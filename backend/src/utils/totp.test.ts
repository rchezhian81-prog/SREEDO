import { describe, expect, it } from "vitest";
import { generateBase32Secret, generateTotp, verifyTotp } from "./totp";

// RFC 6238 Appendix B test vector (SHA-1, 8-digit). ASCII secret
// "12345678901234567890" in base32; we check the trailing 6 digits.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totp", () => {
  it("matches the RFC 6238 SHA-1 test vectors (last 6 digits)", () => {
    expect(generateTotp(RFC_SECRET, 59_000)).toBe("287082"); // 94287082
    expect(generateTotp(RFC_SECRET, 1_111_111_109_000)).toBe("081804"); // 07081804
    expect(generateTotp(RFC_SECRET, 1_234_567_890_000)).toBe("005924"); // 89005924
  });

  it("verifies a freshly generated code and rejects a wrong one", () => {
    const secret = generateBase32Secret();
    const now = Date.now();
    expect(verifyTotp(secret, generateTotp(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, "000000", now)).toBe(false);
    expect(verifyTotp(secret, "not-a-code", now)).toBe(false);
  });

  it("accepts a code from the adjacent step (clock drift) within the window", () => {
    const secret = generateBase32Secret();
    const now = Date.now();
    const prevStepCode = generateTotp(secret, now - 30_000);
    expect(verifyTotp(secret, prevStepCode, now)).toBe(true);
  });

  it("generates 32-char base32 secrets", () => {
    expect(generateBase32Secret()).toMatch(/^[A-Z2-7]{32}$/);
  });
});
