import test from 'node:test';
import assert from 'node:assert/strict';
import { EventValidator } from '../src/validators/EventValidator.ts';
import { EventService } from '../src/services/EventService.ts';
import { EventRepository } from '../src/repositories/EventRepository.ts';
import { Database } from '../src/database/index.ts';
import { MockClock } from '../src/utils/MockClock.ts';

test('EventValidator: Rejects missing or empty eventId', () => {
  const res1 = EventValidator.validate({
    type: 'incident.created',
    occurredAt: '2026-09-17T10:00:00Z',
    payload: {},
  });
  assert.strictEqual(res1.valid, false);
  assert.ok(res1.errors.some((e) => e.includes('eventId')));

  const res2 = EventValidator.validate({
    eventId: '   ',
    type: 'incident.created',
    occurredAt: '2026-09-17T10:00:00Z',
    payload: {},
  });
  assert.strictEqual(res2.valid, false);
});

test('EventValidator: Rejects missing or empty type', () => {
  const res = EventValidator.validate({
    eventId: 'evt_1',
    occurredAt: '2026-09-17T10:00:00Z',
    payload: {},
  });
  assert.strictEqual(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes('type')));
});

test('EventValidator: Rejects invalid or non-ISO occurredAt', () => {
  const res1 = EventValidator.validate({
    eventId: 'evt_1',
    type: 'incident.created',
    occurredAt: 'not-a-date',
    payload: {},
  });
  assert.strictEqual(res1.valid, false);
  assert.ok(res1.errors.some((e) => e.includes('occurredAt')));

  const res2 = EventValidator.validate({
    eventId: 'evt_1',
    type: 'incident.created',
    payload: {},
  });
  assert.strictEqual(res2.valid, false);
});

test('EventValidator: Rejects invalid payload (null, array, primitive)', () => {
  const res1 = EventValidator.validate({
    eventId: 'evt_1',
    type: 'incident.created',
    occurredAt: '2026-09-17T10:00:00Z',
    payload: 'not-an-object',
  });
  assert.strictEqual(res1.valid, false);

  const res2 = EventValidator.validate({
    eventId: 'evt_1',
    type: 'incident.created',
    occurredAt: '2026-09-17T10:00:00Z',
    payload: [1, 2, 3],
  });
  assert.strictEqual(res2.valid, false);

  const res3 = EventValidator.validate({
    eventId: 'evt_1',
    type: 'incident.created',
    occurredAt: '2026-09-17T10:00:00Z',
    payload: null,
  });
  assert.strictEqual(res3.valid, false);
});

test('EventService: Throws ValidationError on invalid submission', async () => {
  const db = new Database({ dbPath: ':memory:' });
  const service = new EventService(new EventRepository(db), new MockClock());

  await assert.rejects(
    async () => service.ingest({}),
    /ValidationError/
  );

  db.close();
});

