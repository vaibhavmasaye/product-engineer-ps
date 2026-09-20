import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface DatabaseOptions {
  dbPath?: string;
}

export class Database {
  private db: DatabaseSync;
  private readonly dbPath: string;

  constructor(options: DatabaseOptions = {}) {
    this.dbPath = options.dbPath || process.env.DATABASE_PATH || ':memory:';

    if (this.dbPath !== ':memory:') {
      const dir = path.dirname(path.resolve(this.dbPath));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.runMigrations();
  }

  get raw(): DatabaseSync {
    return this.db;
  }

  runMigrations(): void {
    // Read and run migration scripts
    const migrationsDir = path.resolve(process.cwd(), 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        this.db.exec(sql);
      }
    }
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string) {
    return this.db.prepare(sql);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }
}

let defaultDbInstance: Database | null = null;

export function getDatabase(options?: DatabaseOptions): Database {
  if (!defaultDbInstance) {
    defaultDbInstance = new Database(options);
  }
  return defaultDbInstance;
}

export function resetDefaultDatabase(): void {
  if (defaultDbInstance) {
    try {
      defaultDbInstance.close();
    } catch {
      // ignore
    }
    defaultDbInstance = null;
  }
}

