export interface Pagination {
  page: number;
  limit: number;
  offset: number;
}

const MAX_LIMIT = 100;

export function parsePagination(query: {
  page?: unknown;
  limit?: unknown;
}): Pagination {
  const page = Math.max(1, Number(query.page) || 1);
  const requested = Number(query.limit) || 20;
  const limit = Math.min(Math.max(1, requested), MAX_LIMIT);
  return { page, limit, offset: (page - 1) * limit };
}

export function paginatedResponse<T>(
  data: T[],
  total: number,
  { page, limit }: Pagination
) {
  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
