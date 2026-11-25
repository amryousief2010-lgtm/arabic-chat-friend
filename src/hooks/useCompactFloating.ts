import { useEffect, useState } from "react";

/**
 * الشاشات ذات شبكة البطاقات (مثل «منتجات الموقع») تضبط body[data-version-badge="compact"]
 * حتى تصغر العناصر العائمة أسفل اليسار (شارة الإصدار والساعة) ولا تغطي الأسعار.
 */
export function useCompactFloating(): boolean {
  const read = () => typeof document !== "undefined" && document.body.dataset.versionBadge === "compact";
  const [compact, setCompact] = useState(read);
  useEffect(() => {
    const update = () => setCompact(read());
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.body, { attributes: true, attributeFilter: ["data-version-badge"] });
    return () => mo.disconnect();
  }, []);
  return compact;
}
