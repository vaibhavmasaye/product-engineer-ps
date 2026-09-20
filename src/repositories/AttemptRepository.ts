import * as crypto from 'node:crypto';
import { Database, getDatabase } from '../database/index.ts';
import { type DeliveryAttempt, Outcome } from '../entities/DeliveryAttempt.ts';

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

  getByEventId(eventId: string): DeliveryAttempt[] {
    const stmt = this.db.prepare(`
      SELECT * FROM delivery_attempts
      WHERE eventId = ?
      ORDER BY attempt_number ASC
    `);

    const rows = stmt.all(eventId) as any[];
    return rows.map((r) => this.mapRowToAttempt(r));
  }

  lastAttemptFor(eventId: string): DeliveryAttempt | null {
    const stmt = this.db.prepare(`
      SELECT * FROM delivery_attempts
      WHERE eventId = ?
      ORDER BY attempt_number DESC
      LIMIT 1
    `);

    const row = stmt.get(eventId) as any;
    return row ? this.mapRowToAttempt(row) : null;
  }

  nextAttemptNumber(eventId: string): number {
    const last = this.lastAttemptFor(eventId);
    return (last?.attempt_number ?? 0) + 1;
  }

  private mapRowToAttempt(row: any): DeliveryAttempt {
    return {
      id: row.id,
      eventId: row.eventId,
      attempt_number: Number(row.attempt_number),
      started_at: row.started_at,
      completed_at: row.completed_at || null,
      http_status_code: row.http_status_code !== null ? Number(row.http_status_code) : null,
      error_type: row.error_type || null,
      outcome: row.outcome as Outcome,
      response_body: row.response_body || null,
      createdAt: row.createdAt,
    };
  }
}
