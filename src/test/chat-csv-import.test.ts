import { describe, it, expect } from "vitest";
import { mapCdr, mapSpend, parseCsv, previewNormalizePhone } from "@/lib/chatManagement/csvImport";

describe("parseCsv", () => {
  it("handles BOM, quotes, CRLF, semicolons", () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","he said ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
    expect(parseCsv("a;b\n1;2\n\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("previewNormalizePhone (fake numbers)", () => {
  it("normalizes +20, 0020, Arabic digits", () => {
    expect(previewNormalizePhone("+20 100 000 0001")).toBe("01000000001");
    expect(previewNormalizePhone("00201000000002")).toBe("01000000002");
    expect(previewNormalizePhone("٠١٠٠٠٠٠٠٠٠٣")).toBe("01000000003");
    expect(previewNormalizePhone("12345")).toBeNull();
  });
});

describe("mapCdr", () => {
  const csv = [
    "call_id,direction,start,duration,disposition,caller,agent,recording",
    "C1,inbound,2026-09-01 12:00:00,0,NO ANSWER,01000000007,نورا,",
    "C2,outbound,2026-09-01 12:40:00,95,ANSWERED,+20 100 000 0007,نورا,calls/2026/09/C2.mp3",
    "C3,sideways,2026-09-01 12:00:00,0,missed,01000000008,,",
    "C4,in,2026-09-01 12:00:00,0,missed,01000000008,,https://vendor.example/r.mp3",
    "C1,in,2026-09-01 12:00:00,0,missed,01000000008,,",
    "C6,in,not-a-date,0,missed,01000000008,,",
    "C7,in,2026-09-01 12:00:00,0,missed,12345,,",
  ].join("\n");
  const r = mapCdr(parseCsv(csv));
  it("maps valid rows and statuses", () => {
    expect(r.missingColumns).toEqual([]);
    expect(r.rows.map((x) => [x.external_call_id, x.direction, x.status])).toEqual([["C1", "inbound", "missed"], ["C2", "outbound", "answered"]]);
    expect(r.rows[1].phone_preview).toBe("01000000007");
    expect(r.rows[1].recording_path).toBe("calls/2026/09/C2.mp3");
  });
  it("rejects with reasons by row number", () => {
    expect(r.issues.map((i) => i.row)).toEqual([4, 5, 6, 7, 8]);
    expect(r.issues[1].reason).toContain("مساراً");
    expect(r.issues[2].reason).toContain("مكرر");
  });
  it("reports missing columns", () => expect(mapCdr(parseCsv("foo,bar\n1,2")).missingColumns).toContain("phone"));
});

describe("mapSpend", () => {
  it("maps Ads Manager-style export", () => {
    const r = mapSpend(parseCsv('Campaign name,Reporting starts,Amount spent (EGP),Impressions\n"حملة أ","2026-09-01","1,200.50",1000\nحملة أ,2026-09-01,5,1\nحملة ب,01/09/2026,5,\nحملة ج,2026-09-02,-1,'));
    expect(r.rows).toEqual([{ campaign_name: "حملة أ", meta_campaign_id: undefined, spend_date: "2026-09-01", spend: 1200.5, currency: "EGP", impressions: 1000, clicks: undefined }]);
    expect(r.issues.map((i) => i.row)).toEqual([3, 4, 5]);
  });
  it("missing columns", () => expect(mapSpend(parseCsv("x,y\n1,2")).missingColumns).toEqual(["campaign", "spend_date", "spend"]));
});
