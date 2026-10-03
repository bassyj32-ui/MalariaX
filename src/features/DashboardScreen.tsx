import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { Card, Empty, IconInfo, IconMap, IconTrend, RiskPill, Sheet } from '../components/ui';
import { REGIONS, REGION_GRID_POSITION, findRegion, seasonForMonth } from '../lib/geo';
import type { RiskLevel } from '../lib/redflags';
import { enrichWithLiveClimate, estimateAllRegions, rankByRisk, type RegionRisk } from '../lib/regionalRisk';
import { fetchRegionRisk, isSupabaseConfigured, type RegionRiskRow } from '../lib/supabase';

const RISK_ORDER: readonly RiskLevel[] = ['low', 'moderate', 'high', 'emergency'] as const;

function regionName(code: string): string {
  const r = findRegion(code);
  if (!r) return code;
  return i18n.language?.startsWith('am') ? r.nameAm : r.nameEn;
}

/**
 * Regional risk cartogram.
 *
 * NOT a map of Ethiopia's borders, on purpose:
 *
 *  1. Administrative divisions have been restructured repeatedly (Sidama 2020;
 *     Central, South and Southwest Ethiopia 2021-2023). Drawing boundaries from
 *     a possibly-stale dataset onto a health dashboard would tell someone a
 *     woreda is somewhere it is not, and someone would act on it.
 *  2. A tiled real map needs ~40MB of tiles and a live connection. A cartogram
 *     is ~1KB of geometry, renders instantly and works offline — which is the
 *     condition that matters most for the intended users.
 *
 * Each region is a tile positioned roughly geographically, so the
 * highland-core vs hot-western-lowland story still reads. No area encodes
 * magnitude, for the same reason census cartograms standardise every unit.
 */
function RegionGrid({
  risks,
  onSelect,
}: {
  risks: Map<string, RegionRisk>;
  onSelect: (code: string) => void;
}) {
  const { t } = useTranslation();
  const am = i18n.language?.startsWith('am');

  return (
    <div className="map-grid" role="group" aria-label={t('a11y.regionMap')}>
      {REGIONS.map((r) => {
        const risk = risks.get(r.code);
        const level = risk?.level;
        const pos = REGION_GRID_POSITION[r.code] ?? { col: 1, row: 1 };
        return (
          <button
            key={r.code}
            type="button"
            className={`map-cell${level ? ` risk-${level}` : ' map-cell-unknown'}`}
            style={{ gridColumn: pos.col, gridRow: pos.row }}
            onClick={() => onSelect(r.code)}
            aria-label={t('a11y.selectedRegion', {
              name: am ? r.nameAm : r.nameEn,
              level: level ? t(`result.levels.${level}.short`) : '—',
            })}
          >
            <span className="map-cell-name">{am ? r.nameAm : r.nameEn}</span>
          </button>
        );
      })}
    </div>
  );
}

export function DashboardScreen() {
  const { t } = useTranslation();
  const [risks, setRisks] = useState<Map<string, RegionRisk>>(() => estimateAllRegions());
  const [open, setOpen] = useState<string | null>(null);
  const [communityCounts, setCommunityCounts] = useState<Map<string, number>>(new Map());
  const [refining, setRefining] = useState(true);
  const abort = useRef<AbortController | null>(null);

  // Paint happens synchronously in the useState initialiser above: the map is
  // never blank and never waits on a network call. Weather and community data
  // then refine it in place.
  useEffect(() => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;

    void enrichWithLiveClimate(REGIONS, {
      signal: ctrl.signal,
      onUpdate: (code, risk) => {
        setRisks((prev) => new Map(prev).set(code, risk));
      },
    }).finally(() => {
      if (!ctrl.signal.aborted) setRefining(false);
    });

    // Optional. If a backend exists, its community counts sharpen the estimate.
    if (isSupabaseConfigured) {
      void fetchRegionRisk()
        .then((rows: RegionRiskRow[]) => {
          if (ctrl.signal.aborted) return;
          const counts = new Map<string, number>();
          for (const row of rows) {
            if (!row.suppressed && row.report_count != null) counts.set(row.region_code, row.report_count);
          }
          setCommunityCounts(counts);
        })
        .catch(() => {
          /* optional enrichment; the map stands on its own without it */
        });
    }

    return () => ctrl.abort();
  }, []);

  const ranked = useMemo(() => rankByRisk(risks.values(), 5), [risks]);

  const national = useMemo<RiskLevel>(() => {
    if (!ranked.length) return 'low';
    const mean = ranked.reduce((s, r) => s + r.score, 0) / ranked.length;
    if (mean < 0.25) return 'low';
    if (mean < 0.5) return 'moderate';
    if (mean < 0.75) return 'high';
    return 'emergency';
  }, [ranked]);

  const season = seasonForMonth(new Date().getMonth() + 1);
  const hasCommunity = communityCounts.size > 0;

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">{t('dashboard.title')}</h1>
        <p className="page-sub">{t('dashboard.subtitle')}</p>
      </header>

      <Card>
        <div className="card-row-between">
          <div>
            <span className="eyebrow">{t('dashboard.nationalSummary')}</span>
            <div style={{ marginTop: 'var(--sp-2)' }}>
              <RiskPill level={national} label={t(`result.levels.${national}.label`)} />
            </div>
          </div>
          <IconMap size={26} />
        </div>
        <p className="card-body">
          <IconInfo size={13} />{' '}
          {refining ? t('dashboard.provenance.estimating') : hasCommunity ? t('dashboard.provenance.live') : t('dashboard.provenance.estimated')}
        </p>
      </Card>

      <Card className="section">
        <div className="card-row" style={{ marginBottom: 'var(--sp-3)' }}>
          <IconInfo size={16} />
          <span className="card-title">{t(`dashboard.season.${season.key}`)}</span>
        </div>
        <p className="card-body">{t(`dashboard.season.${season.key}Body`)}</p>
      </Card>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">{t('dashboard.selectRegion')}</span>
          <div className="row" style={{ gap: 6 }}>
            {RISK_ORDER.map((l) => (
              <span key={l} className={`risk-dot risk-${l}`} title={t(`result.levels.${l}.label`)} />
            ))}
          </div>
        </div>

        <RegionGrid risks={risks} onSelect={setOpen} />
      </section>

      {ranked.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <span className="eyebrow">
              <IconTrend size={13} /> {t('dashboard.topRegions')}
            </span>
          </div>
          <div className="stack stack-sm">
            {ranked.map((r) => (
              <button
                key={r.code}
                type="button"
                className="card row card-row-between"
                style={{ width: '100%', textAlign: 'start', cursor: 'pointer' }}
                onClick={() => setOpen(r.code)}
              >
                <span className="strong small">{regionName(r.code)}</span>
                <RiskPill level={r.level} label={t(`result.levels.${r.level}.short`)} />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <Sheet open={open !== null} onClose={() => setOpen(null)} title={t('dashboard.riskNow')}>
        {open ? (
          <RegionDetail
            code={open}
            risk={risks.get(open) ?? null}
            communityCount={communityCounts.get(open) ?? null}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

function RegionDetail({ code, risk, communityCount }: { code: string; risk: RegionRisk | null; communityCount: number | null }) {
  const { t } = useTranslation();
  const am = i18n.language?.startsWith('am');
  const region = findRegion(code);
  const name = region ? (am ? region.nameAm : region.nameEn) : code;
  const prep = ['prepNets', 'prepDrain', 'prepKnow'] as const;

  return (
    <div className="stack">
      <div className="card-row-between">
        <h3 style={{ fontSize: 'var(--text-lg)' }}>{name}</h3>
        {risk ? <RiskPill level={risk.level} label={t(`result.levels.${risk.level}.short`)} /> : null}
      </div>

      {!risk ? (
        <Empty title={t('dashboard.noData')} body={t('dashboard.noDataBody')} />
      ) : (
        <>
          <Card>
            <span className="eyebrow">{t('dashboard.riskNow')}</span>
            <div className="stat-grid" style={{ marginTop: 'var(--sp-3)' }}>
              <div className="stat">
                <span className="stat-value tnum">{Math.round(risk.score * 100)}</span>
                <span className="stat-label">{t('dashboard.riskIndex')}</span>
              </div>
              <div className="stat">
                <span className="stat-value tnum">{risk.breakdown ? Math.round(risk.breakdown.parts.temperature * 100) : 0}</span>
                <span className="stat-label">{t('dashboard.driverTempShort')}</span>
              </div>
              <div className="stat">
                <span className="stat-value tnum">{risk.breakdown ? Math.round(risk.breakdown.parts.elevation * 100) : 0}</span>
                <span className="stat-label">{t('dashboard.driverElevShort')}</span>
              </div>
            </div>
            <p className="card-body">
              {risk.live ? t('dashboard.provenance.live') : t('dashboard.provenance.estimated')}
            </p>
          </Card>

          {communityCount != null ? (
            <Card>
              <div className="card-row-between">
                <span className="small muted">{t('dashboard.reportsHere')}</span>
                <span className="strong tnum">{communityCount}</span>
              </div>
            </Card>
          ) : null}

          <div>
            <span className="eyebrow">{t('dashboard.prepare')}</span>
            <ul className="stack stack-sm" style={{ marginTop: 'var(--sp-3)' }}>
              {prep.map((k) => (
                <li key={k} className="small">
                  • {t(`dashboard.${k}`)}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}