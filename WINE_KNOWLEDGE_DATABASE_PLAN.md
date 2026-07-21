# Wine Knowledge Database Initiative — Full Plan

Status as of 2026-07-20. This supersedes the three-phase outline referenced in `PRD_UPDATES_v1.4.md` — that version's table names and data-sourcing assumptions were audited against the actual codebase and corrected here. This is the single reference for this initiative going forward.

---

## Roadmap at a Glance

| Phase | Status | Summary |
|---|---|---|
| **Phase 1** — Unified Reference File | SKIPPED (2026-07-16) | Confirmed not a prerequisite for Phase 2. Not worth the time now — see below. |
| **Phase 2** — Real Wine Database | IN PROGRESS | The initiative's actual prerequisite-free starting point. Table is live; data import not yet built. |
| **Phase 3** — Lock It In | NOT STARTED | Blocked on Phase 2. |

**Phase 1 detail:** Phase 2 can be built on the original three-file setup just as easily — the `wine-knowledge.ts` reorg was confirmed not load-bearing for Phase 2. The uncommitted `wine-knowledge.ts` reorg is not being committed. Its two unfinished items (deriving dropdown lists from the hierarchy, the free-text-preservation test) plus the file-naming cleanup are not part of this initiative's critical path — they go at the end of Phase 3, or get spun out as their own separate, standalone project. Not renumbered as "Phase 1" of anything going forward.

---

## Naming — Read This Before Touching Either Phase

Two things in this plan use similar names and that has caused real confusion. Going forward:

- **`lib/wines/wine-reference.ts`** (renamed from `wine-knowledge.ts` — rename not yet done, see Phase 1 checklist) — a small, fixed, hand-written file of place names and grape-name spellings that already existed in the codebase before this initiative. It does not grow and is not filled with data; it corrects spelling and hierarchy (e.g. "napa valley" → Napa Valley / Oakville AVA). Proving it "works" means proving it matches the old scattered files, nothing more.
- **`wine_knowledge`** (Phase 2 Prisma table) — the actual growing database: 100,000+ real wine records from X-Wines, LWIN, and verified user imports. This is what needs to be populated and load-tested with real data before anyone can call it "proven." This is the one people mean when they say "the wine knowledge database."

Only the Phase 2 table keeps the "wine knowledge" name from here on. The Phase 1 file gets a distinct name specifically so "Phase 1 is done" can never again be misread as "the database is done."

---

## Overall Goal

One unified wine knowledge system for Wine Butler IQ: geography (country down to individual vineyard designation), grape/varietal names, and full producer/wine/vintage records — all living in one place, sourced from real licensed data instead of scattered internal lists or AI guessing, and growing itself from verified user activity over time. Nothing scattered, nothing that silently drifts out of sync.

---

## Phase 1 — Unified Reference File

### Context

Geography lookups (region/sub-region pairs, appellation names, quality tiers, country/state pairs, spelling corrections) currently live as five separate flat dictionaries in one file, `lib/wines/region-data.ts`. Grape/varietal name spellings live in a separate file, `lib/wines/varietal-data.ts`. Dropdown suggestion lists (regions, states, varietals, countries) live in a third file, `lib/wines/constants.ts`. All three are read by the same normalization pipeline (`lib/wines/normalize.ts`) but can drift out of sync with each other since they're maintained independently. This phase merges all three into one file. This is a fixed reference table — see Naming above — not the growing database.

### Checklist

- [x] Audit confirmed: 5 real geography tables (REGION_SUBREGION_PAIRS, APPELLATION_LOOKUP, QUALITY_TIER_LOOKUP, COUNTRY_STATE_PAIRS, REGION_SPELLING_CORRECTIONS) + grape/varietal table (VARIETAL_MAP, PROTECTED_BLEND_NAMES) + dropdown lists (constants.ts) — six real sources total, not the originally-cited "KNOWN_APPELLATIONS," which does not exist in the codebase
- [x] Build one new file (currently `lib/wines/wine-knowledge.ts`, pending rename below) containing the nested geography tree (Country → State → Region → Sub-region → Appellation → Classification) and the grape/varietal dictionary together
- [x] Preserve special cases that don't fit a clean tree — e.g. Carneros belongs to both Napa and Sonoma (currently handled via `AMBIGUOUS_SUBREGIONS`) — must stay explicitly flagged, never forced under one parent
- [ ] **Rename `lib/wines/wine-knowledge.ts` → `lib/wines/wine-reference.ts`** and update every import (`normalize.ts`, `claude-extractor.ts`, `scripts/normalize-cellar.ts`, cellar filter generation, autocomplete) — removes the naming collision with the Phase 2 `wine_knowledge` table. Not yet approved to execute.
- [ ] Derive dropdown/autocomplete suggestion lists directly from the new hierarchy rather than maintaining `constants.ts` separately
- [ ] Preserve "free text always allowed" behavior — these are suggestion lists, not closed enums; the form must still accept anything a user types
- [x] Repoint every current call site to the new file: `normalize.ts`, `claude-extractor.ts`, cellar filter generation, autocomplete
- [x] Keep old files in place temporarily, running in parallel with the new file, logging any diff in output
- [x] Delete old files only after a parity check: every entry in every old table produces an identical result from the new file — parity confirmed (scripts/verify-wine-knowledge-parity.ts + wine-knowledge-parity.test.ts, both byte-for-byte identical), old files (`region-data.ts`, `varietal-data.ts`) and verification scaffolding deleted 2026-07-16
- [x] Unit tests covering every region, appellation, quality-tier, and varietal lookup
- [x] Deploy, then re-import a real cellar file and confirm output is unchanged — verified 2026-07-16 against 2 real cellar records (NV Champagne, Rhône Châteauneuf-du-Pape) tracing rawData → mappedData → normalizeWineData() output → DB; region/subRegion/appellation/varietal matched DB exactly on both

### Stress Test / QA

- Biggest risk: silently losing or altering an entry during the merge (especially accented names — Châteauneuf-du-Pape, Gevrey-Chambertin — and the Carneros dual-parent case). Mitigation: automated parity check against every old entry before deletion, not spot checks.
- Second risk: forgetting a call site (e.g. updating `normalize.ts` but missing `claude-extractor.ts`), leaving two systems quietly computing different answers. Mitigation: grep for every old table name after the change; zero results required.
- Third risk: turning free-text-friendly suggestion lists into rigid enums by accident. Mitigation: explicit test that arbitrary free text is still accepted by every affected form field.
- Standing rule: per the existing debugging protocol, manually trace one real, previously-troublesome record (a Carneros wine, an NV Champagne, a Rioja Gran Reserva) through the full pipeline after the change, not just automated tests.

---

## Phase 2 — Real Wine Database

### Context

Phase 1 is static reference data shipped inside the code (place names, grape names) — it never touches this table. Phase 2 adds an actual, growing database of real wine records (producer, wine, vintage, region, rating) so the app can recognize actual bottles, not just correct their spelling. This is the phase that needs to be filled with real data and load-tested before it can be called proven.

### Data Sources

In order of trust — updated 2026-07-17, see `PHASE2_READINESS.md` for full detail on every item below.

1. **X-Wines Full** — public dataset, CC0-1.0 licensed. 100,646 wines, 30,510 wineries, 2,160 producing regions across 62 countries. Approved for download. **Catalog only — the 21 million individual rating rows will NOT be imported** (would consume most of the 8GB Supabase Pro allowance for a feature nothing uses); one computed average + count per wine instead.
2. **LWIN — deferred.** Actual cost is £600 for commercial/full access, not free as first assumed. Not pursued now; revisit alongside a Wine-Searcher license. Schema reserves LWIN fields so this doesn't require a second migration later.
3. **Wine-Searcher (deferred, paid)** — confirmed via their own API docs to provide an aggregated critic score (mean of Parker/Jancis Robinson/Wine Spectator, normalized to 100-point scale), grape variety, region, and pricing. This is now the confirmed plan for ratings once licensed — more methodologically consistent than a crowd-sourced average. No tasting notes/awards available (copyright).
4. **Organic capture from verified user imports** — only producer, wine name, vintage, region, varietal, classification write back, via an explicit allow-list, never purchase price/storage/notes/vendor/user ID. Full privacy design (data-minimization/purpose-limitation grounding, re-identification risks, and a concrete pre-ship checklist) in `PHASE2_READINESS.md`.
5. **Live Vivino / Claude lookups** — unchanged, stays as today's fallback until Wine-Searcher is licensed.
6. **`wine-data.json`** (539 hand-curated wines) — given its own trust tier, `LEGACY_MANUAL`, ranked below X-Wines/LWIN but above generic AI-estimate, since it's real curated data but unverified against a licensed source.

Source-trust is a real Prisma enum column (`SourceTrust`) on `wine_knowledge`, not a JSON blob — decided, so conflict-resolution queries can filter/sort on it directly at 100K+ row scale.

### Checklist

#### 1. Design and add the `wine_knowledge` database table — COMPLETE

- [x] Schema written and reviewed: core identity, geography group, sparse-detail group (vineyard/classification), varietal (documented as not a fixed fact for NV wines), dedup fields, `SourceTrust` enum, source-specific IDs, rating aggregate, confirmation count. Zero fields tied to a user/import/price/location, per the privacy design. `format` removed after review.
- [x] **Extension-drift fix (2026-07-19) — resolved.** Table live in production, committed (`7762dbd`), independently verified.

  <details>
  <summary>Sub-steps (all complete)</summary>

  `npx prisma migrate dev` against the live database reported drift: 4 Supabase-managed extensions (`pg_stat_statements`, `pgcrypto`, `supabase_vault`, `uuid-ossp`) exist in the real database but were never recorded in Prisma's migration history, and `migrate dev` offered `prisma migrate reset` — which would drop every table and must never run. Fix: baseline the missing history via `prisma migrate resolve --applied`, then apply the real migration via `prisma migrate deploy` (production-safe, no drift check, no reset).

  - [x] Step 1 — wrote a migration file documenting the 4 pre-existing extensions (local file only, no DB connection). Reviewed line-by-line: confirmed 4 lines, all `IF NOT EXISTS`, correct names, `supabase_vault` correctly scoped, no DROP/ALTER/TRUNCATE, no real table names present.
  - [x] Step 2 — `prisma migrate resolve --applied "20260719120000_baseline_supabase_managed_extensions"` — real output: "Migration ... marked as applied." Clean, no errors.
  - [x] Step 3 — `prisma migrate status` — real output: "Database schema is up to date!" Drift confirmed resolved.
  - [x] Extra correction — `migrate dev --create-only` hit a confirmed, still-open Prisma bug with Supabase-managed extensions ([prisma/prisma#19100](https://github.com/prisma/prisma/issues/19100)), producing two more false drift/reset alarms. Resolution: abandoned shadow-database diffing for this change, hand-wrote the real SQL instead, applied via `migrate deploy` (never runs drift detection). Re-ran Step 1/2's bookkeeping cleanly after the correction.
  - [x] Step 4 — hand-wrote `prisma/migrations/20260719130000_add_wine_knowledge/migration.sql` directly (`CREATE EXTENSION`/`CREATE TYPE`/`CREATE TABLE`/`CREATE INDEX` only). Reviewed line-by-line: confirmed only `CREATE` statements, `wine_knowledge` the only table name present.
  - [x] Step 5 — `prisma migrate deploy` — real output: "Applying migration `20260719130000_add_wine_knowledge`... All migrations have been successfully applied."
  - [x] Step 6 — `prisma migrate status` confirmed up to date; independently verified via a direct `information_schema.columns` query in the Supabase SQL Editor — all 26 columns present and matching design, `format` correctly absent, `sourceTrust` correctly a custom type.
  - [x] Step 7 — committed. `git commit 7762dbd` — "Add wine_knowledge table for Phase 2." `wine_knowledge` is live in production, verified independently, migration history clean.

  </details>

- [x] **Gap identified 2026-07-20, applied and verified.** Full column-by-column read of the X-Wines CSV (see Data-Source Review Rule below) turned up seven fields with nowhere to land: `type_style` (X-Wines "Type"), `abv`, `body`, `acidity`, `website`, `pairing_notes` (renamed from "Harmonize"), `blend_composition` (renamed from "Elaborate"). Added via `prisma/migrations/20260720140000_add_wine_type/migration.sql`, applied via `prisma migrate deploy`, confirmed by real `prisma migrate status` output ("Database schema is up to date!").
- [x] **`known_vintages` (Int[]) — applied in the same migration above.** Holds the year list for catalog-level entries; `vintage` stays reserved for a user-confirmed bottle. See vintage representation decision below.
- [x] **`has_non_vintage` (Boolean) — applied and verified 2026-07-20.** Mistake caught same day: first attempt was added by editing `20260720140000_add_wine_type/migration.sql` after Prisma had already recorded that migration as applied — Prisma silently skipped the edit, so the column never reached the live database despite `migrate status` reporting clean. Corrected via a new migration, `prisma/migrations/20260720150000_add_has_non_vintage/migration.sql`. Real output confirms it: `migrate status` first correctly listed it as unapplied, `migrate deploy` applied it, final `migrate status` reports "Database schema is up to date!"
- [x] **Vintage representation — confirmed 2026-07-20.** One row per wine, not per year. `vintage` stays reserved for a user-confirmed, bottle-specific entry; `known_vintages` (`Int[]`) added for catalog-level entries (X-Wines) that span a range of years with no other field differing between them. Written to schema + migration, pending deploy.
- [x] **Ratings/pricing granularity — confirmed 2026-07-20.** `avgRating`/`ratingCount` (wine-level crowd aggregate) and `wineSearcherPrice` (wine-level starting price) stay single fields on the catalog row — accepted as-is, not a gap. Real per-vintage overrides (a specific vintage priced or rated well outside the average) are handled by the existing `WineEnrichment` table, which is already per-bottle and already only populated for vintages a user actually owns — no new storage needed. Wine-Searcher data is confirmed to eventually supersede X-Wines-derived values per the existing `SourceTrust` ordering, once licensed.
- [x] **Data-integrity rule — added 2026-07-20.** A user's manually-entered values (rating, notes, price, etc. on their personal `Wine` record) must never be overwritten by any catalog sync or enrichment refresh — "fill blanks only" applies here too, not just to cross-source conflicts on `wine_knowledge`. Documented directly in `schema.prisma` next to the affected fields.

#### 2. X-Wines data acquisition

- [x] Download X-Wines Full catalog (2026-07-20) — `XWines_100K_wines.csv`, 100,646 rows / 17 columns, verified via `pandas` read (row count and column names matched the official README exactly). Sourced from the dataset author's own Google Drive folder. Downloaded and pushed entirely from a Google Colab session — never touched the local machine. Pushed to branch `add-xwines-catalog`, commit `f6a974d`.
- [x] **Merged to `main` (2026-07-20).** Confirmed independently via `git merge-base --is-ancestor`, not just taken on your word — `data-imports/XWines_100K_wines.csv` is present on `main`.
- [ ] Import X-Wines Full catalog into the live `wine_knowledge` table — not started. No longer blocked on the branch merge or schema (both done); still blocked on the dedup-matching logic and consistency checks below actually being built.
- [ ] Import winery + region tables (not started)

**Data-quality findings — where these came from:** while reviewing 5 real duplicate producer/wine pairs from the X-Wines file together in chat on 2026-07-20 (not a general audit — a full audit of all 162 groups has not happened yet, see the new CSV export below), we found real errors and open questions. Each item below says what the rule is, in plain terms, a concrete example, and whether it's actually been built into any code yet.

- [x] **Rule: only count a vintage as real if it's an exact match, not just "in the ballpark."**
  What this means: say a collector enters a bottle labeled "2015." The catalog lists every year a wine is known to have been made — for example, Achaval-Ferrer's "Quimera" lists years going back to 1954, but with real gaps (it jumps from 1990 to 1989 straight to 1987 — 1988 is missing). If the app only checked "is 2015 somewhere between the earliest and latest year," it could wrongly accept a year that was actually never produced. The rule instead requires the exact year to appear in the list.
  Where this came from: found while checking whether 1988 was a real Achaval-Ferrer vintage, in chat on 2026-07-20.
  Status: agreed on, but not written into any code yet — the import script that would use this rule hasn't been built.

- [x] **Finding: one of the two "Quimera" entries in the file is simply wrong, not a different product.**
  What we found: real retailer listings (Wine.com, Astor Wines) confirm Achaval-Ferrer's actual "Quimera" is a 5-grape blend — about 48% Malbec, 19% Cabernet Sauvignon, 18% Cabernet Franc, 13% Merlot, 2% Petit Verdot. One of the two file entries (WineID 169988) matches this exactly. The other (WineID 167488) describes a 100% Malbec wine — a completely different product that doesn't match the real "Quimera" at all.
  Decision: when this wine gets imported, use only WineID 169988. Skip WineID 167488 entirely — don't try to combine the two into one entry.
  Where this came from: verified via a live web search on 2026-07-20, in response to your instruction to check whether this was really the same wine.
  Status: decided, not yet built — there's no import script running yet for this rule to live in.

- [x] **Finding: the Prosecco entry's years can't be trusted, so drop them rather than guess.**
  What we found: Adria Vini's "Italia Collezione Prosecco Brut" has two file entries with overlapping-but-different year lists, and this style of Prosecco is normally sold without a specific vintage at all (non-vintage). There's no reliable way to say which years, if any, are real.
  Decision: for this wine, don't keep any specific years. Combine the two entries into one, and mark it as non-vintage.
  Where this came from: your correction on 2026-07-20 after I first (wrongly) suggested combining the two year lists as if both were trustworthy.
  Status: decided, not yet built.

- [x] **Finding: the file has a real region error for one wine, and our own check design wouldn't have caught it as originally planned.**
  What we found: Albinea Canali's "Vigna di Monteleone Cabernet Sauvignon" is genuinely from Emilia-Romagna (the wine region), specifically a legally defined zone within it called Colli di Scandiano e di Canossa. One file entry lists something close to that correct zone; the other lists "Piemonte" — a totally different, wrong region.
  Decision: the import process needs to look up each wine's region against Wine Butler IQ's own verified, hand-built list of real regions (the Phase 1 reference file), instead of just trusting whatever text X-Wines provides. That lookup would have caught this error automatically.
  Where this came from: you identified this region mismatch directly on 2026-07-20; I initially described the geography terms incorrectly and corrected it after you flagged it.
  Status: decided, not yet built.

- [x] **General rule for all duplicate pairs, not just these two examples: only auto-combine two entries when they actually agree on what the wine is.**
  What this means: if two file entries for the same producer and wine name agree on region, grapes, and type, and only differ on which years are listed, it's safe to combine them (keep both years). If they disagree on region or grapes (like the two examples above), don't guess which one is right — treat them as needing individual research, the same way we just did for these two.
  Where this came from: your instruction on 2026-07-20 that the earlier "just combine everything" plan was too simplistic given what these two real examples showed.
  Status: decided as a rule, not yet applied to the other 160 duplicate groups — see the new CSV below.

- [ ] **Proposed automated checks — not yet agreed one-by-one, not yet built.** Seven checks were proposed to catch this kind of error automatically across all 100,646 rows instead of by hand: (1) flag a producer/wine or winery that contradicts itself across its own entries, (2) flag a vintage year that's implausible for that country's wine industry history, (3) check every region against the verified reference list instead of trusting the file, (4) check that a wine labeled "100% single grape" actually only lists one grape, (5) flag an ABV outside roughly 5–24%, (6) flag any vintage year later than 2022 (when X-Wines' data was collected), (7) flag any exact duplicate ID. None of these has your final sign-off yet, and none is built.

- [x] **Rule: never add a guessed future year to a wine's list of vintages.**
  What this means: since the X-Wines data is a fixed snapshot from 2022, it will never show 2023 or later for any wine, even ones still being made today. The tempting fix — just add the next few years automatically — would mean writing down years that were never actually confirmed, which breaks the same rule we're using everywhere else (don't show unverified data as fact). Instead, new years only get added when they're actually observed: a real collector enters a real bottle with a newer year, or (once licensed) Wine-Searcher reports real current data.
  Where this came from: your suggestion to auto-add years, and the tension I flagged with the "don't show bad data as fact" rule already agreed on earlier the same day.
  Status: agreed on.

#### 2.2 Supplementary data source verification & geography reference upgrade (added 2026-07-20)

**Why this belongs here, not as a separate initiative:** the automated consistency checks already required before X-Wines import (region validation, grape/region plausibility) need a ground-truth reference more authoritative than the hand-built Phase 1 file.

**OIV — GI/AO database and Vine varieties database: ruled out.** Both are JavaScript-rendered interactive report tools with no working access path found; determined not usable for this project. Closed, no further action.

**University of Adelaide Wine Economics Research Centre — used, real value found:**
- [x] Downloaded `global-megafile-regional-rev0521.xlsx` (free, citation-required: Anderson, K. and S. Nelgen, *Database of Regional, National and Global Winegrape Bearing Areas by Variety, 1960 to 2016*).
- [x] **`Synonyms` sheet (1,387 grape-variety synonym → canonical-name mappings) merged into `lib/wines/wine-knowledge.ts`'s `VARIETAL_MAP`.** Diffed against the existing 183-entry dictionary: 1,323 genuinely new entries added; 34 overlapping keys where Adelaide's academic/ampelographic naming convention disagreed with our existing consumer-facing convention (e.g. "Zinfandel" vs. "Tribidrag") — existing consumer-facing names kept in all 34 cases, not overwritten. Verified with a real `npx tsc --noEmit` type-check, which caught and led to fixing one duplicate-key bug from the merge.
- [ ] `Detailed_regional_2016` sheet (1,569 grape varieties × 661 country/region columns, hectares planted) — downloaded, not yet reshaped into the region/grape-plausibility lookup for the automated checks above.

**Other sources checked, all ruled out or on hold:**
- **Kaggle wine-reviews (zynicide, ~130K wines, real 1–100 critic scores):** ruled out. License repeatedly confirmed as CC BY-NC-SA 4.0 (non-commercial) across multiple independent sources; given the product is being built with clear commercial intent, "not monetized yet" is unlikely to be a safe reading of "non-commercial." Not from Kaggle's own license page directly (couldn't render it), so treat as reasonably confirmed, not 100% certain.
- **Scraping Wine Enthusiast directly:** declined to build. Doesn't solve the Kaggle license problem, makes it worse — the review text is Wine Enthusiast's own copyrighted content regardless of any license someone else attached to a scrape of it, and their site almost certainly prohibits scraping in their ToS. Legitimate alternative not yet pursued: a real commercial data license/API inquiry with Wine Enthusiast directly, same category as the existing Wine-Searcher plan.
- **WineSensed / "Learning to Taste" dataset (NeurIPS 2023 — not 2026, a secondhand source had this wrong):** real, 897K label images, 824K reviews, 350K+ vintages, plus a genuine flavor-similarity research contribution from an actual tasting study. Reviews are sourced from Vivino, so it's not independent new data. **License never actually checked — open item**, likely inherits whatever restrictions apply to reuse of Vivino-sourced data.
- **Wine Images 126K (Hugging Face):** ruled out. Dataset's own description says images are scraped from wine retailer websites — same legal pattern as Wine Enthusiast, just images instead of text.
- **OpenWines GitHub project:** ruled out. Abandoned since April 2017; what it does (scrape Wikipedia infoboxes for appellations/grape names) is redundant with what Adelaide already provides better.
- **Open Food Facts:** deprioritized, not ruled out outright. License (ODbL) is genuinely commercial-use-friendly, unlike the others — but carries a share-alike clause that could require any *combined* database to also be released as open data, a real structural risk worth actual legal review before touching it. Also likely thin on wine-specific depth (it's a grocery barcode/nutrition database).
- **Cortez Wine Quality dataset:** ruled out. Genuinely public domain, but contains only anonymized chemical-composition-to-quality-score data with no producer or wine names attached — not useful for identifying or enriching a real bottle.

**Remaining open items in this sub-phase:** reshape the Adelaide `Detailed_regional_2016` sheet into a usable lookup; check WineSensed's actual license.

#### 3. Dedup, privacy, and search (not started)

- [ ] Build cross-source dedup matching (new logic — accent-folding/punctuation cleanup, then a similarity-score match with a real review queue for anything uncertain; concrete thresholds and test cases specified in `PHASE2_READINESS.md`)
- [ ] Validate dedup thresholds against the specified real tricky-name test cases before they're locked in
- [ ] Build the privacy allow-list write-back function + the automated test that checks each forbidden field is absent by name
- [ ] Build server-side search (Postgres `pg_trgm`, one combined index, concrete threshold/debounce/index design in `PHASE2_READINESS.md`)

#### 4. Integration (not started)

- [ ] Migrate `wine-data.json` in, tagged `LEGACY_MANUAL`, dedup against X-Wines using the new matching logic
- [ ] Wire the import-confirm step to write verified, shareable fields back into `wine_knowledge`
- [ ] Point autocomplete at the new table (replacing the `wine-data.json` + Fuse.js client search)
- [ ] Point the photo-ID "Butler" feature at the new table first
- [ ] Point spreadsheet-import enrichment at the new table first
- [ ] Load-test search against the actual full imported catalog, not a small sample
- [ ] License Wine-Searcher (bundled decision with LWIN, deferred) and wire in ratings
- [ ] Deploy and verify

### Stress Test / QA

Concrete mitigations, not just named risks — full detail in `PHASE2_READINESS.md`.

- Privacy leakage — mitigated by an explicit allow-list (never copy-then-remove), zero user/import ID columns on the table, coarse timestamps only, and a named pre-ship checklist.
- Duplicate/conflicting entries — mitigated by the multi-stage dedup design (cleanup → exact-key fast path → scored similarity with a 0.92 auto-match bar → bulk-reviewable queue below that), validated against real tricky name pairs before thresholds lock in.
- Performance regression — mitigated by a purpose-built `pg_trgm` index, capped result counts, debounced queries, and a load test against the real imported catalog size before this phase is called done.
- A wrong entry looking authoritative — mitigated by the `SourceTrust` enum staying visible wherever the data is shown.
- The 21M-row ratings dataset silently consuming most of the database's storage allowance — mitigated by scoping the import to catalog-only, decided.

---

## Phase 3 — Lock It In

### Context

Once Phase 1 and Phase 2 are proven stable in production, remove every remaining trace of the old scattered system so it cannot quietly come back.

### Checklist

- [ ] Confirm Phase 1 and Phase 2 fully live and stable
- [ ] Full-codebase search for every old table/file name; zero references required before checking this off
- [ ] Remove remaining `wine-data.json` references
- [ ] Add an admin endpoint for future manual add/edit of `wine_knowledge` entries
- [ ] Document `wine_knowledge` (the database) + `wine-reference.ts` (the static file) as the single sources of truth in `CLAUDE.md`, with the distinction between them stated explicitly to prevent this same fragmentation and confusion happening again
- [ ] Add a pricing column placeholder (for Wine-Searcher, once/if that license comes through)
- [ ] Final QA pass
- [ ] Update the PRD to reflect the unified architecture

### Stress Test / QA

- Risk: declaring this done while a stray reference to an old table still exists. Mitigation: the grep check above is a hard gate, not optional.
- Risk: documentation drift — CLAUDE.md not updated same day as the code change. Mitigation: treat the CLAUDE.md update as part of the same commit, not a follow-up task.

---

## Cross-Phase Rule

At every phase, before marking anything done: pick one real, previously-troublesome record and manually trace it through the whole pipeline — not just run automated tests and assume it's fine. This is the existing debugging protocol from `CLAUDE.md`, applied here specifically.

**Data-Source Review Rule (added 2026-07-20):** before designing any table meant to hold data from an external source, read that source's full column list first, not a summary. This rule exists because `wine_knowledge` was designed before the X-Wines CSV was actually opened, which cost a second migration to add six missing fields plus an unresolved vintage-structure question. Full text in `CLAUDE.md`.

---

## Region-Hierarchy Source Evaluation (2026-07-20)

Region was found to be the dominant data-quality problem in the X-Wines duplicate audit (80 of 101 hard-conflict groups involve region specifically — see the Albinea Canali "Piemonte" error, which should have been Emilia-Romagna / Colli di Scandiano e di Canossa). This section records every candidate source actually tested for building a region/appellation → parent-administrative-entity → country checker, with real evidence, not summaries.

**Resolved, in use:**
- **TTB / UC Davis AVA Digitizing Project (US)** — CC0, verified, hierarchy native (`within`/`contains` fields). No further work.
- **Wikidata** — Items classified `instance of: wine` (Q282) carry P131 (located in administrative territorial entity) and P17 (country). Confirmed live: 2,993 wine items, 9,265 appellation-to-province rows. Test case confirmed exact: Colli di Scandiano e di Canossa DOC → Province of Reggio Emilia → Italy. Implemented in `lib/wines/region-hierarchy-checker.ts` (commit `0969473`). query.wikidata.org is blocked at this research sandbox's network proxy — proven reachable only from a browser context so far, not yet from this project's own Node/Vercel runtime. That is the one open verification item, not a design gap.
- **WineryMap (github.com/oOo0oOo/winerymap)** — MIT licensed. Confirmed via its actual `vineyards.json` (2,077 regions, 34,178 vineyards — matches its own published numbers): region keys are appellation-level, not country-level. Direct hit on our test case: `"Colli di Scandiano e di Canossa, Italy"` is a literal key in the file. Usable as a secondary cross-check against Wikidata, or as a fallback for countries Wikidata's wine-class coverage is thin on.

**Ruled out, with reason:**
- **OIV** — no working access (JS-rendered register, no API found).
- **Kaggle wine-reviews** — non-commercial license.
- **KNB "Winegrowing Regions of the World 2007"** — opened directly (user-supplied xlsx conversion of the shapefile's .dbf): 197 of 302 rows have no name/country at all; most of the remainder are cryptic internal codes (`moroc1`, `turk2`), not real appellation names.
- **Vigneti Toscana** — real, official Tuscan government data, but vineyard-parcel level for Tuscany only — wrong shape and too narrow.
- **Italian Wine Central** — accurate (confirmed our test case manually) but its Terms of Service explicitly prohibit scraping and require permission for commercial use. Fine for one-off manual reference, not for building the checker.
- **UC Davis "Wine Ontology"** — real, MIT licensed, genuine name→region hierarchy, but only covers France's Rhône Valley (21 appellations) plus Napa (redundant with the TTB source already in use). Too narrow to be a primary source.
- **OSM Overpass (`landuse=vineyard`)** — tested directly, four separate query variations (named-area query, bounding-box query, alternate `lz4` endpoint, plain `/api/status` health check) — `overpass-api.de` returned empty/unreachable on every attempt from this research sandbox. Not evaluated on data quality; ruled out here purely on access, and worth retrying from a normal (non-sandboxed) network if this checker is ever extended past the current sources.

**Resolved same day, after Amanda downloaded the files herself (2026-07-20, later):**
- **eAmbrosia row-level confirmation** — CLOSED. Amanda downloaded `PDO_EU_id.csv` directly (`data/PDO_EU_id (1) eAmbrosia.csv`, 1,177 data rows, matches the dataset's claimed coverage exactly) and Claude read it directly once it was in the mounted project folder. "Colli di Scandiano e di Canossa" is a real row: PDOid `PDO-IT-A0305`, registered 4/14/2004, municipalities field lists Albinea/Bibbiano/Canossa/.../Scandiano/etc.
- **Italy region hierarchy via ISTAT municipality join** — CLOSED, third independent working source found. eAmbrosia's `Municip_nam` field (municipalities per PDO) has no parent-region column of its own, but Italy's municipality→region mapping is stable public administrative geography. Amanda downloaded ISTAT's official permanent list (`data/Elenco-comuni-italiani.csv`, 7,899 rows, ISO-8859-1/semicolon-delimited — re-encoded to UTF-8). Built `lib/wines/data/italy-municipality-to-region.json` (7,891 unique municipality→region pairs, all 20 real Italian regions present) and `deriveItalyRegionFromMunicipalities()` in `region-hierarchy-checker.ts`. **Verified with real executed output, not a type-check**: ran it against the actual eAmbrosia municipality string for Colli di Scandiano e di Canossa — returned `"Emilia-Romagna"`, zero unresolved municipalities. This resolves the Italian subset of eAmbrosia's 1,177 PDOs (Italy has the most PDOs of any single country in that dataset) via two static files and a plain join — no network call, no CORS dependency, unlike the Wikidata/WineryMap paths.
- **Emilia-Romagna regional government DOC list — officially disqualified, not dropped.** Re-attempted per direct instruction not to skip it: retried an in-browser fetch from a working origin, still CORS-blocked, confirmed again. Disqualifying now with reason: the ISTAT+eAmbrosia join above independently solves the same underlying need (region assignment for Italian PDOs) with zero network dependency. The one thing this site would have uniquely added — an authoritative list of DOC *names* — is already covered by eAmbrosia itself (the actual EU register). No remaining unique value.
- **OSM Overpass — API access disqualified, interactive site confirmed usable for a different purpose.** `overpass-api.de` has zero CORS headers (confirmed 6 separate ways this session). BUT: Amanda ran a vineyard query through `overpass-turbo.eu` (its interactive front-end) and got real results — several `<way>` elements tagged `crop=grape`/`landuse=vineyard` near Reggio Emilia, one with an actual name (`"Vigna Cooperativa sociale Lo Stradello"`). This is vineyard-parcel-level data with occasional real names, not appellation/region names systematically — same shape/use-case as Vigneti Toscana (grape-presence plausibility), not a hierarchy source. Real and usable for that narrower purpose if the grape/region plausibility check (a separate to-do, not this one) gets built later.
