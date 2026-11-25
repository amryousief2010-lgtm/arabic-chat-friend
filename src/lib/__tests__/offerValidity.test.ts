import { describe, expect, it } from "vitest";
import {
  formatValidityDate,
  offerBoxIsSelectable,
  parseValidityInput,
  shouldHideOnSite,
  validityModeOf,
  validityState,
} from "../offerValidity";

const now = new Date("2026-11-25T18:00:00.000Z");

describe("offer validity", () => {
  it("treats missing dates as open (existing offers stay open)", () => {
    expect(validityModeOf({ starts_at: null, expires_at: null })).toBe("open");
    expect(validityState({ starts_at: null, expires_at: null }, now)).toBe("open");
    expect(offerBoxIsSelectable({ starts_at: null, expires_at: null, is_active: true }, now)).toBe(true);
    expect(shouldHideOnSite({ starts_at: null, expires_at: null }, now)).toBe(false);
  });

  it("blocks selection and asks to hide on site outside the window", () => {
    const expired = { starts_at: "2026-11-01T00:00:00.000Z", expires_at: "2026-11-20T00:00:00.000Z", is_active: true };
    const scheduled = { starts_at: "2026-12-01T00:00:00.000Z", expires_at: "2026-12-10T00:00:00.000Z", is_active: true };
    const active = { starts_at: "2026-11-01T00:00:00.000Z", expires_at: "2026-12-01T00:00:00.000Z", is_active: true };
    expect(validityState(expired, now)).toBe("expired");
    expect(validityState(scheduled, now)).toBe("scheduled");
    expect(validityState(active, now)).toBe("active");
    expect(offerBoxIsSelectable(expired, now)).toBe(false);
    expect(offerBoxIsSelectable(scheduled, now)).toBe(false);
    expect(offerBoxIsSelectable(active, now)).toBe(true);
    expect(shouldHideOnSite(expired, now)).toBe(true);
    expect(shouldHideOnSite(scheduled, now)).toBe(true);
    expect(shouldHideOnSite(active, now)).toBe(false);
  });

  it("still blocks a manually paused offer even inside the window", () => {
    const box = { starts_at: "2026-11-01T00:00:00.000Z", expires_at: "2026-12-01T00:00:00.000Z", is_active: false };
    expect(offerBoxIsSelectable(box, now)).toBe(false);
    expect(shouldHideOnSite(box, now)).toBe(false);
  });

  it("validates duration input and clears dates when opened", () => {
    expect(parseValidityInput("open", "2026-11-01T00:00", "2026-12-01T00:00")).toEqual({
      ok: true, starts_at: null, expires_at: null,
    });
    expect(parseValidityInput("window", "", "2026-12-01T00:00").ok).toBe(false);
    expect(parseValidityInput("window", "2026-12-01T00:00", "2026-11-01T00:00")).toEqual({ ok: false, error: "end_before_start" });
    const ok = parseValidityInput("window", "2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z");
    expect(ok.ok).toBe(true);
  });

  it("formats dates with Latin numerals", () => {
    const s = formatValidityDate("2026-11-25T18:00:00.000Z");
    expect(s).toMatch(/2026/);
    expect(s).toMatch(/[0-9]/);
    expect(s).not.toMatch(/[٠-٩]/);
  });
});
