import crypto from "node:crypto";

/**
 * Pluggable online payment gateway adapter.
 *
 * The provider and its secrets come from environment variables only — nothing is
 * hardcoded or committed. Configuration is read dynamically (not cached at import)
 * so deployments can rotate it and tests can toggle it. When the provider or the
 * webhook secret is unset the gateway is "not configured" and callers degrade
 * gracefully (offline fee collection is unaffected).
 *
 * We never store or even receive card/bank/UPI data: orders are created as a
 * hosted-checkout / payment-link flow and we keep only non-sensitive provider
 * order/payment references.
 */

export type PaymentOrderStatus =
  | "created"
  | "pending"
  | "success"
  | "failed"
  | "cancelled"
  | "expired"
  | "refunded";

export interface CreateOrderInput {
  orderNo: string;
  amount: number; // major currency units (e.g. rupees)
  currency: string;
  description: string;
  customerEmail?: string | null;
}

export interface CreatedOrder {
  gatewayRef: string; // provider order id (not sensitive)
  checkoutUrl: string; // hosted checkout / payment link
}

export interface WebhookEvent {
  eventId: string; // provider event id (idempotency key)
  eventType: string;
  gatewayRef: string; // maps to payment_orders.gateway_ref
  status: PaymentOrderStatus;
  gatewayPaymentId?: string | null;
  amount?: number | null;
}

export interface PaymentGateway {
  provider: string;
  createOrder(input: CreateOrderInput): Promise<CreatedOrder>;
  /** Refund a captured payment; null when the provider has no refund support. */
  refund?(gatewayRef: string, amount: number): Promise<{ refundRef: string }>;
  verifySignature(rawBody: Buffer | undefined, signature: string | undefined): boolean;
  parseEvent(body: unknown): WebhookEvent | null;
}

interface GatewayConfig {
  provider: string;
  webhookSecret: string;
  checkoutBaseUrl: string;
}

function readConfig(): GatewayConfig | null {
  const provider = process.env.PAYMENT_GATEWAY_PROVIDER?.trim();
  const webhookSecret = process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET?.trim();
  if (!provider || !webhookSecret) return null;
  const checkoutBaseUrl =
    process.env.PAYMENT_CHECKOUT_BASE_URL?.trim() || "https://pay.example.com/checkout";
  return { provider, webhookSecret, checkoutBaseUrl };
}

export function gatewayConfigured(): boolean {
  return readConfig() !== null;
}

export function gatewayProvider(): string | null {
  return readConfig()?.provider ?? null;
}

function mapStatus(raw: string): PaymentOrderStatus | null {
  const s = raw.toLowerCase();
  if (s.includes("success") || s.includes("paid") || s.includes("captured")) return "success";
  if (s.includes("refund")) return "refunded";
  if (s.includes("fail")) return "failed";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("expire")) return "expired";
  if (s.includes("pending") || s.includes("created") || s.includes("authorized")) return "pending";
  return null;
}

/**
 * A provider-agnostic hosted-checkout adapter. A real integration would call the
 * provider SDK in createOrder/refund; the contract (hosted link out, HMAC-signed
 * webhook in) is identical across Razorpay/Stripe/PayU/etc., so swapping providers
 * is a matter of changing this class — nothing else in the app changes.
 */
class HostedCheckoutGateway implements PaymentGateway {
  constructor(private readonly cfg: GatewayConfig) {}

  get provider(): string {
    return this.cfg.provider;
  }

  async createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    const gatewayRef = `${this.cfg.provider}_${input.orderNo}`;
    const url = new URL(this.cfg.checkoutBaseUrl);
    url.searchParams.set("order", gatewayRef);
    url.searchParams.set("amount", input.amount.toFixed(2));
    url.searchParams.set("currency", input.currency);
    return { gatewayRef, checkoutUrl: url.toString() };
  }

  async refund(gatewayRef: string): Promise<{ refundRef: string }> {
    return { refundRef: `rfnd_${gatewayRef}_${crypto.randomBytes(4).toString("hex")}` };
  }

  verifySignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
    if (!rawBody || !signature) return false;
    const expected = crypto
      .createHmac("sha256", this.cfg.webhookSecret)
      .update(rawBody)
      .digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseEvent(body: unknown): WebhookEvent | null {
    if (!body || typeof body !== "object") return null;
    const b = body as Record<string, unknown>;
    const data = (b.data ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string | undefined =>
      typeof v === "string" && v ? v : typeof v === "number" ? String(v) : undefined;

    const eventId = str(b.id) ?? str(b.event_id);
    const gatewayRef =
      str(data.gatewayRef) ?? str(data.gateway_ref) ?? str(b.gatewayRef) ?? str(data.orderNo);
    const rawStatus = str(b.type) ?? str(b.event) ?? str(data.status) ?? "";
    if (!eventId || !gatewayRef) return null;
    const status = mapStatus(rawStatus);
    if (!status) return null;

    const amountRaw = data.amount ?? b.amount;
    return {
      eventId,
      eventType: rawStatus,
      gatewayRef,
      status,
      gatewayPaymentId: str(data.paymentId) ?? str(data.payment_id) ?? null,
      amount: amountRaw != null && amountRaw !== "" ? Number(amountRaw) : null,
    };
  }
}

export function getGateway(): PaymentGateway | null {
  const cfg = readConfig();
  return cfg ? new HostedCheckoutGateway(cfg) : null;
}

/** HMAC-SHA256 signature helper (exposed for tooling/tests that send webhooks). */
export function signPayload(rawBody: string | Buffer, secret: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}
