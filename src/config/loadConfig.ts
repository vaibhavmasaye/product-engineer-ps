import { RetryPolicy } from '../services/RetryPolicy.ts';
import { environmentNumber, httpUrl, integerInRange, MAX_TIMER_MS } from './validation.ts';

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = integerInRange('PORT', environmentNumber(env, 'PORT', 8000), 1, 65535);
  const webhookUrl = httpUrl(env.WEBHOOK_URL ?? 'http://localhost:3001/webhook');
  const dbPath = env.DATABASE_PATH ?? './data/engine.db';
  if (!dbPath.trim() || dbPath.includes('\0')) throw new Error('DATABASE_PATH must be a non-empty valid path');
  const pollIntervalMs = integerInRange('WORKER_POLL_INTERVAL_MS', environmentNumber(env, 'WORKER_POLL_INTERVAL_MS', 1000), 1, MAX_TIMER_MS);
  const retryPolicy = new RetryPolicy({
    maxAttempts: environmentNumber(env, 'RETRY_MAX_ATTEMPTS', 5),
    initialDelayMs: environmentNumber(env, 'RETRY_INITIAL_DELAY_MS', 5000),
    maxDelayMs: environmentNumber(env, 'RETRY_MAX_DELAY_MS', 300000),
    jitterPercent: environmentNumber(env, 'RETRY_JITTER_PERCENT', 0.1),
  });
  return { port, webhookUrl, dbPath, pollIntervalMs, retryPolicy };
}

export function receiverPort(env: NodeJS.ProcessEnv = process.env): number {
  return integerInRange('RECEIVER_PORT', environmentNumber(env, 'RECEIVER_PORT', 3001), 1, 65535);
}
