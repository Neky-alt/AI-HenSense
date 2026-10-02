import { accountRequest } from './accountRequest';
import { serviceError } from '../lib/userMessages';
// Expo statically inlines EXPO_PUBLIC variables; never fall back to phone localhost.
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').trim().replace(/\/$/, '');
export function resolveBackendUrl(path: string, base = API_BASE_URL): string {
  // Cloud mode returns absolute HTTPS signed URLs and does not require a LAN API address.
  if (/^https:\/\//i.test(path)) return new URL(path).toString();
  if (!base) throw new Error('Backend address is not configured. Please contact your administrator.');
  const url = new URL(path, `${base}/`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported Backend URL.');
  return url.toString();
}
export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const account = await accountRequest();
  if (process.env.EXPO_PUBLIC_DATA_SOURCE === 'cloud') {
    const { be04CloudGet } = await import('./be04CloudApi');
    const result=await be04CloudGet<T>(path, signal); await account.check(); return result;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 15000);
  try {
    const response = await fetch(
  resolveBackendUrl(`/api/v1${path}`),
  {
    signal: controller.signal,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${account.token}`,
      'Cache-Control': 'no-cache',
    },
  }
);
    const body = await response.json();
    if (!response.ok || body.success !== true) throw serviceError(response.status, body.error?.code);
    await account.check();
    return body.data as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function apiPost<T>(
  path: string,
  payload: unknown
): Promise<T> {
  const account = await accountRequest();

  if (process.env.EXPO_PUBLIC_DATA_SOURCE === 'cloud') {
    throw new Error('This action requires the local Backend.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(
      resolveBackendUrl(`/api/v1${path}`),
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${account.token}`,
        },
        body: JSON.stringify(payload),
      }
    );

    const body = await response.json();

    if (!response.ok || body.success !== true) {
      throw serviceError(
        response.status,
        body.error?.code
      );
    }

    await account.check();
    return body.data as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function apiPut<T>(
  path: string,
  payload: unknown
): Promise<T> {
  const account = await accountRequest();

  if (process.env.EXPO_PUBLIC_DATA_SOURCE === 'cloud') {
    throw new Error('This action requires the local Backend.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(
      resolveBackendUrl(`/api/v1${path}`),
      {
        method: 'PUT',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${account.token}`,
        },
        body: JSON.stringify(payload),
      }
    );

    const body = await response.json();

    if (!response.ok || body.success !== true) {
      throw serviceError(
        response.status,
        body.error?.code
      );
    }

    await account.check();
    return body.data as T;
  } finally {
    clearTimeout(timer);
  }
}