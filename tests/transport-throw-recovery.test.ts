import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/database/index.ts';
import { EventRepository } from '../src/repositories/EventRepository.ts';
import { AttemptRepository } from '../src/repositories/AttemptRepository.ts';
import { EventService } from '../src/services/EventService.ts';
import { DeliveryWorker } from '../src/workers/DeliveryWorker.ts';
import { RetryPolicy } from '../src/services/RetryPolicy.ts';
import { MockClock } from '../src/utils/MockClock.ts';
import { EventState } from '../src/entities/Event.ts';
import { Outcome } from '../src/entities/DeliveryAttempt.ts';
import type { HttpTransport } from '../src/transport/HttpTransport.ts';

test('Failure handling: transport rejection is recorded and retried', async () => {
  const db = new Database({ dbPath: ':memory:' });
  const events = new EventRepository(db);
  const attempts = new AttemptRepository(db);
  const clock = new MockClock(new Date('2026-09-17T10:00:00.000Z'));
  let calls = 0;
  const transport: HttpTransport = {
    async deliver() {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' });
      return { statusCode: 200, body: 'ok', error: null };
    },
  };
  const service = new EventService(events, clock);
  await service.ingest({ eventId: 'evt_throw_recovery', type: 'incident.created',
    occurredAt: '2026-09-17T10:00:00.000Z', payload: {} });
  const worker = new DeliveryWorker(events, attempts, transport,
    new RetryPolicy({ initialDelayMs: 1000, maxDelayMs: 1000, jitterPercent: 0 }), clock,
    { webhookUrl: 'http://receiver.test/webhook' });

  assert.equal(await worker.claimAndDeliver(), true);
  assert.equal(events.getByEventId('evt_throw_recovery')?.state, EventState.QUEUED);
  assert.equal(attempts.getByEventId('evt_throw_recovery')[0].outcome, Outcome.RETRYABLE);
  clock.advance(1001);
  assert.equal(await worker.claimAndDeliver(), true);
  assert.equal(events.getByEventId('evt_throw_recovery')?.state, EventState.SUCCESS);
  assert.equal(attempts.getByEventId('evt_throw_recovery').length, 2);
  db.close();
});

