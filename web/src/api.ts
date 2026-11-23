export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

let unauthorizedHandler: (() => void) | null = null;

/** Called when any request is rejected because the session is gone. */
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function parseBody(text: string): { error?: string; message?: string } & Record<string, unknown> {
  try {
    return text ? (JSON.parse(text) as never) : {};
  } catch {
    return {};
  }
}

async function request<T>(method: Method, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the panel. Check your connection.');
  }

  const data = parseBody(await response.text());
  if (!response.ok) {
    if (response.status === 401 && !url.startsWith('/api/auth/')) unauthorizedHandler?.();
    throw new ApiError(response.status, data.error ?? 'error', data.message ?? (response.statusText || 'Request failed'));
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

export const q = encodeURIComponent;

/** Uploads files with progress. fetch cannot report upload progress, so this uses XMLHttpRequest. */
export function uploadFiles(directory: string, files: File[], onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const file of files) form.append('file', file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/files/upload?path=${q(directory)}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      if (xhr.status === 401) unauthorizedHandler?.();
      const data = parseBody(xhr.responseText);
      reject(new ApiError(xhr.status, data.error ?? 'error', data.message ?? 'Upload failed'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network', 'Upload failed. Check your connection.'));
    xhr.send(form);
  });
}
