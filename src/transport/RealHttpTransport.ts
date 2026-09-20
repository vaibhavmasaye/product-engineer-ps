import type { CreateEventInput } from '../repositories/EventRepository.ts';
import type { HttpTransport, HttpDeliveryResult } from './HttpTransport.ts';

export class RealHttpTransport implements HttpTransport {
  private readonly timeoutMs: number;

  constructor(timeoutMs: number = 30000) {
    this.timeoutMs = timeoutMs;
  }

  async deliver(url: string, payload: CreateEventInput): Promise<HttpDeliveryResult> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'WebhookRetryEngine/1.0',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const bodyText = await response.text();
      const headersRecord: Record<string, string> = {};
      response.headers.forEach((val, key) => {
        headersRecord[key.toLowerCase()] = val;
      });

      return {
        statusCode: response.status,
        body: bodyText,
        headers: headersRecord,
        error: null,
      };
    } catch (err: unknown) {
      return {
        statusCode: null,
        body: null,
        headers: {},
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }
}
