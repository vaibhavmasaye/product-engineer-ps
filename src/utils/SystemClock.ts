import type { Clock } from './Clock.ts';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  async sleep(durationMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }
}
