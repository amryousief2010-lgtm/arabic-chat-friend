import { createContext, useContext, useState, ReactNode, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type Ctx = { includeTest: boolean; setIncludeTest: (b: boolean) => void; canToggle: boolean };
const TestDataCtx = createContext<Ctx>({ includeTest: false, setIncludeTest: () => {}, canToggle: false });

export const TestDataProvider = ({ children }: { children: ReactNode }) => {
  const { role } = useAuth();
  const canToggle = role === "general_manager" || role === "executive_manager";
  const [includeTest, setIncludeTest] = useState(false);
  return (
    <TestDataCtx.Provider value={{ includeTest: canToggle ? includeTest : false, setIncludeTest, canToggle }}>
      {children}
    </TestDataCtx.Provider>
  );
};

export const useTestDataFilter = () => useContext(TestDataCtx);

/** Returns predicate for client-side filtering of records that have a "notes" field. */
export const useTestFilterPredicate = () => {
  const { includeTest } = useTestDataFilter();
  return useMemo(
    () => (row: { notes?: string | null; reference?: string | null }) => {
      if (includeTest) return true;
      const tag = `${row?.notes ?? ""} ${row?.reference ?? ""}`;
      return !/TEST-DISPATCH/i.test(tag);
    },
    [includeTest],
  );
};

export const TestDataToggle = () => {
  const { includeTest, setIncludeTest, canToggle } = useTestDataFilter();
  if (!canToggle)
    return (
      <Badge variant="outline" className="text-xs">
        بيانات تشغيلية فقط
      </Badge>
    );
  return (
    <div className="flex items-center gap-2 text-xs">
      <Switch id="test-toggle" checked={includeTest} onCheckedChange={setIncludeTest} />
      <Label htmlFor="test-toggle" className="cursor-pointer">
        تضمين بيانات الاختبار (TEST-DISPATCH)
      </Label>
      {includeTest && <Badge variant="destructive">عرض الاختبار مفعل</Badge>}
    </div>
  );
};
