// PR-T5 — shared types for the tenant Import/Export center registry.
import type { Cell } from "../../utils/spreadsheet";

export type Applicability = "school" | "college" | "both";

/** A CSV column in an entity's template / documentation. */
export interface ColumnSpec {
  field: string;
  required?: boolean;
  note?: string;
}

/** A single row-level validation error. */
export interface RowError {
  field: string;
  message: string;
}

/**
 * An importable entity. The engine drives it: toInput (shape) → validate
 * (cross-row + in-tenant FK/dup, read-only) → commit (atomic). `permission` is
 * the per-entity capability required IN ADDITION to data_io:import, so the center
 * never becomes a permission bypass.
 */
export interface ImportEntity<TInput = unknown> {
  key: string;
  label: string;
  appliesTo: Applicability;
  permission: string;
  columns: ColumnSpec[];
  /** Shape-validate one CSV record → typed input, or per-row errors. */
  toInput(rec: Record<string, string>): { input?: TInput; errors: RowError[] };
  /**
   * Batch validation. `inputs[i]` is undefined when toInput failed for that row.
   * Returns an errors array per row index (empty array = that row is valid).
   * MUST NOT write to domain tables.
   */
  validate(inputs: (TInput | undefined)[], institutionId: string): Promise<RowError[][]>;
  /** Commit the already-valid inputs atomically (all-or-nothing). */
  commit(inputs: TInput[], institutionId: string): Promise<number>;
}

/** An exportable entity — a read-only projection to CSV/XLSX. */
export interface ExportEntity {
  key: string;
  label: string;
  appliesTo: Applicability;
  permission: string;
  /** Broad/PII/money datasets: require a reason + audit before download. */
  sensitive?: boolean;
  headers: string[];
  fetch(institutionId: string): Promise<Cell[][]>;
}
