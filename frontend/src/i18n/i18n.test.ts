import { describe, it, expect } from "vitest";
import {
  translate,
  LOCALES,
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_LABELS,
} from "./index";
import { en } from "./en";
import { ta } from "./ta";

describe("i18n core", () => {
  it("defaults to English and registers en + ta", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(LOCALES).toContain("en");
    expect(LOCALES).toContain("ta");
  });

  it("returns English strings for the en locale", () => {
    expect(translate("en", "common.save")).toBe("Save");
    expect(translate("en", "nav.students")).toBe(en["nav.students"]);
  });

  it("loads Tamil translations distinct from English", () => {
    expect(translate("ta", "common.save")).toBe("சேமி");
    expect(translate("ta", "nav.students")).toBe(ta["nav.students"]);
    expect(translate("ta", "common.save")).not.toBe(translate("en", "common.save"));
  });

  it("falls back to English when a Tamil key is missing", () => {
    // app.name (the brand) is intentionally absent from the Tamil dictionary.
    expect(ta["app.name"]).toBeUndefined();
    expect(translate("ta", "app.name")).toBe(en["app.name"]);
  });

  it("falls back to the key itself for an unknown key (never crashes)", () => {
    // @ts-expect-error — deliberately unknown key
    expect(translate("en", "does.not.exist")).toBe("does.not.exist");
  });

  it("interpolates {vars}", () => {
    // @ts-expect-error — unknown key falls back to the literal, then interpolates
    expect(translate("en", "{name} signed in", { name: "Ada" })).toBe("Ada signed in");
  });

  it("has no orphan Tamil keys (every ta key exists in en)", () => {
    for (const key of Object.keys(ta)) {
      expect(en).toHaveProperty(key);
    }
  });

  it("validates locale codes", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ta")).toBe(true);
    expect(isLocale("xx")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it("labels every locale in its own script", () => {
    for (const code of LOCALES) expect(LOCALE_LABELS[code]).toBeTruthy();
    expect(LOCALE_LABELS.ta).toBe("தமிழ்");
  });
});
