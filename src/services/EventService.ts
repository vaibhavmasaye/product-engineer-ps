import { EventRepository } from '../repositories/EventRepository.ts';
import { type Event, EventState, EventTransition } from '../entities/Event.ts';
import { EventValidator, ValidationError } from '../validators/EventValidator.ts';
import type { Clock } from '../utils/Clock.ts';
import { SystemClock } from '../utils/SystemClock.ts';

export interface IngestResult {
  event: Event;
  isDuplicate: boolean;
}

export class EventService {
  private repository: EventRepository;
  private clock: Clock;

  constructor(repository: EventRepository, clock: Clock = new SystemClock()) {
    this.repository = repository;
    this.clock = clock;
  }

  async ingest(rawEvent: unknown): Promise<IngestResult> {
    // 1. Schema validation
    const validation = EventValidator.validate(rawEvent);
    if (!validation.valid) {
      throw new ValidationError(validation.errors);
    }

    const now = this.clock.now();

    // 2. Find or create in repository
    const { event, created } = this.repository.findOrCreate(
      validation.event,
      now
    );

    // 3. If newly created, transition from RECEIVED to QUEUED
    if (created) {
      EventTransition.transition(event.state, EventState.QUEUED);
      event.state = EventState.QUEUED;
      event.updatedAt = now.toISOString();
      this.repository.save(event);
      return { event, isDuplicate: false };
    }

    // Existing event: idempotent, do not reschedule
    return { event, isDuplicate: true };
  }

  getEvent(eventId: string): Event | null {
    return this.repository.getByEventId(eventId);
  }
}
