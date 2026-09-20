import { EventState, EventTransition } from '../types/State.ts';

export interface Event {
  id: string;
  eventId: string;
  type: string;
  occurredAt: string;
  payload: Record<string, any>;
  state: EventState;
  nextRetryAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export { EventState, EventTransition };

