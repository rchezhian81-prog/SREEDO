import { describe, it, expect } from "vitest";
import { getTerms, TERMS } from "@/lib/terms";

describe("terminology engine", () => {
  it("uses school nouns for school mode", () => {
    const t = getTerms("school");
    expect(t.teachers).toBe("Teachers");
    expect(t.klass).toBe("Class");
    expect(t.section).toBe("Section");
    expect(t.subject).toBe("Subject");
    expect(t.term).toBe("Term");
    expect(t.admissionNo).toBe("Admission No");
  });

  it("uses college nouns for college mode", () => {
    const t = getTerms("college");
    expect(t.teachers).toBe("Faculty");
    expect(t.klass).toBe("Program");
    expect(t.section).toBe("Batch");
    expect(t.subject).toBe("Course");
    expect(t.term).toBe("Semester");
    expect(t.admissionNo).toBe("Registration No");
  });

  it("defines exactly the same keys for both editions", () => {
    expect(Object.keys(TERMS.school).sort()).toEqual(
      Object.keys(TERMS.college).sort()
    );
  });
});
