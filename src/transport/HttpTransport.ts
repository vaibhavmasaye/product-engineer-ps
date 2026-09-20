import type { CreateEventInput } from '../repositories/EventRepository.ts';
export interface HttpDeliveryResult {
  statusCode?: number | null;
  body?: string | null;
  headers?: Record<string, string>;
  error?: Error | null;
}

export interface HttpTransport {
  deliver(url: string, payload: CreateEventInput): Promise<HttpDeliveryResult>;
}

