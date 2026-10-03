import { lazy, Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AssessScreen } from './features/AssessScreen';
import { AskScreen } from './features/AskScreen';
import { ReportScreen } from './features/ReportScreen';
import { Banner, Card, IconArrow, IconAward, IconCheck, IconMap, IconReport, IconShield, Skeleton } from './components/ui';
import { TopBar } from './components/TopBar';
import { pendingCount, startAutoSync, syncQueue } from './lib/offline';
import { useApp, type TabKey } from './store/app';
import './styles/global.css';

/**
 * The Data tab pulls in the Supabase client, which is the heaviest dependency in
 * the app. Most sessions only ever check symptoms, so it is split out and fetched
 * on first visit rather than on first paint.
 */
const DashboardScreen = lazy(() =>
  import('./features/DashboardScreen').then((m) => ({ default: m.DashboardScreen })),
);

const TABS: { key: TabKey; icon: typeof IconCheck; labelKey: string }[] = [
  { key: 'check', icon: IconCheck, labelKey: 'nav.check' },
  { key: 'report', icon: IconReport, labelKey: 'nav.report' },
  { key: 'dashboard', icon: IconMap, labelKey: 'nav.dashboard' },
];

export default function App() {
  const { t } = useTranslation();
  const { tab, setTab, online, setOnline, queued, setQueued } = useApp();

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [setOnline]);

  useEffect(() => {
    const stop = startAutoSync();
    void pendingCount().then(setQueued);
    void syncQueue().then((r) => setQueued(Math.max(r.failed, 0)));
    return stop;
  }, [setQueued]);

  return (
    <div className="shell">
      <TopBar />
      <main id="main">
        {tab === 'check' ? <CheckTab /> : null}
        {tab === 'report' ? <ReportScreen /> : null}
        {tab === 'dashboard' ? (
          <Suspense
            fallback={
              <div className="page stack stack-sm">
                <Skeleton height={64} />
                <Skeleton height={180} />
              </div>
            }
          >
            <DashboardScreen />
          </Suspense>
        ) : null}
      </main>

      <nav className="tabbar" aria-label={t('app.name')}>
        <div className="tabbar-inner">
          {TABS.map(({ key, icon: Icon, labelKey }) => (
            <button
              key={key}
              className="tab"
              role="tab"
              aria-selected={tab === key}
              aria-controls="main"
              onClick={() => setTab(key)}
            >
              <Icon size={21} className="tab-icon" />
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </div>
      </nav>

      {!online ? (
        <div style={{ position: 'fixed', bottom: 'calc(var(--tabbar-h) + var(--safe-b))', left: 0, right: 0, zIndex: 35, padding: '0 var(--sp-4)' }}>
          <Banner tone="info" icon={<IconShield size={16} />}>
            {queued > 0
              ? `${t('common.offline')} · ${queued} ${t('badges.reports')} — ${t('report.successQueued')}`
              : t('common.offlineBody')}
          </Banner>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The Check tab is a launcher rather than a bare form: someone arriving with a
 * fever and a question should be able to tell which of the three things they
 * need without reading a page of explanation first. From there it branches into
 * the symptom checker or the question assistant, both of which stay inside this
 * tab so the bottom bar never shifts under the thumb.
 *
 * The sub-view lives in the store, not local state, so switching to the Data tab
 * and back does not discard a half-filled symptom form.
 */
function CheckTab() {
  const { t } = useTranslation();
  const { setTab, progress, checkView, setCheckView } = useApp();

  if (checkView === 'assess') {
    return (
      <div className="view-enter">
        <div className="page" style={{ paddingBottom: 0 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setCheckView('home')}>
            <IconArrow size={14} /> {t('common.back')}
          </button>
        </div>
        <AssessScreen onBack={() => setCheckView('home')} />
      </div>
    );
  }

  if (checkView === 'ask') {
    return (
      <div className="view-enter">
        <div className="page" style={{ paddingBottom: 0 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setCheckView('home')}>
            <IconArrow size={14} /> {t('common.back')}
          </button>
        </div>
        <AskScreen />
      </div>
    );
  }

  return (
    <div className="page view-enter">
      <header className="page-head">
        <h1 className="page-title">
          {t('home.greeting')} · {t('app.name')}
        </h1>
        <p className="page-sub">{t('home.subtitle')}</p>
      </header>

      <div className="stack">
        <LaunchCard
          icon={<IconShield size={18} />}
          title={t('home.checkSelf')}
          body={t('home.checkSelfBody')}
          onClick={() => setCheckView('assess')}
        />
        <LaunchCard
          icon={<IconCheck size={18} />}
          title={t('home.askQuestion')}
          body={t('home.askQuestionBody')}
          onClick={() => setCheckView('ask')}
        />
        <LaunchCard
          icon={<IconReport size={18} />}
          title={t('home.reportCase')}
          body={t('home.reportCaseBody')}
          onClick={() => setTab('report')}
        />
        <LaunchCard
          icon={<IconMap size={18} />}
          title={t('home.checkArea')}
          body={t('home.checkAreaBody')}
          onClick={() => setTab('dashboard')}
        />
      </div>

      <section className="section">
        <Card>
          <div className="card-row-between">
            <div className="row">
              <IconAward size={17} />
              <span className="card-title">{t('home.yourBadges')}</span>
            </div>
            <span className="xs muted">{progress.points} {t('badges.points')}</span>
          </div>
          <div className="stat-grid" style={{ marginTop: 'var(--sp-4)' }}>
            <div className="stat">
              <span className="stat-value tnum">{progress.reportsCount}</span>
              <span className="stat-label">{t('badges.reports')}</span>
            </div>
            <div className="stat">
              <span className="stat-value tnum">{progress.currentStreak}</span>
              <span className="stat-label">{t('badges.streak')}</span>
            </div>
            <div className="stat">
              <span className="stat-value tnum">{progress.badges.length}</span>
              <span className="stat-label">{t('badges.earned')}</span>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}

function LaunchCard({
  icon,
  title,
  body,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button className="card card-row-between" style={{ width: '100%', textAlign: 'start', cursor: 'pointer' }} onClick={onClick}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span style={{ color: 'var(--brand)', marginTop: 2 }}>{icon}</span>
        <div>
          <div className="card-title">{title}</div>
          <p className="card-body">{body}</p>
        </div>
      </div>
      <IconArrow size={16} />
    </button>
  );
}