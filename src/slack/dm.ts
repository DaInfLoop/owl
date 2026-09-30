import { createHmac } from 'node:crypto';
import type { App, BlockAction, ButtonAction } from '@slack/bolt';
import type { KnownBlock } from '@slack/web-api';
import { and, eq, isNull } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { confessions } from '../db/schema.js';
import { authorCredential, hashReplyKey, matchesHash, ownsPost } from './security.js';
import { MAX_TEXT, reviewBlocks } from './views.js';

const plain = (text: string) => ({ type: 'plain_text' as const, text });
const digest = (secret: string, purpose: string, parts: string[]) =>
  createHmac('sha256', secret).update(JSON.stringify([purpose, ...parts])).digest('hex');

export function dmPrompt(text: string, user: string, channel: string, ts: string, secret: string): KnownBlock[] {
  const signature = digest(secret, 'dm-submission', [user, channel, ts, text]);
  return [
    { type: 'section', text: plain('Do you want to submit this confession for review?') },
    { type: 'section', text: plain(text) },
    { type: 'actions', block_id: 'dm_ownership', elements: [{ type: 'checkboxes', action_id: 'dm_passphrase', options: [
      { text: plain('Use a private reply key (passphrase option)'), value: 'passphrase',
        description: plain('Requires this account and a generated secret you save. Leave unchecked for an account hash.') },
    ] }] },
    { type: 'actions', elements: [{ type: 'button', action_id: 'dm_submit', style: 'primary', text: plain('Yes, submit'),
      value: JSON.stringify({ user, channel, ts, signature }) }] },
  ];
}

export function registerDmHandlers(app: App, db: Database, config: Config) {
  app.event('message', async ({ event, client }) => {
    if (event.channel_type !== 'im' || event.subtype || !('user' in event) || !event.user || 'bot_id' in event) return;
    const text = ('text' in event ? event.text : '')?.trim() ?? '';
    if (!text || text.length > MAX_TEXT) {
      await client.chat.postMessage({ channel: event.channel, text: `Send a text confession between 1 and ${MAX_TEXT} characters. Attachments are not submitted.` });
      return;
    }
    await client.chat.postMessage({ channel: event.channel, text: 'Do you want to submit this confession for review?',
      blocks: dmPrompt(text, event.user, event.channel, event.ts, config.signingSecret),
      unfurl_links: false, unfurl_media: false });
  });
  app.action('dm_passphrase', async ({ ack }) => { await ack(); });
  app.action<BlockAction<ButtonAction>>('dm_submit', async ({ ack, body, action, client, respond }) => {
    await ack();
    const preview = body.message?.blocks?.[1];
    const text = preview?.type === 'section' && preview.text?.type === 'plain_text' ? preview.text.text : '';
    let context: { user: string; channel: string; ts: string; signature: string };
    try {
      context = JSON.parse(action.value ?? '');
      if (!context || ![context.user, context.channel, context.ts, context.signature].every(value => typeof value === 'string') ||
        context.user !== body.user.id || context.channel !== body.channel?.id || !context.channel.startsWith('D') ||
        !body.message?.ts || !text || text.length > MAX_TEXT ||
        !matchesHash(context.signature, digest(config.signingSecret, 'dm-submission', [context.user, context.channel, context.ts, text]))) throw new Error('Invalid prompt');
    } catch {
      await respond({ replace_original: false, text: 'This confirmation is invalid. Send your confession to me again.' });
      return;
    }
    // No Slack IDs are persisted in the submission ID. The signed source message also makes retries idempotent.
    const submissionId = `dm:${context.signature}`;
    // Reproducible only with the server secret: a retry can safely show the original key, never a new invalid one.
    const privateKey = digest(config.signingSecret, 'dm-reply-key', [submissionId]);
    const useKey = body.state?.values.dm_ownership?.dm_passphrase?.selected_options?.some(option => option.value === 'passphrase') ?? false;
    let post;
    try {
      [post] = await db.insert(confessions).values({ submissionId, text, postChannel: config.channels.post,
        ...(useKey ? { replyKeyHash: hashReplyKey(privateKey, body.user.id) } : authorCredential(body.user.id)),
      }).onConflictDoNothing({ target: confessions.submissionId }).returning();
      post ??= await db.query.confessions.findFirst({ where: eq(confessions.submissionId, submissionId) });
      if (!post || !ownsPost(post, body.user.id, privateKey)) throw new Error('Unavailable submission');
    } catch {
      await respond({ replace_original: false, text: 'Could not submit this confession. Please try again, or use /owl.' });
      return;
    }
    const confirmation = post.status === 'pending'
      ? `Confession #${post.id} submitted and awaiting review.`
      : `Confession #${post.id} was already submitted (${post.status}).`;
    const blocks: KnownBlock[] = [{ type: 'section', text: plain(confirmation) },
      { type: 'section', text: plain(post.replyKeyHash
        ? `Your private reply key:\n${privateKey}\n\nSave it now. Replies, reactions, and withdrawal require this key and this Slack account.`
        : 'Your Slack account will be recognized through its salted hash. No reply key is needed.') }];
    await client.chat.update({ channel: context.channel, ts: body.message!.ts, text: confirmation, blocks });
    try {
      await db.transaction(async (tx) => {
        const [pending] = await tx.select().from(confessions).where(and(eq(confessions.id, post.id),
          eq(confessions.status, 'pending'), isNull(confessions.reviewTs))).for('update');
        if (!pending) return;
        const review = await client.chat.postMessage({ channel: config.channels.review, text: `Anonymous post #${pending.id}`,
          blocks: reviewBlocks(pending.id, pending.text), unfurl_links: false, unfurl_media: false });
        if (!review.ts) throw new Error('Slack returned no review timestamp');
        await tx.update(confessions).set({ reviewTs: review.ts, updatedAt: new Date() }).where(eq(confessions.id, pending.id));
      });
    } catch {
      await respond({ replace_original: false, text: `Confession #${post.id} is saved, but review delivery is delayed. Moderators can recover it with /owl-revive.` });
    }
  });
}
