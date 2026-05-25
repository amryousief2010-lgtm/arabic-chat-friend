import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, Download } from "lucide-react";
import { TestDataToggle } from "@/hooks/useTestDataFilter";

export interface FactoryFilterState {
  from: string;
  to: string;
  status: string;
  search: string;
}

export const defaultFilterState = (): FactoryFilterState => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  return {
    from: first.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
    status: "all",
    search: "",
  };
};

interface Props {
  value: FactoryFilterState;
  onChange: (v: FactoryFilterState) => void;
  statuses?: string[];
  onExport?: () => void;
  extra?: React.ReactNode;
}

export default function FactoryFilters({ value, onChange, statuses, onExport, extra }: Props) {
  const setF = (patch: Partial<FactoryFilterState>) => onChange({ ...value, ...patch });
  return (
    <div className="border rounded-lg p-3 bg-card space-y-3" dir="rtl">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div>
          <Label className="text-xs">من تاريخ</Label>
          <Input type="date" value={value.from} onChange={(e) => setF({ from: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">إلى تاريخ</Label>
          <Input type="date" value={value.to} onChange={(e) => setF({ to: e.target.value })} />
        </div>
        {statuses && (
          <div>
            <Label className="text-xs">الحالة</Label>
            <Select value={value.status} onValueChange={(v) => setF({ status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="md:col-span-2">
          <Label className="text-xs">بحث</Label>
          <div className="relative">
            <Search className="h-4 w-4 absolute right-2 top-3 text-muted-foreground" />
            <Input className="pr-8" placeholder="رقم دفعة / منتج..." value={value.search} onChange={(e) => setF({ search: e.target.value })} />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <TestDataToggle />
        <div className="flex items-center gap-2">
          {extra}
          {onExport && (
            <Button variant="outline" size="sm" onClick={onExport}>
              <Download className="h-4 w-4 ml-1" />تصدير CSV
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
