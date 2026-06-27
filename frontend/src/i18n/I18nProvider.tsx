"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_LOCALE,
  isLocale,
  translate,
  type Locale,
  type TranslationKey,
} from "./index";

const STORAGE_KEY = "sreedo-lang";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Client-side i18n provider. Renders the DEFAULT locale on the server and the
 * first client paint (so SSR markup matches and there is no hydration mismatch),
 * then adopts the persisted locale from localStorage after mount. The selected
 * language is persisted per browser.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isLocale(saved) && saved !== DEFAULT_LOCALE) setLocaleState(saved);
    } catch {
      // localStorage unavailable (private mode / SSR) — keep the default.
    }
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore persistence failures
    }
    if (typeof document !== "undefined") document.documentElement.lang = next;
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Access the translator. Falls back to a default-locale translator if used
 * outside the provider, so a stray call can never crash a page.
 */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  return {
    locale: DEFAULT_LOCALE,
    setLocale: () => undefined,
    t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
  };
}
