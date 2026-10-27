import { Link } from "react-router-dom";
import { Briefcase, MapPin, CalendarDays, Pencil, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRAND, SCALE } from "@/lib/hr/brand";
import { departmentLabel, type DirectoryEmployee } from "@/lib/hr/directory";
import { Chip, EmployeeAvatar, deptColor } from "./HrUi";

interface Props {
  employee: DirectoryEmployee;
  locationName?: string | null;
  onEdit?: () => void;
}

/** بطاقة موظف مقروءة: الصورة، الاسم، المسمى، القسم، مكان العمل، يوم القبض، الحالة — بلا مرتبات أو هواتف */
const EmployeeCard = ({ employee: e, locationName, onEdit }: Props) => {
  const dept = departmentLabel(e.department);
  const statusChip = e.is_suspended
    ? <Chip color={BRAND.orange}>موقوف عن العمل</Chip>
    : e.status === "active" ? <Chip color={BRAND.purple}>نشط</Chip> : <Chip color={BRAND.orange}>غير نشط</Chip>;

  return (
    <div
      className="bg-card border rounded-2xl flex flex-col hover:shadow-md transition-shadow"
      style={{ padding: SCALE.lg, gap: SCALE.md }}
      data-testid="employee-card"
      dir="rtl"
    >
      <div className="flex items-center" style={{ gap: SCALE.md }}>
        <EmployeeAvatar employeeId={e.id} userId={e.user_id} name={e.full_name} size={SCALE.xxl - SCALE.sm} />
        <div className="min-w-0 flex-1">
          <Link to={`/hr/employees/${e.id}`} className="font-bold text-base hover:underline block truncate" style={{ color: BRAND.purple }}>
            {e.full_name}
          </Link>
          <div className="text-xs text-muted-foreground font-mono">{e.code}</div>
          {e.user_id && (
            <div className="text-[11px] mt-1 inline-flex items-center gap-1" style={{ color: BRAND.magenta }}>
              <Link2 className="w-3 h-3" />مرتبط بحساب دخول
            </div>
          )}
        </div>
        {statusChip}
      </div>

      <div className="flex flex-wrap" style={{ gap: SCALE.xs }}>
        <Chip color={deptColor(dept)}>{dept}</Chip>
        {e.job_title
          ? <Chip color={BRAND.magenta}><Briefcase className="w-3 h-3" />{e.job_title}</Chip>
          : <Chip color={BRAND.orange}>لم يُحدَّد المسمى</Chip>}
      </div>

      <div className="grid grid-cols-2 text-sm text-muted-foreground" style={{ gap: SCALE.sm }}>
        <span className="inline-flex items-center gap-1 truncate"><MapPin className="w-4 h-4" style={{ color: BRAND.orange }} />{locationName || "—"}</span>
        <span className="inline-flex items-center gap-1"><CalendarDays className="w-4 h-4" style={{ color: BRAND.magenta }} />القبض يوم {e.pay_day}</span>
      </div>

      <div className="flex gap-2 mt-auto">
        <Button asChild variant="outline" size="sm" className="flex-1">
          <Link to={`/hr/employees/${e.id}`}>ملف الموظف</Link>
        </Button>
        {onEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label="تعديل البيانات">
            <Pencil className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
};

export default EmployeeCard;
