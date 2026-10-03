import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import type { RiskLevel } from '../lib/redflags';

/* ==========================================================================
   Shared primitives. Deliberately small: this app has a handful of repeated
   surfaces and naming them directly keeps the markup legible.
   ========================================================================== */

export function RiskPill({ level, label }: { level: RiskLevel; label: string }) {
  return (
    <span className={`risk-pill risk-${level}`}>
      <span className="risk-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * The signature element: a 4px ribbon in the level's colour. Repeated beside
 * every risk-bearing surface so severity is readable without processing the
 * words or the numbers.
 */
export function RiskRibbon({ level, children, className = '' }: { level: RiskLevel; children: ReactNode; className?: string }) {
  return (
    <div className={`risk-ribbon risk-${level} ${className}`}>{children}</div>
  );
}

export function Banner({
  tone = 'warn',
  icon,
  children,
}: {
  tone?: 'warn' | 'strong' | 'info';
  icon?: ReactNode;
  children: ReactNode;
}) {
  const cls = tone === 'strong' ? 'banner banner-strong' : tone === 'info' ? 'banner banner-info' : 'banner';
  return (
    <div className={cls} role={tone === 'strong' ? 'alert' : undefined}>
      {icon ? <span className="banner-icon" aria-hidden="true">{icon}</span> : null}
      <div>{children}</div>
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="stat">
      <span className="stat-value tnum">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Bottom sheet. Handles Escape, backdrop dismissal, background scroll lock, and
 * focus containment so keyboard and screen-reader users are not stranded behind
 * the overlay.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={panelRef}
      >
        <div className="sheet-inner">
          <div className="sheet-grip" aria-hidden="true" />
          <div className="card-row-between" style={{ marginBottom: 'var(--sp-4)' }}>
            <h2 id={titleId} className="card-title">
              {title}
            </h2>
            <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          {children}
        </div>
      </div>
    </>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="empty">
      <p className="strong">{title}</p>
      {body ? <p className="small" style={{ marginTop: 'var(--sp-2)' }}>{body}</p> : null}
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: string }) {
  return <div className="skeleton" style={{ height, width }} />;
}

/* --- Minimal inline icons -------------------------------------------------
   Hand-rolled rather than an icon package: this app needs nine glyphs, and the
   bundle saving matters more on a 2G connection than the convenience. */

type IconProps = { size?: number; className?: string };

const svg = (d: ReactNode, { size = 20, className = '' }: IconProps, label?: string) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden={label ? undefined : true}
    role={label ? 'img' : undefined}
  >
    {label ? <title>{label}</title> : null}
    {d}
  </svg>
);

export const IconCheck = (p: IconProps) =>
  svg(<><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>, p);

export const IconReport = (p: IconProps) =>
  svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6" /></>, p);

export const IconMap = (p: IconProps) =>
  svg(<><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15M15 6v15" /></>, p);

export const IconAlert = (p: IconProps) =>
  svg(<><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>, p);

export const IconArrow = (p: IconProps) => svg(<><path d="M5 12h14M13 6l6 6-6 6" /></>, p);

export const IconShield = (p: IconProps) =>
  svg(<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></>, p);

export const IconInfo = (p: IconProps) =>
  svg(<><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>, p);

export const IconSend = (p: IconProps) => svg(<><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></>, p);

export const IconTrend = (p: IconProps) =>
  svg(<><path d="M22 7 13.5 15.5 8.5 10.5 2 17" /><path d="M16 7h6v6" /></>, p);

export const IconAward = (p: IconProps) =>
  svg(<><circle cx="12" cy="8" r="6" /><path d="M8.2 13.2 7 22l5-3 5 3-1.2-8.8" /></>, p);

export const IconGlobe = (p: IconProps) =>
  svg(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" /></>, p);

export const IconPhone = (p: IconProps) =>
  svg(<><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.8 2z" /></>, p);