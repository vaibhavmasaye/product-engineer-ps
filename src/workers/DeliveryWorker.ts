import { EventRepository } from '../repositories/EventRepository.ts';
import { AttemptRepository } from '../repositories/AttemptRepository.ts';
import type { HttpTransport } from '../transport/HttpTransport.ts';
import { RetryClassifier } from '../services/RetryClassifier.ts';
import { RetryPolicy } from '../services/RetryPolicy.ts';
import type { Clock } from '../utils/Clock.ts';
import { SystemClock } from '../utils/SystemClock.ts';
import { EventState, EventTransition } from '../entities/Event.ts';
import { Outcome } from '../entities/DeliveryAttempt.ts';
import type { WorkerConfig } from '../models/WorkerConfig.ts';
import { Metrics } from '../observability/Metrics.ts';

export class DeliveryWorker {
  private eventRepository: EventRepository;
  private attemptRepository: AttemptRepository;
  private transport: HttpTransport;
  private policy: RetryPolicy;
  private clock: Clock;
  private webhookUrl: string;
  private pollIntervalMs: number;
  private running: boolean = false;
  private metrics: Metrics;

  constructor(
    eventRepository: EventRepository,
    attemptRepository: AttemptRepository,
    transport: HttpTransport,
    policy: RetryPolicy = new RetryPolicy(),
    clock: Clock = new SystemClock(),
    config: WorkerConfig = { webhookUrl: process.env.WEBHOOK_URL || 'http://localhost:3001/webhook' },
    metrics: Metrics = new Metrics()
  ) {
    this.eventRepository = eventRepository;
    this.attemptRepository = attemptRepository;
    this.transport = transport;
    this.policy = policy;
    this.clock = clock;
    this.webhookUrl = config.webhookUrl;
    this.pollIntervalMs = config.pollIntervalMs ?? 1000;
    this.metrics = metrics;
  }

  async claimAndDeliver(): Promise<boolean> {
    const claimTime = this.clock.now();
    const event = this.eventRepository.claimOneQueued(claimTime);

    if (!event) {
      return false; // No work available right now
    }

    const attemptNumber = this.attemptRepository.nextAttemptNumber(event.eventId);
    if (attemptNumber > this.policy.getMaxAttempts()) {
      event.state = EventState.FAILED;
      event.nextRetryAt = null;
      event.updatedAt = this.clock.now().toISOString();
      this.eventRepository.save(event);
      return true;
    }

    const startTime = this.clock.now();

    // Minimum event contract payload to deliver
    const deliveryPayload = {
      eventId: event.eventId,
      type: event.type,
      occurredAt: event.occurredAt,
      payload: event.payload,
    };

    // Attempt delivery via HTTP transport
    let result;
    try {
      result = await this.transport.deliver(this.webhookUrl, deliveryPayload);
    } catch (error: unknown) {
      // A transport implementation may reject instead of returning a result.
      // Convert that failure into the same durable retry path as fetch errors.
      result = {
        statusCode: null,
        body: null,
        headers: {},
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
    const endTime = this.clock.now();

    // Classify outcome
    const outcome = RetryClassifier.classify(result.statusCode, result.error);
    this.metrics.recordAttempt(outcome, result.statusCode);

    // Record immutable attempt
    let errorDesc: string | null = null;
    if (result.error) {
      errorDesc = ('code' in result.error && typeof result.error.code === 'string')
        ? result.error.code : result.error.message;
    } else if (result.statusCode && result.statusCode >= 400) {
      errorDesc = `HTTP_${result.statusCode}`;
    }

    // State machine updates
    if (outcome === Outcome.SUCCESS) {
      EventTransition.transition(event.state, EventState.SUCCESS);
      event.state = EventState.SUCCESS;
      event.nextRetryAt = null;
    } else if (outcome === Outcome.RETRYABLE && attemptNumber < this.policy.getMaxAttempts()) {
      const delayMs = this.policy.nextRetryDelay(attemptNumber);
      const nextRetryDate = new Date(endTime.getTime() + delayMs);
      event.nextRetryAt = nextRetryDate.toISOString();
      EventTransition.transition(event.state, EventState.QUEUED);
      event.state = EventState.QUEUED;
    } else {
      // Terminal failure or exhausted max attempts
      EventTransition.transition(event.state, EventState.FAILED);
      event.state = EventState.FAILED;
      event.nextRetryAt = null;
    }

    event.updatedAt = endTime.toISOString();
    this.attemptRepository.createAndSaveEvent(
      {
        eventId: event.eventId,
        attempt_number: attemptNumber,
        started_at: startTime.toISOString(),
        completed_at: endTime.toISOString(),
        http_status_code: result.statusCode,
        error_type: errorDesc,
        outcome,
        response_body: result.body ? result.body.slice(0, 1000) : null,
      }, event, endTime);

    return true;
  }

  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      try {
        const worked = await this.claimAndDeliver();
        if (!worked) {
          await this.clock.sleep(this.pollIntervalMs);
        }
      } catch (err) {
        console.error('DeliveryWorker error during processing loop:', err);
        await this.clock.sleep(this.pollIntervalMs);
      }
    }
  }

  stop(): void {
    this.running = false;
  }
}
