import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { hashPassword } from "../../utils/password";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { UserRole } from "../../types";
import type { z } from "zod";
import type { createUserSchema, updateUserSchema } from "./users.schema";

const USER_COLUMNS =
  "id, email, full_name AS \"fullName\", role, phone, is_active AS \"isActive\", created_at AS \"createdAt\"";

export async function listUsers(
  pagination: Pagination,
  filters: { role?: UserRole; search?: string }
) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.role) {
    params.push(filters.role);
    conditions.push(`role = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(full_name ILIKE $${params.length} OR email ILIKE $${params.length})`
    );
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM users ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${USER_COLUMNS} FROM users ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

export async function getUser(id: string) {
  const { rows } = await query(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("User not found");
  return rows[0];
}

export async function createUser(input: z.infer<typeof createUserSchema>) {
  const passwordHash = await hashPassword(input.password);
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, full_name, role, phone)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${USER_COLUMNS}`,
    [input.email, passwordHash, input.fullName, input.role, input.phone ?? null]
  );
  return rows[0];
}

export async function updateUser(
  id: string,
  input: z.infer<typeof updateUserSchema>
) {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.fullName !== undefined) {
    params.push(input.fullName);
    sets.push(`full_name = $${params.length}`);
  }
  if (input.phone !== undefined) {
    params.push(input.phone);
    sets.push(`phone = $${params.length}`);
  }
  if (input.role !== undefined) {
    params.push(input.role);
    sets.push(`role = $${params.length}`);
  }
  if (input.isActive !== undefined) {
    params.push(input.isActive);
    sets.push(`is_active = $${params.length}`);
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");

  params.push(id);
  const { rows } = await query(
    `UPDATE users SET ${sets.join(", ")} WHERE id = $${params.length}
     RETURNING ${USER_COLUMNS}`,
    params
  );
  if (!rows[0]) throw ApiError.notFound("User not found");
  return rows[0];
}

export async function deactivateUser(id: string): Promise<void> {
  const { rowCount } = await query(
    "UPDATE users SET is_active = false WHERE id = $1",
    [id]
  );
  if (!rowCount) throw ApiError.notFound("User not found");
  await query("DELETE FROM refresh_tokens WHERE user_id = $1", [id]);
}
