import crypto from "node:crypto";
import type { Request } from "express";
import type { z } from "zod";
import { query, withTransaction } from "../../db/postgres";
import { getMongoDb } from "../../db/mongo";
import { env } from "../../config/env";
import { ApiError } from "../../utils/api-error";
import { toPaise, toRupees } from "../../utils/money";
import { accessibleStudentIds, assertStudentAccess } from "../../utils/scope";
import { feeReceiptBuffer } from "../pdfs/pdfs.service";
import { gatewayConfigured, gatewayProvider, getGateway } from "./gateway";
import type { createOrderSchema, listOrdersQuerySchema } from "./onlinepayments.schema";

const ORDER_SELECT = `
  po.id,
  po.order_no AS "orderNo",
  po.invoice_id AS "invoiceId",
  i.invoice_no AS "invoiceNo",
  po.student_id AS "studentId",
  s.first_name || ' ' || s.last_name AS "studentName",
  po.amount,
  po.currency,
  po.status,
  po.provider,
  po.gateway_ref AS "gatewayRef",
  po.gateway_payment_id AS "gatewayPaymentId",
  po.payment_id AS "paymentId",
  po.checkout_url AS "checkoutUrl",
  po.created_at AS "createdAt",
  po.updated_at AS "updatedAt"
`;

const ORDER_FROM = `
  FROM payment_orders po
  JOIN invoices i ON i.id = po.invoice_id
  JOIN students s ON s.id = po.student_id
`;

const currency = (): string => env.paymentCurrency;

function orderNo(): string {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `PO-${stamp}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

/** Best-effort audit log of online-payment actions to Mongo (no-op when off). */
function logUsage(action: string, institutionId: string, meta: Record<string, unknown>): void {
  const db = getMongoDb();
  if (!db) return;
  db.collection("online_payment_logs")
    .insertOne({ action, institutionId, ...meta, at: new Date() })
    .catch(() => undefined);
}

// --- Settings (gateway status + per-institution feature flag) ---

async function institutionFlag(institutionId: string): Promise<boolean | null> {
  const { rows } = await query<{ flag: boolean | null }>(
    `SELECT (settings->'featureFlags'->>'onlinePayments')::boolean AS flag
     FROM institutions WHERE id = $1`,
    [institutionId]
  );
  return rows[0]?.flag ?? null;
}

/** Effective: gateway configured AND not explicitly disabled for the institution. */
export async function onlinePaymentsEnabled(institutionId: string): Promise<boolean> {
  if (!gatewayConfigured()) return false;
  return (await institutionFlag(institutionId)) !== false;
}

export async function gatewayStatus(institutionId: string) {
  const configured = gatewayConfigured();
  const institutionEnabled = (await institutionFlag(institutionId)) !== false;
  return {
    configured,
    provider: gatewayProvider(), // non-secret provider name only
    currency: currency(),
    institutionEnabled,
    enabled: configured && institutionEnabled,
    // Secret keys are intentionally never returned.
  };
}

export async function setInstitutionEnabled(institutionId: string, enabled: boolean) {
  await query(
    `UPDATE institutions SET settings =
       COALESCE(settings, '{}'::jsonb)
       || jsonb_build_object('featureFlags',
            COALESCE(settings->'featureFlags', '{}'::jsonb)
            || jsonb_build_object('onlinePayments', $2::boolean))
     WHERE id = $1`,
    [institutionId, enabled]
  );
  return gatewayStatus(institutionId);
}

// --- Orders ---

export async function listOrders(
  req: Request,
  institutionId: string,
  filters: z.infer<typeof listOrdersQuerySchema>
) {
  const params: unknown[] = [institutionId];
  const where = ["po.institution_id = $1"];
  if (filters.status) {
    params.push(filters.status);
    where.push(`po.status = $${params.length}`);
  }
  if (filters.invoiceId) {
    params.push(filters.invoiceId);
    where.push(`po.invoice_id = $${params.length}`);
  }
  if (filters.studentId) {
    params.push(filters.studentId);
    where.push(`po.student_id = $${params.length}`);
  }
  // Owner-scoping: student/parent see only their own/linked orders.
  const allowed = await accessibleStudentIds(req);
  if (allowed != null) {
    params.push(allowed);
    where.push(`po.student_id = ANY($${params.length}::uuid[])`);
  }
  const { rows } = await query(
    `SELECT ${ORDER_SELECT} ${ORDER_FROM} WHERE ${where.join(" AND ")}
     ORDER BY po.created_at DESC LIMIT 200`,
    params
  );
  return rows;
}

async function loadOrder(id: string, institutionId: string) {
  const { rows } = await query<Record<string, unknown> & { studentId: string }>(
    `SELECT ${ORDER_SELECT} ${ORDER_FROM} WHERE po.id = $1 AND po.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Payment order not found");
  return rows[0];
}

export async function getOrder(req: Request, id: string, institutionId: string) {
  const order = await loadOrder(id, institutionId);
  assertStudentAccess(await accessibleStudentIds(req), order.studentId);
  return order;
}

export async function createOrder(
  req: Request,
  input: z.infer<typeof createOrderSchema>,
  institutionId: string,
  userId: string
) {
  const gateway = getGateway();
  if (!gateway) {
    throw new ApiError(503, "Online payment gateway is not configured");
  }
  if (!(await onlinePaymentsEnabled(institutionId))) {
    throw new ApiError(503, "Online payments are not enabled for this institution");
  }

  // Tenant-scoped invoice load.
  const { rows } = await query<{
    student_id: string;
    amount_due: string;
    amount_paid: string;
    status: string;
    invoice_no: string;
    description: string;
    guardian_email: string | null;
  }>(
    `SELECT i.student_id, i.amount_due, i.amount_paid, i.status, i.invoice_no,
            i.description, s.guardian_email
     FROM invoices i JOIN students s ON s.id = i.student_id
     WHERE i.id = $1 AND i.institution_id = $2`,
    [input.invoiceId, institutionId]
  );
  const inv = rows[0];
  if (!inv) throw ApiError.notFound("Invoice not found");

  // Owner-scoping: a student/parent may only pay their own / linked invoices.
  assertStudentAccess(await accessibleStudentIds(req), inv.student_id);

  if (inv.status === "cancelled") throw ApiError.badRequest("Cannot pay a cancelled invoice");
  const outstandingPaise = toPaise(inv.amount_due) - toPaise(inv.amount_paid);
  if (outstandingPaise <= 0) throw ApiError.badRequest("Invoice is already fully paid");

  // Prevent duplicate successful payment for the same invoice.
  const dup = await query(
    `SELECT 1 FROM payment_orders WHERE invoice_id = $1 AND status = 'success' LIMIT 1`,
    [input.invoiceId]
  );
  if (dup.rows[0]) {
    throw ApiError.badRequest("This invoice already has a successful online payment");
  }

  // Anti-tampering: the charge is always the server-computed outstanding balance.
  if (input.amount != null && toPaise(input.amount) !== outstandingPaise) {
    throw ApiError.badRequest("Payment amount does not match the outstanding balance");
  }
  const amount = toRupees(outstandingPaise);

  const no = orderNo();
  const created = await gateway.createOrder({
    orderNo: no,
    amount,
    currency: currency(),
    description: inv.description,
    customerEmail: inv.guardian_email,
  });

  const { rows: orderRows } = await query(
    `INSERT INTO payment_orders
       (institution_id, invoice_id, student_id, order_no, amount, currency, status,
        provider, gateway_ref, checkout_url, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'created', $7, $8, $9, $10)
     RETURNING id`,
    [
      institutionId,
      input.invoiceId,
      inv.student_id,
      no,
      amount,
      currency(),
      gateway.provider,
      created.gatewayRef,
      created.checkoutUrl,
      userId,
    ]
  );
  logUsage("create_order", institutionId, { orderId: orderRows[0].id, userId });
  return loadOrder(orderRows[0].id, institutionId);
}

// --- Webhook processing (signature-verified, idempotent, tenant-scoped) ---

export async function processWebhook(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  parsedBody: unknown
) {
  const gateway = getGateway();
  if (!gateway) throw new ApiError(503, "Online payment gateway is not configured");

  if (!gateway.verifySignature(rawBody, signature)) {
    throw ApiError.unauthorized("Invalid webhook signature");
  }
  const event = gateway.parseEvent(parsedBody);
  if (!event) throw ApiError.badRequest("Unrecognized webhook payload");

  return withTransaction(async (client) => {
    // Idempotency: a given provider event is processed at most once.
    const ins = await client.query<{ id: string }>(
      `INSERT INTO payment_webhook_events (provider, event_id, event_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (provider, event_id) DO NOTHING
       RETURNING id`,
      [gateway.provider, event.eventId, event.eventType]
    );
    if (!ins.rows[0]) {
      return { ok: true, duplicate: true };
    }

    // Resolve the single order this event belongs to (its institution is the
    // only tenant we touch — no cross-tenant data is read or written).
    const { rows: orderRows } = await client.query<{
      id: string;
      institution_id: string;
      invoice_id: string;
      amount: string;
      status: string;
      created_by: string | null;
      gateway_ref: string | null;
    }>(
      `SELECT id, institution_id, invoice_id, amount, status, created_by, gateway_ref
       FROM payment_orders WHERE provider = $1 AND gateway_ref = $2 FOR UPDATE`,
      [gateway.provider, event.gatewayRef]
    );
    const order = orderRows[0];
    if (!order) {
      return { ok: true, matched: false };
    }

    await client.query(
      `UPDATE payment_webhook_events
       SET institution_id = $1, payment_order_id = $2, status = $3
       WHERE provider = $4 AND event_id = $5`,
      [order.institution_id, order.id, event.status, gateway.provider, event.eventId]
    );

    if (event.status === "success") {
      if (order.status === "success") {
        return { ok: true, alreadyProcessed: true, orderId: order.id };
      }
      // Defense-in-depth amount check against the server-set order amount.
      if (event.amount != null && toPaise(event.amount) !== toPaise(order.amount)) {
        throw ApiError.badRequest("Webhook amount does not match the order amount");
      }

      // Credit the invoice using the same ledger rules as offline payments.
      const { rows: invRows } = await client.query<{
        amount_due: string;
        amount_paid: string;
      }>(
        `SELECT amount_due, amount_paid FROM invoices
         WHERE id = $1 AND institution_id = $2 FOR UPDATE`,
        [order.invoice_id, order.institution_id]
      );
      const inv = invRows[0];
      if (!inv) throw ApiError.notFound("Invoice not found");
      const outstandingPaise = toPaise(inv.amount_due) - toPaise(inv.amount_paid);
      const creditPaise = Math.min(toPaise(order.amount), Math.max(outstandingPaise, 0));
      const credit = toRupees(creditPaise);

      let paymentId: string | null = null;
      if (creditPaise > 0) {
        const pay = await client.query<{ id: string }>(
          `INSERT INTO payments
             (institution_id, invoice_id, amount, method, reference, received_by)
           VALUES ($1, $2, $3, 'online', $4, $5) RETURNING id`,
          [
            order.institution_id,
            order.invoice_id,
            credit,
            event.gatewayPaymentId ?? order.gateway_ref,
            order.created_by,
          ]
        );
        paymentId = pay.rows[0].id;
        const newPaidPaise = toPaise(inv.amount_paid) + creditPaise;
        const newStatus =
          newPaidPaise >= toPaise(inv.amount_due) ? "paid" : "partially_paid";
        await client.query(
          "UPDATE invoices SET amount_paid = $1, status = $2 WHERE id = $3",
          [toRupees(newPaidPaise), newStatus, order.invoice_id]
        );
      }
      await client.query(
        `UPDATE payment_orders
         SET status = 'success', gateway_payment_id = $2, payment_id = $3 WHERE id = $1`,
        [order.id, event.gatewayPaymentId ?? null, paymentId]
      );
      logUsage("webhook_success", order.institution_id, { orderId: order.id, paymentId });
      return { ok: true, status: "success", orderId: order.id, paymentId };
    }

    // Non-success terminal/intermediate states — never downgrade a success.
    if (["failed", "cancelled", "expired", "pending"].includes(event.status)) {
      if (order.status !== "success") {
        await client.query("UPDATE payment_orders SET status = $2 WHERE id = $1", [
          order.id,
          event.status,
        ]);
      }
    }
    logUsage(`webhook_${event.status}`, order.institution_id, { orderId: order.id });
    return { ok: true, status: event.status, orderId: order.id };
  });
}

// --- Receipt (reuses the existing fee-receipt PDF for the order's payment) ---

export async function orderReceipt(
  req: Request,
  id: string,
  institutionId: string
): Promise<Buffer> {
  const order = await loadOrder(id, institutionId);
  assertStudentAccess(await accessibleStudentIds(req), order.studentId);
  if (order.status !== "success" || !order.paymentId) {
    throw ApiError.badRequest("Receipt is available only after a successful payment");
  }
  return feeReceiptBuffer(req, order.paymentId as string, institutionId);
}

// --- Refund (gateway-initiated; fee ledger is reconciled via Fees) ---

export async function refundOrder(id: string, institutionId: string) {
  const gateway = getGateway();
  if (!gateway) throw new ApiError(503, "Online payment gateway is not configured");
  if (!gateway.refund) {
    throw ApiError.badRequest("Refunds are not supported by the configured gateway");
  }
  const order = await loadOrder(id, institutionId);
  if (order.status !== "success") {
    throw ApiError.badRequest("Only successful payments can be refunded");
  }
  const result = await gateway.refund(order.gatewayRef as string, Number(order.amount));
  await query(`UPDATE payment_orders SET status = 'refunded', refund_ref = $2 WHERE id = $1`, [
    id,
    result.refundRef,
  ]);
  logUsage("refund", institutionId, { orderId: id });
  return loadOrder(id, institutionId);
}
