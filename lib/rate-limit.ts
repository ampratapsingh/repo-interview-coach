type Window = { startedAt: number; count: number };

const WINDOW_MS = 10 * 60 * 1_000;
const MAX_AI_REQUESTS = 12;
const windows = new Map<string, Window>();

export function consumeAiRateLimit(userId: string, now = Date.now()) {
  const current = windows.get(userId);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    windows.set(userId, { startedAt: now, count: 1 });
    return { allowed: true, remaining: MAX_AI_REQUESTS - 1, retryAfterSeconds: 0 };
  }
  if (current.count >= MAX_AI_REQUESTS) {
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - (now - current.startedAt)) / 1_000)) };
  }
  current.count += 1;
  return { allowed: true, remaining: MAX_AI_REQUESTS - current.count, retryAfterSeconds: 0 };
}
