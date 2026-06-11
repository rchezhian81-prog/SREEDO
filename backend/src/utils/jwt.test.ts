import { describe, expect, it } from "vitest";
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from "./jwt";

describe("access tokens", () => {
  it("round-trips the payload", () => {
    const token = signAccessToken({
      sub: "00000000-0000-0000-0000-000000000001",
      email: "admin@sreedo.edu",
      role: "admin",
    });
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe("00000000-0000-0000-0000-000000000001");
    expect(payload.email).toBe("admin@sreedo.edu");
    expect(payload.role).toBe("admin");
  });

  it("rejects tampered tokens", () => {
    const token = signAccessToken({
      sub: "u1",
      email: "a@b.c",
      role: "admin",
    });
    expect(() => verifyAccessToken(token + "x")).toThrow();
  });
});

describe("refresh tokens", () => {
  it("hash matches the generated token", () => {
    const { token, tokenHash } = generateRefreshToken();
    expect(hashRefreshToken(token)).toBe(tokenHash);
  });

  it("generates unique tokens", () => {
    expect(generateRefreshToken().token).not.toBe(
      generateRefreshToken().token
    );
  });
});
