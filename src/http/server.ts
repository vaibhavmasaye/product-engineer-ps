import * as http from 'node:http';
import { EventController, type HttpRequest, type HttpResponse } from '../controllers/EventController.ts';

export class HttpServer {
  private server: http.Server;
  private controller: EventController;
  private port: number;
  private metricsText: () => string;

  constructor(controller: EventController, port: number = 8000, metricsText: () => string = () => '') {
    this.controller = controller;
    this.port = port;
    this.metricsText = metricsText;
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    // Parse JSON body for POST/PUT requests
    let body: unknown = undefined;
    if (method === 'POST' || method === 'PUT') {
      try {
        const buffers: Buffer[] = [];
        for await (const chunk of req) {
          buffers.push(chunk as Buffer);
        }
        const data = Buffer.concat(buffers).toString('utf8');
        if (data.trim()) {
          body = JSON.parse(data);
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }
    }

    // Routing
    let response: HttpResponse;

    // Health check
    if (pathname === '/health' && method === 'GET') {
      response = {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { status: 'ok' },
      };
    }
    else if (pathname === '/metrics' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
      res.end(this.metricsText());
      return;
    }
    // POST /events
    else if (pathname === '/events' && method === 'POST') {
      response = await this.controller.create({
        method,
        url: pathname,
        body,
        params: {},
      });
    }
    // GET /events/:eventId/attempts
    else if (pathname.startsWith('/events/') && pathname.endsWith('/attempts') && method === 'GET') {
      const parts = pathname.split('/');
      // /events/:eventId/attempts -> parts: ['', 'events', ':eventId', 'attempts']
      const eventId = decodeURIComponent(parts[2]);
      response = await this.controller.getAttempts({
        method,
        url: pathname,
        params: { eventId },
      });
    }
    // GET /events/:eventId
    else if (pathname.startsWith('/events/') && method === 'GET') {
      const parts = pathname.split('/');
      const eventId = decodeURIComponent(parts[2]);
      response = await this.controller.get({
        method,
        url: pathname,
        params: { eventId },
      });
    }
    // 404 Route Not Found
    else {
      response = {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: { error: `Not found: ${method} ${pathname}` },
      };
    }

    res.writeHead(response.status, response.headers);
    res.end(JSON.stringify(response.body));
  }

  listen(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  get address() {
    return this.server.address();
  }
}
