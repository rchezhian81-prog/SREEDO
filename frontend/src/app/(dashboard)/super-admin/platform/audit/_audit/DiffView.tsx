"use client";

import type { AuditDiffRow } from "@/types";
import { renderValue } from "./taxonomy";

/**
 * Before/after table for a single event's extracted diff. Colours each row by
 * kind (added → green, removed → red, changed → amber). Falls back to an honest
 * "not captured" note when the backend extracted no diff for the event.
 */
export function DiffView({ diff }: { diff: AuditDiffRow[] }) {
  if (!diff || diff.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">
        Before/after not captured for this event.
      </p>
    );
  }

  const kindStyles: Record<AuditDiffRow["kind"], string> = {
    added: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
    removed: "bg-red-500/12 text-red-600 dark:text-red-400",
    changed: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-slate-200 bg-slate-50 uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">Field</th>
            <th className="px-3 py-2 font-medium">Before</th>
            <th className="px-3 py-2 font-medium">After</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {diff.map((row, i) => (
            <tr key={`${row.field}-${i}`} className="align-top">
              <td className="px-3 py-2">
                <span className="font-mono text-slate-700">{row.field}</span>
                <span
                  className={`ml-2 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${kindStyles[row.kind]}`}
                >
                  {row.kind}
                </span>
              </td>
              <td className="px-3 py-2">
                <span className="block break-all font-mono text-slate-500 line-through decoration-red-300/70">
                  {row.kind === "added" ? "—" : renderValue(row.from)}
                </span>
              </td>
              <td className="px-3 py-2">
                <span className="block break-all font-mono text-slate-700">
                  {row.kind === "removed" ? "—" : renderValue(row.to)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
