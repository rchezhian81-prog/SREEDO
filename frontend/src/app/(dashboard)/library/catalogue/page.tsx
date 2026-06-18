"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { BookCategory, LibraryBook } from "@/types";

const bookSchema = z.object({
  title: z.string().min(1, "Required"),
  author: z.string().optional(),
  isbn: z.string().optional(),
  publisher: z.string().optional(),
  edition: z.string().optional(),
  subject: z.string().optional(),
  language: z.string().optional(),
  rackLocation: z.string().optional(),
  categoryId: z.string().optional(),
  copyCount: z.coerce.number().int().min(0).optional(),
});

type BookForm = z.infer<typeof bookSchema>;

const categorySchema = z.object({
  name: z.string().min(1, "Required"),
  code: z.string().optional(),
});

type CategoryForm = z.infer<typeof categorySchema>;

export default function LibraryCataloguePage() {
  const { can, loading: permsLoading } = usePermissions();
  const canCreate = can("library:create");
  const canUpdate = can("library:update");
  const canDelete = can("library:delete");

  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [categories, setCategories] = useState<BookCategory[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [bookModalOpen, setBookModalOpen] = useState(false);
  const [editing, setEditing] = useState<LibraryBook | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);

  const [categoryError, setCategoryError] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    try {
      setCategories(await api.get<BookCategory[]>("/library/categories"));
    } catch {
      // categories are non-critical; ignore
    }
  }, []);

  const loadBooks = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (categoryFilter) params.set("categoryId", categoryFilter);
      if (search) params.set("search", search);
      const qs = params.toString();
      setBooks(
        await api.get<LibraryBook[]>(`/library/books${qs ? `?${qs}` : ""}`)
      );
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load books"
      );
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, search]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  // --- Book form ---
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<BookForm>({ resolver: zodResolver(bookSchema) });

  const openCreate = () => {
    setEditing(null);
    setBookError(null);
    reset({
      title: "",
      author: "",
      isbn: "",
      publisher: "",
      edition: "",
      subject: "",
      language: "",
      rackLocation: "",
      categoryId: "",
      copyCount: 1,
    });
    setBookModalOpen(true);
  };

  const openEdit = (book: LibraryBook) => {
    setEditing(book);
    setBookError(null);
    reset({
      title: book.title,
      author: book.author ?? "",
      isbn: book.isbn ?? "",
      publisher: book.publisher ?? "",
      edition: book.edition ?? "",
      subject: book.subject ?? "",
      language: book.language ?? "",
      rackLocation: book.rackLocation ?? "",
      categoryId: book.categoryId ?? "",
    });
    setBookModalOpen(true);
  };

  const onSubmitBook = async (values: BookForm) => {
    setBookError(null);
    const body: Record<string, unknown> = {
      title: values.title,
      author: values.author || undefined,
      isbn: values.isbn || undefined,
      publisher: values.publisher || undefined,
      edition: values.edition || undefined,
      subject: values.subject || undefined,
      language: values.language || undefined,
      rackLocation: values.rackLocation || undefined,
      categoryId: values.categoryId || undefined,
    };
    if (!editing) body.copyCount = values.copyCount ?? 0;
    try {
      if (editing) {
        await api.patch(`/library/books/${editing.id}`, body);
      } else {
        await api.post("/library/books", body);
      }
      setBookModalOpen(false);
      reset();
      await Promise.all([loadBooks(), loadCategories()]);
    } catch (err) {
      setBookError(
        err instanceof ApiError ? err.message : "Failed to save book"
      );
    }
  };

  const removeBook = async (book: LibraryBook) => {
    if (!confirm(`Delete "${book.title}" and all its copies?`)) return;
    try {
      await api.delete(`/library/books/${book.id}`);
      await Promise.all([loadBooks(), loadCategories()]);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete book");
    }
  };

  // --- Category form ---
  const {
    register: registerCategory,
    handleSubmit: handleCategorySubmit,
    reset: resetCategory,
    formState: { errors: categoryErrors, isSubmitting: categorySubmitting },
  } = useForm<CategoryForm>({ resolver: zodResolver(categorySchema) });

  const onCreateCategory = async (values: CategoryForm) => {
    setCategoryError(null);
    try {
      await api.post("/library/categories", {
        name: values.name,
        code: values.code || undefined,
      });
      resetCategory({ name: "", code: "" });
      await loadCategories();
    } catch (err) {
      setCategoryError(
        err instanceof ApiError ? err.message : "Failed to create category"
      );
    }
  };

  const removeCategory = async (category: BookCategory) => {
    if (!confirm(`Delete category "${category.name}"?`)) return;
    try {
      await api.delete(`/library/categories/${category.id}`);
      await loadCategories();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete category");
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Catalogue" subtitle="Books & categories" />
        <Spinner />
      </>
    );
  }

  if (!can("library:read")) {
    return (
      <>
        <PageHeader title="Catalogue" subtitle="Books & categories" />
        <EmptyState message="You do not have access to the library." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Catalogue"
        subtitle="Books & categories"
        action={
          canCreate ? (
            <Button onClick={openCreate}>+ Add book</Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Link
          href="/library"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Library
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="w-64">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Search
              </span>
              <Input
                placeholder="Title, author or ISBN…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="w-56">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Category
              </span>
              <Select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {loading ? (
            <Spinner />
          ) : loadError ? (
            <ErrorNote message={loadError} />
          ) : books.length === 0 ? (
            <EmptyState message="No books found" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Author</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Available</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {books.map((book) => (
                    <tr key={book.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        <Link
                          href={`/library/books/${book.id}`}
                          className="text-brand-600 hover:text-brand-700"
                        >
                          {book.title}
                        </Link>
                        {book.isbn && (
                          <span className="block font-mono text-xs text-slate-400">
                            {book.isbn}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">{book.author ?? "—"}</td>
                      <td className="px-4 py-3">{book.categoryName ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Badge
                          tone={book.availableCopies > 0 ? "green" : "amber"}
                        >
                          {book.availableCopies} / {book.totalCopies}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-3">
                          <Link
                            href={`/library/books/${book.id}`}
                            className="text-xs font-medium text-brand-600 hover:text-brand-700"
                          >
                            Copies
                          </Link>
                          {canUpdate && (
                            <button
                              onClick={() => openEdit(book)}
                              className="text-xs font-medium text-brand-600 hover:text-brand-700"
                            >
                              Edit
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => removeBook(book)}
                              className="text-xs font-medium text-red-600 hover:text-red-700"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <Card className="h-fit">
          <h2 className="text-sm font-semibold text-slate-900">Categories</h2>
          <p className="mt-1 text-sm text-slate-500">
            Organise the catalogue by subject area.
          </p>

          {canCreate && (
            <form
              onSubmit={handleCategorySubmit(onCreateCategory)}
              className="mt-4 space-y-3"
            >
              <Field label="Name" error={categoryErrors.name?.message}>
                <Input placeholder="Fiction" {...registerCategory("name")} />
              </Field>
              <Field label="Code" error={categoryErrors.code?.message}>
                <Input placeholder="FIC" {...registerCategory("code")} />
              </Field>
              <ErrorNote message={categoryError} />
              <Button
                type="submit"
                className="w-full"
                disabled={categorySubmitting}
              >
                {categorySubmitting ? "Adding…" : "Add category"}
              </Button>
            </form>
          )}

          <div className="mt-4 space-y-2">
            {categories.length === 0 ? (
              <p className="text-sm text-slate-400">No categories yet.</p>
            ) : (
              categories.map((category) => (
                <div
                  key={category.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {category.name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {category.code ? `${category.code} · ` : ""}
                      {category.bookCount}{" "}
                      {category.bookCount === 1 ? "book" : "books"}
                    </p>
                  </div>
                  {canDelete && (
                    <button
                      onClick={() => removeCategory(category)}
                      className="text-xs font-medium text-red-600 hover:text-red-700"
                    >
                      Delete
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Modal
        title={editing ? "Edit book" : "Add book"}
        open={bookModalOpen}
        onClose={() => setBookModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmitBook)} className="space-y-4">
          <Field label="Title" error={errors.title?.message}>
            <Input {...register("title")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Author" error={errors.author?.message}>
              <Input {...register("author")} />
            </Field>
            <Field label="ISBN" error={errors.isbn?.message}>
              <Input {...register("isbn")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Publisher" error={errors.publisher?.message}>
              <Input {...register("publisher")} />
            </Field>
            <Field label="Edition" error={errors.edition?.message}>
              <Input {...register("edition")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Subject" error={errors.subject?.message}>
              <Input {...register("subject")} />
            </Field>
            <Field label="Language" error={errors.language?.message}>
              <Input {...register("language")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rack location" error={errors.rackLocation?.message}>
              <Input {...register("rackLocation")} />
            </Field>
            <Field label="Category" error={errors.categoryId?.message}>
              <Select {...register("categoryId")}>
                <option value="">— None —</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {!editing && (
            <Field label="Number of copies" error={errors.copyCount?.message}>
              <Input type="number" min={0} {...register("copyCount")} />
            </Field>
          )}
          <ErrorNote message={bookError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setBookModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save book"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
