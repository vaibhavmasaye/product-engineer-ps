import { Outcome } from '../types/Outcome.ts';

export interface DeliveryAttempt {
  id: string;
  eventId: string;
  attempt_number: number;
  started_at: string;
  completed_at?: string | null;
  http_status_code?: number | null;
  error_type?: string | null;
  outcome: Outcome;
  response_body?: string | null;
  createdAt: string;
}

export { Outcome };

