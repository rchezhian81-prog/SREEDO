import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { accessibleStudentIds, assertStudentAccess } from "../../utils/scope";
import {
  createBookSchema,
  createCategorySchema,
  createCopySchema,
  createMemberSchema,
  issueSchema,
  postFineSchema,
  returnSchema,
  updateBookSchema,
  updateCategorySchema,
  updateCopySchema,
  updateMemberSchema,
  updateSettingsSchema,
} from "./library.schema";
import * as service from "./library.service";

export const libraryRouter = Router();

libraryRouter.use(authenticate, requireTenant);

const canRead = requirePermission("library:read");
const canCreate = requirePermission("library:create");
const canUpdate = requirePermission("library:update");
const canDelete = requirePermission("library:delete");
const canIssue = requirePermission("library:issue");
const canReturn = requirePermission("library:return");
const canFines = requirePermission("library:fines");

const optStr = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/**
 * @openapi
 * /library/settings:
 *   get:
 *     tags: [Library]
 *     summary: Get circulation settings (loan period, fine rate, limits)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ loanDays, finePerDay, maxRenewals, maxBooksPerMember }" }
 *   patch:
 *     tags: [Library]
 *     summary: Update circulation settings
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Updated settings }
 */
libraryRouter.get("/settings", canRead, async (req, res) => {
  res.json(await service.getSettings(tenantId(req)));
});
libraryRouter.patch("/settings", canUpdate, async (req, res) => {
  res.json(await service.updateSettings(updateSettingsSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /library/categories:
 *   get:
 *     tags: [Library]
 *     summary: List book categories
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Categories with book counts }
 *   post:
 *     tags: [Library]
 *     summary: Create a book category
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: Fiction }
 *               code: { type: string }
 *     responses:
 *       201: { description: Created category }
 *       409: { description: Duplicate category name }
 */
libraryRouter.get("/categories", canRead, async (req, res) => {
  res.json(await service.listCategories(tenantId(req)));
});
libraryRouter.post("/categories", canCreate, async (req, res) => {
  res.status(201).json(await service.createCategory(createCategorySchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /library/categories/{id}:
 *   patch:
 *     tags: [Library]
 *     summary: Update a category
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated category }
 *   delete:
 *     tags: [Library]
 *     summary: Delete a category (books keep, category cleared)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
libraryRouter.patch("/categories/:id", canUpdate, async (req, res) => {
  res.json(await service.updateCategory(uuidParam(req), updateCategorySchema.parse(req.body), tenantId(req)));
});
libraryRouter.delete("/categories/:id", canDelete, async (req, res) => {
  await service.deleteCategory(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /library/books:
 *   get:
 *     tags: [Library]
 *     summary: List/search books (with total + available copy counts)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: categoryId, schema: { type: string, format: uuid } }
 *       - { in: query, name: search, schema: { type: string }, description: "title/author/ISBN" }
 *     responses:
 *       200: { description: Books }
 *   post:
 *     tags: [Library]
 *     summary: Create a book (optionally auto-create N copies)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title: { type: string }
 *               author: { type: string }
 *               isbn: { type: string }
 *               publisher: { type: string }
 *               edition: { type: string }
 *               subject: { type: string }
 *               language: { type: string }
 *               rackLocation: { type: string }
 *               categoryId: { type: string, format: uuid, nullable: true }
 *               copyCount: { type: integer, example: 3, description: "auto-create this many copies" }
 *     responses:
 *       201: { description: Created book }
 */
libraryRouter.get("/books", canRead, async (req, res) => {
  res.json(
    await service.listBooks(tenantId(req), {
      categoryId: optStr(req.query.categoryId),
      search: optStr(req.query.search),
    })
  );
});
libraryRouter.post("/books", canCreate, async (req, res) => {
  res.status(201).json(await service.createBook(createBookSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /library/books/{id}:
 *   get:
 *     tags: [Library]
 *     summary: Get a book with its copies
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Book + copies }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Library]
 *     summary: Update a book
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated book }
 *   delete:
 *     tags: [Library]
 *     summary: Delete a book (blocked if copies are on loan)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 *       409: { description: Has issued copies }
 */
libraryRouter.get("/books/:id", canRead, async (req, res) => {
  res.json(await service.getBook(uuidParam(req), tenantId(req)));
});
libraryRouter.patch("/books/:id", canUpdate, async (req, res) => {
  res.json(await service.updateBook(uuidParam(req), updateBookSchema.parse(req.body), tenantId(req)));
});
libraryRouter.delete("/books/:id", canDelete, async (req, res) => {
  await service.deleteBook(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /library/books/{id}/copies:
 *   get:
 *     tags: [Library]
 *     summary: List a book's copies
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Copies }
 *   post:
 *     tags: [Library]
 *     summary: Add a copy (accession auto-generated if omitted)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       201: { description: Created copy }
 *       409: { description: Duplicate accession number }
 */
libraryRouter.get("/books/:id/copies", canRead, async (req, res) => {
  res.json(await service.listCopies(uuidParam(req), tenantId(req)));
});
libraryRouter.post("/books/:id/copies", canCreate, async (req, res) => {
  res.status(201).json(await service.addCopy(uuidParam(req), createCopySchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /library/copies/{id}:
 *   patch:
 *     tags: [Library]
 *     summary: Update a copy (barcode/accession/status — not the loan status)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated copy }
 *   delete:
 *     tags: [Library]
 *     summary: Delete a copy (blocked if on loan)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
libraryRouter.patch("/copies/:id", canUpdate, async (req, res) => {
  res.json(await service.updateCopy(uuidParam(req), updateCopySchema.parse(req.body), tenantId(req)));
});
libraryRouter.delete("/copies/:id", canDelete, async (req, res) => {
  await service.deleteCopy(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /library/members:
 *   get:
 *     tags: [Library]
 *     summary: List members (students/staff) with open-loan counts
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: memberType, schema: { type: string, enum: [student, staff] } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Members }
 *   post:
 *     tags: [Library]
 *     summary: Register a library member (student or staff)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [memberType]
 *             properties:
 *               memberType: { type: string, enum: [student, staff] }
 *               studentId: { type: string, format: uuid, nullable: true }
 *               teacherId: { type: string, format: uuid, nullable: true }
 *               memberCode: { type: string }
 *     responses:
 *       201: { description: Created member }
 *       409: { description: Already a member }
 */
libraryRouter.get("/members", canRead, async (req, res) => {
  res.json(
    await service.listMembers(tenantId(req), {
      memberType: optStr(req.query.memberType),
      search: optStr(req.query.search),
    })
  );
});
libraryRouter.post("/members", canCreate, async (req, res) => {
  res.status(201).json(await service.createMember(createMemberSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /library/members/{id}:
 *   patch:
 *     tags: [Library]
 *     summary: Update a member (status/code)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated member }
 *   delete:
 *     tags: [Library]
 *     summary: Delete a member (blocked with books on loan)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
libraryRouter.patch("/members/:id", canUpdate, async (req, res) => {
  res.json(await service.updateMember(uuidParam(req), updateMemberSchema.parse(req.body), tenantId(req)));
});
libraryRouter.delete("/members/:id", canDelete, async (req, res) => {
  await service.deleteMember(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /library/members/{id}/history:
 *   get:
 *     tags: [Library]
 *     summary: Borrowing history for a member
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Issue rows (with overdue flag + fines) }
 */
libraryRouter.get("/members/:id/history", canRead, async (req, res) => {
  res.json(await service.memberHistory(uuidParam(req), tenantId(req)));
});

/**
 * @openapi
 * /library/issues:
 *   post:
 *     tags: [Library]
 *     summary: Issue a book to a member (by copyId or bookId)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [memberId]
 *             properties:
 *               memberId: { type: string, format: uuid }
 *               copyId: { type: string, format: uuid }
 *               bookId: { type: string, format: uuid, description: "picks any available copy" }
 *               dueDate: { type: string, format: date }
 *     responses:
 *       201: { description: Created issue }
 *       409: { description: No copies available / borrowing limit reached }
 */
libraryRouter.post("/issues", canIssue, async (req, res) => {
  res.status(201).json(await service.issueBook(issueSchema.parse(req.body), req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /library/issues/{id}/renew:
 *   post:
 *     tags: [Library]
 *     summary: Renew an open issue (extends the due date)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: New due date }
 *       409: { description: Renewal limit reached }
 */
libraryRouter.post("/issues/:id/renew", canIssue, async (req, res) => {
  res.json(await service.renewIssue(uuidParam(req), tenantId(req)));
});

/**
 * @openapi
 * /library/issues/{id}/return:
 *   post:
 *     tags: [Library]
 *     summary: Return a book (computes any late fine)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               condition: { type: string, enum: [ok, lost, damaged] }
 *     responses:
 *       200: { description: "Return result (fineAmount, fineStatus)" }
 */
libraryRouter.post("/issues/:id/return", canReturn, async (req, res) => {
  res.json(await service.returnBook(uuidParam(req), returnSchema.parse(req.body ?? {}), req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /library/issues/{id}/waive-fine:
 *   post:
 *     tags: [Library]
 *     summary: Waive a pending fine
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Waived }
 *       400: { description: No pending fine }
 */
libraryRouter.post("/issues/:id/waive-fine", canFines, async (req, res) => {
  res.json(await service.waiveFine(uuidParam(req), tenantId(req)));
});

/**
 * @openapi
 * /library/issues/{id}/post-fine:
 *   post:
 *     tags: [Library]
 *     summary: Post a pending fine to a student invoice (Fees module)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "Posted (invoiceId)" }
 *       400: { description: No pending fine / not a student member }
 */
libraryRouter.post("/issues/:id/post-fine", canFines, async (req, res) => {
  res.json(await service.postFineToInvoice(uuidParam(req), postFineSchema.parse(req.body ?? {}), tenantId(req)));
});

/**
 * @openapi
 * /library/students/{studentId}/history:
 *   get:
 *     tags: [Library]
 *     summary: A student's own library history (owner-scoped, for the portal)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Issue rows }
 *       403: { description: Not the student's own record }
 */
libraryRouter.get("/students/:studentId/history", async (req, res) => {
  const studentId = uuidParam(req, "studentId");
  assertStudentAccess(await accessibleStudentIds(req), studentId);
  res.json(await service.historyForStudent(studentId, tenantId(req)));
});
