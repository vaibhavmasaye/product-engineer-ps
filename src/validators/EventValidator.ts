import type { CreateEventInput } from '../repositories/EventRepository.ts';

export type ValidationResult =
  | { valid: true; errors: []; event: CreateEventInput }
  | { valid: false; errors: string[] };

export class ValidationError extends Error {
  public errors: string[];

  constructor(errors: string[]) {
    super(errors.join(', '));
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

export class EventValidator {
  static validate(input: unknown): ValidationResult {
    const errors: string[] = [];

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { valid: false, errors: ['Request body must be a valid JSON object'] };
    }

    const rawEvent = input as Record<string, unknown>;

    if (typeof rawEvent.eventId !== 'string' || !rawEvent.eventId.trim()) {
      errors.push('eventId must be a non-empty string');
    }

    if (typeof rawEvent.type !== 'string' || !rawEvent.type.trim()) {
      errors.push('type must be a non-empty string');
    }

    if (!rawEvent.occurredAt || typeof rawEvent.occurredAt !== 'string') {
      errors.push('occurredAt must be a valid ISO 8601 timestamp string');
    } else {
      const parsed = Date.parse(rawEvent.occurredAt);
      if (isNaN(parsed)) {
        errors.push('occurredAt must be a valid ISO 8601 timestamp string');
      }
    }

    if (
      !rawEvent.payload ||
      typeof rawEvent.payload !== 'object' ||
      Array.isArray(rawEvent.payload)
    ) {
      errors.push('payload must be a valid JSON object');
    }

    if (errors.length > 0) return { valid: false, errors };
    // Each field has been checked above; expose only the validated event contract.
    return {
      valid: true,
      errors: [],
      event: {
        eventId: rawEvent.eventId as string,
        type: rawEvent.type as string,
        occurredAt: rawEvent.occurredAt as string,
        payload: rawEvent.payload as Record<string, unknown>,
      },
    };
  }
}

