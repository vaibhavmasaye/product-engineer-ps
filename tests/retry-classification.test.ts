import test from 'node:test';
import assert from 'node:assert/strict';
import { RetryClassifier } from '../src/services/RetryClassifier.ts';
import { Outcome } from '../src/entities/DeliveryAttempt.ts';

test('RetryClassifier: 2xx responses are SUCCESS', () => {
  assert.strictEqual(RetryClassifier.classify(200), Outcome.SUCCESS);
  assert.strictEqual(RetryClassifier.classify(201), Outcome.SUCCESS);
  assert.strictEqual(RetryClassifier.classify(202), Outcome.SUCCESS);
  assert.strictEqual(RetryClassifier.classify(204), Outcome.SUCCESS);
});

test('RetryClassifier: Standard 4xx client errors are non-retryable TERMINAL', () => {
  assert.strictEqual(RetryClassifier.classify(400), Outcome.TERMINAL);
  assert.strictEqual(RetryClassifier.classify(401), Outcome.TERMINAL);
  assert.strictEqual(RetryClassifier.classify(403), Outcome.TERMINAL);
  assert.strictEqual(RetryClassifier.classify(404), Outcome.TERMINAL);
  assert.strictEqual(RetryClassifier.classify(405), Outcome.TERMINAL);
  assert.strictEqual(RetryClassifier.classify(422), Outcome.TERMINAL);
});

test('RetryClassifier: Special 4xx errors (408, 429) are RETRYABLE', () => {
  assert.strictEqual(RetryClassifier.classify(408), Outcome.RETRYABLE); // Request Timeout
  assert.strictEqual(RetryClassifier.classify(429), Outcome.RETRYABLE); // Rate Limited
});

test('RetryClassifier: 5xx server errors are RETRYABLE', () => {
  assert.strictEqual(RetryClassifier.classify(500), Outcome.RETRYABLE);
  assert.strictEqual(RetryClassifier.classify(502), Outcome.RETRYABLE);
  assert.strictEqual(RetryClassifier.classify(503), Outcome.RETRYABLE);
  assert.strictEqual(RetryClassifier.classify(504), Outcome.RETRYABLE);
});

test('RetryClassifier: Network-level errors are RETRYABLE', () => {
  const errRefused = new Error('connect ECONNREFUSED 127.0.0.1:3001');
  (errRefused as any).code = 'ECONNREFUSED';
  assert.strictEqual(RetryClassifier.classify(null, errRefused), Outcome.RETRYABLE);

  const errReset = new Error('read ECONNRESET');
  (errReset as any).code = 'ECONNRESET';
  assert.strictEqual(RetryClassifier.classify(null, errReset), Outcome.RETRYABLE);

  const errDns = new Error('getaddrinfo ENOTFOUND api.incident.local');
  (errDns as any).code = 'ENOTFOUND';
  assert.strictEqual(RetryClassifier.classify(null, errDns), Outcome.RETRYABLE);

  const errTimeout = new Error('The operation timed out');
  errTimeout.name = 'TimeoutError';
  assert.strictEqual(RetryClassifier.classify(null, errTimeout), Outcome.RETRYABLE);

  const errAbort = new Error('The operation was aborted due to timeout');
  errAbort.name = 'AbortError';
  assert.strictEqual(RetryClassifier.classify(null, errAbort), Outcome.RETRYABLE);
});

test('RetryClassifier: Unclassified error defaults safely to TERMINAL', () => {
  const errUnknown = new Error('Fatal protocol mismatch');
  assert.strictEqual(RetryClassifier.classify(null, errUnknown), Outcome.TERMINAL);
  assert.strictEqual(RetryClassifier.classify(null, null), Outcome.TERMINAL);
  assert.strictEqual(RetryClassifier.classify(undefined, undefined), Outcome.TERMINAL);
});

