/**
 * Where to go after signing in. Only paths on this site are allowed, so a
 * crafted link can never send someone to another website.
 */
export function safeNext(raw: string | null | undefined, fallback = '/') {
  if (!raw) return fallback;
  let value: string;
  try {
    value = decodeURIComponent(raw).trim();
  } catch {
    return fallback;
  }
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  // Backslashes and control characters can turn into another host in browsers.
  if (/[\\\u0000-\u001f]/.test(value)) return fallback;
  try {
    const url = new URL(value, 'https://canvaroom.invalid');
    if (url.origin !== 'https://canvaroom.invalid') return fallback;
    if (/^\/(login|signup|forgot-password)\b/.test(url.pathname))
      return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** Keeps the return address on links between the sign-in pages. */
export const withNext = (path: string, next: string) =>
  next && next !== '/' ? `${path}?next=${encodeURIComponent(next)}` : path;
