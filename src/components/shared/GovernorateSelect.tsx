import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EGYPT_GOVERNORATES, governorateLabel } from "@/lib/governorates";

interface Props {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
}

/** قائمة محافظات مصر الموحدة — لا يُسمح بكتابة اسم محافظة يدويًا. */
export default function GovernorateSelect({ value, onChange, className, placeholder = "اختر المحافظة" }: Props) {
  // لو العميل محفوظ باسم قديم غير معتمد، نعرضه بالاسم المعتمد المقابل
  const canonical = value ? governorateLabel(value) : "";
  const known = EGYPT_GOVERNORATES.some((g) => g.name === canonical);

  return (
    <Select value={known ? canonical : ""} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {EGYPT_GOVERNORATES.map((g) => (
          <SelectItem key={g.id} value={g.name}>{g.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
