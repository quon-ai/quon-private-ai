import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyEmail = vi.fn();
vi.mock("@/lib/authStore", () => ({ verifyEmail: (...args: unknown[]) => verifyEmail(...args) }));
describe("verifyOnce", () => {
  beforeEach(() => verifyEmail.mockReset());

  it("posts a token exactly once even when the effect runs twice (StrictMode remount)", async () => {
    verifyEmail.mockResolvedValue({ status: "active" });
    const { verifyOnce } = await import("./verifyOnce");
    await Promise.all([verifyOnce("tok-a"), verifyOnce("tok-a")]);
    expect(verifyEmail).toHaveBeenCalledTimes(1);
    // a later remount re-uses the verdict instead of spending the token again
    await verifyOnce("tok-a");
    expect(verifyEmail).toHaveBeenCalledTimes(1);
  });

  it("keeps tokens apart and caches a failure as a failure", async () => {
    verifyEmail.mockRejectedValueOnce(new Error("invalid or expired token"));
    const { verifyOnce } = await import("./verifyOnce");
    await expect(verifyOnce("tok-bad")).rejects.toThrow("invalid");
    await expect(verifyOnce("tok-bad")).rejects.toThrow("invalid");
    expect(verifyEmail).toHaveBeenCalledTimes(1);
  });
});
