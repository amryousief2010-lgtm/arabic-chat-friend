/**
 * Config-driven sidebar customization.
 *
 * Instead of hand-editing `SidebarMenuSections.tsx` every time a menu item
 * needs to live under a different section, declare the change here and the
 * sidebar + ProtectedRoute pick it up automatically.
 *
 * The `moduleSections` array in SidebarMenuSections remains the canonical
 * definition of every item (icon, label, roles). These overrides only
 * re-target existing items — they never invent new ones.
 */

export interface SidebarItemMove {
  /** The item's `path` in moduleSections. Acts as its stable identifier. */
  path: string;
  /** The destination section id (see the `id` field of each ModuleSection). */
  toSectionId: string;
  /**
   * Optional. Insert the moved item immediately after the target-section item
   * whose `path` matches this value. If omitted (or unmatched), the item is
   * appended at the end of the target section.
   */
  after?: string;
}

/**
 * Move sidebar items across sections without touching SidebarMenuSections.tsx.
 *
 * To move an item: add an entry here. To revert: delete the entry.
 */
export const SIDEBAR_ITEM_MOVES: SidebarItemMove[] = [
  // Live under "Social Media" so the marketing manager sees it in the same
  // block as her other analytics tools.
  {
    path: "/sales/daily-performance-analysis",
    toSectionId: "social-media",
    after: "/social-media/marketing-dashboard",
  },
];

/**
 * Extra path prefixes a marketing-only user (single role
 * `marketing_sales_manager`, e.g. Mohamed Sayed) is allowed to reach.
 *
 * Shared by:
 *  - `SidebarMenuSections.tsx` (so the item stays visible in the sidebar)
 *  - `ProtectedRoute.tsx`      (so the route is not redirected away)
 */
export const MARKETING_ONLY_EXTRA_PREFIXES: string[] = [
  "/sales/daily-performance-analysis",
  "/team-performance",
  "/moderator-performance",
];


