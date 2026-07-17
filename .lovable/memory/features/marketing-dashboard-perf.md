---
name: Marketing Dashboard Mobile Performance
description: Default ranges, React Query cache, lazy load products for marketing pages
type: feature
---

Marketing dashboard perf rules (mobile-first):

- `SocialMediaMarketingDashboard`: default range preset MUST be `month` (not `3m`). Orders/expenses/items/new-customers fetches MUST use `useQuery` with `staleTime` ≥ 2min so switching between pages doesn't refetch.
- Order items (heavy join, drives product table) MUST be lazy-loaded behind an "عرض التفاصيل" button (`loadProducts` state) — never auto-fetch on page open.
- `SocialMediaDashboard` social-orders card: use 30-day lookback, not 3 months.
- Never regress these defaults to wider ranges without explicit user request.
