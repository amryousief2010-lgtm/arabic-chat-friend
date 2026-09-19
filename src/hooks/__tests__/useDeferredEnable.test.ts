import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDeferredEnable } from "@/hooks/useDeferredEnable";

describe("useDeferredEnable", () => {
  it("stays false until the defer timer fires, then follows enabled", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useDeferredEnable(enabled, 2000),
      { initialProps: { enabled: true } },
    );
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBe(true);
    rerender({ enabled: false });
    expect(result.current).toBe(false);
    vi.useRealTimers();
  });
});
