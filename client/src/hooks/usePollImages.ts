import { useEffect, useRef } from 'react';
import type { UploadAction } from './uploadReducer.js';
import type { UploadItem } from '../types.js';
import { fetchImages } from '../services/api.js';

export function usePollImages(
  items: UploadItem[],
  dispatch: React.Dispatch<UploadAction>,
) {
  const isHydrated = useRef(false);

  // Initial load hydration
  useEffect(() => {
    if (!isHydrated.current) {
      isHydrated.current = true;
      fetchImages()
        .then((res) => {
          if (res.items && res.items.length > 0) {
            dispatch({ type: 'HYDRATE_SERVER_ITEMS', serverItems: res.items });
          }
        })
        .catch(() => {
          // ignore initial fetch error if offline or fresh session
        });
    }
  }, [dispatch]);

  // Determine if polling is needed: only while any item is PROCESSING or UPLOADING
  const hasInFlight = items.some(
    (item) => item.status === 'PROCESSING' || item.status === 'UPLOADING',
  );

  useEffect(() => {
    if (!hasInFlight) return;

    const intervalId = setInterval(async () => {
      try {
        const res = await fetchImages();
        if (res.items) {
          dispatch({ type: 'MERGE_SERVER_DATA', serverItems: res.items });
        }
      } catch {
        // Suppress polling network blips
      }
    }, 1500);

    return () => clearInterval(intervalId);
  }, [hasInFlight, dispatch]);
}
