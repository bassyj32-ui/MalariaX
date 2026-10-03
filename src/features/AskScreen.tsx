import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Card, IconAlert, IconSend, IconShield } from '../components/ui';
import { askQuestion, isAiConfigured } from '../lib/ai';

interface Turn {
  id: number;
  q: string;
  a: string;
}

const COMMON_KEYS = ['nets', 'whenTest', 'kids', 'spray', 'after'] as const;

export function AskScreen() {
  const { t } = useTranslation();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const endRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns, busy]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput('');
    setError(false);
    setBusy(true);
    try {
      const a = await askQuestion(q);
      setTurns((prev) => [...prev, { id: nextId.current++, q, a }]);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const canAsk = online && isAiConfigured;

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">{t('ask.title')}</h1>
        <p className="page-sub">{t('ask.subtitle')}</p>
      </header>

      {turns.length === 0 ? (
        <Card>
          <span className="eyebrow">{canAsk ? t('ask.title') : t('ask.offlineTitle')}</span>
          <p className="card-body" style={{ marginBottom: 'var(--sp-3)' }}>
            {canAsk ? t('ask.subtitle') : t('ask.offlineBody')}
          </p>
          <ul className="stack stack-sm">
            {COMMON_KEYS.map((k) => (
              <li key={k}>
                <button
                  type="button"
                  className="btn btn-secondary btn-block"
                  style={{ justifyContent: 'space-between' }}
                  disabled={!canAsk}
                  onClick={() => send(t(`ask.common.${k}`))}
                >
                  {t(`ask.common.${k}`)}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <div className="stack">
          {turns.map((turn) => (
            <div key={turn.id} className="stack stack-sm">
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <span
                  className="card"
                  style={{ maxWidth: '85%', background: 'var(--brand-soft)', borderColor: 'transparent', color: 'var(--brand-ink)' }}
                >
                  <span className="small">{turn.q}</span>
                </span>
              </div>
              <div className="card risk-ribbon risk-low">
                <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{turn.a}</p>
                <p className="xs muted" style={{ marginTop: 'var(--sp-2)' }}>{t('ask.sources')}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {error ? (
        <div className="section">
          <Banner tone="warn" icon={<IconAlert size={16} />}>
            {t('ask.error')}
          </Banner>
        </div>
      ) : null}

      {busy ? (
        <div className="row small muted" style={{ marginTop: 'var(--sp-4)' }}>
          <span className="spinner" aria-hidden="true" /> {t('ask.thinking')}
        </div>
      ) : null}

      <div ref={endRef} />

      {turns.length > 0 ? (
        <div className="row" style={{ marginTop: 'var(--sp-4)' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setTurns([])}>
            {t('ask.clear')}
          </button>
        </div>
      ) : null}

      <form
        className="ask-bar"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <label className="sr-only" htmlFor="ask-input">
          {t('ask.placeholder')}
        </label>
        <input
          id="ask-input"
          className="input grow"
          value={input}
          placeholder={canAsk ? t('ask.placeholder') : t('ask.offlineTitle')}
          disabled={!canAsk || busy}
          onChange={(e) => setInput(e.target.value)}
          enterKeyHint="send"
        />
        <button className="btn btn-primary" type="submit" disabled={!canAsk || busy || !input.trim()} aria-label={t('ask.send')}>
          <IconSend size={17} />
        </button>
      </form>

      {!isAiConfigured ? (
        <div style={{ marginTop: 'var(--sp-3)' }}>
          <Banner tone="info" icon={<IconShield size={16} />}>
            {t('ask.offlineBody')}
          </Banner>
        </div>
      ) : null}
    </div>
  );
}