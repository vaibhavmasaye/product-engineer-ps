export interface Clock {
  now(): Date;
  sleep(durationMs: number): Promise<void>;
}

