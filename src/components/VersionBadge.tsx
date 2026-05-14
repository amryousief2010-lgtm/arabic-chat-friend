import { useEffect, useState } from "react";
import {
  CURRENT_VERSION,
  getLastCheck,
  subscribeToChecks,
  triggerReload,
  type LastCheckState,
} from "@/lib/updateChecker";

const VersionBadge = () => {
  const [state, setState] = useState<LastCheckState | null>(getLastCheck());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const unsub = subscribeToChecks(setState);
    return () => {
      unsub();
    };
  }, []);

  const stale = state?.remote && state.remote !== CURRENT_VERSION;
  const dot = stale ? "#ef4444" : state?.upToDate ? "#10b981" : "#94a3b8";

  return (
    <div
      dir="rtl"
      style={{
        position: "fixed",
        bottom: 8,
        left: 8,
        zIndex: 60,
        fontFamily: "system-ui, sans-serif",
        fontSize: 11,
        userSelect: "none",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          borderRadius: 999,
          background: "rgba(15,23,42,0.7)",
          color: "#e2e8f0",
          border: "1px solid rgba(148,163,184,0.25)",
          backdropFilter: "blur(6px)",
          cursor: "pointer",
        }}
        title="حالة الإصدار"
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot }} />
        <span style={{ fontFamily: "monospace" }}>v{CURRENT_VERSION}</span>
      </button>
      {open && (
        <div
          style={{
            marginTop: 6,
            padding: 10,
            borderRadius: 10,
            background: "rgba(15,23,42,0.92)",
            color: "#e2e8f0",
            border: "1px solid rgba(148,163,184,0.25)",
            minWidth: 220,
            lineHeight: 1.7,
          }}
        >
          <div>
            <span style={{ opacity: 0.6 }}>الحالية: </span>
            <span style={{ fontFamily: "monospace" }}>{CURRENT_VERSION}</span>
          </div>
          <div>
            <span style={{ opacity: 0.6 }}>البعيدة: </span>
            <span style={{ fontFamily: "monospace" }}>{state?.remote ?? "—"}</span>
            {stale && (
              <span style={{ color: "#fca5a5", marginRight: 6 }}>(قديم)</span>
            )}
            {state?.upToDate && state?.remote && (
              <span style={{ color: "#86efac", marginRight: 6 }}>(محدّث)</span>
            )}
          </div>
          <div style={{ opacity: 0.6, fontSize: 10 }}>
            آخر فحص: {state?.at ? new Date(state.at).toLocaleTimeString("ar-EG") : "—"}
          </div>
          {state?.error && (
            <div style={{ color: "#fca5a5", fontSize: 10 }}>خطأ: {state.error}</div>
          )}
          {stale && state?.remote && (
            <button
              onClick={() => void triggerReload("manual", state.remote!)}
              style={{
                marginTop: 8,
                width: "100%",
                padding: "6px 10px",
                borderRadius: 8,
                background: "#f97316",
                color: "#0f172a",
                border: "none",
                fontWeight: 700,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              تحديث الآن إلى v{state.remote}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default VersionBadge;
