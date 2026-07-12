import { cleanFieldValue } from '@/lib/import/clean-field-values'

describe('cleanFieldValue', () => {
  it('trims whitespace and collapses internal double spaces', () => {
    expect(cleanFieldValue('  Napa   Valley  ')).toBe('Napa Valley')
  })

  it('strips a leading separator symbol', () => {
    expect(cleanFieldValue('- Opus One')).toBe('Opus One')
  })

  it('strips a trailing separator symbol', () => {
    expect(cleanFieldValue('Opus One >')).toBe('Opus One')
  })

  it('strips trailing punctuation', () => {
    expect(cleanFieldValue('Bordeaux,')).toBe('Bordeaux')
  })

  it('reduces a value that is only a separator symbol to an empty string', () => {
    expect(cleanFieldValue('-')).toBe('')
    expect(cleanFieldValue('>')).toBe('')
  })

  it('does not touch internal hyphens in a compound name', () => {
    expect(cleanFieldValue('Châteauneuf-du-Pape')).toBe('Châteauneuf-du-Pape')
  })

  it('does not touch internal slashes in a varietal blend', () => {
    expect(cleanFieldValue('Cab / Merlot / P. verdot')).toBe('Cab / Merlot / P. verdot')
  })

  it('preserves parentheses and ampersands', () => {
    expect(cleanFieldValue('Château Smith & Sons (Reserve)')).toBe('Château Smith & Sons (Reserve)')
  })

  it('returns an empty string for an empty input', () => {
    expect(cleanFieldValue('')).toBe('')
  })
})
