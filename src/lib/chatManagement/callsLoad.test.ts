import { describe, expect, it, vi } from "vitest";
import { CALLS_LIST_EMPTY_AR, CALLS_LIST_ERROR_AR, isListRetryableError, secondaryPlan, withOneListRetry } from "./callsLoad";

describe("calls list retry", () => {
  it("keeps the Arabic error and empty copy distinct", () => {
    expect(CALLS_LIST_ERROR_AR).toBe("تعذّر تحميل المكالمات — حاول مرة أخرى");
    expect(CALLS_LIST_EMPTY_AR).toBe("لا توجد مكالمات مطابقة");
    expect(CALLS_LIST_ERROR_AR).not.toBe(CALLS_LIST_EMPTY_AR);
  });

  it("retries a statement timeout or a network failure, not a permission error", () => {
    expect(isListRetryableError({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(true);
    expect(isListRetryableError({ message: "canceling statement due to statement timeout" })).toBe(true);
    expect(isListRetryableError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isListRetryableError({ message: "TypeError: Failed to fetch" })).toBe(true);
    expect(isListRetryableError({ name: "TypeError", message: "NetworkError when attempting to fetch resource" })).toBe(true);
    expect(isListRetryableError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isListRetryableError(new Error("permission denied"))).toBe(false);
    expect(isListRetryableError(null)).toBe(false);
  });

  it("calls the list once more after a timeout, and not a third time", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } })
      .mockResolvedValueOnce({ data: [{ id: "c1" }], error: null });
    await expect(withOneListRetry(run)).resolves.toEqual({ data: [{ id: "c1" }], error: null });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("retries a thrown network error once, then surfaces the second failure", async () => {
    const run = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(withOneListRetry(run)).rejects.toThrow(/Failed to fetch/);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-timeout failure", async () => {
    const run = vi.fn().mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(withOneListRetry(run)).resolves.toMatchObject({ error: { code: "42501" } });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("secondary query plan", () => {
  it("gives the general manager the heavy reads, and withholds them from roles that cannot use them", () => {
    expect(secondaryPlan(["general_manager"])).toEqual({
      summary: true, missed: true, matchable: true, analysis: true, objections: true,
    });
    expect(secondaryPlan(["sales_manager"])).toMatchObject({ matchable: true, analysis: true, objections: true });
    expect(secondaryPlan(["executive_manager"])).toMatchObject({ matchable: false, analysis: true, objections: true });
    expect(secondaryPlan(["marketing_sales_manager"])).toEqual({
      summary: true, missed: true, matchable: false, analysis: false, objections: false,
    });
  });
});
