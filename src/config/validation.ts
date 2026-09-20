export const MAX_TIMER_MS = 2_147_483_647;

export function integerInRange(name: string, value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function httpUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('WEBHOOK_URL must be an absolute HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('WEBHOOK_URL must use HTTP(S) without embedded credentials');
  }
  return value;
}

export function environmentNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+(?:\.\d+)?$/.test(raw.trim())) throw new Error(`${name} must be a decimal number`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}
