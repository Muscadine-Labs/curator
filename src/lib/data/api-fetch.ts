/** Client fetch that bypasses the browser HTTP cache and sends the session cookie. */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    cache: 'no-store',
    credentials: 'same-origin',
  });
}

/**
 * Human-readable message for a failed BFF response: the `{ message | error }`
 * JSON field when present, otherwise the raw body, otherwise `fallback`.
 */
export async function apiErrorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '');
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/html') || text.trim().startsWith('<')) {
    return `Received an HTML page instead of data (HTTP ${res.status}). Deployment protection or a server error page may be blocking the API.`;
  }
  try {
    const json = JSON.parse(text) as { message?: unknown; error?: unknown };
    if (typeof json.message === 'string' && json.message) return json.message;
    if (typeof json.error === 'string' && json.error) return json.error;
  } catch {
    // Not JSON — fall through to the raw body.
  }
  return text || fallback;
}
