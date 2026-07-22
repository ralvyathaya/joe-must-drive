import assert from 'node:assert/strict';
import test from 'node:test';
import { runBootTasks } from '../src/core/boot.ts';

test('runs boot tasks sequentially and reports completed work', async () => {
  const order: string[] = [];
  const progress: Array<{ stage: string; completed: number; total: number; percent: number }> = [];

  await runBootTasks(
    [
      {
        stage: 'First',
        run: async () => {
          order.push('first');
        },
      },
      {
        stage: 'Second',
        run: async () => {
          order.push('second');
        },
      },
    ],
    (value) => progress.push(value),
  );

  assert.deepEqual(order, ['first', 'second']);
  assert.deepEqual(progress, [
    { stage: 'First', completed: 0, total: 2, percent: 0 },
    { stage: 'Second', completed: 1, total: 2, percent: 50 },
    { stage: 'Ready', completed: 2, total: 2, percent: 100 },
  ]);
});

test('stops at the failed boot task and never reports ready', async () => {
  const order: string[] = [];
  const stages: string[] = [];

  await assert.rejects(
    runBootTasks(
      [
        {
          stage: 'Working',
          run: async () => {
            order.push('working');
          },
        },
        {
          stage: 'Broken',
          run: async () => {
            order.push('broken');
            throw new Error('asset failed');
          },
        },
        {
          stage: 'Skipped',
          run: async () => {
            order.push('skipped');
          },
        },
      ],
      (progress) => stages.push(progress.stage),
    ),
    /asset failed/,
  );

  assert.deepEqual(order, ['working', 'broken']);
  assert.deepEqual(stages, ['Working', 'Broken']);
});
