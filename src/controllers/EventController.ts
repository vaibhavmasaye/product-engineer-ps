import type { Event } from '../entities/Event.ts';
import type { DeliveryAttempt } from '../entities/DeliveryAttempt.ts';
import { EventService } from '../services/EventService.ts';
import { AttemptRepository } from '../repositories/AttemptRepository.ts';
import { ValidationError } from '../validators/EventValidator.ts';

export interface HttpRequest {
  method: string;
  url: string;
  body?: unknown;
  params: Record<string, string>;
}

export interface HttpResponse<T = unknown, S extends number = number> {
  status: S;
  headers: Record<string, string>;
  body: T;
}

type ErrorBody = { error: string; details?: string[]; message?: string };
type EventSummary = Pick<Event, 'id' | 'eventId' | 'type' | 'state' | 'createdAt' | 'updatedAt'> & { isDuplicate: boolean };
type AttemptSummary = Pick<DeliveryAttempt, 'attempt_number' | 'started_at' | 'completed_at' | 'http_status_code' | 'outcome' | 'error_type'>;
type CreateResponse = HttpResponse<EventSummary, 200 | 201> | HttpResponse<ErrorBody, 400 | 500>;
type GetResponse = HttpResponse<Event, 200> | HttpResponse<ErrorBody, 404>;

export class EventController {
  private eventService: EventService;
  private attemptRepository: AttemptRepository;

  constructor(eventService: EventService, attemptRepository: AttemptRepository) {
    this.eventService = eventService;
    this.attemptRepository = attemptRepository;
  }

  async create(req: HttpRequest): Promise<CreateResponse> {
    try {
      const result = await this.eventService.ingest(req.body);
      const status = result.isDuplicate ? 200 : 201;

      return {
        status,
        headers: { 'Content-Type': 'application/json' },
        body: {
          id: result.event.id,
          eventId: result.event.eventId,
          type: result.event.type,
          state: result.event.state,
          createdAt: result.event.createdAt,
          updatedAt: result.event.updatedAt,
          isDuplicate: result.isDuplicate,
        },
      };
    } catch (err) {
      if (err instanceof ValidationError) {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: {
            error: 'Validation failed',
            details: err.errors,
          },
        };
      }

      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: {
          error: 'Internal server error',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      };
    }
  }

  async get(req: HttpRequest): Promise<GetResponse> {
    const eventId = req.params.eventId;
    const event = this.eventService.getEvent(eventId);

    if (!event) {
      return {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: { error: `Event not found: ${eventId}` },
      };
    }

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        id: event.id,
        eventId: event.eventId,
        type: event.type,
        state: event.state,
        occurredAt: event.occurredAt,
        payload: event.payload,
        nextRetryAt: event.nextRetryAt,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
      },
    };
  }

  async getAttempts(req: HttpRequest): Promise<HttpResponse<AttemptSummary[], 200>> {
    const eventId = req.params.eventId;
    const attempts = this.attemptRepository.getByEventId(eventId);

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: attempts.map((a) => ({
        attempt_number: a.attempt_number,
        started_at: a.started_at,
        completed_at: a.completed_at,
        http_status_code: a.http_status_code,
        outcome: a.outcome,
        error_type: a.error_type,
      })),
    };
  }
}

