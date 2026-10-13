import type { FC } from 'react';
import type { UploadItem } from '../types.js';
import { getReasonMessage } from '../utils/validation.js';
import { Image as ImageIcon, RotateCw, Trash2 } from 'lucide-react';

interface UploadCardProps {
  item: UploadItem;
  onRemove: (clientId: string) => void;
  onRetry: (clientId: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export const UploadCard: FC<UploadCardProps> = ({ item, onRemove, onRetry }) => {
  const isHeic =
    item.originalName.toLowerCase().endsWith('.heic') ||
    item.originalName.toLowerCase().endsWith('.heif');

  // Display URL precedence: server thumbnail -> server processed -> local preview blob
  const displayUrl = item.thumbnailUrl || item.processedUrl || (!isHeic ? item.previewUrl : '');

  const getStatusClass = (status: UploadItem['status']) => {
    switch (status) {
      case 'ACCEPTED':
        return 'accepted';
      case 'REJECTED':
      case 'CLIENT_REJECTED':
        return 'rejected';
      case 'PROCESSING':
        return 'processing';
      case 'UPLOADING':
        return 'uploading';
      default:
        return 'rejected';
    }
  };

  return (
    <div className="card" role="article" aria-label={`Photo ${item.originalName}`}>
      <div className="card-preview-wrap">
        {displayUrl ? (
          <img
            src={displayUrl}
            alt={item.originalName}
            className="card-img"
            loading="lazy"
          />
        ) : (
          <div className="card-placeholder">
            <ImageIcon size={36} />
            <span>{isHeic ? 'HEIC preview processing...' : 'No preview available'}</span>
          </div>
        )}
      </div>

      <div className="card-content">
        <div className="card-title-row">
          <div>
            <div className="card-filename" title={item.originalName}>
              {item.originalName}
            </div>
            <div className="card-filesize">{formatBytes(item.sizeBytes)}</div>
          </div>
          <span className={`status-pill ${getStatusClass(item.status)}`}>
            {item.status === 'CLIENT_REJECTED' ? 'REJECTED' : item.status}
          </span>
        </div>

        {/* Progress Bar for uploads */}
        {item.status === 'UPLOADING' && (
          <div className="progress-container">
            <div className="progress-bar" style={{ width: `${item.progress}%` }} />
          </div>
        )}

        {/* Quality Metrics */}
        {(item.width || item.blurScore !== null || item.faceCount !== null) && (
          <div className="metrics-row">
            {item.width && item.height && (
              <span className="metric-tag">
                {item.width}×{item.height}
              </span>
            )}
            {item.faceCount !== null && item.faceCount !== undefined && (
              <span className="metric-tag">
                {item.faceCount} face{item.faceCount === 1 ? '' : 's'}
                {item.faceAreaRatio ? ` (${Math.round(item.faceAreaRatio * 100)}% frame)` : ''}
              </span>
            )}
            {item.blurScore !== null && item.blurScore !== undefined && (
              <span className="metric-tag">Sharpness {Math.round(item.blurScore)}</span>
            )}
          </div>
        )}

        {/* Rejection Reasons */}
        {item.reasons.length > 0 && (
          <ul className="reasons-list">
            {item.reasons.map((reason, idx) => (
              <li key={idx} className="reason-item">
                {getReasonMessage(reason)}
              </li>
            ))}
          </ul>
        )}

        {/* Inline error for failed or client rejected */}
        {item.error && !item.reasons.length && (
          <div className="reason-item" style={{ marginTop: '0.5rem' }}>
            {item.error}
          </div>
        )}

        {/* Action Controls */}
        <div className="card-actions">
          {(item.status === 'FAILED' || item.status === 'CLIENT_REJECTED') && (
            <button
              className="action-btn"
              onClick={() => onRetry(item.clientId)}
              aria-label={`Retry ${item.originalName}`}
            >
              <RotateCw size={14} style={{ display: 'inline', marginRight: '4px' }} />
              Retry
            </button>
          )}
          <button
            className="action-btn delete"
            onClick={() => onRemove(item.clientId)}
            aria-label={`Remove ${item.originalName}`}
          >
            <Trash2 size={14} style={{ display: 'inline', marginRight: '4px' }} />
            Remove
          </button>
        </div>
      </div>
    </div>
  );
};
