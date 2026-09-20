export const Outcome = {
  SUCCESS: 'SUCCESS',
  RETRYABLE: 'RETRYABLE',
  TERMINAL: 'TERMINAL',
} as const;

export type Outcome = (typeof Outcome)[keyof typeof Outcome];

