import type { InstitutionType } from "../../middleware/institution-type";

// Backend twin of the frontend terminology engine (frontend/src/lib/terms.ts):
// a one-line noun map injected into the copilot's system prompt so replies use
// the institution's own vocabulary. Kept deliberately tiny — the copilot only
// needs the sentence, not the full TermSet.

const NOUNS: Record<InstitutionType, string> = {
  school:
    'this is a SCHOOL — say "Teacher", "Class", "Section", "Subject", "Term", "Report Card", "Admission No"',
  college:
    'this is a COLLEGE — say "Faculty", "Program", "Batch", "Course", "Semester", "Grade Sheet", "Registration No"',
};

export const getTermsForType = (type: InstitutionType): string => NOUNS[type];
