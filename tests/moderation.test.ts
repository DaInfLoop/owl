import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHandlers } from '../src/slack/handlers.js';

// Exercise registered handlers without Slack or Postgres network calls.
function fixture(status = 'pending') {
  const handlers = new Map<string, (args: any) => Promise<void>>();
  let row = { id: 2, text: 'original confession', status, postChannel: 'MAIN', postTs: status === 'accepted' ? 'PUBLIC_TS' : null,
    reviewTs: 'REVIEW_TS', authorHash: 'hash', authorSalt: 'salt', replyKeyHash: null, updatedAt: new Date(1234) };
  const updates: any[] = [], deletes: any[] = [], responses: any[] = [];
  let deleteError: unknown;
  const db: any = {
    update: () => ({ set: (values: any) => ({ where: () => {
      Object.assign(row, values);
      return { returning: async () => [{ ...row }] };
    } }) }),
    select: () => ({ from: () => ({ where: () => ({ for: async () => [{ ...row }] }) }) }),
    transaction: async (fn: (tx: any) => Promise<void>) => {
      const before = { ...row };
      try { await fn(db); } catch (error) { row = before; throw error; }
    },
  };
  const app: any = { command() {}, view() {}, options() {}, shortcut() {}, action: (name: string, fn: any) => handlers.set(name, fn) };
  registerHandlers(app, db, { channels: { post: 'MAIN', meta: 'META', review: 'REVIEW', log: 'LOG' } } as any);
  const client = { chat: {
    postMessage: async () => ({ ts: 'PUBLIC_TS' }),
    update: async (args: any) => { updates.push(args); },
    delete: async (args: any) => { deletes.push(args); if (deleteError) throw deleteError; },
  } };
  return {
    get row() { return row; }, updates, deletes, responses,
    failDelete(error: unknown) { deleteError = error; },
    async invoke(name: string, value = '2', channel = 'REVIEW') {
      await handlers.get(name)!({ ack: async () => {}, body: { channel: { id: channel }, message: { ts: 'REVIEW_TS' }, user: { id: 'MOD' } },
        action: { value }, client, respond: async (args: any) => { responses.push(args); } });
    },
  };
}

test('reject retains original text and ownership, and renders Undo', async () => {
  const f = fixture();
  await f.invoke('reject_confession');
  assert.equal(f.row.status, 'rejected');
  assert.equal(f.row.text, 'original confession');
  assert.equal(f.row.authorHash, 'hash');
  assert.equal(f.updates[0].blocks[2].elements[0].action_id, 'undo_review');
});

test('undo rejection returns to pending without publishing or deleting', async () => {
  const f = fixture('rejected');
  await f.invoke('undo_review', '2:1234');
  assert.equal(f.row.status, 'pending');
  assert.equal(f.row.text, 'original confession');
  assert.equal(f.deletes.length, 0);
  assert.equal(f.updates[0].blocks[1].elements[0].action_id, 'accept_confession');
});

for (const channel of ['MAIN', 'META']) {
  test(`undo approval deletes from ${channel} and clears publication timestamp`, async () => {
    const f = fixture('accepted');
    f.row.postChannel = channel;
    await f.invoke('undo_review', '2:1234');
    assert.deepEqual(f.deletes, [{ channel, ts: 'PUBLIC_TS' }]);
    assert.equal(f.row.status, 'pending');
    assert.equal(f.row.postTs, null);
    assert.equal(f.row.text, 'original confession');
    await f.invoke('undo_review', '2:1234');
    assert.equal(f.deletes.length, 1);
  });
}

test('failed deletion leaves accepted decision intact for retry', async () => {
  const f = fixture('accepted');
  f.failDelete(new Error('network error'));
  await f.invoke('undo_review', '2:1234');
  assert.equal(f.row.status, 'accepted');
  assert.equal(f.row.postTs, 'PUBLIC_TS');
  assert.equal(f.updates.length, 0);
  assert.match(f.responses[0].text, /Retry Undo/);
});

test('already-deleted published message can be safely undone', async () => {
  const f = fixture('accepted');
  f.failDelete({ data: { error: 'message_not_found' } });
  await f.invoke('undo_review', '2:1234');
  assert.equal(f.row.status, 'pending');
});

test('stale buttons, wrong channel and withdrawn posts cannot be undone', async () => {
  const stale = fixture('accepted');
  await stale.invoke('undo_review', '2:999');
  assert.equal(stale.row.status, 'accepted');
  assert.equal(stale.deletes.length, 0);
  await stale.invoke('undo_review', '2:1234', 'MAIN');
  assert.equal(stale.deletes.length, 0);
  const withdrawn = fixture('rejected');
  withdrawn.row.text = '';
  await withdrawn.invoke('undo_review', '2:1234');
  assert.equal(withdrawn.row.status, 'rejected');
  assert.equal(withdrawn.updates.length, 0);
});
