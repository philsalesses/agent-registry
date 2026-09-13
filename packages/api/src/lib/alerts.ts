import { config } from '../config';

/**
 * POST {text, data?} to ADMIN_ALERT_URL (any incoming-webhook URL, 14.16).
 * Never throws and never blocks the caller for more than 5 seconds.
 */
export async function alert(text: string, data?: Record<string, unknown>): Promise<void> {
  const url = config.adminAlertUrl;
  if (!url) {
    if (process.env.ANS_QUIET !== '1') console.warn(`[alert] ${text}`, data ?? '');
    return;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data ? { text, data } : { text }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error('[alert] delivery failed:', err instanceof Error ? err.message : err);
  }
}
