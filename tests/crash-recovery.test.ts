import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
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

test('Crash Recovery: Event is persisted in DB before worker claims or delivers', async () => {
  const db = new Database({ dbPath: ':memory:' });
  const eventRepository = new EventRepository(db);
  const clock = new MockClock();
  const eventService = new EventService(eventRepository, clock);

  // Ingest
  await eventService.ingest({
    eventId: 'evt_persist_001',
    type: 'order.created',
    occurredAt: '2026-09-17T10:00:00.000Z',
    payload: { item: 'widget' },
  });

  // Check event exists in DB before worker ever runs
  const event = eventRepository.getByEventId('evt_persist_001');
  assert.ok(event);
  assert.strictEqual(event.state, EventState.QUEUED);
  assert.strictEqual(event.eventId, 'evt_persist_001');

  db.close();
});

test('Crash Recovery: Stranded PROCESSING event survives process crash and is redelivered on restart', async () => {
  const testDbFile = path.resolve(process.cwd(), `tmp_test_crash_${Date.now()}.db`);
  if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);

  try {
    // 1. Process 1 starts up
    const db1 = new Database({ dbPath: testDbFile });
    const repo1 = new EventRepository(db1);
    const clock1 = new MockClock();
    const service1 = new EventService(repo1, clock1);

    await service1.ingest({
      eventId: 'evt_crash_001',
      type: 'incident.critical',
      occurredAt: '2026-09-17T10:00:00.000Z',
      payload: { system: 'auth' },
    });

    // Simulate worker claiming event and setting state to PROCESSING
    const claimedEvent = repo1.claimOneQueued();
    assert.ok(claimedEvent);
    assert.strictEqual(claimedEvent.state, EventState.PROCESSING);

    // Verify DB reflects PROCESSING state
    const beforeCrash = repo1.getByEventId('evt_crash_001');
    assert.strictEqual(beforeCrash?.state, EventState.PROCESSING);

    // 2. SIMULATE HARD CRASH: db1 is closed abruptly, process dies
    db1.close();

    // 3. Process 2 restarts with a fresh connection to the same persistent DB
    const db2 = new Database({ dbPath: testDbFile });
    const repo2 = new EventRepository(db2);
    const attemptRepo2 = new AttemptRepository(db2);
    const clock2 = new MockClock();
    const fakeHttp2 = new FakeHttpTransport();
    const webhookUrl = 'http://test-receiver:3001/webhook';
    fakeHttp2.addResponse(webhookUrl, { statusCode: 200, body: 'Recovered OK' });

    // On startup: recover stranded processing events
    const recoveredCount = repo2.recoverStrandedProcessingEvents();
    assert.strictEqual(recoveredCount, 1);

    const afterRecovery = repo2.getByEventId('evt_crash_001');
    assert.strictEqual(afterRecovery?.state, EventState.QUEUED);

    // Worker can now claim and deliver successfully
    const worker2 = new DeliveryWorker(
      repo2,
      attemptRepo2,
      fakeHttp2,
      new RetryPolicy(),
      clock2,
      { webhookUrl }
    );

    const worked = await worker2.claimAndDeliver();
    assert.strictEqual(worked, true);

    const finalEvent = repo2.getByEventId('evt_crash_001');
    assert.strictEqual(finalEvent?.state, EventState.SUCCESS);

    const attempts = attemptRepo2.getByEventId('evt_crash_001');
    assert.strictEqual(attempts.length, 1);
    assert.strictEqual(attempts[0].outcome, Outcome.SUCCESS);

    db2.close();
  } finally {
    if (fs.existsSync(testDbFile)) {
      try {
        fs.unlinkSync(testDbFile);
      } catch {
        // ignore
      }
    }
  }
});

test('Crash Recovery: Stranded RECEIVED event is re-queued on restart', async () => {
  const db = new Database({ dbPath: ':memory:' });
  const repo = new EventRepository(db);
  const service = new EventService(repo, new MockClock());
  await service.ingest({ eventId: 'evt_received_recovery', type: 'incident.created',
    occurredAt: '2026-09-17T10:00:00.000Z', payload: {} });
  // Simulate a crash between durable ingestion and RECEIVED -> QUEUED transition.
  repo.save({ ...repo.getByEventId('evt_received_recovery')!, state: EventState.RECEIVED });
  assert.equal(repo.recoverStrandedProcessingEvents(), 1);
  assert.equal(repo.getByEventId('evt_received_recovery')?.state, EventState.QUEUED);
  db.close();
});
