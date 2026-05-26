/** Pull a human-readable message from callApi/fetch failures. */
export function formatApiError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const raw = err.message.trim();
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    /* plain text */
  }
  return raw;
}
