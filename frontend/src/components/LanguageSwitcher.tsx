"use client";

import { useI18n } from "@/i18n/I18nProvider";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n";
import { cx } from "@/components/ui";

/**
 * Compact language selector. Used in the staff dashboard, the parent/student
 * portal, and the login screens. Persists the choice via the i18n provider.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={cx("flex items-center gap-2", className)}>
      <span className="sr-only">{t("language.label")}</span>
      <span aria-hidden className="text-sm text-slate-400">
        🌐
      </span>
      <select
        aria-label={t("language.label")}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_LABELS[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
