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

test('AC1: Successful delivery to reachable webhook', async () => {
  const db = new Database({ dbPath: ':memory:' });
  const eventRepository = new EventRepository(db);
  const attemptRepository = new AttemptRepository(db);
  const clock = new MockClock(new Date('2026-09-17T10:00:00.000Z'));
  const fakeHttp = new FakeHttpTransport();
  const webhookUrl = 'http://test-receiver:3001/webhook';

  fakeHttp.addResponse(webhookUrl, { statusCode: 200, body: '{"received":true}' });

  const eventService = new EventService(eventRepository, clock);
  const worker = new DeliveryWorker(
    eventRepository,
    attemptRepository,
    fakeHttp,
    new RetryPolicy(),
    clock,
    { webhookUrl }
  );

  // Ingest valid event
  const ingestResult = await eventService.ingest({
    eventId: 'evt_ac1_001',
    type: 'incident.created',
    occurredAt: '2026-09-17T10:00:00.000Z',
    payload: { incidentId: 'inc_123', severity: 'high' },
  });

  assert.strictEqual(ingestResult.isDuplicate, false);
  assert.strictEqual(ingestResult.event.state, EventState.QUEUED);

  // Worker claims and delivers
  const worked = await worker.claimAndDeliver();
  assert.strictEqual(worked, true);

  // Verify Event state transitioned to SUCCESS
  const deliveredEvent = eventRepository.getByEventId('evt_ac1_001');
  assert.ok(deliveredEvent);
  assert.strictEqual(deliveredEvent.state, EventState.SUCCESS);
  assert.strictEqual(deliveredEvent.nextRetryAt, null);

  // Verify attempt record
  const attempts = attemptRepository.getByEventId('evt_ac1_001');
  assert.strictEqual(attempts.length, 1);
  assert.strictEqual(attempts[0].attempt_number, 1);
  assert.strictEqual(attempts[0].outcome, Outcome.SUCCESS);
  assert.strictEqual(attempts[0].http_status_code, 200);
  assert.strictEqual(attempts[0].error_type, null);

  // Verify payload delivered to transport
  const calls = fakeHttp.getCalls();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, webhookUrl);
  assert.strictEqual(calls[0].payload.eventId, 'evt_ac1_001');

  db.close();
});

