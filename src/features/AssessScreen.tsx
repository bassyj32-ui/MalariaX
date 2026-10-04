import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { Banner, Card, IconAlert, IconArrow, IconBack, IconInfo, IconPhone, IconShield, RiskRibbon } from '../components/ui';
import { CareSheet } from './CareSheet';
import { getClimate } from '../lib/climate';
import { REGIONS, findRegion } from '../lib/geo';
import { evaluateRedFlags, isEmpty, SYMPTOM_IDS, type Severity, type SymptomId } from '../lib/redflags';
import { assess, type ClimateInput } from '../lib/risk';
import { useApp, type AgeGroup } from '../store/app';

const SEVERITIES: readonly Severity[] = ['none', 'mild', 'moderate', 'severe'] as const;

const DURATIONS: readonly number[] = [0, 1, 2, 3, 4, 7, 14];

/**
 * Neutral climate used for the instant, offline-first verdict. When no region is
 * selected the environmental term is not applied at all — this placeholder only
 * has to satisfy the signature, and `assess` ignores it for `region: null`.
 */
const OFFLINE_CLIMATE: ClimateInput = {
  rainfallMm: 0,
  rainfallNormMm: 0,
  tempAvgC: 25,
  humidityPct: 50,
  caseRatePer100k: 0,
};

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

    // The clinical verdict is computed and shown IMMEDIATELY, with no network
    // involved. This is deliberate: it is the decision that matters, it comes
    // from the rule engine, and making someone wait on a weather API to learn
    // whether they need to walk to a clinic is unacceptable — especially on the
    // slow connections this app targets.
    const clinical = assess({
      region: null,
      climate: OFFLINE_CLIMATE,
      clinical: redFlags.level,
      forcedEmergency: redFlags.forcedEmergency,
    });

    setResult({
      level: clinical.level,
      forcedEmergency: clinical.forcedEmergency,
      environmental: null,
      climateLive: false,
      at: Date.now(),
    });
    setBusy(true);

    // Then refine with the environmental band, which is context rather than
    // triage. If this never resolves, the result the user already has is still
    // correct and complete enough to act on.
    const region = findRegion(answer.regionCode);
    if (region) {
      try {
        const climate = await getClimate(region.code, 0);
        const refined = assess({
          region,
          climate,
          clinical: redFlags.level,
          forcedEmergency: redFlags.forcedEmergency,
        });
        setResult((prev) =>
          prev
            ? {
                ...prev,
                level: refined.level,
                environmental: refined.environmental?.level ?? null,
                climateLive: climate.live,
              }
            : prev,
        );
      } catch {
        // Leave the instant verdict in place.
      } finally {
        setBusy(false);
      }
    } else {
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
          <button className="btn btn-ghost btn-sm" onClick={resetAnswer}>
            {t('assess.reset')}
          </button>
        </div>

        <div className="symptom-list">
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
  const isDanger = id === 'vomiting' || id === 'weakness';

  return (
    <div className="symptom" data-danger={isDanger} data-set={value !== 'none'}>
      <div className="symptom-head">
        <span className="symptom-name">{label}</span>
        {/* Only shown once something is actually selected. Echoing "None" on all
            eight rows up front reads as noise and implies the user has already
            answered every question, which they have not. */}
        {value === 'none' ? null : <span className={`symptom-state sev-${value}`}>{t(`assess.severity.${value}`)}</span>}
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
      {isDanger ? <p className="symptom-note">{t('assess.dangerNote')}</p> : null}
    </div>
  );
}

/* ==========================================================================
   Result view
   ========================================================================== */

function ResultView({ onReset, onBack }: { onReset: () => void; onBack?: () => void }) {
  const { t } = useTranslation();
  const { result, answer, setTab } = useApp();
  const [careOpen, setCareOpen] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  // The form is a long page. When it is replaced by the result, the viewport is
  // still scrolled down where the submit button was, which hides the verdict
  // under the sticky header — so a user with an EMERGENCY result would land on
  // the middle of the danger-sign list instead of the verdict itself. Always
  // jump to the top when the result appears.
  useEffect(() => {
    // Guarded: scrollIntoView is absent on some older Android WebViews, which
    // are a large share of the devices this app targets. Losing the scroll reset
    // is survivable; throwing during render is not.
    if (typeof topRef.current?.scrollIntoView === 'function') {
      topRef.current.scrollIntoView({ block: 'start' });
    }
    window.scrollTo(0, 0);
  }, []);

  if (!result) return null;

  const level = result.level;
  const isEmergency = level === 'emergency';
  const isHigh = level === 'high';
  const watchList = (t('result.redFlags', { returnObjects: true }) as string[]).map(String);
  const actions = (t(`result.levels.${level}.actions`, { returnObjects: true }) as string[]).map(String);

  return (
    <div className="page">
      <div ref={topRef} />
      {isEmergency ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Banner tone="strong" icon={<IconAlert size={18} />}>
            <strong>{t('result.emergencyBanner')}</strong>
          </Banner>
        </div>
      ) : null}

      <div className={`risk-panel risk-${level}`}>
        <div className="risk-panel-head">
          <span className="eyebrow" style={{ color: 'inherit', opacity: 0.75 }}>
            {t('result.yourRisk')}
          </span>
          {/* The band name is already set in 32px monospace directly below. A
              pill repeating "Emergency" next to a giant EMERGENCY is noise, and
              this is the screen with the least room to waste. */}
          <div className="risk-level" style={{ marginTop: 'var(--sp-2)' }}>
            {t(`result.levels.${level}.short`)}
          </div>
        </div>

        <div className="risk-panel-body stack">
          {/* On the two serious bands the alert banner above already carries
              this exact sentence. Repeating it wastes the most valuable space
              on the screen, so it is shown only where the banner is absent. */}
          {isEmergency ? null : (
            <p style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)' }}>
              {t(`result.levels.${level}.headline`)}
            </p>
          )}

          <div>
            <span className="eyebrow">{t('result.actionTitle')}</span>
            <ol className="stack stack-sm" style={{ marginTop: 'var(--sp-3)', counterReset: 'step' }}>
              {actions.map((a, i) => (
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
            <IconBack size={15} /> {t('common.back')}
          </button>
        ) : null}

        {/* The single most useful action on a serious result, given first and
            given real weight. It was the most obviously missing thing in the
            first pass: the app gave advice and then stopped, exactly where the
            user needs the most help. */}
        {isEmergency || isHigh ? (
          <button className="btn btn-danger btn-block" onClick={() => setCareOpen(true)}>
            <IconPhone size={17} /> {t('result.findCare')}
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
          <p className="small muted">{t('assess.childNote')}</p>
        ) : null}
      </div>

      <CareSheet open={careOpen} onClose={() => setCareOpen(false)} level={level} />
    </div>
  );
}