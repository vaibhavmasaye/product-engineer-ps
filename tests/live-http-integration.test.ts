import test from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import { Database } from '../src/database/index.ts';
import { EventRepository } from '../src/repositories/EventRepository.ts';
import { AttemptRepository } from '../src/repositories/AttemptRepository.ts';
import { EventService } from '../src/services/EventService.ts';
import { DeliveryWorker } from '../src/workers/DeliveryWorker.ts';
import { RealHttpTransport } from '../src/transport/RealHttpTransport.ts';
import { RetryPolicy } from '../src/services/RetryPolicy.ts';
import { MockClock } from '../src/utils/MockClock.ts';
import { EventState } from '../src/entities/Event.ts';
import { Outcome } from '../src/entities/DeliveryAttempt.ts';

test('Core correctness: real HTTP receiver records retry then success', async () => {
  let requests = 0;
  const receiver = http.createServer((req, res) => {
    requests += 1;
    req.resume();
    res.writeHead(requests === 1 ? 503 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ requests }));
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const address = receiver.address();
  assert.ok(address && typeof address === 'object');
  const webhookUrl = `http://127.0.0.1:${address.port}/webhook`;

  const db = new Database({ dbPath: ':memory:' });
  const events = new EventRepository(db);
  const attempts = new AttemptRepository(db);
  const clock = new MockClock(new Date('2026-09-17T10:00:00.000Z'));
  await new EventService(events, clock).ingest({ eventId: 'evt_live_http', type: 'incident.created',
    occurredAt: '2026-09-17T10:00:00.000Z', payload: { severity: 'high' } });
  const worker = new DeliveryWorker(events, attempts, new RealHttpTransport(),
    new RetryPolicy({ initialDelayMs: 1000, maxDelayMs: 1000, jitterPercent: 0 }), clock,
    { webhookUrl });

  try {
    assert.equal(await worker.claimAndDeliver(), true);
    assert.equal(events.getByEventId('evt_live_http')?.state, EventState.QUEUED);
    clock.advance(1001);
    assert.equal(await worker.claimAndDeliver(), true);
    assert.equal(events.getByEventId('evt_live_http')?.state, EventState.SUCCESS);
    const history = attempts.getByEventId('evt_live_http');
    assert.deepEqual(history.map(attempt => [attempt.http_status_code, attempt.outcome]),
      [[503, Outcome.RETRYABLE], [200, Outcome.SUCCESS]]);
    assert.equal(requests, 2);
  } finally {
    db.close();
    await new Promise<void>((resolve, reject) => receiver.close(error => error ? reject(error) : resolve()));
  }
});

