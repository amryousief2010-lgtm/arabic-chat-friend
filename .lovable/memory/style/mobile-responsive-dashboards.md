---
name: Mobile-Responsive Warehouse/Factory Dashboards
description: KPI grids and tab lists must stay mobile-friendly
type: design
---

# Mobile Responsive Rules — LOCKED

For any warehouse/factory dashboard (e.g. `src/pages/feed/FeedWarehouses.tsx`):

- KPI card grids: `grid-cols-2 sm:grid-cols-3 md:grid-cols-6` with reduced padding/font on small screens.
- Long `TabsList` rows: wrap in `overflow-x-auto` container so tabs scroll horizontally on mobile — never stack/wrap into a broken multiline layout.
- Apply same pattern to any new similar dashboard.
