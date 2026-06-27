import { describe, it, expect } from "vitest";
import { renewalReminderEmail } from "./billing.service";

describe("renewalReminderEmail", () => {
  it("phrases a multi-day reminder", () => {
    const { subject, text } = renewalReminderEmail(7, "Pro", "2026-07-01");
    expect(subject).toContain("in 7 days");
    expect(text).toContain('"Pro"');
    expect(text).toContain("2026-07-01");
  });

  it("uses singular wording at one day", () => {
    expect(renewalReminderEmail(1, "Basic", "2026-07-01").subject).toContain(
      "in 1 day"
    );
  });

  it("says today at zero days and tolerates a missing package name", () => {
    const { subject, text } = renewalReminderEmail(0, null, "2026-07-01");
    expect(subject).toContain("today");
    expect(text).not.toContain('""');
  });
});
