import { useReducer, useCallback, useEffect, useRef } from 'react';
import { uploadReducer } from './uploadReducer.js';
import type { UploadItem } from '../types.js';
import { validateFileClientSide } from '../utils/validation.js';
import { uploadBatchWithProgress, deleteImage as apiDeleteImage, retryImage as apiRetryImage } from '../services/api.js';

export function useUploadQueue() {
  const [items, dispatch] = useReducer(uploadReducer, []);
  const activeObjectUrls = useRef<Set<string>>(new Set());

  // Cleanup object URLs on unmount
  useEffect(() => {
    const urls = activeObjectUrls.current;
    return () => {
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
      urls.clear();
    };
  }, []);

  const addFiles = useCallback(async (files: File[]) => {
    if (!files || files.length === 0) return;

    const newItems: UploadItem[] = [];
    const validUploads: Array<{ clientId: string; file: File }> = [];

    for (const file of files) {
      const clientId = crypto.randomUUID();
      const validation = validateFileClientSide(file);

      const isHeic = file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif');
      let previewUrl = '';
      if (!isHeic) {
        previewUrl = URL.createObjectURL(file);
        activeObjectUrls.current.add(previewUrl);
      }

      if (!validation.valid) {
        newItems.push({
          clientId,
          file,
          originalName: file.name,
          sizeBytes: file.size,
          previewUrl,
          status: 'CLIENT_REJECTED',
          progress: 0,
          reasons: [validation.reasonCode || 'INVALID_FORMAT'],
          error: validation.errorMessage,
        });
      } else {
        newItems.push({
          clientId,
          file,
          originalName: file.name,
          sizeBytes: file.size,
          previewUrl,
          status: 'UPLOADING',
          progress: 0,
          reasons: [],
        });
        validUploads.push({ clientId, file });
      }
    }

    dispatch({ type: 'ADD_ITEMS', items: newItems });

    if (validUploads.length > 0) {
      const uploadFiles = validUploads.map((u) => u.file);
      const clientIds = validUploads.map((u) => u.clientId);

      try {
        const serverDtos = await uploadBatchWithProgress(uploadFiles, (percent) => {
          dispatch({ type: 'SET_PROGRESS', clientIds, progress: percent });
        });

        const mapping = validUploads.map((u, index) => ({
          clientId: u.clientId,
          serverDto: serverDtos[index] || serverDtos[0]!,
        }));

        dispatch({ type: 'SET_UPLOAD_SUCCESS', clientMapping: mapping });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        dispatch({ type: 'SET_UPLOAD_FAILURE', clientIds, error: message });
      }
    }
  }, []);

  const remove = useCallback(
    async (clientId: string) => {
      const target = items.find((i) => i.clientId === clientId);
      if (!target) return;

      if (target.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
        activeObjectUrls.current.delete(target.previewUrl);
      }

      dispatch({ type: 'REMOVE_ITEM', clientId });

      if (target.serverId) {
        try {
          await apiDeleteImage(target.serverId);
        } catch {
          // best-effort delete
        }
      }
    },
    [items],
  );

  const retry = useCallback(
    async (clientId: string) => {
      const target = items.find((i) => i.clientId === clientId);
      if (!target) return;

      if (target.serverId) {
        try {
          const retriedDto = await apiRetryImage(target.serverId);
          dispatch({
            type: 'SET_UPLOAD_SUCCESS',
            clientMapping: [{ clientId, serverDto: retriedDto }],
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Retry failed';
          dispatch({ type: 'SET_UPLOAD_FAILURE', clientIds: [clientId], error: message });
        }
      } else if (target.file) {
        // Re-add file if it failed before reaching server
        remove(clientId);
        addFiles([target.file]);
      }
    },
    [items, remove, addFiles],
  );

  const clearRejected = useCallback(async () => {
    const rejectedItems = items.filter(
      (i) => i.status === 'REJECTED' || i.status === 'CLIENT_REJECTED',
    );

    for (const item of rejectedItems) {
      if (item.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(item.previewUrl);
        activeObjectUrls.current.delete(item.previewUrl);
      }
    }

    dispatch({ type: 'CLEAR_REJECTED' });

    for (const item of rejectedItems) {
      if (item.serverId) {
        apiDeleteImage(item.serverId).catch(() => {});
      }
    }
  }, [items]);

  return {
    items,
    dispatch,
    addFiles,
    remove,
    retry,
    clearRejected,
  };
}
