import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

const VALID = /^([01]\d|2[0-3]):[0-5]\d$/;

/** حقل وقت بنظام ٢٤ ساعة (بدون ص/م) — لا يُمرَّر التغيير إلا عند اكتمال صيغة HH:MM صحيحة. */
export function TimeInput24(props: { value: string; onChange: (v: string) => void; disabled?: boolean; "aria-label"?: string }) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const bad = draft !== "" && !VALID.test(draft);
  return (
    <Input dir="ltr" inputMode="numeric" maxLength={5} placeholder="21:00" disabled={props.disabled} aria-label={props["aria-label"]}
      aria-invalid={bad} title="بنظام ٢٤ ساعة، مثل 09:00 أو 21:00"
      className={`font-mono text-center ${bad ? "border-[#F37346]" : ""}`} value={draft}
      onChange={(e) => {
        let v = e.target.value.replace(/[^\d:]/g, "");
        if (/^\d{3,4}$/.test(v)) v = v.padStart(4, "0").replace(/^(\d\d)(\d\d)$/, "$1:$2");
        setDraft(v);
        if (VALID.test(v)) props.onChange(v);
      }}
      onBlur={() => { if (!VALID.test(draft)) setDraft(props.value); }} />
  );
}
