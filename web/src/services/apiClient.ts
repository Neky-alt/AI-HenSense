import { accountRequest } from './accountRequest';
import { serviceError } from '../lib/userMessages';
// This is the Backend origin, not the independent AI service or /api/v1 prefix.
export const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || "http://127.0.0.1:8006").replace(/\/+$/, "");

export function resolveBackendUrl(path: string, baseUrl = API_BASE_URL): string {
  const url = new URL(path, `${baseUrl}/`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Unsupported Backend URL");
  }
  return url.href;
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const account = await accountRequest();
  if (import.meta.env?.VITE_DATA_SOURCE === "cloud") {
    const { be04CloudGet } = await import("./be04CloudApi.ts");
    const result=await be04CloudGet<T>(path, signal); await account.check(); return result;
  }
  const timeout = AbortSignal.timeout(15_000);
  const response = await fetch(resolveBackendUrl(`/api/v1${path}`), {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { Accept: "application/json", Authorization: `Bearer ${account.token}` },
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok || body.success !== true) {
    throw serviceError(response.status, body.error?.code);
  }
  if (!("data" in body)) throw new Error("Invalid Backend response");
  await account.check();
    return body.data as T;
}

export async function apiPost<T>(path: string, payload: unknown): Promise<T> {
  const account = await accountRequest();

  if (import.meta.env?.VITE_DATA_SOURCE === "cloud") {
    throw new Error("This action requires the local Backend.");
  }

  const timeout = AbortSignal.timeout(15_000);

  const response = await fetch(resolveBackendUrl(`/api/v1${path}`), {
    method: "POST",
    signal: timeout,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${account.token}`,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const body = await response.json();

  if (!response.ok || body.success !== true) {
    throw serviceError(response.status, body.error?.code);
  }

  if (!("data" in body)) {
    throw new Error("Invalid Backend response");
  }

  await account.check();
  return body.data as T;
}

export async function apiPut<T>(path: string, payload: unknown): Promise<T> {
  const account = await accountRequest();

  if (import.meta.env?.VITE_DATA_SOURCE === "cloud") {
    throw new Error("This action requires the local Backend.");
  }

  const timeout = AbortSignal.timeout(15_000);

  const response = await fetch(resolveBackendUrl(`/api/v1${path}`), {
    method: "PUT",
    signal: timeout,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${account.token}`,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const body = await response.json();

  if (!response.ok || body.success !== true) {
    throw serviceError(response.status, body.error?.code);
  }

  if (!("data" in body)) {
    throw new Error("Invalid Backend response");
  }

  await account.check();
  return body.data as T;
}