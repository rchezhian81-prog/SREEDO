// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * PR-UI6 — tenant staff Students. jsdom pins the contracts independent of pixels
 * (the Playwright matrix owns those):
 *   1. Data/terminology parity — rendered rows/columns equal the payload for
 *      School and College; no student-data or query change.
 *   2. Request/action parity — the page requests only /students (+ placement
 *      reads); Add opens an empty modal, Edit opens a prefilled one.
 *   3. a11y markup is eligible-UI-v2-ONLY (Decision 4): off-flag adds no
 *      scope/caption/aria-label (legacy byte-identical); on-flag adds them.
 *   4. Frozen-surface + dormancy — every `.st-*` rule is `.ui-v2`-scoped, uses NO
 *      glass (backdrop-filter) and NO gold. All fixture data is synthetic.
 */

const { getMock, postMock, patchMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(), postMock: vi.fn(), patchMock: vi.fn(), deleteMock: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  api: { get: getMock, post: postMock, patch: patchMock, delete: deleteMock },
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/i18n/I18nProvider", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
// Isolate the page from the shared modal components (they render null when closed).
vi.mock("@/components/ImportCsvModal", () => ({ ImportCsvModal: () => null }));
vi.mock("@/components/CertificateModal", () => ({ CertificateModal: () => null }));
vi.mock("@/components/GuardiansModal", () => ({ GuardiansModal: () => null }));
vi.mock("@/components/StudentPerformanceModal", () => ({ StudentPerformanceModal: () => null }));
vi.mock("@/components/PromoteStudentsModal", () => ({ PromoteStudentsModal: () => null }));

import StudentsPage from "./page";
import { useModeStore } from "@/stores/mode-store";
import { useSkinStore } from "@/stores/skin-store";

const SCHOOL_STUDENTS = [
  { id: "s1", admissionNo: "ADM-1001", firstName: "Asha", lastName: "Rao", className: "Grade 5", sectionName: "A", guardianName: "Ramesh Rao", guardianRelation: "father", guardianPhone: "90000 00001", status: "active" },
  { id: "s2", admissionNo: "ADM-1002", firstName: "Vikram", lastName: "Nair", className: "Grade 6", sectionName: "B", guardianName: "Latha Nair", guardianRelation: "mother", guardianPhone: "90000 00002", status: "active" },
];
const COLLEGE_STUDENTS = [
  { id: "c1", admissionNo: "REG-2001", firstName: "Nisha", lastName: "Verma", guardianName: "Om Verma", guardianRelation: "father", guardianPhone: "90000 01001", status: "active" },
];
const COLLEGE_ENROLLMENTS = [{ studentId: "c1", programName: "B.Tech CSE", semesterName: "Semester 5" }];
const SCHOOL_CLASSES = [{ id: "cl5", name: "Grade 5", grade_level: 5, sections: [{ id: "sec5a", name: "A" }] }];

function mockSchool() {
  getMock.mockImplementation(async (path: string) => {
    if (path.startsWith("/students")) return { data: SCHOOL_STUDENTS, meta: { total: SCHOOL_STUDENTS.length, page: 1, limit: 10 } };
    if (path === "/classes") return SCHOOL_CLASSES;
    throw new Error(`unexpected api.get(${path})`);
  });
}
function mockCollege() {
  getMock.mockImplementation(async (path: string) => {
    if (path.startsWith("/students")) return { data: COLLEGE_STUDENTS, meta: { total: COLLEGE_STUDENTS.length, page: 1, limit: 10 } };
    if (path === "/college/enrollments") return COLLEGE_ENROLLMENTS;
    if (path === "/college/programs") return [{ id: "p1", name: "B.Tech CSE" }];
    if (path === "/college/semesters") return [{ id: "sem5", programId: "p1", name: "Semester 5" }];
    throw new Error(`unexpected api.get(${path})`);
  });
}

beforeEach(() => {
  getMock.mockReset(); postMock.mockReset(); patchMock.mockReset(); deleteMock.mockReset();
  useSkinStore.setState({ active: false, resolved: true });
});
afterEach(() => {
  cleanup();
  useModeStore.setState({ mode: "school", hasChosen: false });
});

describe("data/terminology parity — school", () => {
  beforeEach(() => useModeStore.setState({ mode: "school", hasChosen: true }));
  it("renders the returned rows with school terminology", async () => {
    mockSchool();
    render(<StudentsPage />);
    expect(await screen.findByText("Asha Rao")).toBeTruthy();
    expect(screen.getByText("ADM-1001")).toBeTruthy();
    expect(screen.getByText("Grade 5 — A")).toBeTruthy();
    expect(screen.getByText("Vikram Nair")).toBeTruthy();
    expect(screen.getByText("Class")).toBeTruthy(); // term.klass (school)
  });
});

describe("data/terminology parity — college", () => {
  beforeEach(() => useModeStore.setState({ mode: "college", hasChosen: true }));
  it("renders program—semester and college terminology", async () => {
    mockCollege();
    render(<StudentsPage />);
    expect(await screen.findByText("Nisha Verma")).toBeTruthy();
    expect(await screen.findByText("B.Tech CSE — Semester 5")).toBeTruthy();
    expect(screen.getByText("Program")).toBeTruthy(); // term.klass (college)
    expect(screen.queryByText("Class")).toBeNull();
  });
});

describe("request + action parity", () => {
  beforeEach(() => useModeStore.setState({ mode: "school", hasChosen: true }));

  it("requests only /students (+ /classes) — never an unexpected endpoint", async () => {
    mockSchool();
    render(<StudentsPage />);
    await screen.findByText("Asha Rao");
    const paths = getMock.mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.startsWith("/students"))).toBe(true);
    expect(paths.every((p) => p.startsWith("/students") || p === "/classes")).toBe(true);
  });

  it("Add opens an empty modal; Edit opens a prefilled modal", async () => {
    mockSchool();
    render(<StudentsPage />);
    await screen.findByText("Asha Rao");
    fireEvent.click(screen.getByText("+ Add student"));
    expect(await screen.findByText("Add student")).toBeTruthy();
    expect(screen.queryByDisplayValue("Asha")).toBeNull();
    fireEvent.click(screen.getByLabelText("Close"));
    fireEvent.click(screen.getAllByText("Edit")[0]);
    expect(await screen.findByText("Edit student")).toBeTruthy();
    expect(screen.getByDisplayValue("Asha")).toBeTruthy();
  });
});

describe("a11y markup — eligible-UI-v2-only (Decision 4)", () => {
  beforeEach(() => useModeStore.setState({ mode: "school", hasChosen: true }));

  it("adds no scope/caption/aria-label off-flag (legacy byte-identical)", async () => {
    useSkinStore.setState({ active: false, resolved: true });
    mockSchool();
    const { container } = render(<StudentsPage />);
    await screen.findByText("Asha Rao");
    expect(container.querySelector("caption")).toBeNull();
    expect(container.querySelector("th[scope]")).toBeNull();
    expect(screen.getAllByText("Edit")[0].getAttribute("aria-label")).toBeNull();
  });

  it("adds scope, caption and row-action aria-labels inside an eligible session", async () => {
    useSkinStore.setState({ active: true, resolved: true });
    mockSchool();
    const { container } = render(<StudentsPage />);
    await screen.findByText("Asha Rao");
    expect(container.querySelector("caption")?.textContent).toBe("Students list");
    expect(container.querySelectorAll("th[scope='col']").length).toBe(6);
    expect(screen.getByLabelText("Edit Asha Rao")).toBeTruthy();
    expect(screen.getByLabelText("Delete Asha Rao")).toBeTruthy();
    expect(screen.getByLabelText("Search students")).toBeTruthy();
  });
});

describe("frozen-surface + dormancy — Students CSS", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
  const stSelectors = selectors.filter((s) => s.includes(".st-"));
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];

  it("defines Students (`st-*`) rules", () => {
    expect(stSelectors.length).toBeGreaterThan(0);
  });
  it("never applies a Students style without a `.ui-v2` ancestor", () => {
    for (const sel of stSelectors) expect(sel.includes(".ui-v2"), `escapes scope: ${sel}`).toBe(true);
  });
  it("uses NO glass (backdrop-filter) and NO gold on any `.st-` surface", () => {
    for (const [, sel, body] of rules) {
      if (!sel.includes(".st-")) continue;
      expect(/backdrop-filter/.test(body), `st glass: ${sel.trim()}`).toBe(false);
      expect(body.includes("--c-gold"), `st gold: ${sel.trim()}`).toBe(false);
    }
  });
});
