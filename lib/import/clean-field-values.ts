// Strips stray leading/trailing separator symbols and trailing punctuation
// from a field value, e.g. "- Opus One" -> "Opus One", "Bordeaux," ->
// "Bordeaux", "-" -> "". This is a defensive last pass only — splitting a
// combined value like "Napa Valley > Spring Mountain" into region/subRegion
// is lib/wines/normalize.ts's job (dictionary-driven, far more accurate than
// blind separator truncation). Called as the final step inside
// normalizeWineData(), not as a standalone pass.
const BARE_SEPARATOR_CHARS = ['>', '|', '/', '-', '.']

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[,;|]+$/g, '').trim()
}

function stripLeadingTrailingSeparators(value: string): string {
  let result = value.trim()
  let changed = true
  while (changed) {
    changed = false
    for (const sep of BARE_SEPARATOR_CHARS) {
      if (result.startsWith(sep)) {
        result = result.slice(sep.length).trim()
        changed = true
      }
      if (result.endsWith(sep)) {
        result = result.slice(0, -sep.length).trim()
        changed = true
      }
    }
  }
  return result
}

function isOnlySeparators(value: string): boolean {
  return value.length > 0 && /^[>|/.\-,;\s]+$/.test(value)
}

/**
 * Cleans a single field value: trims, collapses whitespace, strips stray
 * leading/trailing separator symbols, and strips trailing punctuation.
 * A value that is nothing but separator symbols becomes an empty string.
 */
export function cleanFieldValue(value: string): string {
  if (typeof value !== 'string') return value

  let result = collapseSpaces(value)
  if (!result) return ''

  result = stripLeadingTrailingSeparators(result)
  result = stripTrailingPunctuation(result)
  result = collapseSpaces(result)

  if (!result || isOnlySeparators(result)) return ''

  return result
}
