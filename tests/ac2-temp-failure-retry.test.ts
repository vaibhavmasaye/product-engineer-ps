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

test('AC2: Temporary failure and retry leads to eventual success', async () => {
  const db = new Database({ dbPath: ':memory:' });
  const eventRepository = new EventRepository(db);
  const attemptRepository = new AttemptRepository(db);
  const clock = new MockClock(new Date('2026-09-17T10:00:00.000Z'));
  const fakeHttp = new FakeHttpTransport();
  const webhookUrl = 'http://test-receiver:3001/webhook';

  // Attempt 1 fails with 503 Service Unavailable, Attempt 2 succeeds with 200 OK
  fakeHttp.addResponse(webhookUrl, { statusCode: 503, body: 'Service Unavailable' });
  fakeHttp.addResponse(webhookUrl, { statusCode: 200, body: 'OK' });

  // Policy with zero jitter for deterministic delay calculation
  const retryPolicy = new RetryPolicy({
    maxAttempts: 5,
    initialDelayMs: 5000,
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

  // 1. Ingest event
  await eventService.ingest({
    eventId: 'evt_ac2_001',
    type: 'incident.escalated',
    occurredAt: '2026-09-17T10:00:00.000Z',
    payload: { incidentId: 'inc_555' },
  });

  // 2. First delivery attempt: fails with 503
  const workedFirst = await worker.claimAndDeliver();
  assert.strictEqual(workedFirst, true);

  const eventAfterFirst = eventRepository.getByEventId('evt_ac2_001');
  assert.ok(eventAfterFirst);
  assert.strictEqual(eventAfterFirst.state, EventState.QUEUED);
  assert.ok(eventAfterFirst.nextRetryAt);

  // Verify attempt #1 recorded as RETRYABLE
  const attemptsAfterFirst = attemptRepository.getByEventId('evt_ac2_001');
  assert.strictEqual(attemptsAfterFirst.length, 1);
  assert.strictEqual(attemptsAfterFirst[0].attempt_number, 1);
  assert.strictEqual(attemptsAfterFirst[0].outcome, Outcome.RETRYABLE);
  assert.strictEqual(attemptsAfterFirst[0].http_status_code, 503);

  // 3. Immediately trying to claim again should yield nothing because nextRetryAt is in the future
  const workedBeforeDelay = await worker.claimAndDeliver();
  assert.strictEqual(workedBeforeDelay, false);

  // 4. Advance mock clock past backoff delay (5000ms)
  clock.advance(5500);

  // 5. Second delivery attempt: worker claims and succeeds
  const workedSecond = await worker.claimAndDeliver();
  assert.strictEqual(workedSecond, true);

  const eventAfterSecond = eventRepository.getByEventId('evt_ac2_001');
  assert.ok(eventAfterSecond);
  assert.strictEqual(eventAfterSecond.state, EventState.SUCCESS);
  assert.strictEqual(eventAfterSecond.nextRetryAt, null);

  // Verify both attempts recorded in order
  const finalAttempts = attemptRepository.getByEventId('evt_ac2_001');
  assert.strictEqual(finalAttempts.length, 2);

  assert.strictEqual(finalAttempts[0].attempt_number, 1);
  assert.strictEqual(finalAttempts[0].outcome, Outcome.RETRYABLE);
  assert.strictEqual(finalAttempts[0].http_status_code, 503);

  assert.strictEqual(finalAttempts[1].attempt_number, 2);
  assert.strictEqual(finalAttempts[1].outcome, Outcome.SUCCESS);
  assert.strictEqual(finalAttempts[1].http_status_code, 200);

  db.close();
});
