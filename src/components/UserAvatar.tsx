import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAvatarUrl } from "@/hooks/useAvatars";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  userId?: string | null;
  /** معرّف ملف الموظف (hr_employees.id) — يُستخدم إن لم يكن هناك حساب مربوط */
  employeeId?: string | null;
  name?: string | null;
  /** أسماء بديلة للمطابقة مع profile_directory حين لا يتوفر معرّف (القيادة، كروت المسوقات) */
  matchNames?: Array<string | null | undefined>;
  className?: string;
  fallbackClassName?: string;
  fallbackStyle?: React.CSSProperties;
}

const initial = (name?: string | null) => {
  const trimmed = (name || "").trim();
  return trimmed ? trimmed.charAt(0) : "م";
};

const UserAvatar = ({ userId, employeeId, name, matchNames, className, fallbackClassName, fallbackStyle }: UserAvatarProps) => {
  const url = useAvatarUrl(userId, employeeId, matchNames);

  return (
    <Avatar className={cn("w-10 h-10", className)} data-has-photo={url ? "1" : "0"}>
      {url && <AvatarImage src={url} alt={name || "صورة المستخدم"} className="object-cover" />}
      <AvatarFallback className={cn("bg-primary text-primary-foreground font-semibold", fallbackClassName)} style={fallbackStyle}>
        {initial(name)}
      </AvatarFallback>
    </Avatar>
  );
};

export default UserAvatar;
