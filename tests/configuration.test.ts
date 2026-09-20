import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, receiverPort } from '../src/config/loadConfig.ts';
import { RetryPolicy } from '../src/services/RetryPolicy.ts';

test('Configuration: defaults preserve the documented local setup', () => {
  const config = loadConfig({});
  assert.equal(config.port, 8000);
  assert.equal(config.webhookUrl, 'http://localhost:3001/webhook');
  assert.equal(config.dbPath, './data/engine.db');
  assert.equal(config.pollIntervalMs, 1000);
  assert.equal(config.retryPolicy.getMaxAttempts(), 5);
  assert.equal(receiverPort({}), 3001);
});

test('Configuration: valid overrides and zero retry delay are accepted', () => {
  const config = loadConfig({ PORT: '9000', WEBHOOK_URL: 'https://example.com/hook',
    DATABASE_PATH: ':memory:', WORKER_POLL_INTERVAL_MS: '10', RETRY_MAX_ATTEMPTS: '3',
    RETRY_INITIAL_DELAY_MS: '0', RETRY_MAX_DELAY_MS: '0', RETRY_JITTER_PERCENT: '0' });
  assert.equal(config.port, 9000);
  assert.equal(config.retryPolicy.getMaxAttempts(), 3);
  assert.equal(config.retryPolicy.nextRetryDelay(1), 0);
  assert.equal(receiverPort({ RECEIVER_PORT: '9001' }), 9001);
});

test('Configuration: malformed and out-of-range numbers fail before startup', () => {
  for (const value of ['', ' ', '8000oops', 'NaN', 'Infinity', '-1', '1e3']) {
    assert.throws(() => loadConfig({ PORT: value }), /PORT/, value);
  }
  for (const value of ['0', '65536', '3000.5']) {
    assert.throws(() => loadConfig({ PORT: value }), /PORT/, value);
    assert.throws(() => receiverPort({ RECEIVER_PORT: value }), /RECEIVER_PORT/, value);
  }
  assert.throws(() => loadConfig({ WORKER_POLL_INTERVAL_MS: '0' }), /WORKER_POLL_INTERVAL_MS/);
  assert.throws(() => loadConfig({ WORKER_POLL_INTERVAL_MS: '2147483648' }), /WORKER_POLL_INTERVAL_MS/);
  assert.throws(() => loadConfig({ RETRY_MAX_ATTEMPTS: '5abc' }), /RETRY_MAX_ATTEMPTS/);
});

test('Configuration: invalid retry policies are rejected through both entry points', () => {
  for (const maxAttempts of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => new RetryPolicy({ maxAttempts }), /RETRY_MAX_ATTEMPTS/);
  }
  for (const jitterPercent of [-0.1, 1.1, NaN, Infinity]) {
    assert.throws(() => new RetryPolicy({ jitterPercent }), /RETRY_JITTER_PERCENT/);
  }
  assert.throws(() => new RetryPolicy({ initialDelayMs: -1 }), /RETRY_INITIAL_DELAY_MS/);
  assert.throws(() => new RetryPolicy({ initialDelayMs: 100, maxDelayMs: 50 }), /RETRY_MAX_DELAY_MS/);
  assert.throws(() => loadConfig({ RETRY_MAX_ATTEMPTS: '0' }), /RETRY_MAX_ATTEMPTS/);
  assert.throws(() => loadConfig({ RETRY_JITTER_PERCENT: '1.1' }), /RETRY_JITTER_PERCENT/);
  assert.throws(() => loadConfig({ RETRY_INITIAL_DELAY_MS: '100', RETRY_MAX_DELAY_MS: '50' }), /RETRY_MAX_DELAY_MS/);
});

test('Configuration: invalid webhook URLs and database paths are rejected', () => {
  for (const webhookUrl of ['', 'localhost:3001', 'file:///tmp/hook', 'ftp://example.com', 'https://user:secret@example.com']) {
    assert.throws(() => loadConfig({ WEBHOOK_URL: webhookUrl }), /WEBHOOK_URL/);
  }
  for (const dbPath of ['', ' ', 'bad\0path']) {
    assert.throws(() => loadConfig({ DATABASE_PATH: dbPath }), /DATABASE_PATH/);
  }
});
