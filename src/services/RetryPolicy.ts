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
