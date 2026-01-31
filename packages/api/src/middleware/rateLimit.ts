import { Context, Next } from 'hono';

// Simple in-memory rate limiter
// In production, use Redis or similar
const requests = new Map<string, { count: number; resetAt: number }>();

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 100; // 100 requests per minute

export async function rateLimit(c: Context, next: Next) {
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
  const now = Date.now();

  let record = requests.get(ip);
  
  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + WINDOW_MS };
    requests.set(ip, record);
  }

  record.count++;

  // Set rate limit headers
  c.header('X-RateLimit-Limit', MAX_REQUESTS.toString());
  c.header('X-RateLimit-Remaining', Math.max(0, MAX_REQUESTS - record.count).toString());
  c.header('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000).toString());

  if (record.count > MAX_REQUESTS) {
    return c.json(
      { error: 'Too many requests', retryAfter: Math.ceil((record.resetAt - now) / 1000) },
      429
    );
  }

  // Cleanup old entries periodically
  if (Math.random() < 0.01) {
    for (const [key, val] of requests.entries()) {
      if (now > val.resetAt) requests.delete(key);
    }
  }

  await next();
}
