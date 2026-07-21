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
