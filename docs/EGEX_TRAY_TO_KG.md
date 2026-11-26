# Egex trays vs kg

Egex counts **units** (half-kilo trays for most items). The app counts **kg**.
Posting an Egex quantity as kg doubles it. On 2026-10-08, 16 STORE documents
(2026-10-02..07) and the Egex stocktake ST-20261003-134545-26E3 were corrected
with additive `*-KGFIX` reversal movements (no deletes).

Migration `20261008160000_egex_tray_to_kg_compare_and_guards.sql`:

* `egex_item_unit_map` + `egex_units_to_kg()` — what one Egex unit weighs.
* `inventory_egex_staging_compare()` — compares Egex vs app in kg.
* `trg_guard_store_document_movement` — one posting per store document number;
  tray items must carry `package_count`; kg == trays is logged to
  `inventory_unit_review_queue` (blocks when `app.egex_kg_guard = 'strict'`).

Not applied to any database by this PR.
