import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmationView, decisionBlocks, postView } from '../src/slack/views.js';

test('submission ownership default exactly matches a radio option', () => {
  const view = postView();
  const block = view.blocks.find(block => 'block_id' in block && block.block_id === 'ownership');
  assert.ok(block && block.type === 'input');
  assert.equal(block.element.type, 'radio_buttons');
  if (block.element.type !== 'radio_buttons') throw new Error('Expected radio buttons');
  assert.deepEqual(block.element.initial_option, block.element.options[0]);
});

test('confirmation renders post IDs and private keys as literal text', () => {
  for (const key of [null, 'private-key']) {
    const section = confirmationView(2, key).blocks[0];
    assert.ok(section && section.type === 'section' && section.text);
    assert.equal(section.text.type, 'plain_text');
    assert.ok(section.text.text.includes('Post #2 is awaiting review.'));
    if (key) assert.ok(section.text.text.includes(key));
  }
});

test('review decisions retain original text and include a revision-bound undo button', () => {
  for (const verdict of ['accepted', 'rejected'] as const) {
    const blocks = decisionBlocks(2, '<#PRIVATE> original text', verdict, 'MOD', 1234);
    const section = blocks[0];
    assert.ok(section && section.type === 'section' && section.text);
    assert.equal(section.text.type, 'plain_text');
    assert.ok(section.text.text.includes('<#PRIVATE> original text'));
    const actions = blocks[2];
    assert.ok(actions && actions.type === 'actions');
    const button = actions.elements[0];
    assert.ok(button && button.type === 'button');
    assert.equal(button.action_id, 'undo_review');
    assert.equal(button.value, '2:1234');
    assert.ok(button.confirm);
  }
});
