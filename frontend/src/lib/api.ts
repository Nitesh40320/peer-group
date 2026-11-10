// All server communication goes through this file.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Array<{ field: string; message: string }>) {
    super(message);
  }
}

let csrfToken = '';
export const setCsrfToken = (token: string) => { csrfToken = token; };

let onUnauthenticated: () => void = () => undefined;
export const setUnauthenticatedHandler = (fn: () => void) => { onUnauthenticated = fn; };

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['x-csrf-token'] = csrfToken;
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${url}`, { method, headers, credentials: 'same-origin', body: isForm ? body : body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach PeerConnect. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    if (res.status === 401 && !url.startsWith('/auth/')) onUnauthenticated();
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? 'Something went wrong. Please try again.', e?.details);
  }
  return data as T;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  patch: <T = any>(url: string, body: unknown = {}) => request<T>('PATCH', url, body),
  delete: <T = any>(url: string) => request<T>('DELETE', url),
};

export const qs = (params: Record<string, unknown>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) { if (v.length) s.set(k, v.join(',')); } else if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  }
  const out = s.toString();
  return out ? `?${out}` : '';
};

export const fileUrl = (id: string) => `/api/files/${id}`;

export function toForm(fields: Record<string, string | undefined | null>, file?: File | null, field = 'file') {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v) form.set(k, v);
  if (file) form.set(field, file);
  return form;
}

export const fieldErrors = (error: unknown): Record<string, string> =>
  error instanceof ApiError && error.details ? Object.fromEntries(error.details.map((d) => [d.field, d.message])) : {};

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Please try again.');

/** Dates always display in the viewer's own time zone. The server stores UTC. */
export const formatDate = (v: string | Date) => new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const formatDateTime = (v: string | Date) => new Date(v).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const formatTime = (v: string | Date) => new Date(v).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function fromNow(v: string | Date) {
  const minutes = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return formatDate(v);
}

/** Converts a datetime-local input value (viewer's zone) to UTC ISO, and back. */
export const localToIso = (v: string) => new Date(v).toISOString();
export function isoToLocal(v: string | Date) {
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
