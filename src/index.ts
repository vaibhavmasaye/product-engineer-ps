import * as fs from 'node:fs';
import * as path from 'node:path';
import { Database } from './database/index.ts';
import { EventRepository } from './repositories/EventRepository.ts';
import { AttemptRepository } from './repositories/AttemptRepository.ts';
import { EventService } from './services/EventService.ts';
import { EventController } from './controllers/EventController.ts';
import { HttpServer } from './http/server.ts';
import { RealHttpTransport } from './transport/RealHttpTransport.ts';
import { loadConfig } from './config/loadConfig.ts';
import { DeliveryWorker } from './workers/DeliveryWorker.ts';
import { SystemClock } from './utils/SystemClock.ts';
import { Metrics } from './observability/Metrics.ts';

// Simple environment loader if .env exists
function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}

loadEnv();

const { port, webhookUrl, dbPath, pollIntervalMs, retryPolicy } = loadConfig();

console.log('==============================================');
console.log('Starting Webhook Retry Engine...');
console.log(`Port: ${port}`);
console.log(`Webhook Destination: ${webhookUrl}`);
console.log(`Database: ${dbPath}`);
console.log('==============================================');

// Initialize database
const db = new Database({ dbPath });
const metrics = new Metrics();

// Initialize repositories & services
const eventRepository = new EventRepository(db);
const recovered = eventRepository.recoverStrandedProcessingEvents();
if (recovered > 0) {
  console.log(`Recovered ${recovered} stranded processing event(s) from previous run.`);
}
const attemptRepository = new AttemptRepository(db);
const clock = new SystemClock();

const eventService = new EventService(eventRepository, clock);
const controller = new EventController(eventService, attemptRepository);

// Initialize HTTP server
const server = new HttpServer(controller, port, () => metrics.renderPrometheus());

// Initialize worker
const transport = new RealHttpTransport();
const worker = new DeliveryWorker(
  eventRepository,
  attemptRepository,
  transport,
  retryPolicy,
  clock,
  {
    webhookUrl,
    pollIntervalMs,
  },
  metrics
);

// Start server and worker
await server.listen();
console.log(`Webhook Retry Engine listening on http://localhost:${port}`);
console.log('Worker background loop started. Ready to ingest and deliver events.');

worker.start().catch((err) => {
  console.error('Fatal worker loop failure:', err);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('\nShutting down gracefully...');
  worker.stop();
  await server.close();
  db.close();
  console.log('Service stopped.');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
