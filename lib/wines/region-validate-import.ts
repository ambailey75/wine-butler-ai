// Region validation for the X-Wines import (Phase 2, Checklist #3 automated
// check "check every region against the verified reference list instead of
// trusting the file"). Uses the region_authority table (populated 2026-07-21,
// 8,956 real Wikidata-sourced appellation -> locatedIn -> country rows) as
// the ground truth, instead of trusting X-Wines' own RegionName text.
//
// Real motivating case: Albinea Canali (Emilia-Romagna producer) has 5 of 6
// catalog rows claiming RegionName "Piemonte" — wrong. This module is what
// catches that at import time instead of writing the bad value through.
import { cleanName, similarityScore } from './dedup-match'
import {
  deriveRegionFromEambrosia,
  isEambrosiaCoveredCountry,
  EAMBROSIA_MATCH_FLOOR,
  EAMBROSIA_AUTOCORRECT_FLOOR,
} from './region-hierarchy-checker'

// Classification/registration-tier suffixes and sub-zone/quality qualifiers
// that describe a wine's official tier or sub-area, not the place itself --
// added 2026-07-21 after checking a real sample of region_authority data
// directly (100 rows, Amanda's own Supabase export) and finding "Prosecco"
// came back completely UNVALIDATED against region_authority's own "Prosecco
// DOC" row, purely because the trailing classification code was never
// stripped before matching. Same real bug class already found and fixed in
// region-hierarchy-checker.ts's eAmbrosia bridge (that file's
// MATCH_NOISE_QUALIFIERS) -- kept as a separate list here rather than
// refactored into one shared export, since this file's real data confirmed
// two more terms specific to how Wikidata labels appellations (DOC, DOCG)
// that eAmbrosia's own PDOnam field doesn't carry at all. Evidenced
// directly in the sample: "Prosecco DOC", "Chianti Riserva DOCG",
// "Valpolicella Ripasso classico DOC", "Crépy AOC" -- not a general list of
// every possible classification code worldwide (e.g. Spain's DO/DOCa, US
// AVA are not yet evidenced here and are deliberately not guessed at).
const REGION_AUTHORITY_NOISE_TERMS = [
  'DOCG',
  'DOC',
  'AOC',
  'AOP',
  'IGT',
  'IGP',
  '1er Cru',
  'Premier Cru',
  'Grand Cru',
  'Villages',
  'Village',
  'Classico',
  'Riserva',
  'Superiore',
]

function stripRegionAuthorityNoiseTerms(name: string): string {
  let result = name
  for (const term of REGION_AUTHORITY_NOISE_TERMS) {
    result = result.replace(new RegExp(`\\b${term}\\b`, 'gi'), ' ')
  }
  return result.replace(/\s+/g, ' ').trim()
}

// Minimum similarity to accept a match as real, not noise. Stricter than
// dedup's 0.75 review floor on purpose — this auto-substitutes the value
// rather than flagging it for a human, so it needs to be more conservative.
// Added 2026-07-21 after the substring-containment version of this function
// produced real false corrections in production testing: "Toscana" ->
// "Province of Arezzo" and "Veneto" -> "Province of Belluno" (twice, for two
// unrelated wines) — a short, already-valid broad region name was matching
// an arbitrary narrow appellation purely because one string contained the
// other, with no real similarity between them.
// Exported 2026-07-21 (was module-local) so region-hierarchy-checker.ts's
// eAmbrosia bridge (REGION_VALIDATION_PLAN.md Step 3) reuses this exact
// threshold instead of a second, possibly-drifting copy of "0.8".
export const CORRECTION_MATCH_THRESHOLD = 0.8

export interface RegionAuthorityLookupRow {
  appellation: string;
  locatedIn: string | null;
  country: string | null;
}

export interface RegionValidationResult {
  validatedRegion: string | null; // locatedIn from region_authority, if found
  status: 'CONFIRMED' | 'CORRECTED' | 'UNVALIDATED';
  // CONFIRMED: X-Wines' text matched a region_authority row and agreed (or
  //            X-Wines' text was close enough it's treated as the same claim)
  // CORRECTED: a region_authority match was found and it DISAGREES with
  //            X-Wines' stated region — validatedRegion is the real one
  // UNVALIDATED: no region_authority row matched this appellation text —
  //              original X-Wines value is kept as-is, not silently trusted
  //              as correct, just not checked
}

// Combined per-row baseline (REGION_VALIDATION_PLAN.md Step 5, Signal A).
//
// Real bug found and fixed 2026-07-21 while testing this against the full
// 100K-row catalog (not caught by the earlier 12-row regression-case spot
// check, which happened not to exercise this path): Signal A, per the
// plan's own architecture section, is defined as existence-only --
// "does this region exist at all for this country" -- never a per-row
// correction. Per-row correction is exclusively a producer-group-conflict
// decision (Signal B/C, Step 4's checkProducerGroupConsistency), which
// requires an internal disagreement across a producer's own rows before it
// will touch anything. An earlier version of this function instead
// compared eAmbrosia's *derived broader region* (e.g. "Bourgogne-Franche-
// Comté", the administrative area a matched PDO's municipalities sit in)
// directly against the source RegionName text (typically a specific
// appellation name, e.g. "Chablis") and treated any non-agreement as a
// correction. Those are two different granularities that were never
// supposed to be compared this way -- run against the real, full 64,863
// eAmbrosia-covered rows, that bug alone produced 37,663 false
// "corrections" and 834 false "flags", because most real, entirely correct
// appellation names (Chablis, Barolo, Crozes-Hermitage, etc.) don't
// literally contain or get contained by their own containing region's
// name. Fixed by making this function existence-only, matching the plan's
// actual Signal A definition: recognized by eAmbrosia/region_authority at
// all -> CONFIRMED; not recognized by either -> UNVALIDATED. The derived
// broader region is still real, useful information -- it's just used
// downstream, inside checkProducerGroupConsistency, as the anchor for
// resolving a disagreement BETWEEN a producer's own rows, never to
// silently rewrite an isolated row that has no such disagreement.
export interface RegionBaselineResult {
  validatedRegion: string | null;
  status: 'CONFIRMED' | 'UNVALIDATED';
  validationSource: 'EAMBROSIA_BRIDGE' | 'REGION_AUTHORITY' | null;
  flagReason: null;
}

// Tries the eAmbrosia PDO bridge first for EU countries eAmbrosia actually
// covers (isEambrosiaCoveredCountry), falling back to region_authority
// everywhere else -- including when a specific X-Wines row's RegionName
// simply isn't a PDO name at all (e.g. a broad table-wine region), since
// not every real region name in an EU country carries PDO protection.
// countryCode is the 2-letter ISO code (X-Wines' "Code" column) --
// eAmbrosia and deriveRegionFromEambrosia are keyed on this, not the full
// country name, which is what region_authority's own index uses instead.
export function validateRegionBaseline(
  index: Map<string, Array<{ cleanedAppellation: string; locatedIn: string | null }>>,
  countryCode: string | null,
  country: string | null,
  regionNameFromSource: string | null
): RegionBaselineResult {
  if (regionNameFromSource && countryCode && isEambrosiaCoveredCountry(countryCode)) {
    const anchor = deriveRegionFromEambrosia(countryCode, regionNameFromSource)
    if (anchor.region && anchor.similarity >= EAMBROSIA_MATCH_FLOOR) {
      // Recognized as a real PDO -- existence confirmed. Not attempting to
      // reconcile this row's own text against the derived broader region;
      // that comparison belongs to producer-group consistency, not here.
      return {
        validatedRegion: regionNameFromSource,
        status: 'CONFIRMED',
        validationSource: 'EAMBROSIA_BRIDGE',
        flagReason: null,
      }
    }
    // Not recognized as any real PDO -- not every real region name in an
    // EU country is PDO-protected, so this isn't treated as an error.
    // Falls through to region_authority below, same as any
    // non-eAmbrosia-covered country.
  }

  const fallback = validateRegion(index, country, regionNameFromSource)
  if (fallback.status === 'UNVALIDATED') {
    return { validatedRegion: regionNameFromSource, status: 'UNVALIDATED', validationSource: null, flagReason: null }
  }
  // Both CONFIRMED and region_authority's own CORRECTED collapse to
  // CONFIRMED here -- existence was proven either way (a real appellation
  // row was matched); which specific province/locatedIn value it happened
  // to auto-correct to under the OLDER, single-source validateRegion() is
  // not reused as this baseline's answer, for the identical
  // granularity-mismatch reason documented above for eAmbrosia.
  // Confirmed 2026-07-21 (grepped the whole repo): validateRegion() is only
  // ever called from this one place, so its own CORRECTED behavior --
  // which likely has the same granularity-mismatch issue, replacing a
  // specific, already-correct appellation name with a broader locatedIn
  // value whenever the two strings don't literally overlap -- is not
  // exposed anywhere in the shipped pipeline. Not deleted outright because
  // its CONFIRMED/UNVALIDATED existence check is still exactly what's
  // needed here; its CORRECTED branch is simply never surfaced past this
  // point.
  return {
    validatedRegion: regionNameFromSource,
    status: 'CONFIRMED',
    validationSource: 'REGION_AUTHORITY',
    flagReason: null,
  }
}

// Built once per import run, not per row — grouping by country first keeps
// the per-row lookup bounded (tens of candidates, not all 8,956).
export function buildRegionAuthorityIndex(
  rows: RegionAuthorityLookupRow[]
): Map<string, Array<{ cleanedAppellation: string; locatedIn: string | null }>> {
  const byCountry = new Map<string, Array<{ cleanedAppellation: string; locatedIn: string | null }>>()
  for (const row of rows) {
    if (!row.country) continue
    const countryKey = cleanName(row.country)
    const list = byCountry.get(countryKey) ?? []
    list.push({ cleanedAppellation: cleanName(stripRegionAuthorityNoiseTerms(row.appellation)), locatedIn: row.locatedIn })
    byCountry.set(countryKey, list)
  }
  return byCountry
}

export function validateRegion(
  index: Map<string, Array<{ cleanedAppellation: string; locatedIn: string | null }>>,
  country: string | null,
  regionNameFromSource: string | null
): RegionValidationResult {
  if (!country || !regionNameFromSource) {
    return { validatedRegion: regionNameFromSource, status: 'UNVALIDATED' }
  }

  const candidates = index.get(cleanName(country))
  if (!candidates || candidates.length === 0) {
    return { validatedRegion: regionNameFromSource, status: 'UNVALIDATED' }
  }

  const cleanedSourceRegion = cleanName(stripRegionAuthorityNoiseTerms(regionNameFromSource))

  // Exact cleaned match first (fast, and the common case for well-formed
  // data). A real appellation can legitimately have MANY rows in
  // region_authority (one per province/administrative unit it spans --
  // e.g. real, confirmed case: "Prosecco" spans 10 real Italian
  // provinces), so this collects every matching row, not just the first
  // one the old .find()-based version took.
  let matches = candidates.filter((c) => c.cleanedAppellation === cleanedSourceRegion)

  // Fall back to real similarity scoring, not substring containment — a
  // short, valid, broad region name like "Veneto" is a substring of (or
  // contains) all kinds of unrelated specific appellation names, which
  // produced false corrections when this used .includes(). Similarity
  // scoring against the full string naturally rejects that case: "veneto"
  // vs. a long, unrelated appellation name scores low once compared as
  // whole strings, not as a raw substring check.
  if (matches.length === 0) {
    let bestScore = 0
    for (const c of candidates) {
      const score = similarityScore(c.cleanedAppellation, cleanedSourceRegion)
      if (score > bestScore) bestScore = score
    }
    if (bestScore >= CORRECTION_MATCH_THRESHOLD) {
      // Take every candidate at (essentially) the winning score, not just
      // one -- an appellation matched this way can still legitimately span
      // several rows, same as an exact match would.
      matches = candidates.filter(
        (c) => Math.abs(similarityScore(c.cleanedAppellation, cleanedSourceRegion) - bestScore) < 1e-9
      )
    }
  }

  const withLocation = matches.filter((m): m is { cleanedAppellation: string; locatedIn: string } => !!m.locatedIn)
  if (withLocation.length === 0) {
    return { validatedRegion: regionNameFromSource, status: 'UNVALIDATED' }
  }

  // If the source's own claim already agrees with ANY of the matched
  // candidates, that's real confirmation regardless of how many other
  // candidates exist (a multi-province appellation can still validate a
  // specific province the source already got right).
  const agreeingMatch = withLocation.find((m) => {
    const cleanedLocatedIn = cleanName(m.locatedIn)
    return cleanedLocatedIn.includes(cleanedSourceRegion) || cleanedSourceRegion.includes(cleanedLocatedIn)
  })
  if (agreeingMatch) {
    return { validatedRegion: regionNameFromSource, status: 'CONFIRMED' }
  }

  // No agreement -- would need to "correct" to one of the matched
  // candidates' locations. Only do that when there's exactly one distinct
  // real location to correct to. Added 2026-07-21 after checking a real
  // region_authority sample directly: appellations spanning multiple
  // provinces (Prosecco: 10) previously had the OLD .find()-based version
  // silently pick whichever row happened to be first, which for two real
  // appellations in the sample ("Colli di Luni Vermentino DOC", "Riviera
  // Ligure di Ponente Moscatello di Taggia DOC") meant real Italian
  // provinces (Genoa, La Spezia, etc.) versus a genuinely wrong Wikidata
  // row claiming "Vianges" (an actual commune in Burgundy, France) as the
  // location -- correctness was pure luck of row order, not a real check.
  // Refusing to guess among multiple distinct real locations is safer and
  // also naturally defuses the Vianges risk, since neither of those two
  // appellations has just one distinct candidate location.
  const distinctLocations = new Set(withLocation.map((m) => cleanName(m.locatedIn)))
  if (distinctLocations.size > 1) {
    return { validatedRegion: regionNameFromSource, status: 'UNVALIDATED' }
  }

  return { validatedRegion: withLocation[0].locatedIn, status: 'CORRECTED' }
}
