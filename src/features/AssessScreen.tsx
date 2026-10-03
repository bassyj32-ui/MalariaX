import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { Banner, Card, IconAlert, IconArrow, IconInfo, IconShield, RiskPill, RiskRibbon } from '../components/ui';
import { getClimate } from '../lib/climate';
import { REGIONS, findRegion } from '../lib/geo';
import { evaluateRedFlags, isEmpty, SYMPTOM_IDS, type Severity, type SymptomId } from '../lib/redflags';
import { assess } from '../lib/risk';
import { useApp, type AgeGroup } from '../store/app';

const SEVERITIES: readonly Severity[] = ['none', 'mild', 'moderate', 'severe'] as const;

const DURATIONS: readonly number[] = [0, 1, 2, 3, 4, 7, 14];

/** Region labels ship in the reference data rather than i18n, because they are
 *  proper nouns — a translation key per district would be unmaintainable. */
function regionName(code: string): string {
  const r = REGIONS.find((x) => x.code === code);
  if (!r) return code;
  return i18n.language?.startsWith('am') ? r.nameAm : r.nameEn;
}

export function AssessScreen({ onBack }: { onBack?: () => void } = {}) {
  const { t } = useTranslation();
  const { answer, setSeverity, setAgeGroup, setDuration, setSoughtCare, setRegion, result, setResult, resetAnswer, online, setTab } =
    useApp();

  const [busy, setBusy] = useState(false);

  const redFlags = useMemo(() => evaluateRedFlags(answer.symptoms), [answer.symptoms]);
  const canSubmit = !isEmpty(answer.symptoms) && !busy;

  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const region = findRegion(answer.regionCode);
      // Case rate is unknown until the dashboard has data; 0 here means the
      // clinical picture drives the verdict, which is the safe default.
      const climate = await getClimate(answer.regionCode ?? 'AA', 0);
      const outcome = assess({
        region,
        climate,
        clinical: redFlags.level,
        forcedEmergency: redFlags.forcedEmergency,
      });

      setResult({
        level: outcome.level,
        forcedEmergency: outcome.forcedEmergency,
        environmental: outcome.environmental?.level ?? null,
        climateLive: climate.live,
        at: Date.now(),
      });
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return <ResultView onReset={resetAnswer} onBack={onBack} />;
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">{t('assess.title')}</h1>
        <p className="page-sub">{t('assess.subtitle')}</p>
      </header>

      {/* The two people most likely to die from malaria are under-fives and
          pregnant women. Asking who this is about first means the child copy can
          escalate its advice rather than just relabelling fields. */}
      <Card>
        <span className="eyebrow">{t('assess.forWhom')}</span>
        <div className="chips" style={{ marginTop: 'var(--sp-3)' }} role="radiogroup" aria-label={t('assess.forWhom')}>
          {(['adult', 'child'] as AgeGroup[]).map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              className="chip"
              aria-checked={answer.ageGroup === g}
              aria-pressed={answer.ageGroup === g}
              onClick={() => setAgeGroup(g)}
            >
              {t(`assess.${g}`)}
            </button>
          ))}
        </div>
        {answer.ageGroup === 'child' ? (
          <p className="card-body">
            <IconInfo size={14} /> {t('assess.childNote')}
          </p>
        ) : null}
      </Card>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">{t('assess.symptomSection')}</span>
        </div>

        <div className="stack">
          {SYMPTOM_IDS.map((id) => (
            <SymptomRow key={id} id={id} value={answer.symptoms[id] ?? 'none'} onChange={setSeverity} />
          ))}
        </div>

        {isEmpty(answer.symptoms) ? (
          <p className="small muted" style={{ marginTop: 'var(--sp-3)' }}>
            {t('assess.selectOne')}
          </p>
        ) : null}
      </section>

      <section className="section">
        <Card>
          <label className="field">
            <span className="field-label">{t('assess.ageLabel')}</span>
            <select
              className="select"
              value={answer.durationDays ?? ''}
              onChange={(e) => setDuration(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">{t('common.optional')}</option>
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {t(`assess.age${['None', '1', '2', '3', '4', '7', '14'][DURATIONS.indexOf(d)]}`)}
                </option>
              ))}
            </select>
          </label>

          <div className="divider" />

          <span className="field-label">{t('assess.soughtCare')}</span>
          <div className="chips">
            {(['yes', 'no', 'pending'] as const).map((v) => (
              <button
                key={v}
                type="button"
                className="chip"
                aria-pressed={answer.soughtCare === v}
                onClick={() => setSoughtCare(v)}
              >
                {t(`assess.care${v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'Pending'}`)}
              </button>
            ))}
          </div>

          <div className="divider" />

          <label className="field">
            <span className="field-label">{t('report.region')}</span>
            <select
              className="select"
              value={answer.regionCode ?? ''}
              onChange={(e) => setRegion(e.target.value || null)}
            >
              <option value="">{t('common.optional')}</option>
              {REGIONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {regionName(r.code)}
                </option>
              ))}
            </select>
          </label>
          <p className="card-body">{t('assess.regionWhy')}</p>
        </Card>
      </section>

      <div className="section stack">
        <button className="btn btn-primary btn-block" onClick={handleSubmit} disabled={!canSubmit}>
          {busy ? <><span className="spinner" aria-hidden="true" /> {t('assess.submitting')}</> : t('assess.submit')}
        </button>

        <Banner tone="warn" icon={<IconAlert size={16} />}>
          {t('result.disclaimer')}
        </Banner>

        {!online ? <Banner tone="info">{t('common.offlineBody')}</Banner> : null}
      </div>

      <div className="row" style={{ marginTop: 'var(--sp-4)' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setTab('dashboard')}>
          {t('dashboard.title')} <IconArrow size={15} />
        </button>
      </div>
    </div>
  );
}

function SymptomRow({
  id,
  value,
  onChange,
}: {
  id: SymptomId;
  value: Severity;
  onChange: (id: SymptomId, sev: Severity) => void;
}) {
  const { t } = useTranslation();
  const label = t(`assess.symptoms.${id}`);

  return (
    <Card>
      <div className="card-row-between" style={{ marginBottom: 'var(--sp-3)' }}>
        <span className="card-title">{label}</span>
      </div>
      <div className="severity" role="radiogroup" aria-label={t('a11y.changeSeverity', { symptom: label })}>
        {SEVERITIES.map((sev) => (
          <button
            key={sev}
            type="button"
            role="radio"
            className="severity-btn"
            data-sev={sev}
            aria-checked={value === sev}
            aria-pressed={value === sev}
            aria-label={t('a11y.currentSeverity', { symptom: label, severity: t(`assess.severity.${sev}`) })}
            onClick={() => onChange(id, sev)}
          >
            {t(`assess.severity.${sev}`)}
          </button>
        ))}
      </div>
    </Card>
  );
}

/* ==========================================================================
   Result view
   ========================================================================== */

function ResultView({ onReset, onBack }: { onReset: () => void; onBack?: () => void }) {
  const { t } = useTranslation();
  const { result, answer, setTab } = useApp();
  if (!result) return null;

  const level = result.level;
  const isEmergency = level === 'emergency';
  const watchList = (t('result.redFlags', { returnObjects: true }) as string[]).map(String);

  return (
    <div className="page">
      {isEmergency ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Banner tone="strong" icon={<IconAlert size={18} />}>
            <strong>{t('result.emergencyBanner')}</strong>
          </Banner>
        </div>
      ) : null}

      <div className={`risk-panel risk-${level}`}>
        <div className="risk-panel-head">
          <span className="eyebrow" style={{ color: 'inherit', opacity: 0.8 }}>
            {t('result.yourRisk')}
          </span>
          <div className="row row-wrap" style={{ justifyContent: 'space-between', marginTop: 'var(--sp-2)' }}>
            <span className="risk-level">{t(`result.levels.${level}.short`)}</span>
            <RiskPill level={level} label={t(`result.levels.${level}.label`)} />
          </div>
        </div>

        <div className="risk-panel-body stack">
          <p style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)' }}>
            {t(`result.levels.${level}.headline`)}
          </p>

          <div>
            <span className="eyebrow">{t('result.actionTitle')}</span>
            <ol className="stack stack-sm" style={{ marginTop: 'var(--sp-3)', counterReset: 'step' }}>
              {(t(`result.levels.${level}.actions`, { returnObjects: true }) as string[]).map((a, i) => (
                <li key={i} className="row" style={{ alignItems: 'flex-start' }}>
                  <span
                    className="tnum"
                    aria-hidden="true"
                    style={{
                      flex: 'none',
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      background: 'var(--sunken)',
                      color: 'var(--ink-2)',
                      fontSize: 11,
                      fontWeight: 700,
                      display: 'grid',
                      placeItems: 'center',
                      marginTop: 2,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span className="small">{String(a)}</span>
                </li>
              ))}
            </ol>
          </div>

          {result.environmental ? (
            <RiskRibbon level={result.environmental}>
              <div className="small">
                <strong>{t('result.riskInArea')}:</strong>{' '}
                {t(`result.levels.${result.environmental}.label`)}
                {!result.climateLive ? <span className="muted"> — {t('result.offlineNotice')}</span> : null}
              </div>
            </RiskRibbon>
          ) : null}

          {isEmergency || level === 'high' ? (
            <div>
              <span className="eyebrow">{t('result.watchTitle')}</span>
              <p className="small muted" style={{ marginTop: 'var(--sp-1)' }}>{t('result.watchBody')}</p>
              <ul className="stack stack-sm" style={{ marginTop: 'var(--sp-2)' }}>
                {watchList.map((f, i) => (
                  <li key={i} className="row small" style={{ alignItems: 'flex-start' }}>
                    <span aria-hidden="true" style={{ color: 'var(--risk-emergency)' }}>•</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <div className="section stack">
        {onBack ? (
          <button className="btn btn-ghost btn-block" onClick={onBack}>
            <IconArrow size={15} /> {t('common.back')}
          </button>
        ) : null}
        <button className="btn btn-primary btn-block" onClick={() => setTab('report')}>
          <IconShield size={17} /> {t('result.reportThis')}
        </button>
        <button className="btn btn-secondary btn-block" onClick={onReset}>
          {t('result.checkAnother')}
        </button>

        <Banner tone="warn" icon={<IconAlert size={16} />}>
          {t('result.disclaimer')}
        </Banner>

        {answer.ageGroup === 'child' && !isEmergency ? (
          <p className="small muted">
            {t('assess.childNote')}
          </p>
        ) : null}
      </div>
    </div>
  );
}