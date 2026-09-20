export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class ValidationError extends Error {
  public errors: string[];

  constructor(errors: string[]) {
    super(errors.join(', '));
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

export class EventValidator {
  static validate(rawEvent: any): ValidationResult {
    const errors: string[] = [];

    if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) {
      return { valid: false, errors: ['Request body must be a valid JSON object'] };
    }

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

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

