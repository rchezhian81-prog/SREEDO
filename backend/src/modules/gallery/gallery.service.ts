import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { z } from "zod";
import type {
  createAlbumSchema,
  updateAlbumSchema,
  listAlbumsQuerySchema,
  addPhotoSchema,
} from "./gallery.schema";

const ALBUM_SELECT = `
  a.id,
  a.title,
  a.description,
  a.cover_url AS "coverUrl",
  a.is_published AS "isPublished",
  (SELECT count(*)::int FROM gallery_photos p WHERE p.album_id = a.id) AS "photoCount",
  a.created_at AS "createdAt",
  a.updated_at AS "updatedAt"
FROM gallery_albums a`;

async function photos(albumId: string) {
  const { rows } = await query(
    `SELECT id, image_url AS "imageUrl", caption, sort_order AS "sortOrder"
     FROM gallery_photos WHERE album_id = $1
     ORDER BY sort_order ASC, created_at ASC`,
    [albumId]
  );
  return rows;
}

// ------------------------------------------------------------------ staff side

export async function listAlbums(
  pagination: Pagination,
  filters: z.infer<typeof listAlbumsQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["a.institution_id = $1"];
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`(a.title ILIKE $${params.length} OR a.description ILIKE $${params.length})`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM gallery_albums a ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${ALBUM_SELECT} ${where}
     ORDER BY a.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

async function albumHeader(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${ALBUM_SELECT} WHERE a.id = $1 AND a.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Album not found");
  return rows[0];
}

export async function getAlbum(id: string, institutionId: string) {
  const album = await albumHeader(id, institutionId);
  return { ...album, photos: await photos(id) };
}

export async function createAlbum(
  input: z.infer<typeof createAlbumSchema>,
  institutionId: string,
  userId: string
) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO gallery_albums (institution_id, title, description, cover_url, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [institutionId, input.title, input.description ?? null, input.coverUrl || null, userId]
  );
  return getAlbum(rows[0].id, institutionId);
}

const ALBUM_UPDATE_MAP: Record<string, string> = {
  title: "title",
  description: "description",
  coverUrl: "cover_url",
  isPublished: "is_published",
};

export async function updateAlbum(
  id: string,
  input: z.infer<typeof updateAlbumSchema>,
  institutionId: string
) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(ALBUM_UPDATE_MAP)) {
    let value = (input as Record<string, unknown>)[field];
    if (value !== undefined) {
      if (field === "coverUrl" && value === "") value = null;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  sets.push("updated_at = now()");
  params.push(id, institutionId);
  const { rowCount } = await query(
    `UPDATE gallery_albums SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Album not found");
  return getAlbum(id, institutionId);
}

export async function deleteAlbum(id: string, institutionId: string): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM gallery_albums WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Album not found");
}

async function assertAlbumInTenant(albumId: string, institutionId: string) {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM gallery_albums WHERE id = $1 AND institution_id = $2",
    [albumId, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Album not found");
}

export async function addPhoto(
  albumId: string,
  input: z.infer<typeof addPhotoSchema>,
  institutionId: string
) {
  await assertAlbumInTenant(albumId, institutionId);
  await query(
    `INSERT INTO gallery_photos (album_id, institution_id, image_url, caption, sort_order)
     VALUES ($1,$2,$3,$4,$5)`,
    [albumId, institutionId, input.imageUrl, input.caption ?? null, input.sortOrder ?? 0]
  );
  return getAlbum(albumId, institutionId);
}

export async function deletePhoto(photoId: string, institutionId: string): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM gallery_photos WHERE id = $1 AND institution_id = $2",
    [photoId, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Photo not found");
}

// ----------------------------------------------------------------- portal side

export async function listPublishedAlbums(institutionId: string) {
  const { rows } = await query(
    `SELECT ${ALBUM_SELECT} WHERE a.institution_id = $1 AND a.is_published = true
     ORDER BY a.created_at DESC`,
    [institutionId]
  );
  return rows;
}

export async function getPublishedAlbum(albumId: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${ALBUM_SELECT} WHERE a.id = $1 AND a.institution_id = $2 AND a.is_published = true`,
    [albumId, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Album not found");
  return { ...rows[0], photos: await photos(albumId) };
}
