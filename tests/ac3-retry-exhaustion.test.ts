import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/database/index.ts';
import { EventRepository } from '../src/repositories/EventRepository.ts';
import { AttemptRepository } from '../src/repositories/AttemptRepository.ts';
import { EventService } from '../src/services/EventService.ts';
import { DeliveryWorker } from '../src/workers/DeliveryWorker.ts';
import { FakeHttpTransport } from '../src/transport/FakeHttpTransport.ts';
import { RetryPolicy } from '../src/services/RetryPolicy.ts';
import { MockClock } from '../src/utils/MockClock.ts';
import { EventState } from '../src/entities/Event.ts';
import { Outcome } from '../src/entities/DeliveryAttempt.ts';

test('AC3: Bounded failure stops delivery after configured attempt limit', async () => {
  const db = new Database({ dbPath: ':memory:' });
  const eventRepository = new EventRepository(db);
  const attemptRepository = new AttemptRepository(db);
  const clock = new MockClock(new Date('2026-09-17T10:00:00.000Z'));
  const fakeHttp = new FakeHttpTransport();
  const webhookUrl = 'http://test-receiver:3001/webhook';

  const maxAttempts = 3;
  for (let i = 0; i < maxAttempts; i++) {
    fakeHttp.addResponse(webhookUrl, { statusCode: 503, body: 'Unavailable' });
  }

  const retryPolicy = new RetryPolicy({
    maxAttempts,
    initialDelayMs: 2000,
    jitterPercent: 0,
  });

  const eventService = new EventService(eventRepository, clock);
  const worker = new DeliveryWorker(
    eventRepository,
    attemptRepository,
    fakeHttp,
    retryPolicy,
    clock,
    { webhookUrl }
  );

  // Ingest event
  await eventService.ingest({
    eventId: 'evt_ac3_001',
    type: 'incident.critical',
    occurredAt: '2026-09-17T10:00:00.000Z',
    payload: { test: 'exhaustion' },
  });

  // Attempt 1: fails, re-queued
  assert.strictEqual(await worker.claimAndDeliver(), true);
  let event = eventRepository.getByEventId('evt_ac3_001')!;
  assert.strictEqual(event.state, EventState.QUEUED);

  // Advance clock past attempt 1 backoff (2000ms)
  clock.advance(2100);

  // Attempt 2: fails, re-queued
  assert.strictEqual(await worker.claimAndDeliver(), true);
  event = eventRepository.getByEventId('evt_ac3_001')!;
  assert.strictEqual(event.state, EventState.QUEUED);

  // Advance clock past attempt 2 backoff (4000ms)
  clock.advance(4100);

  // Attempt 3: fails, reaches max attempts -> state becomes FAILED
  assert.strictEqual(await worker.claimAndDeliver(), true);
  event = eventRepository.getByEventId('evt_ac3_001')!;
  assert.strictEqual(event.state, EventState.FAILED);
  assert.strictEqual(event.nextRetryAt, null);

  // Attempt 4 should not happen
  clock.advance(10000);
  const workedAfterExhaustion = await worker.claimAndDeliver();
  assert.strictEqual(workedAfterExhaustion, false);

  // Verify exactly 3 attempts recorded
  const attempts = attemptRepository.getByEventId('evt_ac3_001');
  assert.strictEqual(attempts.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(attempts[i].attempt_number, i + 1);
    assert.strictEqual(attempts[i].outcome, Outcome.RETRYABLE);
    assert.strictEqual(attempts[i].http_status_code, 503);
  }

  db.close();
});

test('AC3: Terminal failure (HTTP 400) stops retry immediately on first attempt', async () => {
  const db = new Database({ dbPath: ':memory:' });
  const eventRepository = new EventRepository(db);
  const attemptRepository = new AttemptRepository(db);
  const clock = new MockClock();
  const fakeHttp = new FakeHttpTransport();
  const webhookUrl = 'http://test-receiver:3001/webhook';

  fakeHttp.addResponse(webhookUrl, { statusCode: 400, body: 'Bad Request' });

  const eventService = new EventService(eventRepository, clock);
  const worker = new DeliveryWorker(
    eventRepository,
    attemptRepository,
    fakeHttp,
    new RetryPolicy({ maxAttempts: 5 }),
    clock,
    { webhookUrl }
  );

  await eventService.ingest({
    eventId: 'evt_terminal_001',
    type: 'incident.created',
    occurredAt: new Date().toISOString(),
    payload: { bad: 'data' },
  });

  const worked = await worker.claimAndDeliver();
  assert.strictEqual(worked, true);

  const event = eventRepository.getByEventId('evt_terminal_001')!;
  assert.strictEqual(event.state, EventState.FAILED);
  assert.strictEqual(event.nextRetryAt, null);

  const attempts = attemptRepository.getByEventId('evt_terminal_001');
  assert.strictEqual(attempts.length, 1);
  assert.strictEqual(attempts[0].outcome, Outcome.TERMINAL);
  assert.strictEqual(attempts[0].http_status_code, 400);

  // Should not retry
  clock.advance(60000);
  assert.strictEqual(await worker.claimAndDeliver(), false);

  db.close();
});

