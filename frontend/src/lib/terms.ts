import { useModeStore, type CampusMode } from "@/stores/mode-store";

/**
 * Terminology engine — a single source of truth for the domain nouns that
 * differ between a School and a College. Components read terms via `useTerms()`
 * (or `getTerms(mode)` outside React) so the same page reads naturally in both
 * editions: a School shows "Teacher / Class / Subject / Admission No.", a
 * College shows "Faculty / Program / Course / Registration No.".
 *
 * Adopt incrementally: swap a hard-coded label for the matching term and the
 * page becomes mode-aware with no other change.
 */
export interface TermSet {
  teacher: string;
  teachers: string;
  student: string;
  students: string;
  klass: string;
  klassPlural: string;
  section: string;
  sectionPlural: string;
  subject: string;
  subjectPlural: string;
  term: string; // academic period: Term vs Semester
  admissionNo: string;
  reportCard: string;
  classTeacher: string;
}

const SCHOOL: TermSet = {
  teacher: "Teacher",
  teachers: "Teachers",
  student: "Student",
  students: "Students",
  klass: "Class",
  klassPlural: "Classes",
  section: "Section",
  sectionPlural: "Sections",
  subject: "Subject",
  subjectPlural: "Subjects",
  term: "Term",
  admissionNo: "Admission No",
  reportCard: "Report Card",
  classTeacher: "Class Teacher",
};

const COLLEGE: TermSet = {
  teacher: "Faculty member",
  teachers: "Faculty",
  student: "Student",
  students: "Students",
  klass: "Program",
  klassPlural: "Programs",
  section: "Batch",
  sectionPlural: "Batches",
  subject: "Course",
  subjectPlural: "Courses",
  term: "Semester",
  admissionNo: "Registration No",
  reportCard: "Grade Sheet",
  classTeacher: "Faculty Advisor",
};

export const TERMS: Record<CampusMode, TermSet> = {
  school: SCHOOL,
  college: COLLEGE,
};

export function getTerms(mode: CampusMode): TermSet {
  return TERMS[mode];
}

/** React hook: the term set for the currently selected campus mode. */
export function useTerms(): TermSet {
  const mode = useModeStore((s) => s.mode);
  return TERMS[mode];
}
