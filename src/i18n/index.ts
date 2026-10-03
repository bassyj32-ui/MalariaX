import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import am from './am.json';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'am', label: 'አማርኛ' },
] as const;

export type LangCode = (typeof LANGUAGES)[number]['code'];

export const STORAGE_KEY = 'malariax.lang';

const resources = {
  en: { translation: en },
  am: { translation: am },
};

/**
 * Language detection order:
 *   1. explicit user choice (persisted)
 *   2. browser preference
 *   3. English
 *
 * A bare "am-ET" or "am" both resolve to Amharic. The `load` guard means the
 * lookup only runs once per session, so a user who deliberately switches to
 * English while their phone is set to Amharic is not overridden on next boot.
 */
function detectLanguage(): LangCode {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'am') return saved;
  }
  if (typeof navigator !== 'undefined') {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const l of langs) {
      const base = l?.toLowerCase().split('-')[0];
      if (base === 'am' || base === 'en') return base;
    }
  }
  return 'en';
}

export const initialLanguage = detectLanguage();

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: 'en',
  supportedLngs: ['en', 'am'],
  interpolation: { escapeValue: false },
  returnObjects: true,
});

/**
 * The `<html lang>` attribute drives the `:lang(am)` CSS rules that switch the
 * font stack, leading, and label casing for Ethiopic script. Without it, Amharic
 * renders with Latin metrics, which looks visibly wrong.
 */
export function applyDocumentLanguage(lang: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('lang', lang);
}

export async function setLanguage(lang: LangCode): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Private mode or storage full — the in-memory switch still works.
  }
  applyDocumentLanguage(lang);
  if (i18n.language !== lang) await i18n.changeLanguage(lang);
}

applyDocumentLanguage(initialLanguage);

export default i18n;