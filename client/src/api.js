export class AuthError extends Error {}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new AuthError(data.error || 'Please log in.');
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
