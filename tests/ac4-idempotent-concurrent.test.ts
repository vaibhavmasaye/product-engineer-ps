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

test('AC4b: Concurrent duplicate submissions are idempotent via database constraint', async () => {
  const db = new Database({ dbPath: ':memory:' });
  const eventRepository = new EventRepository(db);
  const attemptRepository = new AttemptRepository(db);
  const clock = new MockClock();
  const fakeHttp = new FakeHttpTransport();
  const webhookUrl = 'http://test-receiver:3001/webhook';

  fakeHttp.setDefaultResponse({ statusCode: 200 });

  const eventService = new EventService(eventRepository, clock);
  const worker = new DeliveryWorker(
    eventRepository,
    attemptRepository,
    fakeHttp,
    new RetryPolicy(),
    clock,
    { webhookUrl }
  );

  const eventId = 'evt_concurrent_race_999';
  const rawEvent = {
    eventId,
    type: 'order.placed',
    occurredAt: '2026-09-17T10:00:00.000Z',
    payload: { amount: 150 },
  };

  // Launch 10 concurrent ingestion promises
  const promises = Array.from({ length: 10 }, () => eventService.ingest(rawEvent));
  const results = await Promise.all(promises);

  // All 10 returned the identical eventId and internal id
  const firstId = results[0].event.id;
  for (const res of results) {
    assert.strictEqual(res.event.id, firstId);
    assert.strictEqual(res.event.eventId, eventId);
  }

  // Exactly one returned isDuplicate = false, remaining 9 returned isDuplicate = true
  const firstTimeCount = results.filter((r) => !r.isDuplicate).length;
  const duplicateCount = results.filter((r) => r.isDuplicate).length;
  assert.strictEqual(firstTimeCount, 1);
  assert.strictEqual(duplicateCount, 9);

  // Exactly one event in the database
  const allEvents = eventRepository.listAll();
  assert.strictEqual(allEvents.length, 1);
  assert.strictEqual(allEvents[0].id, firstId);
  assert.strictEqual(allEvents[0].state, EventState.QUEUED);

  // Delivery worker runs: delivers only once
  const delivered = await worker.claimAndDeliver();
  assert.strictEqual(delivered, true);

  // No further work
  const deliveredAgain = await worker.claimAndDeliver();
  assert.strictEqual(deliveredAgain, false);

  // Exactly 1 attempt in history
  const attempts = attemptRepository.getByEventId(eventId);
  assert.strictEqual(attempts.length, 1);
  assert.strictEqual(fakeHttp.callCount(), 1);

  db.close();
});

