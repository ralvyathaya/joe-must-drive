import assert from 'node:assert/strict';
import test from 'node:test';
import { GAME_CONFIG } from '../src/core/config.ts';

test('keeps the Vibe Jam portal opt-in by default', () => {
  assert.equal(GAME_CONFIG.portal.enabled, false);
});
