import { Outcome } from '../types/Outcome.ts';

export class RetryClassifier {
  static classify(statusCode?: number | null, error?: Error | null): Outcome {
    // 1. Handle network/transport-level errors
    if (error) {
      // Native fetch wraps network errors in TypeError('fetch failed').
      // Inspect causes too, guarding against malformed or cyclic cause chains.
      const seen = new Set<object>();
      let cause: unknown = error;
      while (cause !== null && typeof cause === 'object' && !seen.has(cause)) {
        seen.add(cause);
        const current = cause as { message?: unknown; code?: unknown; name?: unknown; cause?: unknown };
        const msg = typeof current.message === 'string' ? current.message.toLowerCase() : '';
        const code = typeof current.code === 'string' ? current.code.toLowerCase() : '';
        const name = typeof current.name === 'string' ? current.name.toLowerCase() : '';

        if (
          msg.includes('econnrefused') ||
          code.includes('econnrefused') ||
          msg.includes('connection refused')
        ) {
          return Outcome.RETRYABLE;
        }

        if (
          msg.includes('econnreset') ||
          code.includes('econnreset') ||
          msg.includes('connection reset')
        ) {
          return Outcome.RETRYABLE;
        }

        if (
          msg.includes('enotfound') ||
          code.includes('enotfound') ||
          msg.includes('getaddrinfo') ||
          msg.includes('dns')
        ) {
          return Outcome.RETRYABLE;
        }

        if (
          msg.includes('etimedout') ||
          code.includes('etimedout') ||
          msg.includes('timeout') ||
          name.includes('timeouterror') ||
          name.includes('aborterror')
        ) {
          return Outcome.RETRYABLE;
        }

        cause = current.cause;
      }

      // Safe default for unclassified network exceptions
      return Outcome.TERMINAL;
    }

    // 2. Handle HTTP status codes
    if (!statusCode || typeof statusCode !== 'number') {
      return Outcome.TERMINAL;
    }

    // 2xx Success
    if (statusCode >= 200 && statusCode < 300) {
      return Outcome.SUCCESS;
    }

    // 408 (Request Timeout) and 429 (Too Many Requests) are retryable
    if (statusCode === 408 || statusCode === 429) {
      return Outcome.RETRYABLE;
    }

    // All other 4xx are client/terminal errors (400, 401, 403, 404, etc.)
    if (statusCode >= 400 && statusCode < 500) {
      return Outcome.TERMINAL;
    }

    // 5xx Server errors are retryable (500, 502, 503, 504, etc.)
    if (statusCode >= 500 && statusCode < 600) {
      return Outcome.RETRYABLE;
    }

    return Outcome.TERMINAL;
  }
}

