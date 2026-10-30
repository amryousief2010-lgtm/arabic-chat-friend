import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HR_DEPARTMENTS, findDepartmentByName } from "@/lib/hr/jobCatalogue";

const NONE = "__none__";

/** خانة القسم: قائمة الأقسام المعتمدة؛ القيمة القديمة غير الموجودة تظهر كما هي حتى تُعتمد خريطة التوحيد */
const DepartmentField = ({ value, onChange }: { value: string | null | undefined; onChange: (v: string) => void }) => {
  const v = (value || "").trim();
  const legacy = v && !findDepartmentByName(v) ? v : null;
  return (
    <Select value={v || NONE} onValueChange={(s) => onChange(s === NONE ? "" : s)}>
      <SelectTrigger data-testid="department-select"><SelectValue placeholder="اختر القسم" /></SelectTrigger>
      <SelectContent className="max-h-80">
        <SelectItem value={NONE}>بدون قسم</SelectItem>
        {legacy && <SelectItem value={legacy}>{legacy} (قيمة قديمة)</SelectItem>}
        {HR_DEPARTMENTS.map((d) => <SelectItem key={d.code} value={d.name}>{d.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
};

export default DepartmentField;
