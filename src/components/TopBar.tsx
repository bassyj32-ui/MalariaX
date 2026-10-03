import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage, type LangCode } from '../i18n';
import { IconGlobe } from './ui';

/**
 * Always-visible language switch.
 *
 * Deliberately not buried in settings. A large share of users will have a phone
 * set to a language this app does not ship, and if switching takes three taps
 * they will simply leave. Two options, one tap, always in reach.
 *
 * The switch is a radio group rather than a toggle because there are exactly two
 * languages: a toggle would need to guess which way to flip.
 */
export function TopBar() {
  const { t, i18n } = useTranslation();
  const current = (i18n.resolvedLanguage ?? i18n.language ?? 'en').startsWith('am') ? 'am' : 'en';

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-brand">
          <span className="topbar-mark" aria-hidden="true" />
          <span className="topbar-name">{t('app.name')}</span>
        </div>

        <div
          className="lang-switch"
          role="radiogroup"
          aria-label={t('settings.language')}
          onKeyDown={(e) => {
            // Left/right arrow moves between the two options, as a radio group
            // is expected to — a keyboard user should not have to Tab through.
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const next: LangCode = current === 'en' ? 'am' : 'en';
            void setLanguage(next);
            requestAnimationFrame(() => {
              document.querySelector<HTMLButtonElement>(`[data-lang="${next}"]`)?.focus();
            });
          }}
        >
          <IconGlobe size={14} />
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              role="radio"
              data-lang={l.code}
              className="lang-btn"
              aria-checked={current === l.code}
              onClick={() => void setLanguage(l.code)}
            >
              {l.code === 'am' ? 'አማ' : 'EN'}
              <span className="sr-only">{l.label}</span>
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}