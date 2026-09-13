import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";

interface Props {
  phone: string;
  className?: string;
}

export default function CopyPhoneButton({ phone, className }: Props) {
  const [copied, setCopied] = useState(false);
  if (!phone) return null;

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const digits = phone.replace(/[^\d+]/g, "");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(digits);
      } else {
        const ta = document.createElement("textarea");
        ta.value = digits;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast.success("تم نسخ الرقم");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("تعذّر نسخ الرقم");
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title="نسخ الرقم"
      aria-label="نسخ الرقم"
      className={`p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0 ${className || ""}`}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}
