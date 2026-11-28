import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { readVoiceFabHidden, voiceFabHiddenKey, useVoiceFabPreference, writeVoiceFabHidden } from "@/hooks/useVoiceFabPreference";

const UID = "user-aaa";

describe("useVoiceFabPreference", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to visible and persists per user", () => {
    expect(readVoiceFabHidden(UID)).toBe(false);
    writeVoiceFabHidden(UID, true);
    expect(localStorage.getItem(voiceFabHiddenKey(UID))).toBe("1");
    expect(readVoiceFabHidden(UID)).toBe(true);
    expect(readVoiceFabHidden("other")).toBe(false);
  });

  it("syncs across hook instances via the custom event", () => {
    const a = renderHook(() => useVoiceFabPreference(UID));
    const b = renderHook(() => useVoiceFabPreference(UID));
    expect(a.result.current.hidden).toBe(false);
    act(() => a.result.current.setHidden(true));
    expect(b.result.current.hidden).toBe(true);
    act(() => b.result.current.setHidden(false));
    expect(a.result.current.hidden).toBe(false);
    expect(localStorage.getItem(voiceFabHiddenKey(UID))).toBe("0");
  });
});
