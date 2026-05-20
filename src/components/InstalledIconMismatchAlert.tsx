import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const KEY = "pwa-installed-icon-hashes";
const ICONS = [
  { key: "favicon", path: "/favicon.png" },
  { key: "pwa192", path: "/pwa-192x192.png" },
  { key: "pwa512", path: "/pwa-512x512.png" },
  { key: "appleTouch", path: "/apple-touch-icon.png" },
];

async function sha(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

const InstalledIconMismatchAlert = () => {
  const navigate = useNavigate();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error iOS
      window.navigator.standalone === true;
    if (!isStandalone) return;

    (async () => {
      try {
        const hashes: Record<string, string> = {};
        await Promise.all(
          ICONS.map(async ({ key, path }) => {
            try {
              const r = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
              hashes[key] = await sha(await r.arrayBuffer());
            } catch {
              hashes[key] = "error";
            }
          }),
        );

        const stored = localStorage.getItem(KEY);
        if (!stored) {
          localStorage.setItem(KEY, JSON.stringify(hashes));
          return;
        }
        const prev = JSON.parse(stored) as Record<string, string>;
        const diff = Object.keys(hashes).filter(
          (k) => prev[k] && prev[k] !== hashes[k] && hashes[k] !== "error",
        );
        if (diff.length > 0) {
          toast.warning("الأيقونة المثبّتة قديمة", {
            description:
              "يرجى حذف التطبيق من الشاشة الرئيسية وإعادة تثبيته لتظهر الأيقونة الجديدة.",
            duration: 12000,
            action: {
              label: "تفاصيل",
              onClick: () => navigate("/pwa-diagnostics"),
            },
          });
        }
      } catch {
        // ignore
      }
    })();
  }, [navigate]);

  return null;
};

export default InstalledIconMismatchAlert;
