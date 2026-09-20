import { integerInRange, MAX_TIMER_MS } from '../config/validation.ts';
import type { RetryConfig } from '../models/RetryConfig.ts';

export class RetryPolicy {
  private readonly maxAttemptsCount: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitterPercent: number;

  constructor(config: RetryConfig = {}) {
    this.maxAttemptsCount = config.maxAttempts ?? 5;
    this.initialDelayMs = config.initialDelayMs ?? 5000; // 5s default
    this.maxDelayMs = config.maxDelayMs ?? 300000; // 300s default (5m)
    this.jitterPercent = config.jitterPercent ?? 0.1; // 10% jitter
    integerInRange('RETRY_MAX_ATTEMPTS', this.maxAttemptsCount, 1, Number.MAX_SAFE_INTEGER);
    integerInRange('RETRY_INITIAL_DELAY_MS', this.initialDelayMs, 0, MAX_TIMER_MS);
    integerInRange('RETRY_MAX_DELAY_MS', this.maxDelayMs, this.initialDelayMs, MAX_TIMER_MS);
    if (!Number.isFinite(this.jitterPercent) || this.jitterPercent < 0 || this.jitterPercent > 1) {
      throw new Error('RETRY_JITTER_PERCENT must be between 0 and 1');
    }
  }

  nextRetryDelay(attemptNumber: number, randomFn?: () => number): number {
    // attemptNumber is 1-indexed (e.g. 1 after first attempt fails)
    const exponent = Math.max(0, attemptNumber - 1);
    const exponential = Math.min(
      this.initialDelayMs * Math.pow(2, exponent),
      this.maxDelayMs
    );

    const rand = randomFn ? randomFn() : Math.random();
    const jitter = rand * (exponential * this.jitterPercent);

    return exponential + jitter;
  }

  isExhausted(attemptCount: number): boolean {
    return attemptCount >= this.maxAttemptsCount;
  }

  getMaxAttempts(): number {
    return this.maxAttemptsCount;
  }

  getInitialDelayMs(): number {
    return this.initialDelayMs;
  }

  getMaxDelayMs(): number {
    return this.maxDelayMs;
  }
}
