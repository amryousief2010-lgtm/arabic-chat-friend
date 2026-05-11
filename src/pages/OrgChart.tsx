import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Crown,
  UserCog,
  Factory,
  Megaphone,
  Wallet,
  ShieldCheck,
} from "lucide-react";
import { LucideIcon } from "lucide-react";

interface Person {
  name: string;
  title: string;
  icon: LucideIcon;
  color: string;
  acting?: boolean;
}

const ceo: Person = {
  name: "م/ عمرو يوسف",
  title: "المدير العام",
  icon: Crown,
  color: "from-purple-600 to-purple-800",
};

const executive: Person = {
  name: "أ/ أحمد الجمل",
  title: "المدير التنفيذي",
  icon: UserCog,
  color: "from-orange-500 to-orange-700",
};

const directors: Person[] = [
  {
    name: "م/ السيد الجمل",
    title: "مدير الإنتاج والتشغيل",
    icon: Factory,
    color: "from-blue-500 to-blue-700",
  },
  {
    name: "م/ آلاء حامد",
    title: "مدير التسويق والمبيعات",
    icon: Megaphone,
    color: "from-pink-500 to-pink-700",
  },
  {
    name: "أ/ خالد الجنزوري",
    title: "المدير المالي",
    icon: Wallet,
    color: "from-emerald-500 to-emerald-700",
  },
  {
    name: "م/ السيد الجمل",
    title: "مدير الجودة",
    icon: ShieldCheck,
    color: "from-amber-500 to-amber-700",
    acting: true,
  },
];

const PersonCard = ({ person, large = false }: { person: Person; large?: boolean }) => {
  const Icon = person.icon;
  return (
    <Card
      className={`relative overflow-hidden border-0 shadow-xl hover:shadow-2xl transition-all hover:-translate-y-1 ${
        large ? "p-6 min-w-[280px]" : "p-5 min-w-[230px]"
      }`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${person.color} opacity-95`} />
      <div className="relative flex flex-col items-center text-center text-white gap-2">
        <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur flex items-center justify-center mb-1">
          <Icon className={large ? "w-8 h-8" : "w-7 h-7"} />
        </div>
        <p className={`font-bold ${large ? "text-xl" : "text-lg"}`}>{person.name}</p>
        <p className="text-sm opacity-95 font-medium">{person.title}</p>
        {person.acting && (
          <Badge variant="secondary" className="mt-1 text-xs">
            قائم بالأعمال مؤقتًا
          </Badge>
        )}
      </div>
    </Card>
  );
};

const Connector = ({ height = "h-8" }: { height?: string }) => (
  <div className={`w-0.5 ${height} bg-border mx-auto`} />
);

const OrgChart = () => {
  return (
    <DashboardLayout>
      <Header
        title="الهيكل التنظيمي"
        subtitle="هيكل القيادة في شركة نعام العاصمة"
      />

      <div className="flex flex-col items-center gap-2 py-8 px-4 overflow-x-auto">
        {/* المدير العام */}
        <PersonCard person={ceo} large />
        <Connector />

        {/* المدير التنفيذي */}
        <PersonCard person={executive} large />
        <Connector />

        {/* خط أفقي للمديرين */}
        <div className="w-full max-w-5xl flex flex-col items-center">
          <div className="h-0.5 bg-border w-full max-w-4xl" />
          <div className="flex justify-around w-full max-w-5xl gap-4 flex-wrap pt-0">
            {directors.map((d, i) => (
              <div key={i} className="flex flex-col items-center">
                <Connector />
                <PersonCard person={d} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default OrgChart;
