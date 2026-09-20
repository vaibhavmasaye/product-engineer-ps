import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../../src/database/index.ts';
import { EventRepository } from '../../src/repositories/EventRepository.ts';
import { EventService } from '../../src/services/EventService.ts';
import { MockClock } from '../../src/utils/MockClock.ts';
import { EventState } from '../../src/entities/Event.ts';

test('Concurrency: claimOneQueued ensures mutual exclusion and prevents duplicate claims', async () => {
  const db = new Database({ dbPath: ':memory:' });
  const repo = new EventRepository(db);
  const clock = new MockClock();
  const service = new EventService(repo, clock);

  // Ingest a single event
  await service.ingest({
    eventId: 'evt_lock_race_1',
    type: 'alert.triggered',
    occurredAt: '2026-09-17T10:00:00.000Z',
    payload: { source: 'monitoring' },
  });

  // Verify it is QUEUED
  assert.strictEqual(repo.getByEventId('evt_lock_race_1')?.state, EventState.QUEUED);

  // Simulate multiple workers racing to claim the single event
  const workerAttempts = await Promise.all([
    Promise.resolve().then(() => repo.claimOneQueued()),
    Promise.resolve().then(() => repo.claimOneQueued()),
    Promise.resolve().then(() => repo.claimOneQueued()),
  ]);

  // Exactly one worker must succeed in claiming the event
  const successfulClaims = workerAttempts.filter((e) => e !== null);
  const failedClaims = workerAttempts.filter((e) => e === null);

  assert.strictEqual(successfulClaims.length, 1);
  assert.strictEqual(failedClaims.length, 2);

  assert.strictEqual(successfulClaims[0]!.eventId, 'evt_lock_race_1');
  assert.strictEqual(successfulClaims[0]!.state, EventState.PROCESSING);

  db.close();
});

