import { describe, it, expect } from "vitest";
import { speakerLabel, fmtSec } from "./callAnalysis";
describe("callAnalysis", () => {
  it("labels speakers by inferred role", () => {
    expect(speakerLabel("speaker_0", { speaker_0: "moderator", speaker_1: "customer" })).toBe("المودريتور");
    expect(speakerLabel("speaker_1", { speaker_0: "moderator", speaker_1: "customer" })).toBe("العميل");
    expect(speakerLabel("speaker_1", null)).toBe("متحدث 2");
  });
  it("formats seconds", () => { expect(fmtSec(65.4)).toBe("1:05"); expect(fmtSec(0)).toBe("0:00"); });
});
