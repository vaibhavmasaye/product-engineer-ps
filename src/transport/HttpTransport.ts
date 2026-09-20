export interface HttpDeliveryResult {
  statusCode?: number | null;
  body?: string | null;
  headers?: Record<string, string>;
  error?: Error | null;
}

export interface HttpTransport {
  deliver(url: string, payload: any): Promise<HttpDeliveryResult>;
}

