import type { SQLOutputValue } from 'node:sqlite';

export type DatabaseRow = Record<string, SQLOutputValue>;

export function textColumn(row: DatabaseRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Invalid text column: ${key}`);
  return value;
}

export function nullableTextColumn(row: DatabaseRow, key: string): string | null {
  return row[key] === null ? null : textColumn(row, key);
}

export function numberColumn(row: DatabaseRow, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid number column: ${key}`);
  }
  return value;
}

export function enumColumn<T extends string>(row: DatabaseRow, key: string, values: readonly T[]): T {
  const value = textColumn(row, key);
  const match = values.find(candidate => candidate === value);
  if (match === undefined) throw new Error(`Invalid enum column: ${key}`);
  return match;
}
