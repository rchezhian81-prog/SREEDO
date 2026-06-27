import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import {
  createAdjustmentSchema,
  createCategorySchema,
  createIssueSchema,
  createItemSchema,
  createPurchaseSchema,
  createVendorSchema,
  updateCategorySchema,
  updateItemSchema,
  updateVendorSchema,
} from "./inventory.schema";
import * as service from "./inventory.service";

export const inventoryRouter = Router();

inventoryRouter.use(authenticate, requireTenant);

const canRead = requirePermission("inventory:read");
const canCreate = requirePermission("inventory:create");
const canUpdate = requirePermission("inventory:update");
const canDelete = requirePermission("inventory:delete");
const canPurchase = requirePermission("inventory:purchase");
const canIssue = requirePermission("inventory:issue");
const canAdjust = requirePermission("inventory:adjust");

const optStr = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/**
 * @openapi
 * /inventory/categories:
 *   get:
 *     tags: [Inventory]
 *     summary: List item categories
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Categories with item counts } }
 *   post:
 *     tags: [Inventory]
 *     summary: Create an item category
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [name], properties: { name: { type: string }, code: { type: string } } } } }
 *     responses: { 201: { description: Created }, 409: { description: Duplicate name } }
 */
inventoryRouter.get("/categories", canRead, async (req, res) => {
  res.json(await service.listCategories(tenantId(req)));
});
inventoryRouter.post("/categories", canCreate, async (req, res) => {
  res.status(201).json(await service.createCategory(createCategorySchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /inventory/categories/{id}:
 *   patch:
 *     tags: [Inventory]
 *     summary: Update a category
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     tags: [Inventory]
 *     summary: Delete a category
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Deleted } }
 */
inventoryRouter.patch("/categories/:id", canUpdate, async (req, res) => {
  res.json(await service.updateCategory(uuidParam(req), updateCategorySchema.parse(req.body), tenantId(req)));
});
inventoryRouter.delete("/categories/:id", canDelete, async (req, res) => {
  await service.deleteCategory(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /inventory/vendors:
 *   get:
 *     tags: [Inventory]
 *     summary: List vendors
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Vendors } }
 *   post:
 *     tags: [Inventory]
 *     summary: Create a vendor
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               contactPerson: { type: string }
 *               phone: { type: string }
 *               email: { type: string }
 *               gstNumber: { type: string }
 *               address: { type: string }
 *               paymentTerms: { type: string }
 *     responses: { 201: { description: Created }, 409: { description: Duplicate name } }
 */
inventoryRouter.get("/vendors", canRead, async (req, res) => {
  res.json(await service.listVendors(tenantId(req)));
});
inventoryRouter.post("/vendors", canCreate, async (req, res) => {
  res.status(201).json(await service.createVendor(createVendorSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /inventory/vendors/{id}:
 *   patch:
 *     tags: [Inventory]
 *     summary: Update a vendor
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     tags: [Inventory]
 *     summary: Delete a vendor
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Deleted } }
 */
inventoryRouter.patch("/vendors/:id", canUpdate, async (req, res) => {
  res.json(await service.updateVendor(uuidParam(req), updateVendorSchema.parse(req.body), tenantId(req)));
});
inventoryRouter.delete("/vendors/:id", canDelete, async (req, res) => {
  await service.deleteVendor(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /inventory/items:
 *   get:
 *     tags: [Inventory]
 *     summary: List items (current stock + low-stock flag)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: categoryId, schema: { type: string, format: uuid } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: lowStock, schema: { type: string, enum: ["true"] } }
 *     responses: { 200: { description: Items } }
 *   post:
 *     tags: [Inventory]
 *     summary: Create an item (opening stock seeds current stock)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, code]
 *             properties:
 *               name: { type: string }
 *               code: { type: string }
 *               categoryId: { type: string, format: uuid, nullable: true }
 *               unit: { type: string, example: pcs }
 *               openingStock: { type: number }
 *               minStockLevel: { type: number }
 *               location: { type: string }
 *     responses: { 201: { description: Created }, 409: { description: Duplicate code } }
 */
inventoryRouter.get("/items", canRead, async (req, res) => {
  res.json(
    await service.listItems(tenantId(req), {
      categoryId: optStr(req.query.categoryId),
      search: optStr(req.query.search),
      lowStock: req.query.lowStock === "true",
    })
  );
});
inventoryRouter.post("/items", canCreate, async (req, res) => {
  res.status(201).json(await service.createItem(createItemSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /inventory/items/{id}:
 *   patch:
 *     tags: [Inventory]
 *     summary: Update an item (opening stock is immutable — use an adjustment)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     tags: [Inventory]
 *     summary: Delete an item (blocked if it has movement history)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Deleted }, 409: { description: Has stock history } }
 */
inventoryRouter.patch("/items/:id", canUpdate, async (req, res) => {
  res.json(await service.updateItem(uuidParam(req), updateItemSchema.parse(req.body), tenantId(req)));
});
inventoryRouter.delete("/items/:id", canDelete, async (req, res) => {
  await service.deleteItem(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /inventory/items/{id}/movements:
 *   get:
 *     tags: [Inventory]
 *     summary: Stock movement history for an item (audit ledger)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: "Movements (type, change, balanceAfter)" } }
 */
inventoryRouter.get("/items/:id/movements", canRead, async (req, res) => {
  res.json(await service.listMovements(uuidParam(req), tenantId(req)));
});

/**
 * @openapi
 * /inventory/purchases:
 *   get:
 *     tags: [Inventory]
 *     summary: List purchases (filter by vendor)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: vendorId, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Purchases } }
 *   post:
 *     tags: [Inventory]
 *     summary: Record a purchase (stock in) — increases item stock
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               vendorId: { type: string, format: uuid, nullable: true }
 *               purchaseDate: { type: string, format: date }
 *               billNo: { type: string }
 *               documentId: { type: string, format: uuid, nullable: true, description: "attachment via /documents" }
 *               notes: { type: string }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [itemId, quantity]
 *                   properties:
 *                     itemId: { type: string, format: uuid }
 *                     quantity: { type: number }
 *                     rate: { type: number }
 *     responses: { 200: { description: "{ id, totalAmount, lineCount }" } }
 */
inventoryRouter.get("/purchases", canRead, async (req, res) => {
  res.json(await service.listPurchases(tenantId(req), optStr(req.query.vendorId)));
});
inventoryRouter.post("/purchases", canPurchase, async (req, res) => {
  res.status(201).json(await service.createPurchase(createPurchaseSchema.parse(req.body), req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /inventory/purchases/{id}:
 *   get:
 *     tags: [Inventory]
 *     summary: Get a purchase with its line items
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Purchase + items }, 404: { description: Not found } }
 */
inventoryRouter.get("/purchases/:id", canRead, async (req, res) => {
  res.json(await service.getPurchase(uuidParam(req), tenantId(req)));
});

/**
 * @openapi
 * /inventory/issues:
 *   get:
 *     tags: [Inventory]
 *     summary: List stock issues (filter by item)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: itemId, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Issues } }
 *   post:
 *     tags: [Inventory]
 *     summary: Issue stock (stock out) — decreases stock, rejects if insufficient
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [itemId, quantity]
 *             properties:
 *               itemId: { type: string, format: uuid }
 *               quantity: { type: number }
 *               issuedToType: { type: string, enum: [department, staff, student, event, other] }
 *               issuedTo: { type: string }
 *               purpose: { type: string }
 *               receivedBy: { type: string }
 *               issueDate: { type: string, format: date }
 *     responses: { 201: { description: Created issue }, 409: { description: Insufficient stock } }
 */
inventoryRouter.get("/issues", canRead, async (req, res) => {
  res.json(await service.listIssues(tenantId(req), optStr(req.query.itemId)));
});
inventoryRouter.post("/issues", canIssue, async (req, res) => {
  res.status(201).json(await service.createIssue(createIssueSchema.parse(req.body), req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /inventory/adjustments:
 *   get:
 *     tags: [Inventory]
 *     summary: List stock adjustments (filter by item)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: itemId, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Adjustments } }
 *   post:
 *     tags: [Inventory]
 *     summary: Adjust stock (signed quantity; damage/lost/correction)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [itemId, quantity]
 *             properties:
 *               itemId: { type: string, format: uuid }
 *               quantity: { type: number, description: "signed delta (negative = reduce)" }
 *               reason: { type: string, enum: [damage, lost, correction] }
 *               note: { type: string }
 *               approvedBy: { type: string }
 *     responses: { 201: { description: Created adjustment }, 409: { description: Would make stock negative } }
 */
inventoryRouter.get("/adjustments", canRead, async (req, res) => {
  res.json(await service.listAdjustments(tenantId(req), optStr(req.query.itemId)));
});
inventoryRouter.post("/adjustments", canAdjust, async (req, res) => {
  res.status(201).json(await service.createAdjustment(createAdjustmentSchema.parse(req.body), req.user!.id, tenantId(req)));
});
