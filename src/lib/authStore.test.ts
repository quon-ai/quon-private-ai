/**
 * The boot fail-closed rule: a momentarily-unreachable backend must not log the
 * user out. Only a real 401/403 means "no session"; a network error, a 5xx, or a
 * boot timeout must land in `unreachable` (Master Key kept, retry offered) - never
 * `anonymous`.
 */
import { describe, expect, it } from "vitest";

import { ApiError } from "./api/http";
import { classifyBootError } from "./authStore";

describe("classifyBootError", () => {
  it("treats a real 401/403 as anonymous (session genuinely gone)", () => {
    expect(classifyBootError(new ApiError(401, "not authenticated"))).toBe("anonymous");
    expect(classifyBootError(new ApiError(403, "csrf"))).toBe("anonymous");
  });

  it("treats a network error / 5xx / timeout as unreachable (keep the session)", () => {
    expect(classifyBootError(new TypeError("Failed to fetch"))).toBe("unreachable");
    expect(classifyBootError(new ApiError(503, "unavailable"))).toBe("unreachable");
    expect(classifyBootError(new ApiError(500, "boom"))).toBe("unreachable");
    expect(classifyBootError(new Error("boot timeout"))).toBe("unreachable");
  });
});
