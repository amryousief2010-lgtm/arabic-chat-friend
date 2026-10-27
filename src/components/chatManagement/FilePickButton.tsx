import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip } from "lucide-react";

/** بديل عربي لحقل الملف الأصلي (الذي يعرض «Choose File / No file chosen» بلغة المتصفح). */
export function FilePickButton(props: {
  accept?: string; multiple?: boolean; label?: string; ariaLabel: string;
  onFiles: (files: FileList | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const id = useId();
  const [names, setNames] = useState<string[]>([]);
  const shown = names.length === 0 ? "لم يُختر أي ملف" : names.length === 1 ? names[0] : `${names.length} ملفات: ${names.slice(0, 3).join("، ")}${names.length > 3 ? "…" : ""}`;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input ref={ref} id={id} type="file" className="sr-only" accept={props.accept} multiple={props.multiple} aria-label={props.ariaLabel}
        onChange={(e) => { setNames(Array.from(e.target.files ?? []).map((f) => f.name)); props.onFiles(e.target.files); }} />
      <Button type="button" variant="outline" className="border-[#662D8C]/40 text-[#662D8C] hover:bg-[#662D8C]/5" onClick={() => ref.current?.click()}>
        <Paperclip className="h-4 w-4 ml-2" />{props.label ?? (props.multiple ? "اختيار الملفات" : "اختيار ملف")}
      </Button>
      <span className="text-sm text-muted-foreground break-all" dir="auto" aria-live="polite">{shown}</span>
    </div>
  );
}
