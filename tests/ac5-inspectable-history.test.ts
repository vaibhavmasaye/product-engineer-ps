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
import { EventController } from '../src/controllers/EventController.ts';
import { EventState } from '../src/entities/Event.ts';
import { Outcome } from '../src/entities/DeliveryAttempt.ts';

test('AC5: Inspectable delivery state and ordered attempt history', async () => {
  const db = new Database({ dbPath: ':memory:' });
  const eventRepository = new EventRepository(db);
  const attemptRepository = new AttemptRepository(db);
  const clock = new MockClock(new Date('2026-09-17T10:00:00.000Z'));
  const fakeHttp = new FakeHttpTransport();
  const webhookUrl = 'http://test-receiver:3001/webhook';

  fakeHttp.addResponse(webhookUrl, { statusCode: 503, body: 'Service Unavailable' });
  fakeHttp.addResponse(webhookUrl, { statusCode: 200, body: 'OK' });

  const retryPolicy = new RetryPolicy({
    maxAttempts: 5,
    initialDelayMs: 5000,
    jitterPercent: 0,
  });

  const eventService = new EventService(eventRepository, clock);
  const controller = new EventController(eventService, attemptRepository);
  const worker = new DeliveryWorker(
    eventRepository,
    attemptRepository,
    fakeHttp,
    retryPolicy,
    clock,
    { webhookUrl }
  );

  const eventId = 'evt_ac5_history_001';

  // Ingest via controller
  const postRes = await controller.create({
    method: 'POST',
    url: '/events',
    params: {},
    body: {
      eventId,
      type: 'payment.completed',
      occurredAt: '2026-09-17T10:00:00.000Z',
      payload: { amount: 200, currency: 'USD' },
    },
  });

  assert.strictEqual(postRes.status, 201);
  assert.strictEqual(postRes.body.state, EventState.QUEUED);

  // Attempt 1 at T=10:00:00
  await worker.claimAndDeliver();

  // Inspect state via controller after attempt 1
  const getRes1 = await controller.get({
    method: 'GET',
    url: `/events/${eventId}`,
    params: { eventId },
  });
  assert.strictEqual(getRes1.status, 200);
  assert.strictEqual(getRes1.body.state, EventState.QUEUED);
  assert.ok(getRes1.body.nextRetryAt);

  // Inspect attempts via controller after attempt 1
  const attemptsRes1 = await controller.getAttempts({
    method: 'GET',
    url: `/events/${eventId}/attempts`,
    params: { eventId },
  });
  assert.strictEqual(attemptsRes1.status, 200);
  assert.strictEqual(attemptsRes1.body.length, 1);
  assert.strictEqual(attemptsRes1.body[0].attempt_number, 1);
  assert.strictEqual(attemptsRes1.body[0].outcome, Outcome.RETRYABLE);
  assert.strictEqual(attemptsRes1.body[0].http_status_code, 503);

  // Advance clock 6 seconds
  clock.advance(6000);

  // Attempt 2 at T=10:00:06
  await worker.claimAndDeliver();

  // Inspect state after attempt 2
  const getRes2 = await controller.get({
    method: 'GET',
    url: `/events/${eventId}`,
    params: { eventId },
  });
  assert.strictEqual(getRes2.status, 200);
  assert.strictEqual(getRes2.body.state, EventState.SUCCESS);
  assert.strictEqual(getRes2.body.nextRetryAt, null);

  // Inspect full ordered attempt history
  const attemptsRes2 = await controller.getAttempts({
    method: 'GET',
    url: `/events/${eventId}/attempts`,
    params: { eventId },
  });
  assert.strictEqual(attemptsRes2.status, 200);
  assert.strictEqual(attemptsRes2.body.length, 2);

  const [att1, att2] = attemptsRes2.body;
  assert.strictEqual(att1.attempt_number, 1);
  assert.strictEqual(att1.outcome, Outcome.RETRYABLE);
  assert.strictEqual(att1.http_status_code, 503);
  assert.strictEqual(att1.started_at, '2026-09-17T10:00:00.000Z');

  assert.strictEqual(att2.attempt_number, 2);
  assert.strictEqual(att2.outcome, Outcome.SUCCESS);
  assert.strictEqual(att2.http_status_code, 200);
  assert.strictEqual(att2.started_at, '2026-09-17T10:00:06.000Z');

  // Verify chronological ordering
  assert.ok(Date.parse(att1.started_at) < Date.parse(att2.started_at));

  db.close();
});

