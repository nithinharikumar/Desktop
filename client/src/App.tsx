import { useMemo } from 'react';
import { useUploadQueue } from './hooks/useUploadQueue.js';
import { usePollImages } from './hooks/usePollImages.js';
import { Dropzone } from './components/Dropzone.js';
import { StatsBar } from './components/StatsBar.js';
import { ImageSection } from './components/ImageSection.js';

export default function App() {
  const { items, dispatch, addFiles, remove, retry, clearRejected } = useUploadQueue();
  usePollImages(items, dispatch);

  const { processingItems, acceptedItems, rejectedItems } = useMemo(() => {
    const processing: typeof items = [];
    const accepted: typeof items = [];
    const rejected: typeof items = [];

    for (const item of items) {
      if (item.status === 'PROCESSING' || item.status === 'UPLOADING') {
        processing.push(item);
      } else if (item.status === 'ACCEPTED') {
        accepted.push(item);
      } else {
        rejected.push(item);
      }
    }

    return {
      processingItems: processing,
      acceptedItems: accepted,
      rejectedItems: rejected,
    };
  }, [items]);

  return (
    <div className="app-container">
      <header className="header">
        <h1>Image Gatekeeper</h1>
        <p>
          Automated multi-stage validation for AI headshot training (blur, face count, frame area, resolution, and duplicate detection)
        </p>
      </header>

      <StatsBar
        total={items.length}
        accepted={acceptedItems.length}
        rejected={rejectedItems.length}
        inFlight={processingItems.length}
      />

      <Dropzone onFilesSelected={addFiles} />

      {/* Screen reader live updates */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {processingItems.length > 0 && `${processingItems.length} photos currently processing.`}
      </div>

      {processingItems.length > 0 && (
        <ImageSection
          title="In-Flight Validation"
          count={processingItems.length}
          items={processingItems}
          variant="processing"
          emptyMessage="No photos processing right now."
          onRemove={remove}
          onRetry={retry}
        />
      )}

      <ImageSection
        title="Accepted Photos"
        count={acceptedItems.length}
        items={acceptedItems}
        variant="accepted"
        emptyMessage="No accepted photos yet. Upload high-quality selfies with good lighting and clear faces."
        onRemove={remove}
        onRetry={retry}
      />

      <ImageSection
        title="Rejected Photos"
        count={rejectedItems.length}
        items={rejectedItems}
        variant="rejected"
        emptyMessage="No rejected photos. Great job!"
        onClear={clearRejected}
        onRemove={remove}
        onRetry={retry}
      />
    </div>
  );
}
