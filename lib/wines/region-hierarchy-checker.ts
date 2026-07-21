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
// UNVERIFIED ASSUMPTION, FLAGGED NOT HIDDEN: this has not yet been run
// from this project's actual Node/Vercel environment. The research
// sandbox used to build this file has query.wikidata.org blocked at its
// network proxy (confirmed: 403 blocked-by-allowlist), so the fetch()
// calls below were never executed from a plain server-side Node process —
// only proven reachable from an actual browser tab. Standard Vercel
// serverless functions have normal outbound internet access, so this is
// expected to work unchanged, but that is an expectation, not a test
// result, until this runs for real in this repo's environment.
//
// KNOWN DATA NOISE: `instance of: wine` (Q282) is broader than "wine
// appellation" — a small number of results are generic terms (e.g.
// "passito") or unlabeled items exposing a bare Wikidata Q-id instead of
// an English label. filterNoiseRow() below excludes both patterns. This
// was observed directly in the 2026-07-20 pull, not assumed.

const WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const WINE_CLASS_QID = "Q282"; // confirmed via the Colli di Scandiano e di Canossa DOC item page, 2026-07-20

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

async function runSparql(query: string): Promise<any> {
  const res = await fetch(buildSparqlUrl(query), {
    headers: { Accept: "application/sparql-results+json" },
  });
  if (!res.ok) {
    throw new Error(
      `Wikidata SPARQL request failed: ${res.status} ${res.statusText}. ` +
        `If this is happening in production (not the research sandbox), it is a new, ` +
        `real finding — do not assume it is the same sandbox block seen during research.`
    );
  }
  return res.json();
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

export async function fetchFullRegionAuthorityTable(): Promise<RegionAuthorityRow[]> {
  const pageSize = 3000;
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
