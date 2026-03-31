const API_BASE_URL = ((import.meta as any).env?.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

export function apiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (!path.startsWith('/')) return path;
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(input), {
    ...init,
    credentials: 'include',
  });
}
