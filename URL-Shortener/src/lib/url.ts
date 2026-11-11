const MAX_URL_LENGTH = 2048;

/**
 * Returns a canonical http(s) URL, or null when the input is unusable.
 *
 * Only http/https are allowed: a shortener that accepts `javascript:` or
 * `data:` turns into an XSS / phishing delivery mechanism.
 */
export function normalizeUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;

  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.hostname.length === 0) return null;

  return parsed.href;
}

/**
 * Rejects links that point back at this service, which would otherwise let
 * someone build redirect loops or chains that multiply traffic.
 */
export function pointsAtSelf(url: string, baseUrl: string): boolean {
  try {
    const target = new URL(url);
    const self = new URL(baseUrl);
    return target.host === self.host;
  } catch {
    return false;
  }
}
