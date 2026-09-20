import test from 'node:test';
import assert from 'node:assert/strict';
import { Metrics } from '../src/observability/Metrics.ts';
import { Outcome } from '../src/types/Outcome.ts';

test('Observability: metrics render stable Prometheus counters', () => {
  const metrics = new Metrics();
  metrics.recordAttempt(Outcome.RETRYABLE, 503);
  metrics.recordAttempt(Outcome.SUCCESS, 200);
  metrics.recordAttempt(Outcome.RETRYABLE, 503);
  const output = metrics.renderPrometheus();
  assert.match(output, /webhook_delivery_attempts_total\{http_status="503",outcome="retryable"\} 2/);
  assert.match(output, /webhook_delivery_attempts_total\{http_status="200",outcome="success"\} 1/);
});

