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
  Egg,
  FlaskConical,
  Drumstick,
  Beef,
  Warehouse,
  User,
  UserX,
  Users,
} from "lucide-react";
import { LucideIcon } from "lucide-react";

interface Member {
  name: string;
  title: string;
  vacant?: boolean;
}

interface Unit {
  id: string;
  name: string;
  icon: LucideIcon;
  color: string; // tailwind gradient classes
  ring: string;  // ring color class
  members: Member[];
}

// ====================== TOP LEVEL ======================
const ceo = { name: "م/ عمرو يوسف", title: "المدير العام" };
const executive = { name: "أ/ أحمد الجمل", title: "المدير التنفيذي" };

// ====================== PRODUCTION (الإنتاج والتشغيل) ======================
const productionUnits: Unit[] = [
  {
    id: "mother-farm",
    name: "مزرعة الأمهات",
    icon: Egg,
    color: "from-orange-500 to-orange-700",
    ring: "ring-orange-500/30",
    members: [
      { name: "أحمد خاطر", title: "مشرف / مسؤول مزرعة الأمهات" },
      { name: "حجاج قرني", title: "متابعة يومية وتغذية وتحصيل البيض" },
    ],
  },
  {
    id: "hatchery",
    name: "معمل التفريخ",
    icon: FlaskConical,
    color: "from-cyan-500 to-cyan-700",
    ring: "ring-cyan-500/30",
    members: [
      { name: "عبداللطيف", title: "مدير معمل التفريخ" },
      { name: "محمود عزت", title: "موظف متابعة ماكينات التفريخ" },
    ],
  },
  {
    id: "brooding",
    name: "مزرعة التحصين والتسمين",
    icon: Drumstick,
    color: "from-yellow-500 to-yellow-700",
    ring: "ring-yellow-500/30",
    members: [
      { name: "شاغر", title: "مشرف مزرعة التحصين والتسمين", vacant: true },
      { name: "عابد زكريا", title: "مسؤول التغذية والتسمين" },
      { name: "السيد المرسي", title: "عمال الرعاية والمتابعة اليومية" },
    ],
  },
  {
    id: "slaughter",
    name: "مجزر النعام",
    icon: Beef,
    color: "from-red-500 to-red-700",
    ring: "ring-red-500/30",
    members: [
      { name: "محمود جمال", title: "مدير / مشرف المجزر" },
      { name: "مصطفى محمد", title: "فريق الذبح" },
      { name: "يوسف زغلول", title: "فريق التشفية والتقطيع" },
      { name: "إبراهيم السعدني", title: "فريق التعبئة والتغليف" },
      { name: "رضا عطية", title: "النظافة والتعقيم بالمجزر" },
    ],
  },
  {
    id: "meat-factory",
    name: "مصنع مصنعات اللحوم",
    icon: Factory,
    color: "from-rose-500 to-rose-700",
    ring: "ring-rose-500/30",
    members: [
      { name: "شاغر", title: "مدير مصنع مصنعات اللحوم", vacant: true },
      { name: "شاغر", title: "فريق تصنيع المنتجات", vacant: true },
      { name: "شاغر", title: "فريق التعبئة والتغليف", vacant: true },
      { name: "شاغر", title: "تسليم المنتج النهائي للمخازن", vacant: true },
    ],
  },
  {
    id: "warehouses",
    name: "المخازن التشغيلية",
    icon: Warehouse,
    color: "from-purple-500 to-purple-700",
    ring: "ring-purple-500/30",
    members: [
      { name: "عبدالهادي علي", title: "مسؤول المخزن العمومي" },
      { name: "فاطمة محمد / فاطمة علي", title: "مسؤول المخزن الفرعي" },
    ],
  },
];

// ====================== MARKETING & SALES ======================
const salesTeam: Member[] = [
  { name: "آية جمال", title: "موظف مبيعات 1" },
  { name: "سارة أحمد", title: "موظف مبيعات 2" },
  { name: "سارة دسوقي", title: "موظف مبيعات 3" },
  { name: "نورا عبدالرحمن", title: "موظف مبيعات 4" },
];

// ====================== FINANCE ======================
const financeTeam: Member[] = [
  { name: "محمد شعلة", title: "محاسب عمومي + تكاليف" },
  { name: "محمد خالد", title: "محاسب" },
  { name: "عبدالهادي علي", title: "محاسب مخازن" },
];

// ====================== QUALITY ======================
const qualityTeam: Member[] = [
  { name: "أحمد خاطر", title: "أخصائي جودة" },
];

// ====================== UI Components ======================
const TopCard = ({
  name,
  title,
  icon: Icon,
  gradient,
  large,
}: {
  name: string;
  title: string;
  icon: LucideIcon;
  gradient: string;
  large?: boolean;
}) => (
  <Card
    className={`relative overflow-hidden border-0 shadow-xl hover:shadow-2xl transition-all hover:-translate-y-1 ${
      large ? "p-6 min-w-[280px]" : "p-5 min-w-[240px]"
    }`}
  >
    <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-95`} />
    <div className="relative flex flex-col items-center text-center text-white gap-2">
      <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur flex items-center justify-center mb-1">
        <Icon className={large ? "w-8 h-8" : "w-7 h-7"} />
      </div>
      <p className={`font-bold ${large ? "text-xl" : "text-lg"}`}>{name}</p>
      <p className="text-sm opacity-95 font-medium">{title}</p>
    </div>
  </Card>
);

const MemberRow = ({ member }: { member: Member }) => (
  <div
    className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
      member.vacant
        ? "bg-muted/40 border-dashed border-muted-foreground/30"
        : "bg-card border-border hover:bg-accent/40"
    }`}
  >
    <div
      className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
        member.vacant ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
      }`}
    >
      {member.vacant ? <UserX className="w-4 h-4" /> : <User className="w-4 h-4" />}
    </div>
    <div className="flex-1 min-w-0">
      <p
        className={`text-sm font-semibold truncate ${
          member.vacant ? "text-muted-foreground" : "text-foreground"
        }`}
      >
        {member.name}
      </p>
      <p className="text-xs text-muted-foreground truncate">{member.title}</p>
    </div>
    {member.vacant && (
      <Badge variant="outline" className="text-[10px] border-orange-500/40 text-orange-600 bg-orange-500/5">
        شاغر
      </Badge>
    )}
  </div>
);

const UnitCard = ({ unit }: { unit: Unit }) => {
  const Icon = unit.icon;
  const filled = unit.members.filter((m) => !m.vacant).length;
  const vacant = unit.members.length - filled;
  return (
    <Card className={`overflow-hidden ring-1 ${unit.ring} shadow-md`}>
      <div className={`bg-gradient-to-br ${unit.color} p-3 text-white flex items-center gap-3`}>
        <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-sm">{unit.name}</p>
          <p className="text-xs opacity-90">
            {filled} مشغول{vacant > 0 ? ` • ${vacant} شاغر` : ""}
          </p>
        </div>
      </div>
      <div className="p-3 space-y-2 bg-card">
        {unit.members.map((m, i) => (
          <MemberRow key={i} member={m} />
        ))}
      </div>
    </Card>
  );
};

const TeamSection = ({
  title,
  icon: Icon,
  gradient,
  managerName,
  managerTitle,
  members,
}: {
  title: string;
  icon: LucideIcon;
  gradient: string;
  managerName: string;
  managerTitle: string;
  members: Member[];
}) => (
  <div>
    <div className="flex justify-center mb-4">
      <TopCard name={managerName} title={managerTitle} icon={Icon} gradient={gradient} />
    </div>
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-4 h-4 text-muted-foreground" />
        <h4 className="font-semibold text-foreground">{title}</h4>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {members.map((m, i) => (
          <MemberRow key={i} member={m} />
        ))}
      </div>
    </Card>
  </div>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-3 my-6">
    <div className="h-px flex-1 bg-border" />
    <h2 className="text-lg font-bold text-foreground">{children}</h2>
    <div className="h-px flex-1 bg-border" />
  </div>
);

const Connector = () => <div className="w-0.5 h-6 bg-border mx-auto" />;

const OrgChart = () => {
  return (
    <DashboardLayout>
      <Header title="الهيكل التنظيمي" subtitle="الهيكل التفصيلي لشركة نعام العاصمة" />

      <div className="py-6 px-2 sm:px-4 space-y-2 max-w-7xl mx-auto">
        {/* CEO */}
        <div className="flex flex-col items-center">
          <TopCard
            name={ceo.name}
            title={ceo.title}
            icon={Crown}
            gradient="from-purple-600 to-purple-800"
            large
          />
          <Connector />
          <TopCard
            name={executive.name}
            title={executive.title}
            icon={UserCog}
            gradient="from-orange-500 to-orange-700"
            large
          />
        </div>

        {/* PRODUCTION & OPERATIONS */}
        <SectionTitle>إدارة الإنتاج والتشغيل</SectionTitle>
        <div className="flex justify-center mb-4">
          <TopCard
            name="م/ السيد الجمل"
            title="مدير الإنتاج والتشغيل"
            icon={Factory}
            gradient="from-blue-500 to-blue-700"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {productionUnits.map((u) => (
            <UnitCard key={u.id} unit={u} />
          ))}
        </div>

        {/* MARKETING & SALES */}
        <SectionTitle>إدارة التسويق والمبيعات</SectionTitle>
        <TeamSection
          title="فريق المبيعات"
          icon={Megaphone}
          gradient="from-pink-500 to-pink-700"
          managerName="م/ آلاء حامد"
          managerTitle="مدير المبيعات"
          members={salesTeam}
        />

        {/* FINANCE */}
        <SectionTitle>الإدارة المالية</SectionTitle>
        <TeamSection
          title="فريق المحاسبة"
          icon={Wallet}
          gradient="from-emerald-500 to-emerald-700"
          managerName="أ/ خالد الجنزوري"
          managerTitle="المدير المالي"
          members={financeTeam}
        />

        {/* QUALITY */}
        <SectionTitle>إدارة الجودة</SectionTitle>
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <TopCard
              name="م/ السيد الجمل"
              title="مدير الجودة"
              icon={ShieldCheck}
              gradient="from-amber-500 to-amber-700"
            />
            <Badge variant="secondary" className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap">
              قائم بالأعمال مؤقتًا
            </Badge>
          </div>
          <Card className="p-4 w-full max-w-md mt-3">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-muted-foreground" />
              <h4 className="font-semibold text-foreground">فريق الجودة</h4>
            </div>
            <div className="space-y-2">
              {qualityTeam.map((m, i) => (
                <MemberRow key={i} member={m} />
              ))}
            </div>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default OrgChart;
