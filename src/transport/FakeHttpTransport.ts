import type { CreateEventInput } from '../repositories/EventRepository.ts';
import type { HttpTransport, HttpDeliveryResult } from './HttpTransport.ts';

export interface RecordedCall {
  url: string;
  payload: CreateEventInput;
  time: Date;
}

export class FakeHttpTransport implements HttpTransport {
  private responseQueues: Map<string, HttpDeliveryResult[]> = new Map();
  private defaultResponse: HttpDeliveryResult = { statusCode: 200, body: 'OK', error: null };
  private calls: RecordedCall[] = [];

  addResponse(url: string, result: Partial<HttpDeliveryResult>): void {
    if (!this.responseQueues.has(url)) {
      this.responseQueues.set(url, []);
    }
    this.responseQueues.get(url)!.push({
      statusCode: result.statusCode ?? null,
      body: result.body ?? null,
      headers: result.headers ?? {},
      error: result.error ?? null,
    });
  }

  setDefaultResponse(result: Partial<HttpDeliveryResult>): void {
    this.defaultResponse = {
      statusCode: result.statusCode ?? null,
      body: result.body ?? null,
      headers: result.headers ?? {},
      error: result.error ?? null,
    };
  }

  async deliver(url: string, payload: CreateEventInput): Promise<HttpDeliveryResult> {
    this.calls.push({
      url,
      payload,
      time: new Date(),
    });

    const queue = this.responseQueues.get(url);
    if (queue && queue.length > 0) {
      return queue.shift()!;
    }

    return { ...this.defaultResponse };
  }

  getCalls(): RecordedCall[] {
    return [...this.calls];
  }

  callCount(): number {
    return this.calls.length;
  }

  reset(): void {
    this.responseQueues.clear();
    this.calls = [];
    this.defaultResponse = { statusCode: 200, body: 'OK', error: null };
  }
}
