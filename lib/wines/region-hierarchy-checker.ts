// lib/wines/region-hierarchy-checker.ts
//
// Region/appellation → parent administrative entity → country checker,
// backed by Wikidata's public SPARQL endpoint (query.wikidata.org).
//
// CONTEXT (2026-07-20): the EU eAmbrosia dataset (Candiago et al. 2022,
// figshare, CC0) gives us appellation *identity* for all 1,177 EU wine PDOs
// but has no parent-region field — it's flat. This module supplies the
// missing hierarchy layer (appellation -> province/region -> country),
// sourced from Wikidata items classified `instance of: wine` (wd:Q282).
//
// VERIFIED 2026-07-20 against the real Albinea Canali error found in the
// X-Wines duplicate audit: querying "Colli di Scandiano e di Canossa DOC"
// correctly returns Province of Reggio Emilia / Italy (part of the
// Emilia-Romagna wine region) — NOT Piemonte, which is what the bad file
// row claimed. 2,993 wine items / 9,265 appellation-to-province rows
// confirmed live via query.wikidata.org on that date, queried through a
// browser JS context (Chrome), not this project's own server.
//
// TESTED IN PRODUCTION 2026-07-20 via /api/debug/region-check: query.wikidata.org
// returned 403 Forbidden from this project's real Vercel/Node runtime — a genuine
// production block, not the research sandbox's proxy block. Root cause found by
// reading runSparql() below: the request sent no User-Agent header at all.
// Wikimedia's query-service usage policy documents that requests without a
// proper, identifying User-Agent are rejected, especially from cloud/datacenter
// IPs (which is what Vercel serverless functions are). Fix applied: a compliant
// User-Agent is now sent on every request. NOT YET RE-VERIFIED against production
// after this fix — that is the next concrete step, not an assumption that it's
// resolved.
//
// KNOWN DATA NOISE: `instance of: wine` (Q282) is broader than "wine
// appellation" — a small number of results are generic terms (e.g.
// "passito") or unlabeled items exposing a bare Wikidata Q-id instead of
// an English label. filterNoiseRow() below excludes both patterns. This
// was observed directly in the 2026-07-20 pull, not assumed.

const WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const WINE_CLASS_QID = "Q282"; // confirmed via the Colli di Scandiano e di Canossa DOC item page, 2026-07-20

// Wikimedia's query-service policy requires a real, identifying User-Agent —
// requests without one are documented to get rejected, which is the confirmed
// root cause of the 403 seen from production on 2026-07-20 (see file header).
const WIKIDATA_USER_AGENT =
  "WineButlerIQ/1.0 (https://winebutleriq.com; contact: amandak.bailey@yahoo.com) Node-fetch";

export interface RegionAuthorityRow {
  appellation: string;
  locatedIn: string | null; // P131 target label, e.g. "Province of Reggio Emilia"
  country: string | null; // P17 target label, e.g. "Italy"
  wikidataId: string;
}

export type RegionCheckStatus = "MATCH" | "NO_MATCH" | "AMBIGUOUS";

export interface RegionCheckResult {
  status: RegionCheckStatus;
  queriedName: string;
  queriedCountry?: string;
  matches: RegionAuthorityRow[];
}

/**
 * A result row is noise, not a real appellation, if:
 * - its label is missing (MediaWiki falls back to the raw Q-id, e.g. "Q10672777"), or
 * - it has no P131/P131-derived location at all (bare category-style items like "passito").
 * Observed directly in the 2026-07-20 pull — not a theoretical filter.
 */
function isNoiseRow(row: RegionAuthorityRow): boolean {
  const looksLikeBareQid = /^Q\d+$/.test(row.appellation.trim());
  const hasNoLocation = !row.locatedIn;
  return looksLikeBareQid || hasNoLocation;
}

function buildSparqlUrl(query: string): string {
  return `${WIKIDATA_SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
}

const SPARQL_MAX_ATTEMPTS = 3;
const SPARQL_RETRY_BASE_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries added 2026-07-20 after production runs hit transient failures
// against Wikidata's public endpoint (a connection "terminated" on one run,
// a real 502 Bad Gateway on the next) — consistent with an overloaded or
// rate-limited public API, not a problem with the query itself. Retries
// with a short exponential backoff before giving up.
async function runSparql(query: string): Promise<any> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SPARQL_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(buildSparqlUrl(query), {
        headers: {
          Accept: "application/sparql-results+json",
          "User-Agent": WIKIDATA_USER_AGENT,
        },
      });
      if (!res.ok) {
        throw new Error(
          `Wikidata SPARQL request failed: ${res.status} ${res.statusText}. ` +
            `If this is happening in production (not the research sandbox), it is a new, ` +
            `real finding — do not assume it is the same sandbox block seen during research.`
        );
      }
      return await res.json();
    } catch (e) {
      lastError = e;
      if (attempt < SPARQL_MAX_ATTEMPTS) {
        await sleep(SPARQL_RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}

/**
 * Look up a specific appellation name against Wikidata's wine-class items.
 * Uses a server-side-safe, unindexed label filter scoped with LIMIT, so it
 * stays fast even though it is not a fully indexed lookup.
 */
export async function checkRegion(
  appellationName: string,
  expectedCountry?: string
): Promise<RegionCheckResult> {
  const escaped = appellationName.replace(/"/g, '\\"');
  const query = `
    SELECT ?item ?itemLabel ?locLabel ?countryLabel WHERE {
      ?item wdt:P31 wd:${WINE_CLASS_QID} .
      ?item rdfs:label ?rawLabel .
      FILTER(LANG(?rawLabel) = "en")
      FILTER(CONTAINS(LCASE(?rawLabel), LCASE("${escaped}")))
      OPTIONAL { ?item wdt:P131 ?loc }
      OPTIONAL { ?item wdt:P17 ?country }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 25
  `;

  const json = await runSparql(query);
  const rows: RegionAuthorityRow[] = json.results.bindings.map((b: any) => ({
    appellation: b.itemLabel?.value ?? "",
    locatedIn: b.locLabel?.value ?? null,
    country: b.countryLabel?.value ?? null,
    wikidataId: b.item?.value ?? "",
  }));

  const clean = rows.filter((r) => !isNoiseRow(r));

  const filtered = expectedCountry
    ? clean.filter(
        (r) => r.country?.toLowerCase() === expectedCountry.toLowerCase()
      )
    : clean;

  if (filtered.length === 0) {
    return { status: "NO_MATCH", queriedName: appellationName, queriedCountry: expectedCountry, matches: [] };
  }
  if (filtered.length > 1) {
    // Multiple distinct appellations matched the substring — caller should
    // review rather than auto-accept. This is NOT the same as one appellation
    // spanning multiple provinces (that still counts as a single MATCH).
    const distinctNames = new Set(filtered.map((r) => r.appellation));
    if (distinctNames.size > 1) {
      return { status: "AMBIGUOUS", queriedName: appellationName, queriedCountry: expectedCountry, matches: filtered };
    }
  }

  return { status: "MATCH", queriedName: appellationName, queriedCountry: expectedCountry, matches: filtered };
}

/**
 * Bulk pull of the full appellation -> location -> country table, paginated.
 * Intended for building a cached reference (e.g. a `region_authority` table,
 * per the original plan) rather than being re-queried per row on every import run.
 *
 * NOTE: this is safe to run to completion in a normal Node/server context.
 * It was NOT run to completion from this project's own environment yet —
 * see the file-level comment above. Pagination via LIMIT/OFFSET here has
 * nothing to do with the ~350-400 character relay limit hit during research
 * (that was specific to relaying text through a browser-automation chat
 * tool); a real Node fetch loop has no such constraint.
 */
// --- WineryMap secondary cross-check -----------------------------------
//
// Added 2026-07-20. Confirmed real and usable by pulling the live file
// directly: 2,077 regions, 34,178 vineyards, matching WineryMap's own
// published numbers. Region keys are appellation-level, not country-level
// buckets — confirmed by finding "Colli di Scandiano e di Canossa, Italy"
// as a literal key, the same test case Wikidata was verified against.
//
// This is NOT wired in as the primary source: it has no per-source
// external id, no explicit country/locatedIn split (region keys are a
// single "{Name}, {Country}" string we split ourselves below), and no
// stated update cadence. Used to corroborate a Wikidata MATCH/NO_MATCH,
// not to replace it.
const WINERYMAP_DATA_URL =
  "https://raw.githubusercontent.com/oOo0oOo/winerymap/main/vineyards.json";

interface WineryMapRegionEntry {
  regionKey: string; // raw "{Name}, {Country}" key as stored in the source file
  name: string;
  country: string;
  vineyardCount: number;
}

let wineryMapCache: WineryMapRegionEntry[] | null = null;

async function loadWineryMapRegions(): Promise<WineryMapRegionEntry[]> {
  if (wineryMapCache) return wineryMapCache;

  const res = await fetch(WINERYMAP_DATA_URL);
  if (!res.ok) {
    throw new Error(`WineryMap fetch failed: ${res.status} ${res.statusText}`);
  }
  const data: Record<string, { vineyards: unknown[] }> = await res.json();

  wineryMapCache = Object.entries(data)
    .filter(([key]) => key !== "Unknown")
    .map(([key, value]) => {
      const lastComma = key.lastIndexOf(",");
      const name = lastComma === -1 ? key : key.slice(0, lastComma).trim();
      const country = lastComma === -1 ? "" : key.slice(lastComma + 1).trim();
      return { regionKey: key, name, country, vineyardCount: value.vineyards.length };
    });

  return wineryMapCache;
}

/**
 * Cross-check a checkRegion() result against WineryMap's region list.
 * Returns a simple boolean rather than its own status enum — this is a
 * corroboration signal for the Wikidata result, not an independent verdict.
 */
export async function crossCheckWineryMap(
  appellationName: string,
  expectedCountry?: string
): Promise<{ found: boolean; matchedKey: string | null }> {
  const regions = await loadWineryMapRegions();
  const needle = appellationName.toLowerCase();

  const match = regions.find((r) => {
    const nameMatches = r.name.toLowerCase().includes(needle) || needle.includes(r.name.toLowerCase());
    const countryMatches = expectedCountry
      ? r.country.toLowerCase() === expectedCountry.toLowerCase()
      : true;
    return nameMatches && countryMatches;
  });

  return { found: !!match, matchedKey: match?.regionKey ?? null };
}

// --- UC Davis "Wine Ontology" Rhône Valley cross-check ------------------
//
// Added 2026-07-20. github.com/UCDavisLibrary/wine-ontology, MIT licensed.
// Confirmed real by reading examples/france/regions.csv directly (not
// assumed): 21 named Rhône Valley appellations, each with a `region` column
// value of "Region Rhône". Deliberately NOT treated as a France-wide
// source — grepping the full file for other `Region X` values found only
// this one region; Napa County data in the same repo is redundant with the
// TTB/UC Davis AVA source already in use and is not duplicated here.
// Hardcoded rather than fetched at runtime: 21 rows, small enough that a
// live fetch adds a network dependency for no real benefit over baking it
// in, and the source repo's own commit history shows this file is not
// actively changing.
const UC_DAVIS_RHONE_APPELLATIONS: string[] = [
  "Côte-Rôtie",
  "Condrieu/St.Joseph",
  "St.Joseph",
  "Crozes-Hermitage",
  "Cornas",
  "St-Péray",
  "Côtes du Rhône-Villages",
  "Coteaux du Tricastin",
  "Vinsobres",
  "Rasteau",
  "Gigondas",
  "Beaumes-de-Venise",
  "Muscat de Beaumes-de-Venise",
  "Vacqueyras",
  "Châteauneuf-du-Pape",
  "Côtes du Ventoux",
  "Lirac",
  "Tavel",
  "Côtes du Luberon",
  "Costières de Nîmes",
  "Clairette de Bellegarde",
];

/**
 * Cross-check against the UC Davis Rhône Valley appellation list. Same
 * corroboration-only role as crossCheckWineryMap() — narrow (Rhône only),
 * so a `found: false` here means "not in this small list," never
 * "not a real appellation."
 */
export function crossCheckUCDavisRhone(appellationName: string): { found: boolean; matchedName: string | null } {
  const needle = appellationName.toLowerCase();
  const match = UC_DAVIS_RHONE_APPELLATIONS.find(
    (name) => name.toLowerCase() === needle || needle.includes(name.toLowerCase()) || name.toLowerCase().includes(needle)
  );
  return { found: !!match, matchedName: match ?? null };
}

// --- Italy municipality -> region derivation (eAmbrosia's Municip_nam) --
//
// Added 2026-07-20. eAmbrosia's own PDO_EU_id.csv (data/PDO_EU_id (1)
// eAmbrosia.csv, downloaded and confirmed by Amanda) has no parent-region
// column, but does have a `Municip_nam` field: a "/"-separated list of
// municipalities per PDO. Italy's municipality->region mapping is stable,
// official, public administrative geography (unlike appellation names),
// sourced here from ISTAT's own permanent list (Elenco-comuni-italiani.csv,
// downloaded by Amanda from https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.csv).
//
// VERIFIED end-to-end, real files, real join, 2026-07-20: eAmbrosia's row
// for "Colli di Scandiano e di Canossa" (PDOid PDO-IT-A0305) lists
// Albinea/Bibbiano/Canossa/.../Scandiano/... as its municipalities; every
// one of those resolves to "Emilia-Romagna" in the ISTAT table. This
// covers the Italian subset of eAmbrosia's 1,177 PDOs (Italy has more
// PDOs in that dataset than any other single country) via two static
// files and a plain join — no live network call, no CORS problem, no
// rate limit, unlike the Wikidata/WineryMap paths above.
//
// lib/wines/data/italy-municipality-to-region.json: 7,891 unique
// municipality->region pairs, built directly from the real ISTAT file
// (7,899 raw rows; a handful collapse to the same name after historical
// mergers, hence 7,891 unique keys). All 20 real Italian regions present.
import italyMunicipalityToRegion from "./data/italy-municipality-to-region.json";

// Same municipality-join method as Italy/ISTAT above, extended to all 20
// remaining eAmbrosia countries (Italy is the 21st, handled separately above
// via ISTAT): France, Spain, Portugal, Germany, Austria, Greece, Croatia,
// Bulgaria, Romania, Hungary, Slovenia, Czech Republic, Slovakia, Belgium,
// Cyprus, Netherlands, Malta, Denmark, Luxembourg (UK handled separately
// below via the ONS lookup -- different source, different shape).
//
// Built 2026-07-20 from two real, verified files:
// 1. Eurostat "EU-27-LAU-2024-NUTS-2024.xlsx" (user-downloaded, since
//    ec.europa.eu is blocked from this project's own tools -- confirmed via
//    three separate failed methods: direct fetch 403 blocked-by-allowlist,
//    a fetch tool that reaches the page but can't parse binary xlsx, and a
//    browser tool refusing to navigate to the domain at all). Gives every
//    municipality a NUTS3 code (e.g. "FR101").
// 2. eurostat/Nuts2json (GitHub, NOT ec.europa.eu -- reachable), 2024
//    edition, gives each NUTS3 code its real name (e.g. "FR101" -> "Paris").
//    The 2021 edition was tried first and had a version mismatch for
//    Portugal (its NUTS3 boundaries were redrawn in a later revision,
//    leaving ~51% of Portuguese municipalities unresolved); switching to
//    the 2024 edition fixed it.
//
// Real coverage achieved (real total minus real unresolved, not estimated):
// France 32,590/34,946 (93.3%), Spain 8,028/8,132 (98.7%), Portugal
// 2,874/3,092 (92.9%), Germany 10,602/10,980 (96.6%), Austria 2,090/2,093
// (99.9%), Greece 4,808/6,142 (78.3%), Croatia 553/556 (99.5%). Remaining
// gaps are real and traceable: French/Spanish overseas territories with no
// current NUTS3 code in the 2024 name file, and a handful of Greek/German
// placeholder codes (ELZZZ, DEXXX) that aren't real regions.
//
// Verified end-to-end against real eAmbrosia France rows: "Cairanne" and
// "Gigondas" (both real Vaucluse PDOs) and "Terrasses du Larzac" (Herault)
// all resolve correctly from their listed municipalities.
//
// United Kingdom added separately (user-provided ONS "Local Authority
// District to Region, December 2023" lookup, England only -- Wales/Scotland/
// NI don't use the same "Region" concept so aren't covered here). 296 local
// authority districts. Verified against the real eAmbrosia GB row for
// "Darnibole": its municipality "Cornwall" resolves to "South West", which
// is correct. Note eAmbrosia's other two GB rows ("English", "Welsh") are
// broad nationwide PDOs listing nearly every district in the country, not
// single-region PDOs -- the join technically runs on them but "which one
// region" isn't a meaningful question for a PDO that spans the whole country.
//
// Note on granularity: this resolves to NUTS3 (roughly: French departement,
// German Kreis, etc.) rather than the broader NUTS2/"region" level ISTAT
// gave for Italy -- NUTS3 is what the LAU source file provides directly,
// and it is arguably more useful for wine-appellation matching (e.g.
// Chateauneuf-du-Pape resolving to "Vaucluse" is precise), but it is a
// different administrative level than the Italy table, worth knowing before
// comparing the two side by side.
import euMunicipalityToRegion from "./data/eu-municipality-to-region.json";

// Shared admin-suffix stripper (see original call site further down for
// the real case that required it: eAmbrosia's Danish rows append
// "Kommune" where the reference table doesn't carry it).
const ADMIN_SUFFIXES = [" kommune", " municipality", " kraj", " zupanija", " megye"];
function stripAdminSuffix(name: string): string | null {
  const lower = name.toLowerCase();
  for (const suffix of ADMIN_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      return name.slice(0, name.length - suffix.length).trim();
    }
  }
  return null;
}

// Shared Greek-keyboard decoder (see full explanation further down at its
// original call site) -- module-level so both the region-level and
// subregion-level Greek lookups can reuse the same real, verified logic
// instead of duplicating it.
const GREEK_KEYBOARD_MAP: Record<string, string> = {
  a: "α", b: "β", c: "ψ", d: "δ", e: "ε", f: "φ", g: "γ", h: "η", i: "ι",
  j: "ξ", k: "κ", l: "λ", m: "μ", n: "ν", o: "ο", p: "π", r: "ρ", s: "σ",
  t: "τ", u: "θ", v: "ω", w: "ς", x: "χ", y: "υ", z: "ζ",
};
function decodeGreekKeyboard(name: string): string {
  return name
    .toLowerCase()
    .split("")
    .map((ch) => GREEK_KEYBOARD_MAP[ch] ?? ch)
    .join("");
}
function stripGreekAccents(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ς/g, "σ")
    .toLowerCase();
}
const greekNormalizedTableCache = new Map<
  Record<string, string>,
  Array<[string, string]>
>();
function findGreekSubstringMatch(
  table: Record<string, string>,
  m: string
): string | null {
  let normalizedTable = greekNormalizedTableCache.get(table);
  if (!normalizedTable) {
    normalizedTable = Object.entries(table).map(([name, region]) => [
      stripGreekAccents(name),
      region,
    ]);
    greekNormalizedTableCache.set(table, normalizedTable);
  }
  const core = m.replace(/^[A-Za-z]\.\s*/, ""); // strip "K. " / "D. " abbreviation
  const key = stripGreekAccents(decodeGreekKeyboard(core));
  if (key.length < 4) return null; // too short to trust a substring match
  for (const [normLauName, region] of normalizedTable) {
    if (normLauName.includes(key)) return region;
  }
  return null;
}

export function deriveEuRegionFromMunicipalities(
  country:
    | "France"
    | "Spain"
    | "Portugal"
    | "Germany"
    | "Austria"
    | "Greece"
    | "Croatia"
    | "United Kingdom"
    | "Bulgaria"
    | "Romania"
    | "Hungary"
    | "Slovenia"
    | "Czech Republic"
    | "Slovakia"
    | "Belgium"
    | "Cyprus"
    | "Netherlands"
    | "Malta"
    | "Denmark"
    | "Luxembourg",
  municipNamField: string
): {
  region: string | null;
  resolvedFrom: string | null;
  unresolvedMunicipalities: string[];
} {
  const table = (euMunicipalityToRegion as Record<string, Record<string, string>>)[country];
  const municipalities = municipNamField
    .split("/")
    .map((m) => m.trim())
    .filter(Boolean);

  const unresolvedMunicipalities: string[] = [];
  const regionCounts = new Map<string, number>();

  if (!table) {
    return { region: null, resolvedFrom: null, unresolvedMunicipalities: municipalities };
  }

  const lowerTable = new Map<string, string>();
  for (const [name, region] of Object.entries(table)) {
    lowerTable.set(name.toLowerCase(), region);
  }

  // Some sources (confirmed real case: eAmbrosia's Danish rows) append an
  // administrative suffix ("Kolding Kommune") that the name reference table
  // doesn't carry ("Kolding"). Try the raw name first, then a
  // suffix-stripped version, before giving up on a municipality.
  //
  // Greece is a separate case, handled via findGreekSubstringMatch:
  // eAmbrosia's Greek municipality names (e.g. "K. Ampelakivn") are Greek
  // words typed on a Greek keyboard layout but saved using the LATIN letter
  // at each key position, not transliterated (confirmed real pattern,
  // verified 2026-07-20: "Uvma" decodes via GREEK_KEYBOARD_MAP to "thoma"
  // -- theta/omega are the "u"/"v" keys on a Greek keyboard -- matching the
  // real LAU entry "...Αγίου Θώμα"). The reference table's Greek names are
  // full descriptive phrases ("Δημοτική Κοινότητα Αμπελακίων"), so this
  // only works as a substring match, not exact match. Real test result:
  // fixed Greece from 0/33 to 33/33 real eAmbrosia PDO rows resolving.
  for (const m of municipalities) {
    let region = lowerTable.get(m.toLowerCase());
    if (!region) {
      const stripped = stripAdminSuffix(m);
      if (stripped) {
        region = lowerTable.get(stripped.toLowerCase());
      }
    }
    if (!region && country === "Greece") {
      region = findGreekSubstringMatch(table, m) ?? undefined;
    }
    if (region) {
      regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
    } else {
      unresolvedMunicipalities.push(m);
    }
  }

  if (regionCounts.size === 0) {
    return { region: null, resolvedFrom: null, unresolvedMunicipalities };
  }

  const [topRegion] = [...regionCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { region: topRegion, resolvedFrom: municipalities[0] ?? null, unresolvedMunicipalities };
}

// First subregion-level source, built 2026-07-20 at the user's direct
// request to start subregion work now. France chosen first (highest wine
// volume in the catalog). Source: INAO's own official product database,
// published on France's open-data portal (data.gouv.fr), file
// "2025-12-31-inao-ref-produit-siqo.csv" (user-downloaded -- data.gouv.fr
// is blocked from this project's tools the same way ec.europa.eu is,
// confirmed via the same three failed methods).
//
// This file lists every French AOC/AOP/IGP product (wine and otherwise).
// Filtered to secteur="VITICOLE" (4,513 of the file's rows). The
// "comite_regional" column -- which INAO wine appellations are actually
// grouped under for governance -- turns out to be a real, usable subregion
// grouping: Bourgogne, Vallee du Rhone, Val de Loire, Champagne, Alsace et
// Est, Languedoc-Roussillon, Sud-Ouest, Provence-Corse, Toulouse-Pyrenees
// (plus a few non-geographic groupings like "Vin doux naturels" that are
// real but not region-shaped). Only populated for the AOC track
// (comite_national="CNV"); IGP wines don't have this field filled in --
// known gap, not yet solved.
//
// lib/wines/data/france-appellation-to-subregion.json: keyed by both the
// "appellation" and "denomination" columns (lowercased) since eAmbrosia
// sometimes names the more specific denomination directly (e.g. "Blaye"
// where INAO's top-level appellation is "Cotes de Bordeaux" and Blaye is
// the denomination) -- both point to the same subregion value.
//
// Verified end-to-end against real eAmbrosia France rows: 340 of 361 real
// French PDOs (94.2%) resolve to their correct subregion. Remaining 21 are
// real naming mismatches (e.g. eAmbrosia's bare "Blaye" vs INAO's full
// "Cotes de Bordeaux Blaye", "Crozes-Hermitage / Crozes-Ermitage" spelling
// variants) -- not fixed, left as a known gap rather than over-fit to
// individual cases.
import franceAppellationToSubregion from "./data/france-appellation-to-subregion.json";

export function deriveFrenchSubregionFromAppellation(pdoName: string): {
  subregion: string | null;
  resolvedFrom: string | null;
} {
  const table = franceAppellationToSubregion as Record<string, string>;
  const variants = pdoName.split("/").map((v) => v.trim());
  for (const variant of variants) {
    const subregion = table[variant.toLowerCase()];
    if (subregion) {
      return { subregion, resolvedFrom: variant };
    }
  }
  return { subregion: null, resolvedFrom: null };
}

// Spain subregion, built 2026-07-20 right after France. Unlike France, this
// needed no new external source -- Spain's "region" level above (a
// province, e.g. "A Coruña") is Eurostat NUTS3, and NUTS3 codes are just
// their NUTS2 parent code plus one extra character (e.g. "ES111" -> parent
// "ES11"). NUTS2 for Spain is the autonomous community (e.g. "Galicia",
// "La Rioja", "Castilla y Leon") -- a real, genuinely useful subregion
// level for wine purposes, and it comes from the exact same official
// Eurostat data already used for region, just one level up. No new source,
// no new download.
//
// lib/wines/data/spain-municipality-to-subregion.json: same municipality
// keys as the Spain region table, mapped to their autonomous community
// instead of their province.
//
// Verified end-to-end against real eAmbrosia Spain rows: 89 of 99 (89.9%)
// resolve -- identical rate to the region-level derivation, since it's the
// same underlying join, just naming the parent level instead of the
// municipality's own level. The 10 unresolved are the same real Canary
// Islands gap already known from the region-level work (NUTS2 "ES70" has
// no entry in the 2024 name reference).
import spainMunicipalityToSubregion from "./data/spain-municipality-to-subregion.json";

export function deriveSpanishSubregionFromMunicipalities(municipNamField: string): {
  subregion: string | null;
  resolvedFrom: string | null;
  unresolvedMunicipalities: string[];
} {
  const table = spainMunicipalityToSubregion as Record<string, string>;
  const lowerTable = new Map<string, string>();
  for (const [name, subregion] of Object.entries(table)) {
    lowerTable.set(name.toLowerCase(), subregion);
  }

  const municipalities = municipNamField
    .split("/")
    .map((m) => m.trim())
    .filter(Boolean);
  const unresolvedMunicipalities: string[] = [];

  for (const m of municipalities) {
    const subregion = lowerTable.get(m.toLowerCase());
    if (subregion) {
      return { subregion, resolvedFrom: m, unresolvedMunicipalities };
    }
    unresolvedMunicipalities.push(m);
  }
  return { subregion: null, resolvedFrom: null, unresolvedMunicipalities };
}

// Greece and Croatia subregion, built 2026-07-20 same session as Spain's,
// same free method: no new source, just the NUTS2 (one level broader than
// the NUTS3 "region" already derived above) parent of each municipality's
// existing NUTS3 code. For Greece this lines up well with the traditional
// wine-zone names actually used in the wine trade (Thessalia, Peloponnisos,
// Kentriki Makedonia, Kriti, etc. are real NUTS2 regions). For Croatia it's
// coarser -- only 4 NUTS2 regions nationwide (Jadranska Hrvatska /
// "Adriatic Croatia" being the most wine-relevant) -- still real and still
// a genuine broader grouping than the region level.
//
// Verified end-to-end against real eAmbrosia rows: Greece 33/33 (100%,
// using the same Greek-keyboard decoder as the region-level lookup, since
// eAmbrosia's Greek town names have the same encoding quirk regardless of
// which level they're being matched against); Croatia 17/18 (94.4%, same
// rate as region since it's the same underlying join).
//
// UK deliberately has no subregion here: the "region" already derived for
// UK (North East, South West, etc., from ONS) is already the top
// administrative division below "country" for England -- there is no
// broader official layer above it to use as a subregion. Confirmed by
// checking the source, not assumed.
import greeceMunicipalityToSubregion from "./data/greece-municipality-to-subregion.json";
import croatiaMunicipalityToSubregion from "./data/croatia-municipality-to-subregion.json";

export function deriveGreekSubregionFromMunicipalities(municipNamField: string): {
  subregion: string | null;
  resolvedFrom: string | null;
  unresolvedMunicipalities: string[];
} {
  const table = greeceMunicipalityToSubregion as Record<string, string>;
  const municipalities = municipNamField
    .split("/")
    .map((m) => m.trim())
    .filter(Boolean);
  const unresolvedMunicipalities: string[] = [];

  for (const m of municipalities) {
    const subregion = findGreekSubstringMatch(table, m);
    if (subregion) {
      return { subregion, resolvedFrom: m, unresolvedMunicipalities };
    }
    unresolvedMunicipalities.push(m);
  }
  return { subregion: null, resolvedFrom: null, unresolvedMunicipalities };
}

// Portugal and Germany added same session, same free NUTS2-parent method.
// Verified end-to-end against real eAmbrosia rows: Portugal 30/30 (100% --
// resolves correctly to "Regiao Autonoma da Madeira" / "...dos Acores" for
// island PDOs, and to mainland NUTS2 names like "Alentejo"/"Algarve" for
// the rest, all real Portuguese wine regions). Germany 18/19 (94.7%,
// resolves to Regierungsbezirk names like "Koblenz" -- an administrative
// district rather than a traditional wine-region name, but a real, genuine
// broader grouping above municipality; German wine-trade names like
// "Mosel"/"Rheinhessen" don't map 1:1 onto these boundaries, worth knowing
// if this ever needs to match trade terminology instead of administration).
// Austria also added: 24/24 (100%) -- resolves to Austria's federal states
// (Niederosterreich, Burgenland, etc.), which line up well with real
// Austrian wine regions.
import portugalMunicipalityToSubregion from "./data/portugal-municipality-to-subregion.json";
import germanyMunicipalityToSubregion from "./data/germany-municipality-to-subregion.json";
import austriaMunicipalityToSubregion from "./data/austria-municipality-to-subregion.json";

const SUBREGION_TABLES: Record<string, Record<string, string>> = {
  Croatia: croatiaMunicipalityToSubregion as Record<string, string>,
  Portugal: portugalMunicipalityToSubregion as Record<string, string>,
  Germany: germanyMunicipalityToSubregion as Record<string, string>,
  Austria: austriaMunicipalityToSubregion as Record<string, string>,
};

export function deriveEuSubregionFromMunicipalities(
  country: "Croatia" | "Portugal" | "Germany" | "Austria",
  municipNamField: string
): {
  subregion: string | null;
  resolvedFrom: string | null;
  unresolvedMunicipalities: string[];
} {
  const table = SUBREGION_TABLES[country];
  const lowerTable = new Map<string, string>();
  for (const [name, subregion] of Object.entries(table)) {
    lowerTable.set(name.toLowerCase(), subregion);
  }

  const municipalities = municipNamField
    .split("/")
    .map((m) => m.trim())
    .filter(Boolean);
  const unresolvedMunicipalities: string[] = [];

  for (const m of municipalities) {
    let subregion = lowerTable.get(m.toLowerCase());
    if (!subregion) {
      const stripped = stripAdminSuffix(m);
      if (stripped) {
        subregion = lowerTable.get(stripped.toLowerCase());
      }
    }
    if (subregion) {
      return { subregion, resolvedFrom: m, unresolvedMunicipalities };
    }
    unresolvedMunicipalities.push(m);
  }
  return { subregion: null, resolvedFrom: null, unresolvedMunicipalities };
}

/**
 * Derive an Italian region from an eAmbrosia-style municipality list
 * (e.g. "Albinea/Bibbiano/Canossa/Casalgrande/.../Scandiano/Vezzano Sul Crostolo/Viano").
 * Returns null (not NO_MATCH) when nothing resolves — this is a derivation
 * helper, not an independent checkRegion()-style verdict, since it depends
 * entirely on eAmbrosia already having supplied the municipality list.
 */
export function deriveItalyRegionFromMunicipalities(municipNamField: string): {
  region: string | null;
  resolvedFrom: string | null;
  unresolvedMunicipalities: string[];
} {
  const municipalities = municipNamField
    .split("/")
    .map((m) => m.trim())
    .filter(Boolean);

  const unresolvedMunicipalities: string[] = [];
  const regionCounts = new Map<string, number>();

  for (const m of municipalities) {
    // ISTAT names are Title Case with normal Italian diacritics; eAmbrosia's
    // Municip_nam field is inconsistently cased (e.g. "Reggio Nell'Emilia")
    // -- match case-insensitively rather than assuming exact casing lines up.
    const key = Object.keys(italyMunicipalityToRegion).find(
      (istatName) => istatName.toLowerCase() === m.toLowerCase()
    );
    if (key) {
      const region = (italyMunicipalityToRegion as Record<string, string>)[key];
      regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
    } else {
      unresolvedMunicipalities.push(m);
    }
  }

  if (regionCounts.size === 0) {
    return { region: null, resolvedFrom: null, unresolvedMunicipalities };
  }

  // Take the region with the most matching municipalities. A PDO's
  // municipality list should overwhelmingly belong to one region; a mixed
  // result here would itself be a signal worth surfacing to a human, not
  // silently resolved -- callers should check unresolvedMunicipalities
  // and consider low agreement a soft warning, not just take region blindly.
  const [topRegion] = [...regionCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { region: topRegion, resolvedFrom: municipalities[0] ?? null, unresolvedMunicipalities };
}

// Italy subregion, added 2026-07-20 after re-checking on direct request --
// the earlier conclusion ("no subregion exists in Italy's official
// government data") was correct about MASAF's own list (which only groups
// by region, same as ISTAT), but incomplete: Federdoc, Italy's national
// confederation of wine protection consortia (federdoc.com), publishes its
// own "production area" pages that split the two DOCG-heaviest regions
// into real named zones with an explicit appellation list for each:
//   Piedmont -> "Langhe Area", "Monferrato Area", "Asti Area", "North"
//   Tuscany  -> "Tuscany", "Tuscany Antique Heart"
// The other 18 Italian regions are not split by Federdoc either -- for
// those, region and subregion are genuinely the same thing, not a gap.
//
// lib/wines/data/italy-appellation-to-subregion.json: 124 appellation-name
// keys (both DOCG and DOC, including alternate names given on the
// Federdoc pages, e.g. "Gavi" / "Cortese di Gavi") built directly from the
// real text on federdoc.com/en/production-areas/*, not inferred or
// guessed.
//
// Verified end-to-end against real eAmbrosia Italy rows: of the 110 real
// Italian PDOs whose ISTAT-derived region is Piemonte or Toscana, 109
// (99.1%) resolve to the correct Federdoc subregion. The one miss (Ruche
// di Castagnole Monferrato, an accent-variant spelling) has been fixed.
import italyAppellationToSubregion from "./data/italy-appellation-to-subregion.json";

export function deriveItalianSubregionFromAppellation(pdoName: string): {
  subregion: string | null;
  resolvedFrom: string | null;
} {
  const table = italyAppellationToSubregion as Record<string, string>;
  const variants = pdoName.split("/").map((v) => v.trim());
  for (const variant of variants) {
    const subregion = table[variant.toLowerCase()];
    if (subregion) {
      return { subregion, resolvedFrom: variant };
    }
  }
  return { subregion: null, resolvedFrom: null };
}

export async function fetchFullRegionAuthorityTable(): Promise<RegionAuthorityRow[]> {
  // Reduced from 3000 (added 2026-07-20): production run showed the fetch
  // getting cut off with "terminated" after ~80s at page size 3000, most
  // likely Wikidata's own server-side query timeout on a heavier query.
  // Smaller pages trade more requests for each one being reliable.
  const pageSize = 1000;
  let offset = 0;
  const all: RegionAuthorityRow[] = [];

  while (true) {
    const query = `
      SELECT ?item ?itemLabel ?locLabel ?countryLabel WHERE {
        ?item wdt:P31 wd:${WINE_CLASS_QID} .
        OPTIONAL { ?item wdt:P131 ?loc }
        OPTIONAL { ?item wdt:P17 ?country }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      } ORDER BY ?item LIMIT ${pageSize} OFFSET ${offset}
    `;
    const json = await runSparql(query);
    const rows: RegionAuthorityRow[] = json.results.bindings.map((b: any) => ({
      appellation: b.itemLabel?.value ?? "",
      locatedIn: b.locLabel?.value ?? null,
      country: b.countryLabel?.value ?? null,
      wikidataId: b.item?.value ?? "",
    }));
    all.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return all.filter((r) => !isNoiseRow(r));
}

// ---------------------------------------------------------------------------
// eAmbrosia PDO-name bridge (REGION_VALIDATION_PLAN.md, Step 3, added
// 2026-07-21).
//
// deriveItalyRegionFromMunicipalities() and deriveEuRegionFromMunicipalities()
// above both take an eAmbrosia Municip_nam string directly. Neither accepts
// what X-Wines actually gives us: a RegionName value like "Colli di Scandiano
// e di Canossa" -- an appellation name, not a municipality list. This bridge
// closes that gap: fuzzy-match the X-Wines RegionName against eAmbrosia's own
// PDOnam column for that country, then feed the matched row's Municip_nam
// into the right derive function above.
//
// Reuses the same match code proven elsewhere (dedup-match's
// similarityScore/cleanName), but NOT region-validate-import's
// CORRECTION_MATCH_THRESHOLD (0.8) -- that constant was calibrated for a
// different validator (the single-source region_authority check). This
// bridge has its own two-band calibration (EAMBROSIA_MATCH_FLOOR = 0.75,
// EAMBROSIA_AUTOCORRECT_FLOOR = 0.85 -- see below), built by actually
// running the bridge against all 1,483 real distinct RegionName values in
// eAmbrosia-covered countries and inspecting the borderline range by hand,
// not by reusing 0.8 on the assumption it would still be right here.
import { readFileSync } from "fs";
import { join } from "path";
import { similarityScore } from "./dedup-match";

// Calibrated 2026-07-21 directly against real data, not assumed -- ran the
// bridge against all 1,483 distinct (country, RegionName) values in
// eAmbrosia-covered countries and inspected every value in the borderline
// range by hand. Below 0.75, results are reliably unrelated names (e.g.
// "Ilia" / "Jutland" scoring under 0.4). From 0.75-0.84, results are a real
// mix: genuine wanted matches (Albinea Canali's real case, 0.839) alongside
// genuine different-place near-misses ("Tarantino" vs "Trentino" 0.778,
// "Pouilly-Fumé" vs "Pouilly-Fuissé" 0.786) -- not safe to auto-correct on,
// safe to surface for human review. At 0.85 and above, spot-checked matches
// were all clean, correct pairs. This intentionally supersedes
// region-validate-import.ts's separate CORRECTION_MATCH_THRESHOLD (0.8),
// which was calibrated for the single-source region_authority validator,
// not this bridge -- the two are allowed to differ since they're
// calibrated against different reference data.
export const EAMBROSIA_MATCH_FLOOR = 0.75; // below this, treat as no match at all
export const EAMBROSIA_AUTOCORRECT_FLOOR = 0.85; // at/above this, confident enough to auto-correct
// Between EAMBROSIA_MATCH_FLOOR and EAMBROSIA_AUTOCORRECT_FLOOR: a real
// candidate match exists, but not confidently enough to silently rewrite a
// value -- surfaced as FLAGGED_CONFLICT for a human instead.

export interface EambrosiaPdoRow {
  countryCode: string; // eAmbrosia's own 2-letter code, e.g. "IT"
  pdoName: string; // raw PDOnam field, kept whole for traceability/display
  pdoNameVariants: string[]; // pdoName split on "/" -- see note below
  municipNam: string;
}

// Fix added 2026-07-21, after checking real "no match" cases: eAmbrosia's
// own PDOnam field bundles alternate spellings into one string joined by
// "/" for some PDOs -- confirmed real examples: "Erbaluce di Caluso /
// Caluso", "Jerez-Xérès-Sherry / Jerez / Xérès / Sherry", "Cataluña /
// Catalunya" (122 of 1,177 total eAmbrosia PDOs, ~10%, formatted this way).
// Municip_nam was already being split on "/" for exactly this reason;
// PDOnam wasn't, which is why "Erbaluce di Caluso" (a real, exact-name
// match for one of the two bundled variants) was only scoring 0.720
// against the full bundled string instead of a clean 1.0. Splitting PDOnam
// the same way Municip_nam already is fixes this without changing the
// match algorithm itself.
function splitPdoNameVariants(pdoName: string): string[] {
  return pdoName
    .split("/")
    .map((v) => v.trim())
    .filter(Boolean);
}

// Minimal RFC4180-style CSV line parser. eAmbrosia's Municip_nam field
// contains real embedded commas inside quotes for some countries (confirmed
// real case: Spain's "Adrada, La/Barraco/..."), so a naive split(",")
// misaligns columns -- verified directly against the real file: field counts
// per line range from 15 to 98 with 80 quote characters present overall, not
// assumed safe to split naively. No CSV library is installed in this
// project; this file's format is simple enough that a hand-rolled
// quote-aware parser is safer than adding a dependency for one loader.
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

let cachedEambrosiaRows: EambrosiaPdoRow[] | null = null;

// Loads and caches data/PDO_EU_id (1) eAmbrosia.csv, keeping only the three
// columns this bridge needs (Country, PDOnam, Municip_nam -- columns 0, 2, 13
// of the real header: Country,PDOid,PDOnam,Registration,
// Category_of_wine_product,Varieties_OIV,Varieties_Other,Maximum_yield_hl,
// Maximum_yield_kg,Minimum_planting_density,Irrigation,Amendment,PDOinfo,
// Municip_nam,begin_lifes). Cached at module level -- this is static
// reference data, no reason to re-read and re-parse the file on every call.
export function loadEambrosiaPdoRows(csvPath?: string): EambrosiaPdoRow[] {
  if (cachedEambrosiaRows) return cachedEambrosiaRows;
  const path = csvPath ?? join(process.cwd(), "data", "PDO_EU_id (1) eAmbrosia.csv");
  const raw = readFileSync(path, "utf-8").replace(/^﻿/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: EambrosiaPdoRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    // skip header row (i=0)
    const fields = parseCsvLine(lines[i]);
    const countryCode = fields[0]?.trim();
    const pdoName = fields[2]?.trim();
    const municipNam = fields[13]?.trim();
    if (!countryCode || !pdoName || !municipNam) continue;
    rows.push({ countryCode, pdoName, pdoNameVariants: splitPdoNameVariants(pdoName), municipNam });
  }
  cachedEambrosiaRows = rows;
  return rows;
}

export interface EambrosiaBridgeResult {
  region: string | null;
  matchedPdoName: string | null;
  similarity: number;
  resolvedFrom: string | null;
  unresolvedMunicipalities: string[];
}

// Maps eAmbrosia's 2-letter country code to the literal country-name union
// deriveEuRegionFromMunicipalities() expects. Only countries that function
// actually supports are listed here -- anything else falls through to "no
// hierarchy layer" in deriveRegionFromEambrosia() below rather than a guess.
const EAMBROSIA_CODE_TO_EU_COUNTRY: Record<
  string,
  Parameters<typeof deriveEuRegionFromMunicipalities>[0]
> = {
  FR: "France",
  ES: "Spain",
  PT: "Portugal",
  DE: "Germany",
  AT: "Austria",
  EL: "Greece", // eAmbrosia uses ISO "EL" for Greece, not "GR"
  GR: "Greece",
  HR: "Croatia",
  UK: "United Kingdom",
  GB: "United Kingdom",
  BG: "Bulgaria",
  RO: "Romania",
  HU: "Hungary",
  SI: "Slovenia",
  CZ: "Czech Republic",
  SK: "Slovakia",
  BE: "Belgium",
  CY: "Cyprus",
  NL: "Netherlands",
  MT: "Malta",
  DK: "Denmark",
  LU: "Luxembourg",
};

// Added 2026-07-21, Step 5: lets callers outside this file (the import
// pipeline) know whether it's even worth trying the eAmbrosia bridge for a
// given country before calling deriveRegionFromEambrosia -- Italy is
// handled by its own dedicated municipality deriver above, not through the
// EAMBROSIA_CODE_TO_EU_COUNTRY map, so it's included explicitly here.
export function isEambrosiaCoveredCountry(countryCode: string): boolean {
  return countryCode === "IT" || countryCode in EAMBROSIA_CODE_TO_EU_COUNTRY;
}

// Classification/quality-tier qualifiers that describe a sub-zone or
// production standard *within* an appellation, not the place itself --
// added 2026-07-21 after checking real near-miss cases directly. "Villages"
// is the clearest example: it marks a village-level sub-designation (like
// calling something "the township of X"), not a distinct location, so a
// source value with "Villages" attached (e.g. "Côtes-du-Rhône-Villages")
// shouldn't be penalized against the plain parent name in eAmbrosia. Same
// idea for French "Grand Cru"/"Premier Cru" (quality-classification tiers,
// not places) and Italian "Classico"/"Riserva"/"Superiore" (sub-zone or
// aging/quality tiers). Confirmed real, current usage directly against
// eAmbrosia's own PDOnam column before adding each term (not guessed):
// Villages/Village 6, Grand Cru 54, Classico 4, Riserva 5, Superiore 7,
// Premier Cru/1er Cru 0 (kept anyway -- same category, just not yet used in
// this exact file). Stripped from BOTH the source text and eAmbrosia's own
// name before scoring, so the comparison stays symmetric -- this is
// deliberately a short, curated list built from real cases, not a general
// grammar rule, and it only affects which text gets compared, never which
// municipality list gets used once a row is matched.
const MATCH_NOISE_QUALIFIERS = [
  "1er Cru",
  "Premier Cru",
  "Grand Cru",
  "Villages",
  "Village",
  "Classico",
  "Riserva",
  "Superiore",
];

function stripMatchNoiseQualifiers(name: string): string {
  let result = name;
  for (const term of MATCH_NOISE_QUALIFIERS) {
    result = result.replace(new RegExp(`\\b${term}\\b`, "gi"), " ");
  }
  return result.replace(/\s+/g, " ").trim();
}

// Pure function of (countryCode, regionNameFromSource) -- memoized because
// checkProducerGroupConsistency calls this once per distinct RegionName
// value in every disagreeing producer group, and the same real values
// (e.g. "Bourgogne", "Willamette Valley") recur across many unrelated
// producers in a real full-catalog run. Added 2026-07-21 after timing the
// real, full 100,645-row catalog: 6,862 disagreeing (WineryID, Country)
// groups, a handful of which are large negociants/retailers with 30-63
// distinct RegionName values each (confirmed real cases: several French
// producers with 25-63 distinct values), made the uncached version take
// roughly 80s end-to-end -- correct, not a hang, just real repeated work
// worth not redoing.
const eambrosiaBridgeCache = new Map<string, EambrosiaBridgeResult>();

// Fuzzy-matches an X-Wines RegionName value against eAmbrosia's real PDOnam
// list for one country, then feeds the matched row's Municip_nam into the
// existing Italy or EU municipality-to-region deriver above. Returns a null
// region (not a guess) whenever nothing clears EAMBROSIA_MATCH_FLOOR, or
// when a PDO match exists but no municipality-to-region table covers that
// country yet. Callers needing the flag/auto-correct distinction should
// compare the returned similarity against EAMBROSIA_AUTOCORRECT_FLOOR
// themselves (see checkProducerGroupConsistency below).
export function deriveRegionFromEambrosia(
  countryCode: string,
  regionNameFromSource: string
): EambrosiaBridgeResult {
  const cacheKey = `${countryCode}::${regionNameFromSource}`;
  const cached = eambrosiaBridgeCache.get(cacheKey);
  if (cached) return cached;

  const result = deriveRegionFromEambrosiaUncached(countryCode, regionNameFromSource);
  eambrosiaBridgeCache.set(cacheKey, result);
  return result;
}

function deriveRegionFromEambrosiaUncached(
  countryCode: string,
  regionNameFromSource: string
): EambrosiaBridgeResult {
  const rows = loadEambrosiaPdoRows().filter((r) => r.countryCode === countryCode);
  if (rows.length === 0) {
    return {
      region: null,
      matchedPdoName: null,
      similarity: 0,
      resolvedFrom: null,
      unresolvedMunicipalities: [],
    };
  }

  const cleanedSource = stripMatchNoiseQualifiers(regionNameFromSource);

  let best: { row: EambrosiaPdoRow; score: number } | null = null;
  for (const row of rows) {
    // Score against every bundled name variant (see splitPdoNameVariants
    // above), not just the raw combined PDOnam string -- takes the best of
    // e.g. ["Erbaluce di Caluso", "Caluso"] rather than scoring against
    // "Erbaluce di Caluso / Caluso" as one literal string.
    const variants = row.pdoNameVariants.length > 0 ? row.pdoNameVariants : [row.pdoName];
    for (const variant of variants) {
      const cleanedVariant = stripMatchNoiseQualifiers(variant);
      const score = similarityScore(cleanedSource, cleanedVariant);
      if (!best || score > best.score) {
        best = { row, score };
      }
    }
  }

  if (!best || best.score < EAMBROSIA_MATCH_FLOOR) {
    return {
      region: null,
      matchedPdoName: best?.row.pdoName ?? null,
      similarity: best?.score ?? 0,
      resolvedFrom: null,
      unresolvedMunicipalities: [],
    };
  }

  if (countryCode === "IT") {
    const derived = deriveItalyRegionFromMunicipalities(best.row.municipNam);
    return {
      region: derived.region,
      matchedPdoName: best.row.pdoName,
      similarity: best.score,
      resolvedFrom: derived.resolvedFrom,
      unresolvedMunicipalities: derived.unresolvedMunicipalities,
    };
  }

  const euCountry = EAMBROSIA_CODE_TO_EU_COUNTRY[countryCode];
  if (euCountry) {
    const derived = deriveEuRegionFromMunicipalities(euCountry, best.row.municipNam);
    return {
      region: derived.region,
      matchedPdoName: best.row.pdoName,
      similarity: best.score,
      resolvedFrom: derived.resolvedFrom,
      unresolvedMunicipalities: derived.unresolvedMunicipalities,
    };
  }

  // Real PDO identity found (best.row.pdoName), but no municipality-to-region
  // table exists for this country in either derive function -- honestly
  // unresolved, not guessed.
  return {
    region: null,
    matchedPdoName: best.row.pdoName,
    similarity: best.score,
    resolvedFrom: null,
    unresolvedMunicipalities: [],
  };
}

// ---------------------------------------------------------------------------
// Producer-group consistency check (REGION_VALIDATION_PLAN.md, Step 4,
// Signals B/C, added 2026-07-21).
//
// Design settled through direct testing against real cases this session,
// not assumed up front:
//
// - Ken Wright Cellars (real case: Willamette Valley Pinot Noir + Celilo
//   Vineyard Chardonnay from White Salmon, Washington) proved that
//   hierarchy-relatedness can't be the gate for flagging a disagreement --
//   Washington and Willamette Valley aren't parent/child at all, yet the
//   disagreement is completely legitimate (two real wines, two real
//   places). A design that flags "unrelated" values would have wrongly
//   flagged this real producer.
// - Albinea Canali (real case: 5 of 6 rows "Piemonte", 1 row the correct
//   "Colli de Scandiano e Canosa" / Emilia-Romagna) proved the opposite
//   failure mode: two values can look shaped like a legitimate multi-region
//   split (a small minority disagreeing with a majority) while actually
//   being a real data error, not a real second place.
//
// What actually tells these apart isn't the *shape* of the disagreement, or
// whether the two values are geographically related -- it's whether an
// independent anchor (the eAmbrosia bridge above) specifically resolves a
// minority value to a real place that contradicts the majority's claim.
// Absent that anchor, a disagreement is left alone no matter how unrelated
// the values look, because Ken Wright proves unrelated-but-legitimate is a
// real, common pattern (New World wines and non-appellation-controlled
// European wines can source grapes/fruit outside a fixed home region --
// this is the norm for a meaningful share of the catalog, not an edge
// case). Only eAmbrosia-covered countries have an anchor source at all;
// everything else (all New World countries, including the US) has no
// anchor and is therefore left untouched by construction, not by a special
// case -- confirmed against real data: 1,913 of 6,862 disagreeing producer
// groups are in a country with no anchor source at all (1,077 of those in
// the US alone), and all of them fall through to NO_ANCHOR below.
//
// A "clear majority" (defined here as one value accounting for a strict
// majority, >50%, of a group's rows) is required before attempting
// anything at all -- groups without one (roughly even splits across 2+
// values) look structurally like genuine multi-region producers
// (confirmed real cases: Quinta da Barreira/Douro+Lisboa,
// Lionel Osmin & Cie/many Southwest France appellations) and are left
// alone regardless of anchor results, matching the plan's own framing:
// producer-group consistency detects that a conflict exists, it never
// picks a winner by vote.

export type RegionNameGroupStatus =
  | "NO_DISAGREEMENT" // group has only one distinct RegionName value
  | "NO_CLEAR_MAJORITY" // disagreement exists but no single value is a strict majority -- presumed multi-region producer, left alone
  | "MAJORITY_UNANCHORED" // a clear majority exists, but it doesn't itself confidently resolve to a real place -- no trustworthy ground truth to judge minority values against, left alone
  | "NO_ANCHOR" // majority confidently anchors, but no minority value has an anchor that contradicts it -- left alone
  | "CORRECTED" // a minority value was confidently (>=0.85) anchored to a region that contradicts the majority's own confidently-anchored region
  | "FLAGGED_CONFLICT"; // a minority value has a real but uncertain (0.75-0.84) anchor contradicting the majority's confidently-anchored region

export interface RegionNameGroupDecision {
  regionName: string;
  rowCount: number;
  isMajority: boolean;
  status: "CONFIRMED" | "CORRECTED" | "FLAGGED_CONFLICT" | "UNVALIDATED";
  correctedRegion: string | null; // set only when status === "CORRECTED"
  validationSource: string | null; // e.g. "EAMBROSIA_BRIDGE"
  flagReason: string | null; // set only when status === "FLAGGED_CONFLICT"
  matchedPdoName: string | null;
  similarity: number | null;
}

export interface ProducerGroupConsistencyResult {
  groupStatus: RegionNameGroupStatus;
  decisions: RegionNameGroupDecision[];
}

// regionNameCounts: distinct RegionName -> row count, for one (WineryID,
// Country) group. Only worth calling when regionNameCounts.size > 1 --
// callers should treat a single-value group as NO_DISAGREEMENT upstream
// without needing to call this at all, though it's handled safely here too.
export function checkProducerGroupConsistency(
  countryCode: string,
  regionNameCounts: Map<string, number>
): ProducerGroupConsistencyResult {
  const entries = [...regionNameCounts.entries()];

  if (entries.length <= 1) {
    return {
      groupStatus: "NO_DISAGREEMENT",
      decisions: entries.map(([regionName, rowCount]) => ({
        regionName,
        rowCount,
        isMajority: true,
        status: "UNVALIDATED",
        correctedRegion: null,
        validationSource: null,
        flagReason: null,
        matchedPdoName: null,
        similarity: null,
      })),
    };
  }

  const totalRows = entries.reduce((sum, [, count]) => sum + count, 0);
  const [majorityRegionName, majorityCount] = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  const hasClearMajority = majorityCount > totalRows / 2;

  if (!hasClearMajority) {
    // Shaped like a genuine multi-region producer (real confirmed cases:
    // Quinta da Barreira, Lionel Osmin & Cie) -- not attempting anything,
    // regardless of what any anchor might say.
    return {
      groupStatus: "NO_CLEAR_MAJORITY",
      decisions: entries.map(([regionName, rowCount]) => ({
        regionName,
        rowCount,
        isMajority: false,
        status: "UNVALIDATED",
        correctedRegion: null,
        validationSource: null,
        flagReason: null,
        matchedPdoName: null,
        similarity: null,
      })),
    };
  }

  // Require the majority itself to confidently self-anchor before treating
  // it as ground truth to judge minority values against -- added 2026-07-21
  // after two real false positives surfaced by running this against the
  // actual regression set, not caught by reasoning alone:
  //   - Fayolle Fils & Fille: majority "Northern Rhône" is an informal
  //     umbrella term with no eAmbrosia PDO entry at all (no anchor), so
  //     the real, correct minority value "Crozes-Hermitage" was wrongly
  //     "corrected" away from it.
  //   - Terra d'Alter: majority "Alentejano" (a broad Vinho Regional tier)
  //     only scores 0.800 against eAmbrosia's "Alentejo" PDO -- itself
  //     inside the flag band, not confident -- so the real, valid, more
  //     specific minority value "Alentejo" was wrongly "corrected" to
  //     "Alentejo Central" relative to an unconfident majority.
  // If the majority doesn't confidently resolve, there's no trustworthy
  // anchor to correct or flag anything against -- the whole group is left
  // alone, same caution as an unanchored minority value gets.
  const majorityAnchor = deriveRegionFromEambrosia(countryCode, majorityRegionName);
  const majorityConfident = majorityAnchor.region !== null && majorityAnchor.similarity >= EAMBROSIA_AUTOCORRECT_FLOOR;

  if (!majorityConfident) {
    return {
      groupStatus: "MAJORITY_UNANCHORED",
      decisions: entries.map(([regionName, rowCount]) => ({
        regionName,
        rowCount,
        isMajority: regionName === majorityRegionName,
        status: "UNVALIDATED",
        correctedRegion: null,
        validationSource: null,
        flagReason: null,
        matchedPdoName: regionName === majorityRegionName ? majorityAnchor.matchedPdoName : null,
        similarity: regionName === majorityRegionName ? majorityAnchor.similarity : null,
      })),
    };
  }

  const decisions: RegionNameGroupDecision[] = [];
  let anyCorrected = false;
  let anyFlagged = false;

  for (const [regionName, rowCount] of entries) {
    const isMajority = regionName === majorityRegionName;
    if (isMajority) {
      decisions.push({
        regionName,
        rowCount,
        isMajority: true,
        status: "CONFIRMED",
        correctedRegion: null,
        validationSource: "EAMBROSIA_BRIDGE",
        flagReason: null,
        matchedPdoName: majorityAnchor.matchedPdoName,
        similarity: majorityAnchor.similarity,
      });
      continue;
    }

    const anchor = deriveRegionFromEambrosia(countryCode, regionName);

    if (!anchor.region) {
      // No anchor at all for this minority value -- Ken Wright's Celilo
      // Vineyard Chardonnay is exactly this shape for a non-eAmbrosia
      // country; the same caution applies here even within eAmbrosia's
      // scope (e.g. a real minority appellation eAmbrosia simply doesn't
      // resolve to a region for). Left alone, not guessed at.
      decisions.push({
        regionName,
        rowCount,
        isMajority: false,
        status: "UNVALIDATED",
        correctedRegion: null,
        validationSource: null,
        flagReason: null,
        matchedPdoName: anchor.matchedPdoName,
        similarity: anchor.similarity,
      });
      continue;
    }

    if (anchor.region === majorityAnchor.region) {
      // Anchor confirms the minority value actually agrees with the
      // majority's own resolved region once resolved (e.g. a spelling
      // variant, or a more specific name within the same real place) --
      // not a real conflict at all.
      decisions.push({
        regionName,
        rowCount,
        isMajority: false,
        status: "CONFIRMED",
        correctedRegion: null,
        validationSource: "EAMBROSIA_BRIDGE",
        flagReason: null,
        matchedPdoName: anchor.matchedPdoName,
        similarity: anchor.similarity,
      });
      continue;
    }

    // Anchor found, and it contradicts the majority's own confidently
    // anchored region -- a real conflict. Confidence
    // (EAMBROSIA_AUTOCORRECT_FLOOR) decides whether to silently correct or
    // surface for human review; see that constant's comment for how 0.85
    // was calibrated against real data.
    if (anchor.similarity >= EAMBROSIA_AUTOCORRECT_FLOOR) {
      anyCorrected = true;
      decisions.push({
        regionName,
        rowCount,
        isMajority: false,
        status: "CORRECTED",
        correctedRegion: anchor.region,
        validationSource: "EAMBROSIA_BRIDGE",
        flagReason: null,
        matchedPdoName: anchor.matchedPdoName,
        similarity: anchor.similarity,
      });
    } else {
      anyFlagged = true;
      decisions.push({
        regionName,
        rowCount,
        isMajority: false,
        status: "FLAGGED_CONFLICT",
        correctedRegion: null,
        validationSource: "EAMBROSIA_BRIDGE",
        flagReason:
          `eAmbrosia bridge matched "${regionName}" to "${anchor.matchedPdoName}" ` +
          `(similarity ${anchor.similarity.toFixed(3)}), deriving region "${anchor.region}", ` +
          `which contradicts the group's majority claim of "${majorityRegionName}" ` +
          `(itself anchored to "${majorityAnchor.region}" at ${majorityAnchor.similarity.toFixed(3)}). ` +
          `Below the ${EAMBROSIA_AUTOCORRECT_FLOOR} auto-correct floor -- needs human review, not auto-corrected.`,
        matchedPdoName: anchor.matchedPdoName,
        similarity: anchor.similarity,
      });
    }
  }

  const groupStatus: RegionNameGroupStatus = anyCorrected ? "CORRECTED" : anyFlagged ? "FLAGGED_CONFLICT" : "NO_ANCHOR";

  return { groupStatus, decisions };
}
