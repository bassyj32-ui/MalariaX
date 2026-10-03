import { useTranslation } from 'react-i18next';
import { Banner, Card, IconPhone, Sheet } from '../components/ui';
import type { RiskLevel } from '../lib/redflags';

interface CareSheetProps {
  open: boolean;
  onClose: () => void;
  level: RiskLevel;
}

/**
 * What to do when someone needs care NOW.
 *
 * This exists because the highest-value action on a high or emergency result was
 * missing: telling someone where to go and how to get there. Without it the app
 * gave advice and then stopped, which is the exact point at which a user needs
 * the most help.
 *
 * HONESTY NOTE: MalariaX has no verified dataset of Ethiopian health facilities,
 * so this sheet does not pretend to show one. It gives the emergency number, what
 * to bring, and what to say — the things that are reliably true everywhere — and
 * it tells the user to ask locally. Shipping a fabricated clinic list would be
 * worse than shipping none.
 *
 * NOTE: 991 is Ethiopia's ambulance line. Verify and localise before launch;
 * see the "Before launch" checklist in the README.
 */
export function CareSheet({ open, onClose, level }: CareSheetProps) {
  const { t } = useTranslation();
  const urgent = level === 'emergency' || level === 'high';

  return (
    <Sheet open={open} onClose={onClose} title={t('result.findCare')}>
      <div className="stack">
        {urgent ? (
          <Banner tone="strong" icon={<IconPhone size={17} />}>
            <strong>{t('result.emergencyBanner')}</strong>
          </Banner>
        ) : null}

        <a className="btn btn-danger btn-block" href="tel:991">
          <IconPhone size={17} /> {t('care.callAmbulance')}
        </a>

        <Card>
          <span className="eyebrow">{t('care.bringTitle')}</span>
          <ul className="stack stack-sm" style={{ marginTop: 'var(--sp-3)' }}>
            {(t('care.bring', { returnObjects: true }) as string[]).map((b, i) => (
              <li key={i} className="row small" style={{ alignItems: 'flex-start' }}>
                <span aria-hidden="true" style={{ color: 'var(--brand)' }}>•</span>
                <span>{String(b)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <span className="eyebrow">{t('care.sayTitle')}</span>
          <p className="card-body">{t('care.sayBody')}</p>
        </Card>

        <Card>
          <span className="eyebrow">{t('care.localTitle')}</span>
          <p className="card-body">{t('care.localBody')}</p>
        </Card>

        <p className="xs muted center">{t('result.disclaimer')}</p>
      </div>
    </Sheet>
  );
}