import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { audioMimeFor, isValidCdrTime, mapCdr, mapSpend, matchRecording, parseCdrDuration, parseCsv, previewNormalizePhone, readCdrFiles, toCdrPayload } from "@/lib/chatManagement/csvImport";

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

// صفوف وهمية بنفس صيغة التصدير الفعلي (CDR.csv + Switched.csv) — أرقام وهمية 0100000000x فقط
const CDR_CSV = [
  "Cdr Id,A Number,Customer Name,B Number,Call Record,Voicemail,Start Time,End Time,Switched Time,Call Result,Call Duration,Call Direction",
  "CDR.260901.120000.0000001,01000000001,عميل وهمي,0220000000,,,01-09-2026 12:00:00,01-09-2026 12:00:40,,ANSWERED,00:00:00,INBOUND",
  "CDR.260901.121000.0000002,01000000002,,0220000000,CDR.260901.121000.0000002,,01-09-2026 12:10:00,01-09-2026 12:13:05,01-09-2026 12:10:04,ANSWERED_BY_AGENT,00:03:05,INBOUND",
  "CDR.260901.122000.0000003,0220000000,,+201000000003,,,01-09-2026 12:20:00,,,NEW_THING,00:00:10,OUTBOUND",
  "CDR.260901.122000.0000003,01000000004,,0220000000,,,01-09-2026 12:20:00,,,ANSWERED,00:00:10,INBOUND",
  ",01000000004,,0220000000,,,01-09-2026 12:20:00,,,ANSWERED,00:00:10,INBOUND",
  "CDR.260901.123000.0000006,01000000004,,0220000000,,,2026-09-01 12:30,,,ANSWERED,00:00:10,INBOUND",
  "CDR.260901.123000.0000007,01000000004,,0220000000,,,01-09-2026 12:30:00,,,ANSWERED,3 min,INBOUND",
  "CDR.260901.123000.0000008,12345,,0220000000,,,01-09-2026 12:30:00,,,ANSWERED,00:00:10,INBOUND",
  "CDR.260901.123000.0000009,01000000004,,0220000000,,,01-09-2026 12:30:00,,,ANSWERED,00:00:10,SIDEWAYS",
].join("\n");
const SW_CSV = [
  "Cdr Id,Username,Switch Time,Switching Status,Call Status,Answer Time,End Time",
  "CDR.260901.120000.0000001,Agent.One,2026-09-01T12:00:05+03:00,MISSED,SWITCHED_REJECTED,,",
  "CDR.260901.121000.0000002,agent.two,2026-09-01T12:10:20+03:00,ACCEPTED,SWITCHED_ACCEPTED,2026-09-01T12:10:22+03:00,2026-09-01T12:13:05+03:00",
  "CDR.260901.121000.0000002,agent.one,2026-09-01T12:10:04+03:00,MISSED,SWITCHED_REJECTED,,",
  "CDR.250101.000000.9999999,agent.one,2026-09-01T00:00:00+03:00,MISSED,SWITCHED_REJECTED,,",
].join("\n");

describe("mapCdr (exact export format)", () => {
  const r = mapCdr(parseCsv(CDR_CSV), parseCsv(SW_CSV));
  it("accepts valid rows, rejects bad ones with line numbers", () => {
    expect(r.missingColumns).toEqual([]);
    expect(r.rows.map((x) => x.cdr_id)).toEqual(["CDR.260901.120000.0000001", "CDR.260901.121000.0000002", "CDR.260901.122000.0000003"]);
    expect(r.issues.map((i) => i.row)).toEqual([5, 6, 7, 8, 9, 10]);
  });
  it("missed when no ACCEPTED attempt, even if Call Result says ANSWERED", () => {
    expect(r.rows[0].preview).toMatchObject({ status: "missed", username: "agent.one", phone: "01000000001" });
  });
  it("merges Switched.csv by Cdr Id, sorted by time; accepted attempt sets the moderator", () => {
    expect(r.rows[1].attempts.map((a) => a.username)).toEqual(["agent.one", "agent.two"]);
    expect(r.rows[1].preview).toMatchObject({ status: "answered", username: "agent.two" });
    expect(r.rows[1].call_record).toBe("CDR.260901.121000.0000002");
    expect(r.orphanSwitched).toBe(1);
  });
  it("outbound uses B Number and surfaces unknown Call Result", () => {
    expect(r.rows[2].preview).toMatchObject({ phone: "01000000003", status: "failed", unknownResult: true });
    expect(r.unknownResults).toEqual(["NEW_THING"]);
  });
  it("payload drops preview/customer name (no extra PII sent)", () => {
    const p = toCdrPayload(r.rows[0]) as Record<string, unknown>;
    expect(p.preview).toBeUndefined(); expect(p.customer_name).toBeUndefined();
    expect(p).toMatchObject({ cdr_id: "CDR.260901.120000.0000001", start_time: "01-09-2026 12:00:00", call_duration: "00:00:00" });
  });
  it("reports missing columns per file", () => {
    expect(mapCdr(parseCsv("foo,bar\n1,2")).missingColumns).toContain("CDR.csv: Cdr Id");
    expect(mapCdr(parseCsv(CDR_CSV), parseCsv("x\n1")).missingColumns).toContain("Switched.csv: Username");
  });
  it("durations and times", () => {
    expect(parseCdrDuration("01:02:03")).toBe(3723); expect(parseCdrDuration("")).toBe(0); expect(parseCdrDuration("1:2")).toBeNull();
    expect(isValidCdrTime("31-12-2026 23:59:59")).toBe(true); expect(isValidCdrTime("2026-12-31 23:59:59")).toBe(false);
  });
});

// jsdom: نفس realm الخاص بـ fflate
const u8 = (s: string) => Uint8Array.from(strToU8(s));
describe("readCdrFiles (zip)", () => {
  it("reads CDR.csv + Switched.csv from a zip", async () => {
    const zip = zipSync({ "export/CDR.csv": u8(CDR_CSV), "export/Switched.csv": u8(SW_CSV) });
    const file = { name: "export.zip", text: async () => "", arrayBuffer: async () => zip.slice().buffer };
    const r = await readCdrFiles([file]);
    expect(r.rows).toHaveLength(3); expect(r.rows[1].preview.username).toBe("agent.two");
  });
  it("complains when CDR.csv is absent", async () => {
    const zip = zipSync({ "Switched.csv": u8(SW_CSV) });
    const r = await readCdrFiles([{ name: "a.zip", text: async () => "", arrayBuffer: async () => zip.slice().buffer }]);
    expect(r.missingColumns[0]).toMatch(/CDR\.csv/);
  });
});

describe("matchRecording", () => {
  const calls = [
    { id: "c1", external_call_id: "CDR.260901.120000.0000001", phone_norm: "01000000001", started_at: "2026-09-01T09:00:00Z" },
    { id: "c2", external_call_id: "CDR.261201.100000.0000002", phone_norm: "01000000002", started_at: "2026-12-01T08:00:00Z" },
  ];
  it("by Cdr Id in file name", () => expect(matchRecording("rec/CDR.260901.120000.0000001.mp3", calls)).toMatchObject({ by: "cdr_id", call: { id: "c1" } }));
  it("by phone + Cairo local time (summer +03 / winter +02)", () => {
    expect(matchRecording("01000000001_20260901_120100.wav", calls)).toMatchObject({ by: "phone_time", call: { id: "c1" } });
    expect(matchRecording("+201000000002 2026-12-01 10-00-30.m4a", calls)).toMatchObject({ by: "phone_time", call: { id: "c2" } });
  });
  it("no match", () => {
    expect(matchRecording("CDR.260101.000000.0000000.mp3", calls).call).toBeNull();
    expect(matchRecording("voice.mp3", calls).call).toBeNull();
    expect(matchRecording("01000000001_20260901_180000.mp3", calls).call).toBeNull();
  });
  it("audio types", () => { expect(audioMimeFor("a.MP3")).toBe("audio/mpeg"); expect(audioMimeFor("a.pdf")).toBeNull(); });
});

describe("mapSpend", () => {
  it("maps Ads Manager-style export", () => {
    const r = mapSpend(parseCsv('Campaign name,Reporting starts,Amount spent (EGP),Impressions\n"حملة أ","2026-09-01","1,200.50",1000\nحملة أ,2026-09-01,5,1\nحملة ب,01/09/2026,5,\nحملة ج,2026-09-02,-1,'));
    expect(r.rows).toEqual([{ campaign_name: "حملة أ", meta_campaign_id: undefined, spend_date: "2026-09-01", spend: 1200.5, currency: "EGP", impressions: 1000, clicks: undefined }]);
    expect(r.issues.map((i) => i.row)).toEqual([3, 4, 5]);
  });
  it("missing columns", () => expect(mapSpend(parseCsv("x,y\n1,2")).missingColumns).toEqual(["campaign", "spend_date", "spend"]));
});
