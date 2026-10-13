import type { ServerImageDto } from '../types.js';

export async function fetchImages(
  status?: string,
  cursor?: string,
  limit: number = 50,
): Promise<{ items: ServerImageDto[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  if (cursor) params.append('cursor', cursor);
  params.append('limit', limit.toString());

  const res = await fetch(`/api/images?${params.toString()}`, {
    credentials: 'include',
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || `Failed to fetch images (${res.status})`);
  }

  return await res.json();
}

export function uploadBatchWithProgress(
  files: File[],
  onProgress?: (percent: number) => void,
): Promise<ServerImageDto[]> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();

    for (const file of files) {
      formData.append('files', file);
    }

    xhr.open('POST', '/api/images', true);
    xhr.withCredentials = true;

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data.items || []);
        } catch {
          reject(new Error('Invalid response from server'));
        }
      } else {
        try {
          const errData = JSON.parse(xhr.responseText);
          reject(new Error(errData?.error?.message || `Upload failed (${xhr.status})`));
        } catch {
          reject(new Error(`Upload failed (${xhr.status})`));
        }
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error occurred during file upload'));
    };

    xhr.send(formData);
  });
}

export async function deleteImage(id: string): Promise<void> {
  const res = await fetch(`/api/images/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || `Failed to delete image (${res.status})`);
  }
}

export async function retryImage(id: string): Promise<ServerImageDto> {
  const res = await fetch(`/api/images/${id}/retry`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || `Failed to retry image (${res.status})`);
  }

  return await res.json();
}
