CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  eventId TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  occurredAt TEXT NOT NULL,
  payload TEXT NOT NULL,
  state TEXT NOT NULL,
  nextRetryAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_state ON events(state);
CREATE INDEX IF NOT EXISTS idx_events_eventId ON events(eventId);
CREATE INDEX IF NOT EXISTS idx_events_nextRetryAt ON events(nextRetryAt);

