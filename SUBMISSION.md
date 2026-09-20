# Product Engineering Challenge Submission

## Candidate

- **Name:** Vaibhav Masaye
- **Email:** masayevaibhav@gmail.com
- **GitHub:** https://github.com/vaibhavmasaye/product-engineer-ps
- **Selected problem:** Problem 2 — Webhook Retry Engine
- **Demo video:** https://drive.google.com/file/d/19UbdlhIzQxObX88c2XWEhWYEnFjxDaav/view?usp=sharing

---

## Run the project

### Prerequisites
- Node.js v24.x or later (uses native TypeScript stripping and built-in SQLite engine with zero external npm installation required).
- `curl` (for triggering endpoints and running the demo script).

### Setup and Start Commands

```bash
# 1. Start the test webhook receiver (Terminal 1)
npm run start:receiver
# Listening on http://localhost:3001/webhook

# 2. Start the webhook retry engine service (Terminal 2)
npm run start:server
# Listening on http://localhost:8000
```

### Configuration

Defaults work without an environment file. To customize them, copy `.env.example` to `.env` for the engine, or export the variables in your shell. The receiver reads `RECEIVER_PORT` from its shell environment.

Startup validates configuration before opening the engine database or starting its HTTP server: ports must be integers from 1–65535; polling must be a positive integer; retry attempts must be a positive safe integer; retry delays must be nonnegative integer milliseconds with maximum delay at least the initial delay; jitter must be between 0 and 1. Polling and delay settings cannot exceed 2,147,483,647 milliseconds. The webhook destination must be an absolute HTTP(S) URL without embedded credentials, and the database path must be nonempty. Invalid values produce an error instead of silently using a partial number or fallback.

### Triggering Acceptance Scenarios

#### AC1: Successful Delivery
```bash
curl -X POST http://localhost:8000/events \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "evt_demo_ac1",
    "type": "incident.created",
    "occurredAt": "2026-09-17T10:00:00Z",
    "payload": {"incidentId": "inc_001", "severity": "high"}
  }'

# Inspect state and history:
curl http://localhost:8000/events/evt_demo_ac1
curl http://localhost:8000/events/evt_demo_ac1/attempts
```

#### AC2: Temporary Failure and Retry
```bash
# Set receiver to fail on first attempt with 503 then succeed:
curl -X POST "http://localhost:3001/mode?set=fail_once"

# Submit event:
curl -X POST http://localhost:8000/events \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "evt_demo_ac2",
    "type": "incident.updated",
    "occurredAt": "2026-09-17T10:01:00Z",
    "payload": {"incidentId": "inc_001", "status": "investigating"}
  }'

# Inspect intermediate state (QUEUED with nextRetryAt set):
curl http://localhost:8000/events/evt_demo_ac2

# Wait 6 seconds for backoff, then inspect final SUCCESS state with 2 attempts:
curl http://localhost:8000/events/evt_demo_ac2/attempts
```

#### AC3: Bounded Failure / Attempt Exhaustion

With the default configuration, delivery stops after five attempts. Retry delays are approximately 5, 10, 20, and 40 seconds, plus jitter and worker polling time. Keep the receiver in failure mode until the event reaches `FAILED`.

```bash
# Configure receiver to return 503 on every attempt:
curl -X POST "http://localhost:3001/mode?set=always_fail_503"

# Use a fresh event ID so this scenario can be repeated:
AC3_EVENT_ID="evt_demo_ac3_$(date +%s)"

curl -X POST http://localhost:8000/events \
  -H "Content-Type: application/json" \
  -d "{\"eventId\":\"$AC3_EVENT_ID\",\"type\":\"incident.closed\",\"occurredAt\":\"2026-09-17T10:02:00Z\",\"payload\":{\"incidentId\":\"inc_001\"}}"

# Allow all five attempts to complete with the default retry settings:
sleep 95

# Expect state FAILED and five ordered attempts, each with HTTP 503:
curl "http://localhost:8000/events/$AC3_EVENT_ID"
curl "http://localhost:8000/events/$AC3_EVENT_ID/attempts"

# Confirm no additional attempts occur after exhaustion:
sleep 10
curl "http://localhost:8000/events/$AC3_EVENT_ID/attempts"

# Restore the receiver for subsequent scenarios:
curl -X POST "http://localhost:3001/mode?set=normal"
```

HTTP 400 is a separate terminal-failure case: it stops delivery after the first attempt. It does not demonstrate exhaustion of the retry limit.

#### AC4: Idempotent Ingestion
```bash
# Submit the same eventId twice:
curl -X POST http://localhost:8000/events -H "Content-Type: application/json" -d '{"eventId": "evt_demo_ac1", "type": "test", "occurredAt": "2026-09-17T10:00:00Z", "payload": {}}'
# Returns 200 OK with isDuplicate: true and original event details.
```

#### Automated Interactive Demo Script
```bash
npm run demo
# or: bash scripts/demo.sh
```

---

## Run the tests

```bash
npm ci
npm run build  # Runs tsc --noEmit; checks source and test types without generating files
npm test
```

Executes 34 automated, deterministic tests across AC1–AC5, classification matrices, state machines, single- and multi-connection concurrency locks, configuration validation, live HTTP delivery, transport rejection handling, and crash recovery in ~240ms with zero paid external services.

---

## Architecture and data flow

```
                Client
                  │
        POST /events (schema validation)
                  ▼
          [EventService]
                  │
     EventRepository.findOrCreate() ◄── (Enforces UNIQUE constraint on eventId)
                  │
         Persisted in SQLite
         (State: QUEUED)
                  │
                  ▼
         [DeliveryWorker] ◄────────────── (claimOneQueued atomic transaction)
                  │
        State -> PROCESSING
                  │
                  ▼
          [HttpTransport] ──────────────► Webhook Receiver (:3001)
                  │                              │
                  │◄─────────────────────────────┘ (HTTP response or error)
                  ▼
         [RetryClassifier] ─────────────► Outcome (SUCCESS | RETRYABLE | TERMINAL)
                  │
                  ▼
      [AttemptRepository.create()] ────► delivery_attempts (Immutable audit log)
                  │
                  ▼
            State Update
       ├── SUCCESS: state = SUCCESS
       ├── RETRYABLE & attempts < max: state = QUEUED, nextRetryAt = now + backoff(attempt)
       └── TERMINAL or exhausted: state = FAILED
```

### Core Components
1. **EventService**: Enforces schema validation (`EventValidator`) and coordinates idempotent ingestion via `EventRepository.findOrCreate()`. Ensures duplicate submissions reference the existing event and do not spawn duplicate delivery jobs.
2. **EventState Machine**: Explicit state machine with strict transitions: `RECEIVED -> QUEUED -> PROCESSING -> SUCCESS | FAILED`, with retry loop `PROCESSING -> QUEUED`.
3. **DeliveryWorker**: Background worker claiming queued events whose `nextRetryAt <= now`. Uses an atomic transaction for mutual exclusion, converts transport rejections into durable retry outcomes, and commits each immutable attempt together with its resulting event state.
4. **RetryClassifier**: Deterministic classification matrix:
   - `2xx` $\to$ `SUCCESS`
   - `408`, `429` $\to$ `RETRYABLE`
   - Standard `4xx` (`400`, `401`, `403`, `404`) $\to$ `TERMINAL`
   - `5xx` (`500`, `502`, `503`, `504`) $\to$ `RETRYABLE`
   - Network errors (`ECONNREFUSED`, `ECONNRESET`, `ENOTFOUND`, `ETIMEDOUT`) $\to$ `RETRYABLE`
   - Unknown error $\to$ `TERMINAL` (safe default)
5. **RetryPolicy**: Exponential backoff $\min(\text{initialDelay} \times 2^{\text{attempt}-1}, \text{maxDelay}) + \text{jitter}$ with configurable max attempts (default: 5) and 10% jitter.
6. **AttemptRepository**: Append-only, immutable delivery attempt log capturing timestamp, status code, outcome, and error type.

---

## Technology choices

- **Language & Runtime:** TypeScript on Node.js v24.
  - *Why:* Node.js 24 provides native TypeScript stripping (`--experimental-strip-types`), native SQLite (`node:sqlite` via `DatabaseSync`), native test runner (`node:test`), and native `fetch` / `crypto.randomUUID()`.
  - *Alternatives considered:* Python (FastAPI + SQLAlchemy) or Go. TypeScript was selected because it allows zero runtime dependencies and fast deterministic in-memory execution. Development checks use pinned TypeScript and Node type definitions installed with `npm ci`.
  - *Trade-offs:* Using type-stripping requires avoiding TypeScript `enum` in favor of `as const` object unions and explicit `import type` annotations. This is a cleaner, more standard modern TS practice anyway.
- **Database:** SQLite with native transactions and foreign keys.
  - *Why:* Zero configuration for reviewers, fast in-memory execution for unit tests (`:memory:`), and identical constraint semantics (unique indexes, foreign keys, transactions) as PostgreSQL.
  - *Trade-offs:* In a high-throughput multi-node production environment, PostgreSQL with row-level locks (`SELECT ... FOR UPDATE SKIP LOCKED`) would replace SQLite.

---

## Important decisions

1. **Database-enforced idempotency over application-level locks:**
   - *Decision:* `findOrCreate()` relies on SQLite's `UNIQUE(eventId)` constraint with `ON CONFLICT(eventId) DO NOTHING` inside a transaction.
   - *Rationale:* Application-level checks (`if (!exists) insert()`) suffer from race conditions under concurrent submissions. Relying on the database constraint guarantees strict atomicity and mutual exclusion without distributed locking complexity.
2. **Injectable Time & Transport Abstractions (`Clock` and `HttpTransport`):**
   - *Decision:* All time-dependent scheduling and network transport depend on `Clock` (`SystemClock` / `MockClock`) and `HttpTransport` (`RealHttpTransport` / `FakeHttpTransport`).
   - *Rationale:* Eliminates flaky test sleep delays. The entire 34-test suite executes in ~325ms while verifying realistic exponential backoff, retry boundaries, live HTTP behavior, transport exceptions, network errors, and claims across separate SQLite connections.
3. **Crash recovery with stranded `PROCESSING` reclamation:**
   - *Decision:* On startup, the service runs `recoverStrandedProcessingEvents()`, safely transitioning stranded `PROCESSING` records back to `QUEUED`.
   - *Rationale:* If the worker process crashes during an HTTP flight, delivery is safely resumed under at-least-once semantics. Attempt insertion and the resulting state transition are committed atomically, while stranded `RECEIVED` and `PROCESSING` records are re-queued on startup.

---

## Assumptions and limitations

- **Delivery Guarantees:** Delivery across an external HTTP boundary is **at-least-once**. In the event of a worker crash after the receiver returns HTTP 200 but before the attempt is logged in DB, the event will be re-attempted on restart. Receivers should treat delivery idempotently using the provided stable `eventId`.
- **Single Webhook Destination:** Designed per Problem 2 brief for a single configured webhook endpoint.
- **Single Process Worker:** Designed as a single worker process with database-level claim locking. Production scaling to multiple workers is outlined below.
- **Crash boundary:** A process crash during an in-flight HTTP request can still cause a duplicate after restart; exactly-once delivery across an external HTTP boundary is impossible. Receivers should deduplicate by `eventId`.

---

## Production and scale

If this prototype needed to operate in production at significantly greater scale, here are the first four changes:
1. **PostgreSQL with `SKIP LOCKED`:** Transition from SQLite to PostgreSQL using `SELECT ... FOR UPDATE SKIP LOCKED` to allow dozens of concurrent worker pods to claim jobs simultaneously without lock contention or thread contention.
2. **Dedicated Queue / Partitioning by Endpoint:** Introduce Redis Streams or Kafka partitions grouped by destination host so that an unresponsive or rate-limiting endpoint does not starve workers from delivering webhooks to healthy endpoints (endpoint fair-share scheduling).
3. **Circuit Breakers & Rate Limit Adherence:** Parse `Retry-After` headers on HTTP 429 and implement a circuit breaker per destination domain to pause outbound requests when an endpoint is persistently degraded.
4. **Metrics & Alerting:** Export Prometheus metrics:
   - `webhook_delivery_attempts_total{outcome, http_status}`
   - `webhook_delivery_latency_seconds` (histogram)
   - `webhook_events_state{state="QUEUED"}` (queue lag alert)
   - Alert when queue lag > 1,000 or retry exhaustion rate exceeds 1%.

---

## AI usage

- **AI Tools Used:** Google Antigravity / Gemini and OpenAI Codex.
- **Contribution:**
  - Generated initial test matrix and failure scenarios against the prompt specifications.
  - Implemented unit tests, schemas, and controllers based on the established architecture doc.
  - Reviewed and verified test coverage and edge cases.
  - Used Codex to review the project against the submission requirements, fix retry classification for nested native `fetch` error causes, add regression tests, update the submission instructions, replace untyped values with validated types, add configuration validation and a real TypeScript check, and harden crash recovery with atomic attempt/state commits.

---

## Credibility note

- **System:** Real-time Event Ingestion & Webhook Dispatch Pipeline (B2B SaaS).
- **Contribution:** Lead backend engineer designing the reliable dispatch service delivering over 15 million webhooks/day to customer API endpoints.
- **Operational Complexity:** Handled high failure variance across customer endpoints, strict rate-limiting per tenant, and automatic retry backoff without blocking internal event streaming pipelines.
- **Key Decision:** Moved from in-memory task queues to an outbox pattern with database-backed lease locking (`SKIP LOCKED`) and tenant-level concurrency limits, reducing dropped webhook incidents to zero during customer service outages.
