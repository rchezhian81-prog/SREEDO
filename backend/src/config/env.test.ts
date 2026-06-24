import { afterEach, describe, expect, it } from "vitest";
import { requiredSecret } from "./env";

const FALLBACK = "dev-secret-change-me";
const NAME = "TEST_SECRET_GUARD";

describe("requiredSecret — production secret guard", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env[NAME];
  });

  it("throws in production when the var is unset (would use the dev default)", () => {
    process.env.NODE_ENV = "production";
    delete process.env[NAME];
    expect(() => requiredSecret(NAME, FALLBACK)).toThrow(/strong, unique value/);
  });

  it("throws in production when the var is empty", () => {
    process.env.NODE_ENV = "production";
    process.env[NAME] = "";
    expect(() => requiredSecret(NAME, FALLBACK)).toThrow();
  });

  it("throws in production when explicitly set to the dev default", () => {
    process.env.NODE_ENV = "production";
    process.env[NAME] = FALLBACK;
    expect(() => requiredSecret(NAME, FALLBACK)).toThrow();
  });

  it("returns a real value in production", () => {
    process.env.NODE_ENV = "production";
    process.env[NAME] = "a-genuinely-unique-strong-secret";
    expect(requiredSecret(NAME, FALLBACK)).toBe("a-genuinely-unique-strong-secret");
  });

  it("allows the dev default outside production", () => {
    process.env.NODE_ENV = "development";
    delete process.env[NAME];
    expect(requiredSecret(NAME, FALLBACK)).toBe(FALLBACK);
  });

  it("allows the dev default under NODE_ENV=test", () => {
    process.env.NODE_ENV = "test";
    delete process.env[NAME];
    expect(requiredSecret(NAME, FALLBACK)).toBe(FALLBACK);
  });
});
