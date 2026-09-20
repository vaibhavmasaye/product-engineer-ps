import * as http from 'node:http';

const port = parseInt(process.env.RECEIVER_PORT || '3001', 10);

interface DeliveryLog {
  eventId: string;
  attemptNumberForEvent: number;
  time: string;
  statusCode: number;
  payload: any;
}

const deliveryLogs: DeliveryLog[] = [];
const eventAttemptCounts: Map<string, number> = new Map();

// Control modes for demo:
// 'normal': always 200 OK
// 'fail_once': fails first attempt with 503, subsequent 200 OK
// 'always_fail_503': always fails with 503 Service Unavailable
// 'terminal_400': fails with 400 Bad Request
let mode: 'normal' | 'fail_once' | 'always_fail_503' | 'terminal_400' = 'normal';

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = (req.method || 'GET').toUpperCase();

  // Mode control endpoint
  if (pathname === '/mode' && method === 'POST') {
    const qMode = parsedUrl.searchParams.get('set');
    if (qMode && ['normal', 'fail_once', 'always_fail_503', 'terminal_400'].includes(qMode)) {
      mode = qMode as any;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'mode_updated', currentMode: mode }));
      return;
    }
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid mode' }));
    return;
  }

  // Reset endpoint
  if (pathname === '/reset' && method === 'POST') {
    deliveryLogs.length = 0;
    eventAttemptCounts.clear();
    mode = 'normal';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'reset_success' }));
    return;
  }

  // Logs endpoint
  if (pathname === '/logs' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ mode, logs: deliveryLogs }));
    return;
  }

  // Webhook receiver endpoint: POST /webhook
  if (pathname === '/webhook' && method === 'POST') {
    let bodyText = '';
    for await (const chunk of req) {
      bodyText += chunk.toString();
    }

    let parsedBody: any = {};
    try {
      if (bodyText) parsedBody = JSON.parse(bodyText);
    } catch {
      // ignore
    }

    const eventId = parsedBody.eventId || 'unknown';
    const attempt = (eventAttemptCounts.get(eventId) || 0) + 1;
    eventAttemptCounts.set(eventId, attempt);

    // Determine status code based on mode or query param override
    const overrideStatus = parsedUrl.searchParams.get('status');
    let responseStatus = 200;

    if (overrideStatus) {
      responseStatus = parseInt(overrideStatus, 10);
    } else if (mode === 'fail_once') {
      responseStatus = attempt === 1 ? 503 : 200;
    } else if (mode === 'always_fail_503') {
      responseStatus = 503;
    } else if (mode === 'terminal_400') {
      responseStatus = 400;
    } else {
      responseStatus = 200;
    }

    const logEntry: DeliveryLog = {
      eventId,
      attemptNumberForEvent: attempt,
      time: new Date().toISOString(),
      statusCode: responseStatus,
      payload: parsedBody,
    };
    deliveryLogs.push(logEntry);

    console.log(
      `[Receiver] Received webhook for event "${eventId}" (attempt #${attempt}) -> responding HTTP ${responseStatus}`
    );

    res.writeHead(responseStatus, { 'Content-Type': 'application/json' });
    if (responseStatus >= 200 && responseStatus < 300) {
      res.end(JSON.stringify({ status: 'delivered', eventId, attempt }));
    } else {
      res.end(
        JSON.stringify({
          error: `Simulated failure with HTTP ${responseStatus}`,
          eventId,
          attempt,
        })
      );
    }
    return;
  }

  // Fallback
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found on test receiver' }));
});

server.listen(port, () => {
  console.log('==============================================');
  console.log(`Test Webhook Receiver listening on http://localhost:${port}`);
  console.log(`Webhook endpoint: POST http://localhost:${port}/webhook`);
  console.log('Controls:');
  console.log(`  Set mode: POST http://localhost:${port}/mode?set=[normal|fail_once|always_fail_503|terminal_400]`);
  console.log(`  View logs: GET http://localhost:${port}/logs`);
  console.log(`  Reset: POST http://localhost:${port}/reset`);
  console.log('==============================================');
});

