// Pure string utilities for cross-script (Cyrillic ↔ Latin) company/name
// matching. No DB, no server-only imports — safe to import anywhere.
//
// Motivation: the same company is routinely written both in Cyrillic and in
// Latin within one thread — "АСТ" / "AST", "Вектор" / "Vektor". A plain
// lowercase+strip key (normaliseCompanyName) keeps those as DISTINCT keys
// ("аст" vs "ast"), so discovery proposes two clients for one real company.
// Transliterating to a common Latin form before keying collapses them.

import { normaliseCompanyName } from "@/lib/normalise-company-name"

// Practical Russian → Latin map (BGN/PCGN-ish, lowercase). Multi-char first
// where relevant. Good enough for matching keys (not for display).
const RU_TO_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
}

/**
 * Transliterate any Cyrillic letters in a string to a Latin approximation.
 * Non-Cyrillic characters pass through unchanged. Case-folds to lowercase
 * (we only use the result as a match key). Returns the input lowercased when
 * it contains no Cyrillic.
 *   "АСТ"     → "ast"
 *   "Вектор"  → "vektor"
 *   "Acme"    → "acme"
 */
export function transliterateRu(input: string): string {
  const lower = input.toLowerCase()
  let out = ""
  for (const ch of lower) {
    out += ch in RU_TO_LAT ? RU_TO_LAT[ch] : ch
  }
  return out
}

// Russian legal-entity forms, written as PREFIXES (unlike Western suffixes):
// "ООО АСТ", "ЗАО Вектор". Stripped in transliterated form before the
// suffix-oriented `normaliseCompanyName` runs. Longer first.
const RU_LEGAL_PREFIXES = ["oao", "pao", "zao", "ooo", "ip", "ao", "nko", "gup", "mup"]

/**
 * Cross-script canonical key for company dedup. Transliterates Cyrillic to
 * Latin, strips Russian legal-form PREFIXES (ООО/ЗАО/…), THEN runs the normal
 * company normaliser (strips Western legal suffixes + punctuation, keeps
 * alphanumerics). So "АСТ", "AST", "ООО АСТ", "AST LLC" all collapse to "ast".
 *
 * Use this instead of `normaliseCompanyName` wherever cross-script matching
 * matters (discovery dedup). Returns "" for pure-suffix garbage.
 */
export function companyMatchKey(raw: string): string {
  let s = transliterateRu(raw).trim().toLowerCase()
  // Strip a leading legal-form token (and quotes Russians wrap names in).
  s = s.replace(/^["«»']+/, "").trim()
  let changed = true
  while (changed) {
    changed = false
    for (const p of RU_LEGAL_PREFIXES) {
      if (s.startsWith(p + " ")) {
        s = s.slice(p.length + 1).trim()
        changed = true
        break
      }
    }
  }
  return normaliseCompanyName(s)
}

/**
 * Cross-script canonical key for a person's name: transliterate, lowercase,
 * collapse whitespace, then sort the word tokens so name-order variants match
 * ("Богданов Евгений" ≡ "Евгений Богданов" ≡ "Bogdanov Evgeniy"). Returns ""
 * for the "(unknown)" placeholder or empty input.
 */
export function personMatchKey(raw: string): string {
  const t = transliterateRu(raw).trim().replace(/\s+/g, " ")
  if (!t || t === "(unknown)") return ""
  return t
    .split(" ")
    .map((w) => w.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter(Boolean)
    .sort()
    .join(" ")
}
