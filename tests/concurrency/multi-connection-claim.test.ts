import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Database } from '../../src/database/index.ts';
import { EventRepository } from '../../src/repositories/EventRepository.ts';
import { EventService } from '../../src/services/EventService.ts';
import { MockClock } from '../../src/utils/MockClock.ts';
import { EventState } from '../../src/entities/Event.ts';

test('Concurrency: separate SQLite connections cannot claim the same event', async () => {
  const dbPath = path.resolve(process.cwd(), `tmp_multi_connection_${Date.now()}.db`);
  try {
    const writer = new Database({ dbPath });
    const writerRepo = new EventRepository(writer);
    await new EventService(writerRepo, new MockClock()).ingest({
      eventId: 'evt_multi_connection', type: 'incident.created',
      occurredAt: '2026-09-17T10:00:00.000Z', payload: {},
    });
    const dbA = new Database({ dbPath });
    const dbB = new Database({ dbPath });
    const claims = await Promise.all([
      Promise.resolve(new EventRepository(dbA).claimOneQueued()),
      Promise.resolve(new EventRepository(dbB).claimOneQueued()),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(claims.filter(claim => claim === null).length, 1);
    assert.equal(new EventRepository(dbA).getByEventId('evt_multi_connection')?.state, EventState.PROCESSING);
    dbA.close();
    dbB.close();
    writer.close();
  } finally {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
});

