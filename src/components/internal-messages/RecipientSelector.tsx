import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Check, Search, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface RecipientOption {
  id: string;
  full_name: string | null;
  role?: string;
}

const ROLE_LABEL: Record<string, string> = {
  general_manager: "المدير العام",
  executive_manager: "المدير التنفيذي",
  sales_manager: "مدير المبيعات",
  sales_moderator: "موديريتور",
  accountant: "محاسب",
  warehouse_supervisor: "مسؤول المخزن",
  farm_manager: "مدير المزرعة",
  hatchery_manager: "مدير المعمل",
  brooding_manager: "مدير التحضين",
  slaughterhouse_manager: "مدير المجزر",
  meat_factory_manager: "مدير مصنع اللحوم",
  feed_factory_manager: "مدير مصنع الأعلاف",
  hr_manager: "مدير الموارد البشرية",
  production_manager: "مدير الإنتاج",
  marketing_sales_manager: "مدير التسويق",
  financial_manager: "المدير المالي",
  quality_manager: "مدير الجودة",
  shipping_company: "شركة شحن",
  private_delivery_rep: "مندوب خاص",
  agouza_warehouse_keeper: "أمين مخزن العجوزة",
  brooding_dashboard_viewer: "متابع التحضين",
  lab_treasury_keeper: "أمين خزنة المعمل",
  lab_external_collector: "محصل خارجي",
  lab_treasury_approver: "معتمد خزنة المعمل",
  slaughterhouse_custody_keeper: "أمين عهدة المجزر",
};

interface Props {
  value: string[];
  onChange: (ids: string[]) => void;
}

export const RecipientSelector = ({ value, onChange }: Props) => {
  const { user } = useAuth();
  const [search, setSearch] = useState("");

  const { data: users = [] } = useQuery({
    queryKey: ["internal-msg-users"],
    queryFn: async () => {
      const { data: profiles } = await supabase
        .from("profile_directory")
        .select("id, full_name")
        .order("full_name");
      const { data: roles } = await supabase.from("user_roles").select("user_id, role");
      const roleMap = new Map<string, string>();
      (roles || []).forEach((r: any) => {
        if (!roleMap.has(r.user_id)) roleMap.set(r.user_id, r.role);
      });
      return (profiles || []).map((p: any) => ({
        id: p.id,
        full_name: p.full_name,
        role: roleMap.get(p.id),
      })) as RecipientOption[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users
      .filter((u) => u.id !== user?.id)
      .filter((u) => {
        if (!q) return true;
        const name = (u.full_name || "").toLowerCase();
        const role = (u.role || "").toLowerCase();
        const roleLabel = (u.role && ROLE_LABEL[u.role]) || "";
        return name.includes(q) || role.includes(q) || roleLabel.includes(q);
      });
  }, [users, search, user?.id]);

  const selected = useMemo(
    () => users.filter((u) => value.includes(u.id)),
    [users, value],
  );

  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  };

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((u) => (
            <Badge key={u.id} variant="secondary" className="gap-1 py-1">
              {u.full_name || "موظف"}
              <button
                type="button"
                onClick={() => toggle(u.id)}
                className="hover:text-destructive"
                aria-label="إزالة"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث بالاسم أو الدور..."
          className="pr-9"
        />
      </div>
      <ScrollArea className="h-56 rounded-md border">
        <div className="p-1">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">لا توجد نتائج</div>
          ) : (
            filtered.map((u) => {
              const isSel = value.includes(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggle(u.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-accent text-right ${
                    isSel ? "bg-accent" : ""
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded border flex items-center justify-center ${
                      isSel ? "bg-primary border-primary text-primary-foreground" : "border-input"
                    }`}
                  >
                    {isSel && <Check className="w-3 h-3" />}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">{u.full_name || "موظف"}</div>
                    {u.role && (
                      <div className="text-xs text-muted-foreground">
                        {ROLE_LABEL[u.role] || u.role}
                      </div>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
