// شاشة إقلاع صغيرة تظهر أثناء فحص التحديث قبل تحميل التطبيق
const BootSplash = ({ status }: { status: string }) => (
  <div
    dir="rtl"
    style={{
      position: "fixed",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      background: "#0f172a",
      color: "#e2e8f0",
      fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      zIndex: 9999,
    }}
  >
    <div
      style={{
        width: 56,
        height: 56,
        borderRadius: "50%",
        border: "3px solid rgba(99,102,241,0.25)",
        borderTopColor: "#f97316",
        animation: "boot-spin 0.9s linear infinite",
      }}
    />
    <div style={{ fontSize: 14, opacity: 0.9 }}>{status}</div>
    <style>{`@keyframes boot-spin{to{transform:rotate(360deg)}}`}</style>
  </div>
);

export default BootSplash;
