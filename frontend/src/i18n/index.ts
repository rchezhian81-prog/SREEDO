import { en, type TranslationKey } from "./en";
import { ta } from "./ta";

export type { TranslationKey };

export const LOCALES = ["en", "ta"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Human labels for the language switcher (shown in each language's own script). */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ta: "தமிழ்",
};

const DICTIONARIES: Record<Locale, Partial<Record<TranslationKey, string>>> = {
  en,
  ta,
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Look up a translation for `locale`, falling back to English and then to the key
 * itself so a missing string is never a crash. Supports `{name}` interpolation.
 */
export function translate(
  locale: Locale,
  key: TranslationKey,
  vars?: Record<string, string | number>
): string {
  let str = DICTIONARIES[locale]?.[key] ?? en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      str = str.replaceAll(`{${name}}`, String(value));
    }
  }
  return str;
}
