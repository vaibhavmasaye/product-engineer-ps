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

test('AC4a: Sequential duplicate ingestion is idempotent and prevents duplicate delivery jobs', async () => {
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

  const payload = {
    eventId: 'evt_seq_dup_001',
    type: 'incident.created',
    occurredAt: '2026-09-17T10:00:00.000Z',
    payload: { title: 'Network spike' },
  };

  // First submission
  const res1 = await eventService.ingest(payload);
  assert.strictEqual(res1.isDuplicate, false);
  assert.strictEqual(res1.event.state, EventState.QUEUED);

  // Second submission with identical eventId (even if payload slightly differs)
  const res2 = await eventService.ingest({
    ...payload,
    payload: { title: 'Network spike duplicate' },
  });
  assert.strictEqual(res2.isDuplicate, true);

  // Both submissions return the exact same logical event
  assert.strictEqual(res1.event.id, res2.event.id);
  assert.strictEqual(res1.event.eventId, res2.event.eventId);

  // Only one event exists in repository
  const allEvents = eventRepository.listAll();
  assert.strictEqual(allEvents.length, 1);
  assert.strictEqual(allEvents[0].eventId, 'evt_seq_dup_001');

  // Delivery worker runs once
  assert.strictEqual(await worker.claimAndDeliver(), true);
  assert.strictEqual(eventRepository.getByEventId('evt_seq_dup_001')!.state, EventState.SUCCESS);

  // Worker runs again -> no duplicate work
  assert.strictEqual(await worker.claimAndDeliver(), false);

  // Exactly one attempt recorded
  const attempts = attemptRepository.getByEventId('evt_seq_dup_001');
  assert.strictEqual(attempts.length, 1);
  assert.strictEqual(fakeHttp.callCount(), 1);

  db.close();
});

