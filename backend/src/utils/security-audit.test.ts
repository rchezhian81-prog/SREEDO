import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { clientIp } from "./security-audit";

const req = (ip: string | undefined) => ({ ip }) as unknown as Request;

describe("clientIp", () => {
  it("normalizes an IPv4-mapped IPv6 address to plain IPv4", () => {
    // A dual-stack listener surfaces IPv4 clients this way (e.g. on CI); without
    // normalization the same client can appear in two forms across requests and
    // fail to match an IPv4 allowlist entry.
    expect(clientIp(req("::ffff:127.0.0.1"))).toBe("127.0.0.1");
    expect(clientIp(req("::ffff:203.0.113.9"))).toBe("203.0.113.9");
  });

  it("leaves plain IPv4 and genuine IPv6 addresses untouched", () => {
    expect(clientIp(req("127.0.0.1"))).toBe("127.0.0.1");
    expect(clientIp(req("::1"))).toBe("::1");
    expect(clientIp(req("2001:db8::1"))).toBe("2001:db8::1");
  });

  it("returns null when the request has no ip", () => {
    expect(clientIp(req(undefined))).toBeNull();
  });
});
