export const EventState = {
  RECEIVED: 'RECEIVED',
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;

export type EventState = (typeof EventState)[keyof typeof EventState];

export class EventTransition {
  private static readonly VALID_TRANSITIONS: Record<EventState, readonly EventState[]> = {
    [EventState.RECEIVED]: [EventState.QUEUED],
    [EventState.QUEUED]: [EventState.PROCESSING],
    [EventState.PROCESSING]: [EventState.SUCCESS, EventState.FAILED, EventState.QUEUED],
    [EventState.SUCCESS]: [],
    [EventState.FAILED]: [],
  };

  static isValidTransition(from: EventState, to: EventState): boolean {
    const allowed = this.VALID_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  static transition(currentState: EventState, newState: EventState): EventState {
    if (!this.isValidTransition(currentState, newState)) {
      throw new Error(`Invalid transition: ${currentState} → ${newState}`);
    }
    return newState;
  }
}

