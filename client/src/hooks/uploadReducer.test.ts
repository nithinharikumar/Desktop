import { describe, it, expect } from 'vitest';
import { uploadReducer } from './uploadReducer.js';
import type { UploadItem, ServerImageDto } from '../types.js';

describe('uploadReducer (Pure Unit Tests - Phase 7)', () => {
  const sampleItem: UploadItem = {
    clientId: 'client-1',
    originalName: 'test.jpg',
    sizeBytes: 100000,
    previewUrl: 'blob:test',
    status: 'UPLOADING',
    progress: 0,
    reasons: [],
  };

  it('handles ADD_ITEMS', () => {
    const state = uploadReducer([], { type: 'ADD_ITEMS', items: [sampleItem] });
    expect(state).toHaveLength(1);
    expect(state[0]!.clientId).toBe('client-1');
  });

  it('handles SET_PROGRESS', () => {
    const initialState = [sampleItem];
    const state = uploadReducer(initialState, {
      type: 'SET_PROGRESS',
      clientIds: ['client-1'],
      progress: 65,
    });
    expect(state[0]!.progress).toBe(65);
  });

  it('handles SET_UPLOAD_SUCCESS', () => {
    const initialState = [sampleItem];
    const serverDto: ServerImageDto = {
      id: 'server-uuid-1',
      ownerId: 'owner-1',
      originalName: 'test.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: '100000',
      width: null,
      height: null,
      storageKey: 'raw/1.jpg',
      processedKey: null,
      thumbnailKey: null,
      status: 'PROCESSING',
      rejectionReasons: [],
      blurScore: null,
      faceCount: null,
      faceAreaRatio: null,
      attempts: 0,
      createdAt: new Date().toISOString(),
      processedAt: null,
      thumbnailUrl: null,
      processedUrl: null,
    };

    const state = uploadReducer(initialState, {
      type: 'SET_UPLOAD_SUCCESS',
      clientMapping: [{ clientId: 'client-1', serverDto }],
    });

    expect(state[0]!.serverId).toBe('server-uuid-1');
    expect(state[0]!.status).toBe('PROCESSING');
  });

  it('handles MERGE_SERVER_DATA transitions from PROCESSING to ACCEPTED', () => {
    const initialState: UploadItem[] = [
      {
        ...sampleItem,
        serverId: 'server-uuid-1',
        status: 'PROCESSING',
      },
    ];

    const serverDto: ServerImageDto = {
      id: 'server-uuid-1',
      ownerId: 'owner-1',
      originalName: 'test.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: '100000',
      width: 800,
      height: 800,
      storageKey: 'raw/1.jpg',
      processedKey: 'processed/1.jpg',
      thumbnailKey: 'thumbs/1.jpg',
      status: 'ACCEPTED',
      rejectionReasons: [],
      blurScore: 120,
      faceCount: 1,
      faceAreaRatio: 0.15,
      attempts: 1,
      createdAt: new Date().toISOString(),
      processedAt: new Date().toISOString(),
      thumbnailUrl: '/api/files/thumbs%2F1.jpg',
      processedUrl: '/api/files/processed%2F1.jpg',
    };

    const state = uploadReducer(initialState, {
      type: 'MERGE_SERVER_DATA',
      serverItems: [serverDto],
    });

    expect(state[0]!.status).toBe('ACCEPTED');
    expect(state[0]!.thumbnailUrl).toBe('/api/files/thumbs%2F1.jpg');
    expect(state[0]!.faceCount).toBe(1);
  });

  it('handles REMOVE_ITEM and CLEAR_REJECTED', () => {
    const items: UploadItem[] = [
      { ...sampleItem, clientId: 'c1', status: 'ACCEPTED' },
      { ...sampleItem, clientId: 'c2', status: 'REJECTED' },
      { ...sampleItem, clientId: 'c3', status: 'CLIENT_REJECTED' },
    ];

    const stateAfterRemove = uploadReducer(items, { type: 'REMOVE_ITEM', clientId: 'c1' });
    expect(stateAfterRemove).toHaveLength(2);
    expect(stateAfterRemove.some((i) => i.clientId === 'c1')).toBe(false);

    const stateAfterClear = uploadReducer(stateAfterRemove, { type: 'CLEAR_REJECTED' });
    expect(stateAfterClear).toHaveLength(0);
  });
});
