import type { FC } from 'react';
import type { UploadItem } from '../types.js';
import { UploadCard } from './UploadCard.js';

interface ImageSectionProps {
  title: string;
  count: number;
  items: UploadItem[];
  variant: 'accepted' | 'rejected' | 'processing';
  emptyMessage: string;
  onClear?: () => void;
  onRemove: (clientId: string) => void;
  onRetry: (clientId: string) => void;
}

export const ImageSection: FC<ImageSectionProps> = ({
  title,
  count,
  items,
  variant,
  emptyMessage,
  onClear,
  onRemove,
  onRetry,
}) => {
  const getBadgeClass = () => {
    if (variant === 'accepted') return 'status-pill accepted';
    if (variant === 'rejected') return 'status-pill rejected';
    return 'status-pill processing';
  };

  return (
    <section className="section" aria-labelledby={`heading-${variant}`}>
      <div className="section-header">
        <h2 id={`heading-${variant}`} className="section-title">
          <span>{title}</span>
          <span className={`badge-count ${getBadgeClass()}`}>{count}</span>
        </h2>
        {variant === 'rejected' && count > 0 && onClear && (
          <button className="btn-clear" onClick={onClear} aria-label="Clear all rejected photos">
            Clear Rejected
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="empty-state">{emptyMessage}</div>
      ) : (
        <div className="image-grid">
          {items.map((item) => (
            <UploadCard
              key={item.clientId}
              item={item}
              onRemove={onRemove}
              onRetry={onRetry}
            />
          ))}
        </div>
      )}
    </section>
  );
};
