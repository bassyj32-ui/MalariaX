import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { Card, Empty, IconInfo, IconMap, IconTrend, RiskPill, Sheet, Skeleton } from '../components/ui';
import { REGIONS, REGION_GRID_POSITION, seasonForMonth } from '../lib/geo';
import type { RiskLevel } from '../lib/redflags';
import { fetchRegionRisk, isSupabaseConfigured, type RegionRiskRow } from '../lib/supabase';

const RISK_ORDER: RiskLevel[] = ['low', 'moderate', 'high', 'emergency'];

/**
 * Regional risk cartogram.
 *
 * This is deliberately NOT a map of Ethiopia's borders.
 *
 * Two reasons, one ethical and one practical:
 *
 *  1. Ethiopia's administrative divisions have been repeatedly restructured
 *     (Sidama 2020, Central / South / Southwest Ethiopia 2021-2023). Drawing
 *     boundaries from an out-of-date dataset onto a health dashboard would
 *     misrepresent where a woreda is, and someone would act on it.
 *  2. A tile-based real map would need ~40MB of tiles and a live connection.
 *     A cartogram is ~1KB of geometry, renders instantly, and works offline —
 *     which is the condition that matters most for the intended users.
 *
 * Each region is a tile positioned to approximate its real relative location, so
 * the spatial story (highland core vs hot western lowlands) still reads
 * correctly. Tiles are sized by nothing and coloured only by risk, so no
 * magnitude is implied by area — the same reason census cartograms standardise
 * every unit.
 *
 * Swapping in verified GeoJSON later is a drop-in change to this component: the
 * contract is a region code, a risk level, and an onSelect callback.
 */
function RegionGrid({
  riskByCode,
  onSelect,
}: {
  riskByCode: Map<string, RegionRiskRow>;
  onSelect: (code: string) => void;
}) {
  const { t } = useTranslation();
  const am = i18n.language?.startsWith('am');

  return (
    <div
      className="map-grid"
      role="group"
      aria-label={t('a11y.regionMap')}
    >
      {REGIONS.map((r) => {
        const row = riskByCode.get(r.code);
        const level = row?.risk_level;
        const suppressed = row?.suppressed ?? false;
        const pos = REGION_GRID_POSITION[r.code] ?? { col: 1, row: 1 };
        return (
          <button
            key={r.code}
            type="button"
            className={`map-cell${level ? ` risk-${level}` : ' map-cell-unknown'}${suppressed ? ' map-cell-suppressed' : ''}`}
            style={{ gridColumn: pos.col, gridRow: pos.row }}
            onClick={() => onSelect(r.code)}
            aria-label={t('a11y.selectedRegion', {
              name: am ? r.nameAm : r.nameEn,
              level: level ? t(`result.levels.${level}.short`) : '—',
            })}
          >
            <span className="map-cell-name">{am ? r.nameAm : r.nameEn}</span>
            {suppressed ? <span className="map-cell-mark" aria-hidden="true">·</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function DashboardScreen() {
  const { t } = useTranslation();
  const am = i18n.language?.startsWith('am');
  const [rows, setRows] = useState<RegionRiskRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!isSupabaseConfigured) {
      setFailed(true);
      return;
    }
    fetchRegionRisk()
      .then((data) => {
        if (alive) setRows(data);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const byCode = useMemo(() => new Map((rows ?? []).map((r) => [r.region_code, r])), [rows]);

  const ranked = useMemo(
    () =>
      [...(rows ?? [])]
        .filter((r) => !r.suppressed)
        .sort((a, b) => Number(b.risk_score) - Number(a.risk_score)),
    [rows],
  );

  const national = useMemo<RiskLevel>(() => {
    if (!ranked.length) return 'low';
    const total = ranked.reduce((sum, r) => sum + Number(r.risk_score), 0) / ranked.length;
    return RISK_ORDER.find((l, i) => {
      const next = RISK_ORDER[i + 1];
      if (!next) return false;
      const cuts = { low: 0.25, moderate: 0.5, high: 0.75, emergency: 1.01 } as const;
      return total < cuts[l];
    }) ?? 'emergency';
  }, [ranked]);

  const season = seasonForMonth(new Date().getMonth() + 1);

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

        {rows === null && !failed ? (
          <div className="stack stack-sm">
            <Skeleton height={96} />
            <Skeleton height={96} />
          </div>
        ) : failed ? (
          <Empty title={t('common.offline')} body={t('common.offlineBody')} />
        ) : (
          <RegionGrid riskByCode={byCode} onSelect={setOpen} />
        )}
      </section>

      {ranked.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <span className="eyebrow">
              <IconTrend size={13} /> {t('dashboard.topRegions')}
            </span>
          </div>
          <div className="stack stack-sm">
            {ranked.slice(0, 5).map((r) => {
              const region = REGIONS.find((x) => x.code === r.region_code);
              return (
                <button
                  key={r.region_code}
                  type="button"
                  className="card row card-row-between"
                  style={{ width: '100%', textAlign: 'start', cursor: 'pointer' }}
                  onClick={() => setOpen(r.region_code)}
                >
                  <span className="strong small">{region ? (am ? region.nameAm : region.nameEn) : r.region_code}</span>
                  <RiskPill level={r.risk_level} label={t(`result.levels.${r.risk_level}.short`)} />
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <Sheet open={open !== null} onClose={() => setOpen(null)} title={t('dashboard.riskNow')}>
        {open ? <RegionDetail code={open} row={byCode.get(open)} /> : null}
      </Sheet>
    </div>
  );
}

function RegionDetail({ code, row }: { code: string; row: RegionRiskRow | undefined }) {
  const { t } = useTranslation();
  const am = i18n.language?.startsWith('am');
  const region = REGIONS.find((r) => r.code === code);
  const name = region ? (am ? region.nameAm : region.nameEn) : code;

  const drivers: string[] = Array.isArray(row?.drivers) ? row!.drivers : [];
  const prep = ['prepNets', 'prepDrain', 'prepKnow'] as const;

  return (
    <div className="stack">
      <div className="card-row-between">
        <h3 style={{ fontSize: 'var(--text-lg)' }}>{name}</h3>
        {row && !row.suppressed ? <RiskPill level={row.risk_level} label={t(`result.levels.${row.risk_level}.short`)} /> : null}
      </div>

      {!row ? (
        <Empty title={t('dashboard.noData')} body={t('dashboard.noDataBody')} />
      ) : row.suppressed ? (
        <Empty title={t('dashboard.suppressed')} body={t('dashboard.suppressedBody')} />
      ) : (
        <>
          <Card>
            <div className="card-row-between">
              <span className="small muted">{t('dashboard.reportsHere')}</span>
              <span className="strong tnum">{row.report_count ?? 0}</span>
            </div>
            {row.rainfall_mm != null ? (
              <div className="card-row-between">
                <span className="small muted">{t('dashboard.trends')}</span>
                <span className="strong tnum">
                  {Math.round(Number(row.rainfall_mm))} / {Math.round(Number(row.rainfall_norm_mm ?? 0))} mm
                </span>
              </div>
            ) : null}
          </Card>

          {drivers.length > 0 ? (
            <div>
              <span className="eyebrow">{t('dashboard.drivers')}</span>
              <ul className="stack stack-sm" style={{ marginTop: 'var(--sp-3)' }}>
                {drivers.map((d, i) => (
                  <li key={i} className="small">
                    • {t(`dashboard.${d}`, { defaultValue: d })}
                  </li>
                ))}
              </ul>
            </div>
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