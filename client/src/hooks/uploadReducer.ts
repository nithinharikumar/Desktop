import type { UploadItem, ServerImageDto } from '../types.js';

export type UploadAction =
  | { type: 'ADD_ITEMS'; items: UploadItem[] }
  | { type: 'SET_PROGRESS'; clientIds: string[]; progress: number }
  | { type: 'SET_UPLOAD_SUCCESS'; clientMapping: Array<{ clientId: string; serverDto: ServerImageDto }> }
  | { type: 'SET_UPLOAD_FAILURE'; clientIds: string[]; error: string }
  | { type: 'MERGE_SERVER_DATA'; serverItems: ServerImageDto[] }
  | { type: 'HYDRATE_SERVER_ITEMS'; serverItems: ServerImageDto[] }
  | { type: 'REMOVE_ITEM'; clientId: string }
  | { type: 'CLEAR_REJECTED' };

export function uploadReducer(state: UploadItem[], action: UploadAction): UploadItem[] {
  switch (action.type) {
    case 'ADD_ITEMS': {
      return [...action.items, ...state];
    }

    case 'SET_PROGRESS': {
      const idSet = new Set(action.clientIds);
      return state.map((item) => {
        if (idSet.has(item.clientId)) {
          return { ...item, progress: action.progress };
        }
        return item;
      });
    }

    case 'SET_UPLOAD_SUCCESS': {
      const mapping = new Map(action.clientMapping.map((m) => [m.clientId, m.serverDto]));
      return state.map((item) => {
        const serverDto = mapping.get(item.clientId);
        if (serverDto) {
          return {
            ...item,
            serverId: serverDto.id,
            status: serverDto.status,
            reasons: serverDto.rejectionReasons || [],
            thumbnailUrl: serverDto.thumbnailUrl,
            processedUrl: serverDto.processedUrl,
            progress: 100,
          };
        }
        return item;
      });
    }

    case 'SET_UPLOAD_FAILURE': {
      const idSet = new Set(action.clientIds);
      return state.map((item) => {
        if (idSet.has(item.clientId)) {
          return {
            ...item,
            status: 'FAILED',
            error: action.error,
            progress: 0,
          };
        }
        return item;
      });
    }

    case 'MERGE_SERVER_DATA': {
      const serverMap = new Map<string, ServerImageDto>();
      for (const s of action.serverItems) {
        serverMap.set(s.id, s);
      }

      const existingServerIds = new Set<string>();

      // Update existing items in state
      const updated = state.map((item) => {
        const id = item.serverId;
        if (id && serverMap.has(id)) {
          existingServerIds.add(id);
          const serverDto = serverMap.get(id)!;
          return {
            ...item,
            status: serverDto.status,
            reasons: serverDto.rejectionReasons || [],
            thumbnailUrl: serverDto.thumbnailUrl || item.thumbnailUrl,
            processedUrl: serverDto.processedUrl || item.processedUrl,
            width: serverDto.width,
            height: serverDto.height,
            blurScore: serverDto.blurScore,
            faceCount: serverDto.faceCount,
            faceAreaRatio: serverDto.faceAreaRatio,
          };
        }
        return item;
      });

      // Add any new server items that were not in state (e.g. from refresh or other tab)
      const newItems: UploadItem[] = [];
      for (const s of action.serverItems) {
        if (!existingServerIds.has(s.id) && !state.some((i) => i.serverId === s.id)) {
          newItems.push({
            clientId: s.id,
            serverId: s.id,
            originalName: s.originalName,
            sizeBytes: Number(s.sizeBytes),
            status: s.status,
            progress: 100,
            previewUrl: s.thumbnailUrl || s.processedUrl || '',
            thumbnailUrl: s.thumbnailUrl,
            processedUrl: s.processedUrl,
            reasons: s.rejectionReasons || [],
            width: s.width,
            height: s.height,
            blurScore: s.blurScore,
            faceCount: s.faceCount,
            faceAreaRatio: s.faceAreaRatio,
            createdAt: s.createdAt,
          });
        }
      }

      return [...updated, ...newItems];
    }

    case 'HYDRATE_SERVER_ITEMS': {
      // Replaces or initializes state from fresh server fetch
      return action.serverItems.map((s) => ({
        clientId: s.id,
        serverId: s.id,
        originalName: s.originalName,
        sizeBytes: Number(s.sizeBytes),
        status: s.status,
        progress: 100,
        previewUrl: s.thumbnailUrl || s.processedUrl || '',
        thumbnailUrl: s.thumbnailUrl,
        processedUrl: s.processedUrl,
        reasons: s.rejectionReasons || [],
        width: s.width,
        height: s.height,
        blurScore: s.blurScore,
        faceCount: s.faceCount,
        faceAreaRatio: s.faceAreaRatio,
        createdAt: s.createdAt,
      }));
    }

    case 'REMOVE_ITEM': {
      return state.filter((item) => item.clientId !== action.clientId);
    }

    case 'CLEAR_REJECTED': {
      return state.filter(
        (item) => item.status !== 'REJECTED' && item.status !== 'CLIENT_REJECTED',
      );
    }

    default:
      return state;
  }
}
