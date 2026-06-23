/** Client fetch that bypasses the browser HTTP cache for fresh API data. */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    cache: 'no-store',
  });
}
