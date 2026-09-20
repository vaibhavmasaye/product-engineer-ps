import { type DatabaseRow, textColumn, nullableTextColumn, numberColumn, enumColumn } from '../database/row.ts';
import * as crypto from 'node:crypto';
import { Database, getDatabase } from '../database/index.ts';
import { type DeliveryAttempt, Outcome } from '../entities/DeliveryAttempt.ts';
import type { Event } from '../entities/Event.ts';

export interface CreateAttemptInput {
  eventId: string;
  attempt_number: number;
  started_at: string;
  completed_at?: string | null;
  http_status_code?: number | null;
  error_type?: string | null;
  outcome: Outcome;
  response_body?: string | null;
}

export class AttemptRepository {
  private db: Database;

  constructor(db?: Database) {
    this.db = db || getDatabase();
  }

  create(input: CreateAttemptInput, now: Date = new Date()): DeliveryAttempt {
    const id = crypto.randomUUID();
    const createdAt = now.toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO delivery_attempts (
        id, eventId, attempt_number, started_at, completed_at,
        http_status_code, error_type, outcome, response_body, createdAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.eventId,
      input.attempt_number,
      input.started_at,
      input.completed_at ?? null,
      input.http_status_code ?? null,
      input.error_type ?? null,
      input.outcome,
      input.response_body ?? null,
      createdAt
    );

    return {
      id,
      eventId: input.eventId,
      attempt_number: input.attempt_number,
      started_at: input.started_at,
      completed_at: input.completed_at ?? null,
      http_status_code: input.http_status_code ?? null,
      error_type: input.error_type ?? null,
      outcome: input.outcome,
      response_body: input.response_body ?? null,
      createdAt,
    };
  }

  /** Persist the immutable attempt and resulting event state in one transaction. */
  createAndSaveEvent(input: CreateAttemptInput, event: Event, now: Date = new Date()): DeliveryAttempt {
    const attempt = this.createRecord(input, now);
    this.db.transaction(() => {
      this.insertRecord(attempt);
      const stmt = this.db.prepare(`UPDATE events SET state = ?, nextRetryAt = ?, updatedAt = ? WHERE id = ?`);
      stmt.run(event.state, event.nextRetryAt ?? null, event.updatedAt, event.id);
    });
    return attempt;
  }

  private createRecord(input: CreateAttemptInput, now: Date): DeliveryAttempt {
    return { id: crypto.randomUUID(), eventId: input.eventId, attempt_number: input.attempt_number,
      started_at: input.started_at, completed_at: input.completed_at ?? null,
      http_status_code: input.http_status_code ?? null, error_type: input.error_type ?? null,
      outcome: input.outcome, response_body: input.response_body ?? null, createdAt: now.toISOString() };
  }

  private insertRecord(attempt: DeliveryAttempt): void {
    this.db.prepare(`INSERT INTO delivery_attempts
      (id, eventId, attempt_number, started_at, completed_at, http_status_code, error_type, outcome, response_body, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      attempt.id, attempt.eventId, attempt.attempt_number, attempt.started_at, attempt.completed_at ?? null,
      attempt.http_status_code ?? null, attempt.error_type ?? null, attempt.outcome, attempt.response_body ?? null, attempt.createdAt);
  }

  getByEventId(eventId: string): DeliveryAttempt[] {
    const stmt = this.db.prepare(`
      SELECT * FROM delivery_attempts
      WHERE eventId = ?
      ORDER BY attempt_number ASC
    `);

    const rows = stmt.all(eventId);
    return rows.map((r) => this.mapRowToAttempt(r));
  }

  lastAttemptFor(eventId: string): DeliveryAttempt | null {
    const stmt = this.db.prepare(`
      SELECT * FROM delivery_attempts
      WHERE eventId = ?
      ORDER BY attempt_number DESC
      LIMIT 1
    `);

    const row = stmt.get(eventId);
    return row ? this.mapRowToAttempt(row) : null;
  }

  nextAttemptNumber(eventId: string): number {
    const last = this.lastAttemptFor(eventId);
    return (last?.attempt_number ?? 0) + 1;
  }

  private mapRowToAttempt(row: DatabaseRow): DeliveryAttempt {
    return {
      id: textColumn(row, 'id'),
      eventId: textColumn(row, 'eventId'),
      attempt_number: numberColumn(row, 'attempt_number'),
      started_at: textColumn(row, 'started_at'),
      completed_at: nullableTextColumn(row, 'completed_at'),
      http_status_code: row.http_status_code === null ? null : numberColumn(row, 'http_status_code'),
      error_type: nullableTextColumn(row, 'error_type'),
      outcome: enumColumn(row, 'outcome', Object.values(Outcome)),
      response_body: nullableTextColumn(row, 'response_body'),
      createdAt: textColumn(row, 'createdAt'),
    };
  }
}
