import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("Secret@123");
    expect(await verifyPassword("Secret@123", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("Secret@123");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces unique salted hashes", async () => {
    const first = await hashPassword("Secret@123");
    const second = await hashPassword("Secret@123");
    expect(first).not.toBe(second);
  });
});
