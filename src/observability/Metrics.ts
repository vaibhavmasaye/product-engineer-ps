import { Outcome } from '../types/Outcome.ts';

export class Metrics {
  private counters = new Map<string, number>();

  increment(name: string, labels: Record<string, string> = {}): void {
    const key = `${name}${Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
      .map(([label, value]) => `|${label}=${value}`).join('')}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  renderPrometheus(): string {
    const lines = [
      '# HELP webhook_delivery_attempts_total Total webhook delivery attempts by outcome.',
      '# TYPE webhook_delivery_attempts_total counter',
    ];
    for (const [key, value] of this.counters) {
      const [name, ...rawLabels] = key.split('|');
      const labels = rawLabels.map(pair => {
        const [label, labelValue] = pair.split('=');
        return `${label}="${labelValue.replaceAll('"', '\\"')}"`;
      }).join(',');
      lines.push(`${name}${labels ? `{${labels}}` : ''} ${value}`);
    }
    return `${lines.join('\n')}\n`;
  }

  recordAttempt(outcome: Outcome, statusCode?: number | null): void {
    this.increment('webhook_delivery_attempts_total', {
      outcome: outcome.toLowerCase(),
      http_status: String(statusCode ?? 'none'),
    });
  }
}
