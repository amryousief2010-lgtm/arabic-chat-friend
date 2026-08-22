import { PanelRightClose, PanelRightOpen } from "lucide-react";

interface SidebarToggleButtonProps {
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * Always-visible floating toggle for the desktop sidebar.
 * Stays on screen when the sidebar is collapsed so the user never needs the
 * main toolbar to bring it back.
 */
const SidebarToggleButton = ({ collapsed, onToggle }: SidebarToggleButtonProps) => (
  <button
    type="button"
    data-testid="sidebar-toggle"
    aria-label={collapsed ? "إظهار الشريط الجانبي" : "إخفاء الشريط الجانبي"}
    aria-expanded={!collapsed}
    title={collapsed ? "إظهار الشريط الجانبي" : "إخفاء الشريط الجانبي"}
    onClick={onToggle}
    className="hidden md:flex fixed top-4 z-[60] items-center justify-center w-10 h-10 rounded-full bg-sidebar text-sidebar-foreground border border-sidebar-border shadow-lg hover:bg-sidebar-accent transition-all"
    style={{ right: collapsed ? "1rem" : "17rem" }}
  >
    {collapsed ? <PanelRightOpen className="w-5 h-5" /> : <PanelRightClose className="w-5 h-5" />}
  </button>
);

export default SidebarToggleButton;
