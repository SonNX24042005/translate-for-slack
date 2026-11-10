// Retry decisions shared by translation and channel-context requests.

export const MAX_SUGGESTED_RETRY_DELAY_MS = 60000;

// Errors that cannot succeed by resending the same request (bad key, no permission, unknown model, bad payload).
const PERMANENT_HTTP_STATUSES = new Set([400, 401, 403, 404]);

export function isPermanentGeminiError(error) {
  return PERMANENT_HTTP_STATUSES.has(Number(error?.status));
}

export function retryDelayMs(attempt, baseDelayMs, error = null) {
  const backoff = baseDelayMs * (2 ** (attempt - 1));
  const suggested = Math.min(Number(error?.retryAfterMs) || 0, MAX_SUGGESTED_RETRY_DELAY_MS);
  return baseDelayMs > 0 ? Math.max(backoff, suggested) : backoff;
}
