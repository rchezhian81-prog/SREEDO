import { Router } from "express";
import { z } from "zod";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { requireInstitutionType } from "../../middleware/institution-type";
import {
  accessibleStudentIds,
  assertStudentAccess,
} from "../../utils/scope";
import {
  createBatchSchema,
  createDepartmentSchema,
  createEnrollmentSchema,
  createProgramSchema,
  createProgramSubjectSchema,
  createSemesterSchema,
  createStaffAllocationSchema,
  updateDepartmentSchema,
  updateEnrollmentSchema,
  updateProgramSchema,
  updateSemesterSchema,
  updateSettingsSchema,
} from "./college.schema";
import * as service from "./college.service";

export const collegeRouter = Router();

collegeRouter.use(authenticate, requireTenant);

const canRead = requirePermission("college:read");
const canCreate = requirePermission("college:create");
const canUpdate = requirePermission("college:update");
const canDelete = requirePermission("college:delete");

const uuidQuery = (...keys: string[]) =>
  z.object(Object.fromEntries(keys.map((k) => [k, z.string().uuid().optional()])));

/**
 * @openapi
 * /college/overview:
 *   get:
 *     tags: [College]
 *     summary: College mode summary (institution type + structure counts)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ type, departments, programs, semesters, enrollments }" }
 */
collegeRouter.get("/overview", canRead, async (req, res) => {
  res.json(await service.overview(tenantId(req)));
});

/**
 * @openapi
 * /college/settings:
 *   patch:
 *     tags: [College]
 *     summary: Switch the institution between school and college mode (own tenant)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type]
 *             properties:
 *               type: { type: string, enum: [school, college] }
 *     responses:
 *       200: { description: "{ id, name, type }" }
 */
collegeRouter.patch("/settings", canUpdate, async (req, res) => {
  const { type } = updateSettingsSchema.parse(req.body);
  res.json(await service.setInstitutionType(tenantId(req), type));
});

// College structures below (departments, programs, semesters, batches,
// program-subjects, enrollments, results, staff allocations) only exist for
// college institutions. /overview and /settings above stay open to any tenant,
// so a school can read its mode and switch in.
collegeRouter.use(requireInstitutionType("college"));

// --- Departments ---

/**
 * @openapi
 * /college/departments:
 *   get:
 *     tags: [College]
 *     summary: List departments (with head teacher + program counts)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Departments ordered by name }
 *   post:
 *     tags: [College]
 *     summary: Create a department
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, code]
 *             properties:
 *               name: { type: string, example: "Computer Science" }
 *               code: { type: string, example: "CS" }
 *               headTeacherId: { type: string, format: uuid, nullable: true }
 *     responses:
 *       201: { description: Created department }
 *       409: { description: Duplicate department code }
 */
collegeRouter.get("/departments", requirePermission("departments:read"), async (req, res) => {
  res.json(await service.listDepartments(tenantId(req)));
});

collegeRouter.post("/departments", requirePermission("departments:create"), async (req, res) => {
  const input = createDepartmentSchema.parse(req.body);
  res.status(201).json(await service.createDepartment(input, tenantId(req)));
});

/**
 * @openapi
 * /college/departments/{id}:
 *   patch:
 *     tags: [College]
 *     summary: Update a department
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated department }
 *   delete:
 *     tags: [College]
 *     summary: Delete a department (cascades to its programs)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
collegeRouter.patch("/departments/:id", canUpdate, async (req, res) => {
  const input = updateDepartmentSchema.parse(req.body);
  res.json(await service.updateDepartment(uuidParam(req), input, tenantId(req)));
});

collegeRouter.delete("/departments/:id", canDelete, async (req, res) => {
  await service.deleteDepartment(uuidParam(req), tenantId(req));
  res.status(204).end();
});

// --- Programs / courses ---

/**
 * @openapi
 * /college/programs:
 *   get:
 *     tags: [College]
 *     summary: List programs/courses (optionally for one department)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: departmentId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Programs ordered by name }
 *   post:
 *     tags: [College]
 *     summary: Create a program/course
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [departmentId, name, code]
 *             properties:
 *               departmentId: { type: string, format: uuid }
 *               name: { type: string, example: "B.Sc Computer Science" }
 *               code: { type: string, example: "BSCS" }
 *               durationSemesters: { type: integer, example: 6 }
 *     responses:
 *       201: { description: Created program }
 *       409: { description: Duplicate program code }
 */
collegeRouter.get("/programs", requirePermission("programs:read"), async (req, res) => {
  const { departmentId } = uuidQuery("departmentId").parse(req.query);
  res.json(await service.listPrograms(tenantId(req), departmentId));
});

collegeRouter.post("/programs", requirePermission("programs:create"), async (req, res) => {
  const input = createProgramSchema.parse(req.body);
  res.status(201).json(await service.createProgram(input, tenantId(req)));
});

/**
 * @openapi
 * /college/programs/{id}:
 *   patch:
 *     tags: [College]
 *     summary: Update a program/course
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated program }
 *   delete:
 *     tags: [College]
 *     summary: Delete a program (cascades to semesters/enrollments)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
collegeRouter.patch("/programs/:id", canUpdate, async (req, res) => {
  const input = updateProgramSchema.parse(req.body);
  res.json(await service.updateProgram(uuidParam(req), input, tenantId(req)));
});

collegeRouter.delete("/programs/:id", canDelete, async (req, res) => {
  await service.deleteProgram(uuidParam(req), tenantId(req));
  res.status(204).end();
});

// --- Semesters ---

/**
 * @openapi
 * /college/semesters:
 *   get:
 *     tags: [College]
 *     summary: List semesters (optionally for one program)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: programId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Semesters ordered by program + number }
 *   post:
 *     tags: [College]
 *     summary: Create a semester
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [programId, name, number]
 *             properties:
 *               programId: { type: string, format: uuid }
 *               name: { type: string, example: "Semester 1" }
 *               number: { type: integer, example: 1 }
 *               academicYearId: { type: string, format: uuid, nullable: true }
 *               startDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *     responses:
 *       201: { description: Created semester }
 *       409: { description: Duplicate semester number for the program }
 */
collegeRouter.get("/semesters", requirePermission("semesters:read"), async (req, res) => {
  const { programId } = uuidQuery("programId").parse(req.query);
  res.json(await service.listSemesters(tenantId(req), programId));
});

collegeRouter.post("/semesters", requirePermission("semesters:create"), async (req, res) => {
  const input = createSemesterSchema.parse(req.body);
  res.status(201).json(await service.createSemester(input, tenantId(req)));
});

/**
 * @openapi
 * /college/semesters/{id}:
 *   patch:
 *     tags: [College]
 *     summary: Update a semester
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated semester }
 *   delete:
 *     tags: [College]
 *     summary: Delete a semester
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
collegeRouter.patch("/semesters/:id", canUpdate, async (req, res) => {
  const input = updateSemesterSchema.parse(req.body);
  res.json(await service.updateSemester(uuidParam(req), input, tenantId(req)));
});

collegeRouter.delete("/semesters/:id", canDelete, async (req, res) => {
  await service.deleteSemester(uuidParam(req), tenantId(req));
  res.status(204).end();
});

// --- Batches ---

/**
 * @openapi
 * /college/batches:
 *   get:
 *     tags: [College]
 *     summary: List academic batches (optionally for one program)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: programId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Batches ordered by name }
 *   post:
 *     tags: [College]
 *     summary: Create an academic batch
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [programId, name]
 *             properties:
 *               programId: { type: string, format: uuid }
 *               name: { type: string, example: "2026-2029" }
 *               startYear: { type: integer, example: 2026 }
 *     responses:
 *       201: { description: Created batch }
 *       409: { description: Duplicate batch for the program }
 */
collegeRouter.get("/batches", canRead, async (req, res) => {
  const { programId } = uuidQuery("programId").parse(req.query);
  res.json(await service.listBatches(tenantId(req), programId));
});

collegeRouter.post("/batches", canCreate, async (req, res) => {
  const input = createBatchSchema.parse(req.body);
  res.status(201).json(await service.createBatch(input, tenantId(req)));
});

/**
 * @openapi
 * /college/batches/{id}:
 *   delete:
 *     tags: [College]
 *     summary: Delete an academic batch
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
collegeRouter.delete("/batches/:id", canDelete, async (req, res) => {
  await service.deleteBatch(uuidParam(req), tenantId(req));
  res.status(204).end();
});

// --- Program subjects (course-wise / semester-wise) ---

/**
 * @openapi
 * /college/program-subjects:
 *   get:
 *     tags: [College]
 *     summary: List subjects mapped to a program/semester (with credits)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: programId, schema: { type: string, format: uuid } }
 *       - { in: query, name: semesterId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Program subjects ordered by semester + subject }
 *   post:
 *     tags: [College]
 *     summary: Map a subject to a program (and optionally a semester) with credits
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [programId, subjectId]
 *             properties:
 *               programId: { type: string, format: uuid }
 *               semesterId: { type: string, format: uuid, nullable: true }
 *               subjectId: { type: string, format: uuid }
 *               credits: { type: number, example: 4 }
 *     responses:
 *       201: { description: Created mapping }
 *       409: { description: Subject already mapped to the semester }
 */
collegeRouter.get("/program-subjects", canRead, async (req, res) => {
  const filters = uuidQuery("programId", "semesterId").parse(req.query);
  res.json(await service.listProgramSubjects(tenantId(req), filters));
});

collegeRouter.post("/program-subjects", canCreate, async (req, res) => {
  const input = createProgramSubjectSchema.parse(req.body);
  res.status(201).json(await service.createProgramSubject(input, tenantId(req)));
});

/**
 * @openapi
 * /college/program-subjects/{id}:
 *   delete:
 *     tags: [College]
 *     summary: Remove a subject mapping
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
collegeRouter.delete("/program-subjects/:id", canDelete, async (req, res) => {
  await service.deleteProgramSubject(uuidParam(req), tenantId(req));
  res.status(204).end();
});

// --- Enrollments ---

/**
 * @openapi
 * /college/enrollments:
 *   get:
 *     tags: [College]
 *     summary: List student enrollments (filter by program/semester)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: programId, schema: { type: string, format: uuid } }
 *       - { in: query, name: semesterId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Enrollments with student + program + semester names }
 *   post:
 *     tags: [College]
 *     summary: Enroll a student into a program (+ semester / batch)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [studentId, programId]
 *             properties:
 *               studentId: { type: string, format: uuid }
 *               programId: { type: string, format: uuid }
 *               semesterId: { type: string, format: uuid, nullable: true }
 *               batchId: { type: string, format: uuid, nullable: true }
 *               status: { type: string, example: active }
 *     responses:
 *       201: { description: Created enrollment }
 *       409: { description: Student already enrolled in the program }
 */
collegeRouter.get("/enrollments", canRead, async (req, res) => {
  const filters = uuidQuery("programId", "semesterId").parse(req.query);
  res.json(await service.listEnrollments(tenantId(req), filters));
});

collegeRouter.post("/enrollments", canCreate, async (req, res) => {
  const input = createEnrollmentSchema.parse(req.body);
  res.status(201).json(await service.createEnrollment(input, tenantId(req)));
});

/**
 * @openapi
 * /college/enrollments/{id}:
 *   patch:
 *     tags: [College]
 *     summary: Update an enrollment (promote semester / change batch / status)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated enrollment }
 *   delete:
 *     tags: [College]
 *     summary: Delete an enrollment
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
collegeRouter.patch("/enrollments/:id", canUpdate, async (req, res) => {
  const input = updateEnrollmentSchema.parse(req.body);
  res.json(await service.updateEnrollment(uuidParam(req), input, tenantId(req)));
});

collegeRouter.delete("/enrollments/:id", canDelete, async (req, res) => {
  await service.deleteEnrollment(uuidParam(req), tenantId(req));
  res.status(204).end();
});

// --- Staff allocations ---

/**
 * @openapi
 * /college/staff-allocations:
 *   get:
 *     tags: [College]
 *     summary: List teacher allocations to departments/programs/subjects
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: teacherId, schema: { type: string, format: uuid } }
 *       - { in: query, name: programId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Allocations with resolved names }
 *   post:
 *     tags: [College]
 *     summary: Allocate a teacher to a department/program/subject
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [teacherId]
 *             properties:
 *               teacherId: { type: string, format: uuid }
 *               departmentId: { type: string, format: uuid, nullable: true }
 *               programId: { type: string, format: uuid, nullable: true }
 *               subjectId: { type: string, format: uuid, nullable: true }
 *     responses:
 *       201: { description: Created allocation }
 */
collegeRouter.get("/staff-allocations", canRead, async (req, res) => {
  const filters = uuidQuery("teacherId", "programId").parse(req.query);
  res.json(await service.listStaffAllocations(tenantId(req), filters));
});

collegeRouter.post("/staff-allocations", canCreate, async (req, res) => {
  const input = createStaffAllocationSchema.parse(req.body);
  res.status(201).json(await service.createStaffAllocation(input, tenantId(req)));
});

/**
 * @openapi
 * /college/staff-allocations/{id}:
 *   delete:
 *     tags: [College]
 *     summary: Remove a teacher allocation
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
collegeRouter.delete("/staff-allocations/:id", canDelete, async (req, res) => {
  await service.deleteStaffAllocation(uuidParam(req), tenantId(req));
  res.status(204).end();
});

// --- Results (owner-scoped: a student/parent may read their own) ---

/**
 * @openapi
 * /college/students/{studentId}/semesters/{semesterId}/result:
 *   get:
 *     tags: [College]
 *     summary: Semester result summary for a student (subject GPA + semester GPA)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: semesterId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ semesterId, semesterName, subjects, totalCredits, gpa }" }
 *       403: { description: Not the student's own record }
 */
collegeRouter.get(
  "/students/:studentId/semesters/:semesterId/result",
  async (req, res) => {
    const studentId = uuidParam(req, "studentId");
    assertStudentAccess(await accessibleStudentIds(req), studentId);
    res.json(
      await service.semesterResult(
        studentId,
        uuidParam(req, "semesterId"),
        tenantId(req)
      )
    );
  }
);

/**
 * @openapi
 * /college/students/{studentId}/cgpa:
 *   get:
 *     tags: [College]
 *     summary: Cumulative GPA across a program's semesters for a student
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: programId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ programId, cgpa, totalCredits, perSemester }" }
 *       403: { description: Not the student's own record }
 */
collegeRouter.get("/students/:studentId/cgpa", async (req, res) => {
  const studentId = uuidParam(req, "studentId");
  assertStudentAccess(await accessibleStudentIds(req), studentId);
  const { programId } = z
    .object({ programId: z.string().uuid() })
    .parse(req.query);
  res.json(await service.cgpa(studentId, programId, tenantId(req)));
});
