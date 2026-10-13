import type { FC } from 'react';

interface StatsBarProps {
  total: number;
  accepted: number;
  rejected: number;
  inFlight: number;
}

export const StatsBar: FC<StatsBarProps> = ({ total, accepted, rejected, inFlight }) => {
  const settled = accepted + rejected;
  const passRate = settled > 0 ? Math.round((accepted / settled) * 100) : 0;

  return (
    <div className="stats-bar" aria-label="Upload statistics overview">
      <div className="stat-card">
        <div className="stat-value">{total}</div>
        <div className="stat-label">Total Uploaded</div>
      </div>
      <div className="stat-card">
        <div className="stat-value" style={{ color: 'var(--color-processing)' }}>
          {inFlight}
        </div>
        <div className="stat-label">In-Flight / Verifying</div>
      </div>
      <div className="stat-card">
        <div className="stat-value" style={{ color: 'var(--color-success)' }}>
          {accepted}
        </div>
        <div className="stat-label">Accepted Quality</div>
      </div>
      <div className="stat-card">
        <div className="stat-value" style={{ color: 'var(--color-error)' }}>
          {rejected}
        </div>
        <div className="stat-label">Rejected Gate</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{settled > 0 ? `${passRate}%` : '—'}</div>
        <div className="stat-label">Pass Rate</div>
      </div>
    </div>
  );
};
