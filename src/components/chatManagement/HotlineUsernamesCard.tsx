import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;
interface Mapping { username: string; moderator_id: string | null; notes: string | null }

/** ربط Username في Switched.csv بالمودريتور (SM/GM). أي تعديل يعيد نسب المكالمات السابقة لنفس الاسم تلقائياً. */
export function HotlineUsernamesCard({ onChange }: { onChange: () => void }) {
  const [rows, setRows] = useState<Mapping[]>([]);
  const [mods, setMods] = useState<{ id: string; display_name: string }[]>([]);
  const [draft, setDraft] = useState({ username: "", moderator_id: "" });
  const load = useCallback(async () => {
    const [m, d] = await Promise.all([db.from("cm_hotline_usernames").select("username,moderator_id,notes").order("username"),
      db.from("cm_moderators").select("id,display_name").order("display_name")]);
    if (m.error) toast.error(m.error.message);
    setRows(m.data ?? []); setMods(d.data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = async (username: string, moderator_id: string | null) => {
    const u = username.trim().toLowerCase(); if (!u) return;
    const { error } = await db.from("cm_hotline_usernames").upsert({ username: u, moderator_id }, { onConflict: "username" });
    if (error) toast.error(`تعذّر الحفظ: ${error.message}`); else { toast.success("تم الحفظ وإعادة نسب المكالمات"); setDraft({ username: "", moderator_id: "" }); load(); onChange(); }
  };
  const select = (value: string, on: (v: string) => void, label: string) => (
    <select aria-label={label} className="h-9 rounded-md border bg-background px-2 text-sm" value={value} onChange={(e) => on(e.target.value)}>
      <option value="">— بدون —</option>{mods.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</select>);
  return (
    <Card>
      <CardHeader><CardTitle>ربط مستخدمي الهوت لاين بالمودريتورز</CardTitle>
        <CardDescription>Username كما يظهر في Switched.csv. المكالمة تُنسب لمن قبلها (ACCEPTED)، والفائتة لآخر من رُنّت عليه.</CardDescription></CardHeader>
      <CardContent className="space-y-2">
        <table className="w-full text-sm"><tbody>{rows.map((r) => (
          <tr key={r.username} className="border-t"><td className="p-1" dir="ltr">{r.username}</td>
            <td className="p-1">{select(r.moderator_id ?? "", (v) => save(r.username, v || null), `مودريتور ${r.username}`)}</td></tr>))}
          {!rows.length && <tr><td className="p-2 text-muted-foreground">لا يوجد ربط بعد</td></tr>}</tbody></table>
        <div className="flex flex-wrap items-center gap-2">
          <Input dir="ltr" placeholder="username" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} className="w-44" aria-label="اسم المستخدم" />
          {select(draft.moderator_id, (v) => setDraft({ ...draft, moderator_id: v }), "المودريتور")}
          <Button size="sm" className="bg-[#A4288A] hover:bg-[#662D8C] text-white" onClick={() => save(draft.username, draft.moderator_id || null)}>إضافة</Button>
        </div>
      </CardContent>
    </Card>
  );
}
