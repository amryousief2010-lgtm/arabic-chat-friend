import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const voice = readFileSync("supabase/functions/ai-assistant-chat/voice.ts", "utf8");
const migRaw = readFileSync("supabase/migrations/20261128150000_ai_voice_chat_tools.sql", "utf8");
const mig = migRaw.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n"); // من غير التعليقات

describe("voice assistant chat tools (static checks)", () => {
  it("exposes the three chat tools with the right RPC names, for the 3 manager roles", () => {
    for (const [name, rpc] of [
      ["chat_response_by_moderator", "ai_tool_chat_response_by_moderator"],
      ["chat_summary", "ai_tool_chat_summary"],
      ["chats_waiting_now", "ai_tool_chats_waiting_now"],
    ]) {
      expect(voice).toContain(`name: "${name}", rpc: "${rpc}", roles: MGR`);
      expect(mig).toContain(`FUNCTION public.${rpc}(`);
    }
    expect((voice.match(/topic: "/g) ?? []).length).toBe(11);
    expect(voice).not.toMatch(/financial_manager/);
  });

  it("migration: read-only, definer only with role check + read-all guard, 92-day cap, no sensitive columns or tables", () => {
    expect(mig).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/);
    // SECURITY DEFINER فقط للأدوات الـ3 (عشان RLS لكل صف كان بطيء) وكل واحدة فيها الحارسان: الدور + cm_can_read_all
    const defs = mig.split(/CREATE OR REPLACE FUNCTION/).filter((b) => /SECURITY DEFINER/.test(b));
    expect(defs.length).toBe(3);
    for (const b of defs) {
      expect(b).toMatch(/ai_asst_require\(ARRAY\['general_manager','executive_manager','sales_manager'\]/);
      expect(b).toMatch(/IF NOT public\.cm_can_read_all\(\) THEN RAISE EXCEPTION 'forbidden'/);
      expect(b).toMatch(/SET search_path = public/);
    }
    expect((mig.match(/ai_asst_require\(ARRAY\['general_manager','executive_manager','sales_manager'\]/g) ?? []).length).toBe(3);
    expect((mig.match(/cm_can_read_all\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(mig).toContain("ai_asst_range(_from, _to)");
    expect(mig).not.toMatch(/phone_norm|contact_name|contact_handle|FROM public\.cm_messages|cm_ad_attributions|catering_/);
    expect(mig).toMatch(/REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon/);
  });

  it("wording: permission refusal only after a real forbidden; otherwise the 'not available yet' sentence", () => {
    expect(voice).toContain("ممنوعة إلا لو أداة اتنادت فعلًا ورجّعت error=forbidden");
    expect(voice).toContain("ده مش متاح في المساعد لسه. أقدر أجاوبك عن");
    expect(voice).toContain("toolLog.length > 0, roles)");
    expect(voice).toContain('!toolLog.length ? "no_tool"');
  });
});
