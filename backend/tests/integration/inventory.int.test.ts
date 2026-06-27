import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

describe("inventory management", () => {
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, b?: unknown) => request(app).post(p).set(auth(t)).send(b ?? {});
  const patch = (p: string, t: string, b: unknown) => request(app).patch(p).set(auth(t)).send(b);
  const del = (p: string, t: string) => request(app).delete(p).set(auth(t));

  async function makeItem(code: string, opening = 0, minLevel = 0): Promise<string> {
    const res = await post("/api/v1/inventory/items", tok.admin, { name: `Item ${code}`, code, unit: "pcs", openingStock: opening, minStockLevel: minLevel });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }
  async function currentStock(id: string): Promise<number> {
    const items = (await get("/api/v1/inventory/items", tok.admin)).body as Array<{ id: string; currentStock: string }>;
    return Number(items.find((i) => i.id === id)!.currentStock);
  }

  beforeEach(async () => {
    await resetDb();
    const instA = await createInstitution("INV");
    await createUser({ email: "admin@inv.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "teacher@inv.dev", password: PW, role: "teacher", institutionId: instA });
    await createUser({ email: "accountant@inv.dev", password: PW, role: "accountant", institutionId: instA });
    await createUser({ email: "student@inv.dev", password: PW, role: "student", institutionId: instA });

    const instB = await createInstitution("INV2");
    await createUser({ email: "admin@inv2.dev", password: PW, role: "admin", institutionId: instB });

    for (const r of ["admin", "teacher", "accountant", "student"]) tok[r] = await tokenFor(`${r}@inv.dev`, PW);
    tok.badmin = await tokenFor("admin@inv2.dev", PW);
  });

  it("manages categories, vendors and items (opening stock seeds current)", async () => {
    const cat = await post("/api/v1/inventory/categories", tok.admin, { name: "Stationery", code: "STN" });
    expect(cat.status).toBe(201);
    expect((await post("/api/v1/inventory/categories", tok.admin, { name: "Stationery" })).status).toBe(409);

    const vendor = await post("/api/v1/inventory/vendors", tok.admin, { name: "Acme", gstNumber: "GST1", paymentTerms: "Net 30" });
    expect(vendor.status).toBe(201);

    const item = await post("/api/v1/inventory/items", tok.admin, {
      name: "Pen", code: "PEN", categoryId: cat.body.id, unit: "pcs", openingStock: 10, minStockLevel: 5,
    });
    expect(item.status).toBe(201);
    expect(Number(item.body.currentStock)).toBe(10);
    expect((await post("/api/v1/inventory/items", tok.admin, { name: "Dup", code: "PEN" })).status).toBe(409);

    const list = (await get("/api/v1/inventory/items", tok.admin)).body;
    const row = list.find((i: { id: string }) => i.id === item.body.id);
    expect(Number(row.currentStock)).toBe(10);
    expect(row.lowStock).toBe(false);
    expect(row.categoryName).toBe("Stationery");

    // Opening stock is recorded in the movement ledger.
    const moves = (await get(`/api/v1/inventory/items/${item.body.id}/movements`, tok.admin)).body;
    expect(moves).toHaveLength(1);
    expect(moves[0].type).toBe("opening");
    expect(Number(moves[0].balanceAfter)).toBe(10);
  });

  it("increases stock on purchase", async () => {
    const item = await makeItem("PEN", 0);
    const vendor = await post("/api/v1/inventory/vendors", tok.admin, { name: "Acme" });

    const purchase = await post("/api/v1/inventory/purchases", tok.accountant, {
      vendorId: vendor.body.id, billNo: "B-1",
      items: [{ itemId: item, quantity: 5, rate: 100 }],
    });
    expect(purchase.status).toBe(201);
    expect(Number(purchase.body.totalAmount)).toBe(500);
    expect(await currentStock(item)).toBe(5);

    const full = await get(`/api/v1/inventory/purchases/${purchase.body.id}`, tok.admin);
    expect(full.body.items).toHaveLength(1);
    expect(Number(full.body.items[0].amount)).toBe(500);

    const moves = (await get(`/api/v1/inventory/items/${item}/movements`, tok.admin)).body;
    expect(moves[moves.length - 1].type).toBe("purchase");
    expect(Number(moves[moves.length - 1].balanceAfter)).toBe(5);
  });

  it("decreases stock on issue and prevents over-issue", async () => {
    const item = await makeItem("PEN", 5);
    const issue = await post("/api/v1/inventory/issues", tok.admin, {
      itemId: item, quantity: 3, issuedToType: "department", issuedTo: "Science Lab", purpose: "Lab use",
    });
    expect(issue.status).toBe(201);
    expect(await currentStock(item)).toBe(2);

    // Insufficient stock → 409, stock unchanged.
    expect((await post("/api/v1/inventory/issues", tok.admin, { itemId: item, quantity: 5 })).status).toBe(409);
    expect(await currentStock(item)).toBe(2);

    const issues = (await get(`/api/v1/inventory/issues?itemId=${item}`, tok.admin)).body;
    expect(issues).toHaveLength(1);
  });

  it("adjusts stock (damage/lost/correction) with negative guard", async () => {
    const item = await makeItem("PEN", 2);
    const dmg = await post("/api/v1/inventory/adjustments", tok.admin, { itemId: item, quantity: -1, reason: "damage", note: "broken" });
    expect(dmg.status).toBe(201);
    expect(await currentStock(item)).toBe(1);

    await post("/api/v1/inventory/adjustments", tok.admin, { itemId: item, quantity: 10, reason: "correction" });
    expect(await currentStock(item)).toBe(11);

    // Cannot adjust below zero.
    expect((await post("/api/v1/inventory/adjustments", tok.admin, { itemId: item, quantity: -100 })).status).toBe(409);

    const dl = await get("/api/v1/report-center/inventory_damaged_lost", tok.admin);
    expect(dl.body.rows).toHaveLength(1);
    expect(dl.body.rows[0].reason).toBe("damage");
  });

  it("reports low stock, movements and vendor purchases", async () => {
    const low = await makeItem("LOW", 2, 5); // current 2 <= min 5
    const ok = await makeItem("OK", 50, 5);
    const vendor = await post("/api/v1/inventory/vendors", tok.admin, { name: "Acme" });
    await post("/api/v1/inventory/purchases", tok.accountant, { vendorId: vendor.body.id, items: [{ itemId: ok, quantity: 1, rate: 250 }] });

    const lowRpt = await get("/api/v1/report-center/inventory_low_stock", tok.admin);
    const codes = lowRpt.body.rows.map((r: { code: string }) => r.code);
    expect(codes).toContain("LOW");
    expect(codes).not.toContain("OK");

    const reg = await get("/api/v1/report-center/inventory_stock_register", tok.admin);
    expect(reg.body.rows.length).toBe(2);

    const vp = await get("/api/v1/report-center/inventory_vendor_purchases", tok.admin);
    const acme = vp.body.rows.find((r: { vendor: string }) => r.vendor === "Acme");
    expect(Number(acme.totalAmount)).toBe(250);

    const mv = await get(`/api/v1/report-center/inventory_item_movements?itemId=${low}`, tok.admin);
    expect(mv.body.rows).toHaveLength(1); // opening only
  });

  it("blocks deleting an item with movement history", async () => {
    const item = await makeItem("PEN", 5);
    expect((await del(`/api/v1/inventory/items/${item}`, tok.admin)).status).toBe(409);
    const fresh = await makeItem("FRESH", 0);
    expect((await del(`/api/v1/inventory/items/${fresh}`, tok.admin)).status).toBe(204);
  });

  it("enforces permission guards", async () => {
    const item = await makeItem("PEN", 5);
    // teacher: read yes; create/purchase/issue/adjust no.
    expect((await get("/api/v1/inventory/items", tok.teacher)).status).toBe(200);
    expect((await post("/api/v1/inventory/items", tok.teacher, { name: "X", code: "X" })).status).toBe(403);
    expect((await post("/api/v1/inventory/purchases", tok.teacher, { items: [{ itemId: item, quantity: 1 }] })).status).toBe(403);
    expect((await post("/api/v1/inventory/issues", tok.teacher, { itemId: item, quantity: 1 })).status).toBe(403);
    // accountant: purchase yes; create/issue/adjust no.
    const vendor = await post("/api/v1/inventory/vendors", tok.admin, { name: "Acme" });
    expect((await post("/api/v1/inventory/purchases", tok.accountant, { vendorId: vendor.body.id, items: [{ itemId: item, quantity: 1, rate: 1 }] })).status).toBe(201);
    expect((await post("/api/v1/inventory/items", tok.accountant, { name: "Y", code: "Y" })).status).toBe(403);
    expect((await post("/api/v1/inventory/issues", tok.accountant, { itemId: item, quantity: 1 })).status).toBe(403);
    expect((await post("/api/v1/inventory/adjustments", tok.accountant, { itemId: item, quantity: -1 })).status).toBe(403);
    // student: no access.
    expect((await get("/api/v1/inventory/items", tok.student)).status).toBe(403);
  });

  it("is tenant-scoped (no cross-institution access)", async () => {
    const item = await makeItem("PEN", 5);
    await post("/api/v1/inventory/vendors", tok.admin, { name: "Acme" });
    // B sees none of A's data.
    expect((await get("/api/v1/inventory/items", tok.badmin)).body).toHaveLength(0);
    expect((await get("/api/v1/inventory/vendors", tok.badmin)).body).toHaveLength(0);
    // B cannot purchase against A's item or issue A's stock.
    expect((await post("/api/v1/inventory/purchases", tok.badmin, { items: [{ itemId: item, quantity: 1 }] })).status).toBe(400);
    expect((await post("/api/v1/inventory/issues", tok.badmin, { itemId: item, quantity: 1 })).status).toBe(400);
  });
});
