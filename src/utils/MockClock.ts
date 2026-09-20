import type { Clock } from './Clock.ts';

export class MockClock implements Clock {
  private currentTime: Date;

  constructor(initialTime?: Date | string | number) {
    this.currentTime = initialTime ? new Date(initialTime) : new Date('2026-09-17T10:00:00.000Z');
  }

  now(): Date {
    return new Date(this.currentTime.getTime());
  }

  async sleep(_durationMs: number): Promise<void> {
    // Deterministic mock sleep: zero real-time delay
    return Promise.resolve();
  }

  advance(ms: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }

  setTime(date: Date | string | number): void {
    this.currentTime = new Date(date);
  }
}
