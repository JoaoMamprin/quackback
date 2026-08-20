import { describe, it, expect } from 'vitest'
import { SUPPORTED_LOCALES } from '@/lib/shared/i18n'

// Derive the catalog registry from the JSON files on disk rather than a
// hand-maintained import list — adding a locale is then just dropping its
// `xx.json` next to en.json and adding it to SUPPORTED_LOCALES, with no edit
// here. The `*.json` glob stays one level deep, so it never picks up the
// compiled output. (Eager import is fine: this is test-only and never reaches
// the app bundle, where `loadMessages` keeps catalogs lazily code-split.)
const modules = import.meta.glob('../*.json', { eager: true, import: 'default' })
const catalogs: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(modules).map(([path, catalog]) => [
    /([^/]+)\.json$/.exec(path)?.[1] ?? path,
    catalog as Record<string, string>,
  ])
)

type Locale = (typeof SUPPORTED_LOCALES)[number]

// English remains the canonical key/ICU schema because every translated
// catalog was authored against en.json. Generic Portuguese intentionally
// inherits pt-br at runtime while pt.json overrides wording where available.
function effectiveCatalog(locale: Locale): Record<string, string> {
  if (locale === 'pt') {
    return { ...catalogs['pt-br'], ...catalogs.pt }
  }
  return catalogs[locale]
}

const en = catalogs.en
const enKeys = Object.keys(en)
const enKeySet = new Set(enKeys)
const localesToCheck = SUPPORTED_LOCALES.filter((locale) => locale !== 'en')

// Collect the top-level ICU argument names in a message: `{name}` -> "name",
// `{count, plural, ...}` -> "count". Branch keywords (plural/one/other) and the
// `#` inside a branch are not arguments, so they are intentionally excluded.
function icuArgNames(message: string): Set<string> {
  const names = new Set<string>()
  const re = /\{\s*([a-zA-Z_][\w]*)\b/g
  let match: RegExpExecArray | null
  while ((match = re.exec(message)) !== null) names.add(match[1])
  return names
}

describe('locale catalogs', () => {
  // Catches both a supported locale with no file AND an orphan `xx.json` that
  // was never wired into SUPPORTED_LOCALES (so it would never load at runtime).
  it('has exactly one catalog file per supported locale', () => {
    expect(new Set(Object.keys(catalogs))).toEqual(new Set(SUPPORTED_LOCALES))
  })

  // Every effective locale must expose every canonical English key. For `pt`,
  // this validates the same pt-br -> pt overlay used by loadMessages().
  it.each(localesToCheck)('%s defines every key present in en.json', (locale) => {
    const localeKeys = new Set(Object.keys(effectiveCatalog(locale)))
    const missing = enKeys.filter((key) => !localeKeys.has(key))
    expect(missing, `${locale} is missing ${missing.length} key(s)`).toEqual([])
  })

  // Extra keys are dead weight (and usually a sign a key was renamed in en.json
  // without updating the locale), so keep every effective catalog in lockstep.
  it.each(localesToCheck)('%s defines no keys absent from en.json', (locale) => {
    const extra = Object.keys(effectiveCatalog(locale)).filter((key) => !enKeySet.has(key))
    expect(extra, `${locale} has ${extra.length} stale key(s)`).toEqual([])
  })

  // A translation that drops, renames, or invents an ICU placeholder either
  // renders a literal `{name}` to the user or throws when react-intl formats
  // the message. Every locale must use exactly the placeholders en.json does.
  it.each(localesToCheck)('%s preserves every ICU placeholder from en.json', (locale) => {
    const catalog = effectiveCatalog(locale)
    const mismatches = enKeys
      .filter((key) => key in catalog)
      .map((key) => ({
        key,
        en: [...icuArgNames(en[key])].sort(),
        locale: [...icuArgNames(catalog[key])].sort(),
      }))
      .filter(({ en: a, locale: b }) => a.length !== b.length || a.some((n, i) => n !== b[i]))
    expect(mismatches, `${locale} has ${mismatches.length} placeholder mismatch(es)`).toEqual([])
  })
})
