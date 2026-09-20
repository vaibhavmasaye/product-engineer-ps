import test from 'node:test';
import assert from 'node:assert/strict';
import { EventState, EventTransition } from '../src/types/State.ts';

test('State Machine: All valid transitions succeed', () => {
  // Direct happy path: RECEIVED -> QUEUED -> PROCESSING -> SUCCESS
  assert.strictEqual(EventTransition.isValidTransition(EventState.RECEIVED, EventState.QUEUED), true);
  assert.strictEqual(EventTransition.isValidTransition(EventState.QUEUED, EventState.PROCESSING), true);
  assert.strictEqual(EventTransition.isValidTransition(EventState.PROCESSING, EventState.SUCCESS), true);

  // Failure path: PROCESSING -> FAILED
  assert.strictEqual(EventTransition.isValidTransition(EventState.PROCESSING, EventState.FAILED), true);

  // Retry loop path: PROCESSING -> QUEUED
  assert.strictEqual(EventTransition.isValidTransition(EventState.PROCESSING, EventState.QUEUED), true);
});

test('State Machine: Invalid transitions are rejected', () => {
  const invalidPairs: Array<[EventState, EventState]> = [
    [EventState.RECEIVED, EventState.PROCESSING],
    [EventState.RECEIVED, EventState.SUCCESS],
    [EventState.RECEIVED, EventState.FAILED],
    [EventState.QUEUED, EventState.RECEIVED],
    [EventState.QUEUED, EventState.SUCCESS],
    [EventState.QUEUED, EventState.FAILED],
    [EventState.SUCCESS, EventState.QUEUED],
    [EventState.SUCCESS, EventState.PROCESSING],
    [EventState.SUCCESS, EventState.FAILED],
    [EventState.FAILED, EventState.QUEUED],
    [EventState.FAILED, EventState.PROCESSING],
    [EventState.FAILED, EventState.SUCCESS],
  ];

  for (const [from, to] of invalidPairs) {
    assert.strictEqual(
      EventTransition.isValidTransition(from, to),
      false,
      `Expected ${from} -> ${to} to be invalid`
    );

    assert.throws(
      () => EventTransition.transition(from, to),
      /Invalid transition/,
      `Expected transition(${from}, ${to}) to throw`
    );
  }
});

