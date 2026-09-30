import assert from 'node:assert/strict';
import test from 'node:test';
import { postView } from '../src/slack/views.js';

test('submission ownership default exactly matches a radio option', () => {
  const view = postView();
  const block = view.blocks.find(block => 'block_id' in block && block.block_id === 'ownership');
  assert.ok(block && block.type === 'input');
  assert.equal(block.element.type, 'radio_buttons');
  if (block.element.type !== 'radio_buttons') throw new Error('Expected radio buttons');
  assert.deepEqual(block.element.initial_option, block.element.options[0]);
});
