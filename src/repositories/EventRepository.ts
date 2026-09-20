import * as crypto from 'node:crypto';
import { Database, getDatabase } from '../database/index.ts';
import { type Event, EventState } from '../entities/Event.ts';

export interface CreateEventInput {
  eventId: string;
  type: string;
  occurredAt: string;
  payload: Record<string, any>;
}

export class EventRepository {
  private db: Database;

  constructor(db?: Database) {
    this.db = db || getDatabase();
  }

  findOrCreate(input: CreateEventInput, now: Date = new Date()): { event: Event; created: boolean } {
    const id = crypto.randomUUID();
    const nowIso = now.toISOString();
    const payloadStr = JSON.stringify(input.payload);

    return this.db.transaction(() => {
      const insertStmt = this.db.prepare(`
        INSERT INTO events (id, eventId, type, occurredAt, payload, state, nextRetryAt, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(eventId) DO NOTHING;
      `);

      const result = insertStmt.run(
        id,
        input.eventId,
        input.type,
        input.occurredAt,
        payloadStr,
        EventState.RECEIVED,
        nowIso,
        nowIso
      );

      const created = Number(result.changes) > 0;
      const selectStmt = this.db.prepare('SELECT * FROM events WHERE eventId = ?');
      const row = selectStmt.get(input.eventId) as any;

      if (!row) {
        throw new Error(`Failed to retrieve event for eventId: ${input.eventId}`);
      }

      return {
        event: this.mapRowToEvent(row),
        created,
      };
    });
  }

  getByEventId(eventId: string): Event | null {
    const stmt = this.db.prepare('SELECT * FROM events WHERE eventId = ?');
    const row = stmt.get(eventId) as any;
    return row ? this.mapRowToEvent(row) : null;
  }

  getById(id: string): Event | null {
    const stmt = this.db.prepare('SELECT * FROM events WHERE id = ?');
    const row = stmt.get(id) as any;
    return row ? this.mapRowToEvent(row) : null;
  }

  save(event: Event): void {
    const stmt = this.db.prepare(`
      UPDATE events
      SET state = ?, nextRetryAt = ?, updatedAt = ?, payload = ?, type = ?, occurredAt = ?
      WHERE id = ?
    `);

    stmt.run(
      event.state,
      event.nextRetryAt ?? null,
      event.updatedAt,
      JSON.stringify(event.payload),
      event.type,
      event.occurredAt,
      event.id
    );
  }

  claimOneQueued(now: Date = new Date()): Event | null {
    const nowIso = now.toISOString();

    return this.db.transaction(() => {
      // Find one eligible queued event
      const findStmt = this.db.prepare(`
        SELECT * FROM events
        WHERE state = ? AND (nextRetryAt IS NULL OR nextRetryAt <= ?)
        ORDER BY createdAt ASC
        LIMIT 1
      `);
      const row = findStmt.get(EventState.QUEUED, nowIso) as any;

      if (!row) {
        return null;
      }

      const event = this.mapRowToEvent(row);
      event.state = EventState.PROCESSING;
      event.updatedAt = nowIso;

      const updateStmt = this.db.prepare(`
        UPDATE events
        SET state = ?, updatedAt = ?
        WHERE id = ? AND state = ?
      `);
      const result = updateStmt.run(EventState.PROCESSING, nowIso, event.id, EventState.QUEUED);

      if (Number(result.changes) === 0) {
        // Was claimed by another worker concurrently
        return null;
      }

      return event;
    });
  }

  recoverStrandedProcessingEvents(now: Date = new Date()): number {
    const stmt = this.db.prepare(`
      UPDATE events
      SET state = ?, updatedAt = ?
      WHERE state = ?
    `);
    const result = stmt.run(EventState.QUEUED, now.toISOString(), EventState.PROCESSING);
    return Number(result.changes);
  }

  listAll(): Event[] {
    const stmt = this.db.prepare('SELECT * FROM events ORDER BY createdAt ASC');
    const rows = stmt.all() as any[];
    return rows.map((r) => this.mapRowToEvent(r));
  }

  private mapRowToEvent(row: any): Event {
    return {
      id: row.id,
      eventId: row.eventId,
      type: row.type,
      occurredAt: row.occurredAt,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      state: row.state as EventState,
      nextRetryAt: row.nextRetryAt || null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
