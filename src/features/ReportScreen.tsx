import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { Banner, Card, IconAward, IconSend, IconShield, ProgressBar } from '../components/ui';
import { BADGE_DEFS, badgeProgress, nextBadge } from '../lib/badges';
import { enqueueReport, pendingCount } from '../lib/offline';
import { getClientHash } from '../lib/identity';
import { REGIONS } from '../lib/geo';
import { SYMPTOM_IDS, type SymptomId, type Severity } from '../lib/redflags';
import { useApp, type AgeGroup } from '../store/app';

const DURATIONS: readonly number[] = [0, 1, 2, 3, 4, 7, 14];

function regionName(code: string): string {
  const r = REGIONS.find((x) => x.code === code);
  if (!r) return code;
  return i18n.language?.startsWith('am') ? r.nameAm : r.nameEn;
}

export function ReportScreen() {
  const { t } = useTranslation();
  const { answer, result, recordReport, progress, setQueued } = useApp();

  const [regionCode, setRegionCode] = useState(answer.regionCode ?? '');
  const [zone, setZone] = useState('');
  const [ageGroup, setAgeGroup] = useState<AgeGroup>(answer.ageGroup);
  const [symptoms, setSymptoms] = useState<Partial<Record<SymptomId, Severity>>>(answer.symptoms);
  const [duration, setDuration] = useState<number | null>(answer.durationDays);
  const [sought, setSought] = useState<'yes' | 'no' | 'pending' | null>(answer.soughtCare);
  const [notes, setNotes] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { queued: boolean; earned: string[] }>(null);
  const [error, setError] = useState<null | 'region' | 'consent'>(null);

  const toggleSymptom = (id: SymptomId) => {
    setSymptoms((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = 'mild';
      return next;
    });
  };

  async function handleSubmit() {
    if (!regionCode) return setError('region');
    if (!consent) return setError('consent');
    setError(null);
    setBusy(true);
    try {
      const client_hash = await getClientHash();
      // Queue first. The user is told "saved" only once the row is durable in
      // IndexedDB — a report that exists only in a fetch() never happened.
      await enqueueReport({
        client_hash,
        region_code: regionCode,
        zone_name: zone.trim() || null,
        age_group: ageGroup,
        symptoms: Object.fromEntries(Object.entries(symptoms)),
        duration_days: duration,
        sought_care: sought,
        risk_level: result?.level ?? null,
        notes: notes.trim() || null,
      });

      const queued = (await pendingCount()) > 0;
      const earned = recordReport();
      setQueued(queued ? 1 : 0);
      setDone({ queued, earned });
    } catch {
      setError('region');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <ReportDone queued={done.queued} earned={done.earned} />;
  }

  const next = nextBadge(progress);

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">{t('report.title')}</h1>
        <p className="page-sub">{t('report.subtitle')}</p>
      </header>

      <Card>
        <div className="card-row" style={{ marginBottom: 'var(--sp-2)' }}>
          <IconShield size={17} />
          <span className="card-title">{t('report.privacyTitle')}</span>
        </div>
        <p className="card-body">{t('report.privacyBody')}</p>
      </Card>

      <section className="section stack">
        <label className="field">
          <span className="field-label">{t('report.region')} *</span>
          <select
            className="select"
            value={regionCode}
            onChange={(e) => {
              setRegionCode(e.target.value);
              if (error === 'region') setError(null);
            }}
          >
            <option value="">{t('report.regionPlaceholder')}</option>
            {REGIONS.map((r) => (
              <option key={r.code} value={r.code}>
                {regionName(r.code)}
              </option>
            ))}
          </select>
          {error === 'region' ? <span className="xs" style={{ color: 'var(--risk-emergency)' }}>{t('report.invalidRegion')}</span> : null}
        </label>

        <label className="field">
          <span className="field-label">{t('report.zoneOptional')}</span>
          <input
            className="input"
            value={zone}
            maxLength={60}
            placeholder={t('report.zonePlaceholder')}
            onChange={(e) => setZone(e.target.value)}
          />
        </label>

        <div className="field">
          <span className="field-label">{t('report.ageGroup')}</span>
          <div className="chips">
            {(['adult', 'child'] as AgeGroup[]).map((g) => (
              <button key={g} type="button" className="chip" aria-pressed={ageGroup === g} onClick={() => setAgeGroup(g)}>
                {t(`report.${g}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">{t('report.symptoms')}</span>
          <div className="chips">
            {SYMPTOM_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className="chip"
                aria-pressed={Boolean(symptoms[id])}
                onClick={() => toggleSymptom(id)}
              >
                {t(`assess.symptoms.${id}`)}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-label">{t('report.duration')}</span>
          <select className="select" value={duration ?? ''} onChange={(e) => setDuration(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">{t('common.optional')}</option>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {t(`assess.age${['None', '1', '2', '3', '4', '7', '14'][DURATIONS.indexOf(d)]}`)}
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          <span className="field-label">{t('report.soughtCare')}</span>
          <div className="chips">
            {(['yes', 'no', 'pending'] as const).map((v) => (
              <button key={v} type="button" className="chip" aria-pressed={sought === v} onClick={() => setSought(v)}>
                {t(`report.sought${v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'Pending'}`)}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-label">{t('report.notes')}</span>
          <textarea
            className="textarea"
            value={notes}
            maxLength={280}
            placeholder={t('report.notesPlaceholder')}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        <label className="switch-row" style={{ cursor: 'pointer' }}>
          <span className="small">{t('report.consent')}</span>
          <button
            type="button"
            role="checkbox"
            aria-checked={consent}
            className="switch"
            onClick={() => {
              setConsent((c) => !c);
              if (error === 'consent') setError(null);
            }}
          />
        </label>
        {error === 'consent' ? <span className="xs" style={{ color: 'var(--risk-emergency)' }}>{t('report.invalidConsent')}</span> : null}
      </section>

      {next ? (
        <Card className="section">
          <div className="card-row" style={{ marginBottom: 'var(--sp-3)' }}>
            <IconAward size={17} />
            <span className="card-title">{t('badges.nextBadge', { name: t(next.def.labelKey) })}</span>
          </div>
          <ProgressBar value={badgeProgress(progress, next.def)} />
          <p className="card-body">
            {next.def.criteria === 'reports'
              ? t('badges.reportsToGo', { count: next.remaining })
              : t('badges.daysToGo', { count: next.remaining })}
          </p>
        </Card>
      ) : null}

      <div className="section">
        <button className="btn btn-primary btn-block" onClick={handleSubmit} disabled={busy}>
          {busy ? <><span className="spinner" aria-hidden="true" /> {t('report.submitting')}</> : <><IconSend size={16} /> {t('report.submit')}</>}
        </button>
      </div>
    </div>
  );
}

function ReportDone({ queued, earned }: { queued: boolean; earned: string[] }) {
  const { t } = useTranslation();
  const { setTab, progress } = useApp();

  return (
    <div className="page">
      <div className="stack-lg" style={{ marginTop: 'var(--sp-8)' }}>
        <div className="center">
          <IconShield size={40} />
          <h2 style={{ marginTop: 'var(--sp-3)', fontSize: 'var(--text-xl)' }}>
            {t(queued ? 'report.successQueued' : 'report.success')}
          </h2>
          <p className="muted small" style={{ marginTop: 'var(--sp-2)' }}>{t('report.successBody')}</p>
        </div>

        {earned.length > 0 ? (
          <Card>
            <span className="eyebrow">{t('report.badgeEarned')}</span>
            <ul className="stack stack-sm" style={{ marginTop: 'var(--sp-3)' }}>
              {earned.map((id) => (
                <li key={id} className="row">
                  <IconAward size={17} />
                  <span className="strong small">{t(`report.badges.${id}`)}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card>
          <div className="stat-grid">
            <div className="stat">
              <span className="stat-value tnum">{progress.reportsCount}</span>
              <span className="stat-label">{t('badges.reports')}</span>
            </div>
            <div className="stat">
              <span className="stat-value tnum">{progress.currentStreak}</span>
              <span className="stat-label">{t('badges.streak')}</span>
            </div>
            <div className="stat">
              <span className="stat-value tnum">{progress.points}</span>
              <span className="stat-label">{t('badges.points')}</span>
            </div>
          </div>

          <div className="divider" />

          <span className="eyebrow">{t('badges.title')}</span>
          <ul className="stack stack-sm" style={{ marginTop: 'var(--sp-3)' }}>
            {BADGE_DEFS.map((def) => {
              const has = progress.badges.includes(def.id);
              return (
                <li key={def.id} className="row card-row-between">
                  <span className="row small">
                    <IconAward size={15} />
                    {t(def.labelKey)}
                  </span>
                  <span className="xs muted">{has ? t('badges.earned') : t('badges.locked')}</span>
                </li>
              );
            })}
          </ul>
        </Card>

        <button className="btn btn-secondary btn-block" onClick={() => setTab('dashboard')}>
          {t('dashboard.title')}
        </button>

        <Banner tone="info">{t('result.disclaimer')}</Banner>
      </div>
    </div>
  );
}