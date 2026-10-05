import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, IconArrow, IconPhone, Sheet } from './ui';

/**
 * Install prompt.
 *
 * Why this is hand-built rather than left to the browser: Chrome removed the
 * automatic install banner. The page now receives a `beforeinstallprompt` event
 * and, unless it calls `preventDefault()` and prompts the user itself, the app is
 * simply never offered to the home screen. So the manifest being correct and the
 * app being installable are both necessary and insufficient.
 *
 * iOS Safari never fires `beforeinstallprompt` at all, and cannot be scripted.
 * There the only route is Share -> Add to Home Screen, so those users get
 * instructions instead of a button that would do nothing.
 *
 * Behaviour chosen deliberately:
 * - A sheet, not a modal, so a user mid-symptom-check is never blocked.
 * - Dismissal is respected for a cooldown rather than forever. Someone who said
 *   no on Tuesday might want it during the next rainy season, and permanently
 *   suppressed prompts are how install rates end up near zero.
 * - Never shown once running standalone.
 */

const DISMISS_KEY = 'malariax.install_dismissed';
const INSTALLED_KEY = 'malariax.installed';
/** 14 days. Long enough to respect "no", short enough to ask again seasonally. */
const COOLDOWN_DAYS = 14;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function alreadyInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  // Persisted on `appinstalled`, not just held in memory. Display-mode only
  // covers the installed launch, so someone who later opens the ordinary
  // browser tab would be prompted all over again despite already having it on
  // their home screen.
  try {
    if (localStorage.getItem(INSTALLED_KEY) === '1') return true;
  } catch {
    /* storage unavailable; fall through to the display-mode checks */
  }
  // Standalone means launched from the home screen, i.e. already installed.
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    // iOS Safari's non-standard equivalent.
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Mac, so the touch check is what catches it.
  const iPadOs = /Macintosh/.test(ua) && typeof document !== 'undefined' && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOs;
}

function inCooldown(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < COOLDOWN_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

export function InstallPrompt() {
  const { t } = useTranslation();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState(alreadyInstalled);

  const eligible = !installed && !inCooldown();

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      // Suppress any browser UI and keep the event for our own call.
      event.preventDefault();

      // Checked here rather than via the render-time `eligible`, which is
      // captured once. Without this the prompt re-opened on every subsequent
      // visit even after a deliberate dismissal, which is how an install prompt
      // becomes something people reflexively dismiss.
      if (alreadyInstalled() || inCooldown()) return;

      setDeferred(event as BeforeInstallPromptEvent);
      // Not auto-opened: the first visit is likely someone reading about
      // symptoms, and an unrequested sheet on top of that is the wrong moment.
      setOpen(true);
    };

    const onInstalled = () => {
      setInstalled(true);
      setOpen(false);
      setDeferred(null);
      try {
        localStorage.removeItem(DISMISS_KEY);
        localStorage.setItem(INSTALLED_KEY, '1');
      } catch {
        /* storage unavailable; in-memory state still reflects installed */
      }
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode; the sheet will simply reappear next visit */
    }
    setOpen(false);
  }, []);

  const accept = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    // Only a dismissal is remembered; an acceptance is handled by appinstalled.
    if (choice.outcome === 'dismissed') dismiss();
    setOpen(false);
    setDeferred(null);
  }, [deferred, dismiss]);

  // iOS: nothing to prompt with, so the event never arrives and the sheet would
  // never open. Offer it on the same cooldown basis with manual steps instead.
  const showIosInstructions = eligible && isIos() && !deferred && !open;
  if (!open && !showIosInstructions) return null;

  if (showIosInstructions) {
    return (
      <div style={{ padding: '0 var(--sp-5) var(--sp-4)' }}>
        <Banner tone="info" icon={<IconArrow size={16} />}>
          <div className="row card-row-between">
            <span className="grow">{t('install.iosHint')}</span>
            <button className="btn btn-secondary btn-sm" onClick={dismiss}>
              {t('install.notNow')}
            </button>
          </div>
        </Banner>
      </div>
    );
  }

  return (
    <Sheet open={open} onClose={dismiss} title={t('install.title')}>
      <div className="stack">
        <p className="small muted">{t('install.body')}</p>

        {/* Offline is the real argument, and it is a true one for this app: the
            symptom checker and reporting both work with no connection. */}
        <ul className="stack stack-sm">
          {(t('install.reasons', { returnObjects: true }) as string[]).map((r, i) => (
            <li key={i} className="row small" style={{ alignItems: 'flex-start' }}>
              <span aria-hidden="true" style={{ color: 'var(--brand)' }}>•</span>
              <span>{String(r)}</span>
            </li>
          ))}
        </ul>

        <button className="btn btn-primary btn-block" onClick={() => void accept()}>
          {t('install.action')}
        </button>

        <button className="btn btn-ghost btn-block" onClick={dismiss}>
          {t('install.notNow')}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Exported for the About/settings surface: once someone has dismissed the
 * prompt, there must still be a way back to it, or the cooldown means they can
 * never install at all.
 */
export function installAvailable(): boolean {
  return !alreadyInstalled();
}

export { isIos, IconPhone };