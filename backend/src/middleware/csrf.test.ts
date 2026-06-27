import { describe, it, expect, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { csrfOriginGuard } from "./csrf";
import { ApiError } from "../utils/api-error";

// env.corsOrigin defaults to ["http://localhost:3000"] in the test environment.
const ALLOWED = "http://localhost:3000";

function run(headers: Record<string, string>, method = "POST") {
  const req = { method, headers } as unknown as Request;
  const next = vi.fn() as unknown as NextFunction;
  const invoke = () => csrfOriginGuard(req, {} as Response, next);
  return { invoke, next };
}

describe("csrfOriginGuard", () => {
  it("passes safe methods regardless of origin", () => {
    const { invoke, next } = run({ origin: "http://evil.test" }, "GET");
    invoke();
    expect(next).toHaveBeenCalledOnce();
  });

  it("passes Bearer-authenticated requests (not cookie-borne)", () => {
    const { invoke, next } = run({
      authorization: "Bearer abc.def.ghi",
      origin: "http://evil.test",
      cookie: `access_token=x`,
    });
    invoke();
    expect(next).toHaveBeenCalledOnce();
  });

  it("passes server-to-server requests with no auth cookie", () => {
    const { invoke, next } = run({ origin: "http://evil.test" });
    invoke();
    expect(next).toHaveBeenCalledOnce();
  });

  it("passes cookie requests that omit Origin/Referer (native clients)", () => {
    const { invoke, next } = run({ cookie: "access_token=x" });
    invoke();
    expect(next).toHaveBeenCalledOnce();
  });

  it("passes cookie requests from an allowed origin", () => {
    const { invoke, next } = run({ cookie: "access_token=x", origin: ALLOWED });
    invoke();
    expect(next).toHaveBeenCalledOnce();
  });

  it("accepts the Referer origin when Origin is absent", () => {
    const { invoke, next } = run({
      cookie: "refresh_token=x",
      referer: `${ALLOWED}/portal/fees`,
    });
    invoke();
    expect(next).toHaveBeenCalledOnce();
  });

  it("blocks a cross-origin cookie-borne state change", () => {
    const { invoke, next } = run({
      cookie: "access_token=x",
      origin: "http://evil.test",
    });
    expect(invoke).toThrow(ApiError);
    expect(next).not.toHaveBeenCalled();
  });
});
