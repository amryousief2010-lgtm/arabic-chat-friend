import { describe, expect, it } from "vitest";
import {
  matchesCronSecret,
  readCronSecretHeader,
  timingSafeEqualText,
  ZODEX_CRON_SECRET_ENV,
  ZODEX_CRON_SECRET_HEADER,
} from "../../../supabase/functions/_shared/cron-secret";

describe("Zodex cron secret compare", () => {
  it("exports the header and env names Amr must wire up", () => {
    expect(ZODEX_CRON_SECRET_HEADER).toBe("x-zodex-cron-secret");
    expect(ZODEX_CRON_SECRET_ENV).toBe("ZODEX_CRON_SECRET");
  });

  it("matches equal non-empty secrets", async () => {
    await expect(matchesCronSecret("shared-secret-value", "shared-secret-value")).resolves.toBe(true);
  });

  it("rejects a wrong secret without treating it as a match", async () => {
    await expect(matchesCronSecret("shared-secret-value", "different-secret-value")).resolves.toBe(false);
  });

  it("rejects empty or whitespace-only values on either side", async () => {
    await expect(matchesCronSecret("", "shared-secret-value")).resolves.toBe(false);
    await expect(matchesCronSecret("shared-secret-value", "")).resolves.toBe(false);
    await expect(matchesCronSecret("   ", "shared-secret-value")).resolves.toBe(false);
    await expect(matchesCronSecret("shared-secret-value", "   ")).resolves.toBe(false);
    await expect(matchesCronSecret("", "")).resolves.toBe(false);
  });

  it("trims both sides before comparing", async () => {
    await expect(matchesCronSecret("  abc-def  ", "abc-def")).resolves.toBe(true);
  });

  it("timingSafeEqualText is length-agnostic and constant-size", async () => {
    await expect(timingSafeEqualText("short", "much-longer-secret")).resolves.toBe(false);
    await expect(timingSafeEqualText("same", "same")).resolves.toBe(true);
  });

  it("reads the cron header case-insensitively via Headers", () => {
    const headers = new Headers({ "X-Zodex-Cron-Secret": " from-header " });
    expect(readCronSecretHeader(headers)).toBe("from-header");
    expect(readCronSecretHeader(new Headers())).toBe("");
  });
});
