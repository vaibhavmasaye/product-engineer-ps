CREATE TABLE IF NOT EXISTS delivery_attempts (
  id TEXT PRIMARY KEY,
  eventId TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  http_status_code INTEGER,
  error_type TEXT,
  outcome TEXT NOT NULL,
  response_body TEXT,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (eventId) REFERENCES events(eventId) ON DELETE CASCADE,
  UNIQUE(eventId, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_attempts_eventId ON delivery_attempts(eventId);

