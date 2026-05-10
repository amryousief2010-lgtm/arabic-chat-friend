import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LucideIcon, Construction } from "lucide-react";

interface ModulePlaceholderProps {
  title: string;
  description: string;
  icon: LucideIcon;
  features: string[];
}

const ModulePlaceholder = ({ title, description, icon: Icon, features }: ModulePlaceholderProps) => {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Icon className="w-7 h-7 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-foreground">{title}</h1>
          <p className="text-muted-foreground mt-1">{description}</p>
        </div>
      </div>

      <Card className="border-dashed border-2">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Construction className="w-6 h-6 text-secondary" />
            <div>
              <CardTitle>قيد التطوير</CardTitle>
              <CardDescription>هذه الوحدة جاهزة للبناء — تواصل معنا لتفعيل الميزات التالية</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            {features.map((feature) => (
              <div key={feature} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <Badge variant="outline" className="shrink-0">قريباً</Badge>
                <span className="text-sm font-medium">{feature}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ModulePlaceholder;
