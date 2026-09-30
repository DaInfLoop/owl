import type { App, BlockAction, ButtonAction, MessageShortcut } from '@slack/bolt';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { WebClient } from '@slack/web-api';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { confessions } from '../db/schema.js';
import { authorCredential, hashReplyKey, newReplyKey, ownsPost } from './security.js';
import { registerDmHandlers } from './dm.js';
import { confirmationView, decisionBlocks, MAX_TEXT, postView, reactionView, replyView, reviewBlocks, withdrawView } from './views.js';
function slackError(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'data' in error &&
    (error.data as { error?: string } | undefined)?.error === code;
}

export function registerHandlers(app: App, db: Database, config: Config) {
  registerDmHandlers(app, db, config);
  const cleared = () => ({ status: 'rejected' as const, text: '', replyKeyHash: null,
    authorHash: null, authorSalt: null, updatedAt: new Date() });
  const published = (channel: string, ts: string) => db.query.confessions.findFirst({
    where: and(eq(confessions.postChannel, channel), eq(confessions.postTs, ts), eq(confessions.status, 'accepted')),
  });
  async function withdraw(id: number, userId: string, key: string, client: WebClient) {
    const post = await db.query.confessions.findFirst({ where: eq(confessions.id, id) });
    if (!post || !ownsPost(post, userId, key)) return false;
    const [claimed] = await db.update(confessions).set({ status: 'withdrawing', updatedAt: new Date() })
      .where(and(eq(confessions.id, id), inArray(confessions.status, ['pending', 'accepted', 'withdrawing', 'rejected']))).returning();
    if (!claimed) return false;
    if (claimed.postTs) {
      try { await client.chat.delete({ channel: claimed.postChannel, ts: claimed.postTs }); }
      catch (error) { if (!slackError(error, 'message_not_found')) throw error; }
    }
    await db.update(confessions).set(cleared()).where(eq(confessions.id, id));
    await Promise.all([
      ...(claimed.reviewTs ? [client.chat.update({ channel: config.channels.review, ts: claimed.reviewTs,
        text: `Post #${id} withdrawn by its author`, blocks: [{ type: 'section', text: {
          type: 'plain_text', text: `Post #${id} withdrawn by its author`,
        } }] })] : []),
      client.chat.postMessage({ channel: config.channels.log, text: `Post #${id} withdrawn by its author.` }),
    ]);
    return true;
  }

  app.command('/owl-self-reject', async ({ ack, command, client, respond }) => {
    await ack();
    const s = command.text.trim();
    const id = Number(s);
    if (!/^\d+$/.test(s) || !Number.isSafeInteger(id) || id < 1) {
      await respond({ response_type: 'ephemeral', text: 'Usage: /owl-self-reject <id>' });
      return;
    }
    try {
      const post = await db.query.confessions.findFirst({ where: eq(confessions.id, id) });
      if (post?.replyKeyHash) {
        await client.views.open({ trigger_id: command.trigger_id, view: withdrawView(id) });
        return;
      }
      const success = await withdraw(id, command.user_id, '', client);
      await respond({ response_type: 'ephemeral', text: success ? `Post #${id} withdrawn.` : 'No available post belongs to this account. A post being published cannot be withdrawn yet.' });
    } catch {
      await respond({ response_type: 'ephemeral', text: 'Withdrawal could not be confirmed. Please try again; published content may already have been removed.' });
    }
  });

  app.view('self_reject_view', async ({ ack, body, view, client }) => {
    const id = Number(view.private_metadata);
    const key = view.state.values.key?.key?.value?.trim() ?? '';
    const post = Number.isSafeInteger(id) && id > 0
      ? await db.query.confessions.findFirst({ where: eq(confessions.id, id) }) : undefined;
    if (!post || !ownsPost(post, body.user.id, key) || !['pending', 'accepted', 'withdrawing', 'rejected'].includes(post.status)) {
      await ack({ response_action: 'errors', errors: { key: 'Use this post’s private key and its original account.' } });
      return;
    }
    await ack();
    await withdraw(id, body.user.id, key, client);
  });

  app.command('/owl-revive', async ({ ack, command, client, respond }) => {
    await ack();
    if (command.channel_id !== config.channels.review) {
      await respond({ response_type: 'ephemeral', text: 'Run /owl-revive in the review channel.' });
      return;
    }
    const rows = await db.select({ id: confessions.id }).from(confessions)
      .where(and(eq(confessions.status, 'pending'), isNull(confessions.reviewTs))).orderBy(asc(confessions.id)).limit(50);
    let count = 0;
    for (const row of rows) {
      await db.transaction(async (tx) => {
        const [post] = await tx.select().from(confessions).where(and(eq(confessions.id, row.id),
          eq(confessions.status, 'pending'), isNull(confessions.reviewTs))).for('update', { skipLocked: true });
        if (!post) return;
        const review = await client.chat.postMessage({ channel: config.channels.review,
          text: `Anonymous post #${post.id}`, blocks: reviewBlocks(post.id, post.text), unfurl_links: false, unfurl_media: false });
        if (!review.ts) throw new Error('Slack returned no review timestamp');
        await tx.update(confessions).set({ reviewTs: review.ts, updatedAt: new Date() }).where(eq(confessions.id, post.id));
        count++;
      });
    }
    await respond({ response_type: 'ephemeral', text: `Recovered ${count} pending review message(s).` });
  });

  const emojis = ['thumbsup', 'thumbsdown', 'heart', 'tada', 'smile', 'joy', 'sob', 'eyes', 'thinking_face',
    'fire', '100', 'raised_hands', 'clap', 'wave', 'pray', 'sparkles', 'white_check_mark', 'rocket', 'heart_eyes'];
  app.options('emoji', async ({ ack, options }) => {
    const q = options.value.trim().replaceAll(':', '').toLowerCase();
    const names = emojis.filter(name => name.includes(q));
    // emoji
    if (/^[a-z0-9_+\-]{1,64}$/.test(q) && !names.includes(q)) names.unshift(q);
    await ack({ options: names.slice(0, 100).map(name => ({ text: { type: 'plain_text', text: `:${name}:` }, value: name })) });
  });
  app.shortcut<MessageShortcut>('react_anon', async ({ ack, shortcut, client }) => {
    await ack();
    const ts = shortcut.message.thread_ts ?? shortcut.message.ts;
    await client.views.open({ trigger_id: shortcut.trigger_id,
      view: reactionView(shortcut.channel.id, ts, shortcut.message.ts) });
  });
  app.view('react_anon_view', async ({ ack, body, view, client }) => {
    const key = view.state.values.key?.key?.value?.trim() ?? '';
    const emoji = view.state.values.emoji?.emoji?.selected_option?.value ?? '';
    let context: { channel: string; ts: string; targetTs: string };
    try {
      context = JSON.parse(view.private_metadata);
      if (typeof context.channel !== 'string' || typeof context.ts !== 'string' || typeof context.targetTs !== 'string') throw new Error('Invalid context');
    } catch {
      await ack({ response_action: 'errors', errors: { emoji: 'Reopen this form from the confession or its thread.' } });
      return;
    }
    if (!/^[a-zA-Z0-9_+\-]{1,64}$/.test(emoji)) {
      await ack({ response_action: 'errors', errors: { emoji: 'Choose an emoji.' } });
      return;
    }
    const post = await published(context.channel, context.ts);
    if (!post || !ownsPost(post, body.user.id, key)) {
      await ack({ response_action: 'errors', errors: { key: 'Use the original account, plus its private key if you chose that option.' } });
      return;
    }
    await ack();
    try {
      await client.reactions.add({ channel: context.channel, timestamp: context.targetTs, name: emoji });
    } catch (error) {
      if (slackError(error, 'already_reacted')) {
        await client.reactions.remove({ channel: context.channel, timestamp: context.targetTs, name: emoji });
      } else {
        await client.chat.postEphemeral({ channel: context.channel, user: body.user.id,
          text: 'Could not toggle the reaction. Check that the emoji and message exist before trying again.' });
      }
    }
  });
  app.command('/owl', async ({ ack, command, client, respond }) => {
    await ack();
    try {
      await client.views.open({ trigger_id: command.trigger_id, view: postView(command.text.trim()) });
    } catch (error) {
      const data = typeof error === 'object' && error !== null && 'data' in error
        ? error.data as { error?: unknown } : undefined;
      console.error('owl form open failed:', typeof data?.error === 'string' ? data.error : 'unknown_error');
      await respond({ response_type: 'ephemeral', text: 'Could not open the form. Please try /owl again.' });
    }
  });

  app.view('anon_post_view', async ({ ack, view, body, client }) => {
    const text = view.state.values.text?.text?.value?.trim() ?? '';
    if (!text || text.length > MAX_TEXT) {
      await ack({ response_action: 'errors', errors: { text: `Enter between 1 and ${MAX_TEXT} characters.` } });
      return;
    }
    const mode = view.state.values.ownership?.mode?.selected_option?.value;
    if (mode !== 'account' && mode !== 'passphrase') {
      await ack({ response_action: 'errors', errors: { ownership: 'Choose an ownership option.' } });
      return;
    }
    const key = mode === 'passphrase' ? newReplyKey() : null;
    let confession;
    try {
      [confession] = await db.insert(confessions).values({
        submissionId: view.id, text,
        ...(key ? { replyKeyHash: hashReplyKey(key, body.user.id) } : authorCredential(body.user.id)),
        postChannel: config.channels.post,
      }).onConflictDoNothing({ target: confessions.submissionId }).returning();
    } catch {
      await ack({ response_action: 'errors', errors: { text: 'Could not save your post. Please try again.' } });
      return;
    }
    if (!confession) {
      await ack({ response_action: 'clear' });
      return;
    }
    await ack({ response_action: 'update', view: confirmationView(confession.id, key) });
    const review = await client.chat.postMessage({
      channel: config.channels.review, text: `Anonymous post #${confession.id}`,
      blocks: reviewBlocks(confession.id, text), unfurl_links: false, unfurl_media: false,
    });
    if (!review.ts) throw new Error('Slack returned no review timestamp');
    await db.update(confessions).set({ reviewTs: review.ts, updatedAt: new Date() })
      .where(eq(confessions.id, confession.id));
  });

  for (const actionId of ['accept_confession', 'accept_meta', 'reject_confession'] as const) {
    app.action<BlockAction<ButtonAction>>(actionId, async ({ ack, body, action, client, respond }) => {
      await ack();
      if (body.channel?.id !== config.channels.review || !body.message?.ts) return;
      const id = Number(action.value);
      if (!Number.isSafeInteger(id) || id < 1) return;
      const accepting = actionId !== 'reject_confession';
      const postChannel = actionId === 'accept_meta' ? config.channels.meta : config.channels.post;
      const reviewedAt = new Date();
      const [confession] = await db.update(confessions)
        .set({ status: accepting ? 'publishing' : 'rejected',
          ...(accepting ? { postChannel } : {}), updatedAt: reviewedAt })
        .where(and(eq(confessions.id, id), eq(confessions.status, 'pending'),
          eq(confessions.reviewTs, body.message.ts))).returning();
      if (!confession) {
        await respond({ response_type: 'ephemeral', replace_original: false, text: 'this has already been reviewed! thank u for ur efforts anyway! its the spirit that counts' });
        return;
      }
      if (accepting) {
        const published = await client.chat.postMessage({
          channel: confession.postChannel, text: `${id}: ${confession.text}`, mrkdwn: false,
          blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [
            { type: 'text', text: String(id), style: { bold: true } },
            { type: 'text', text: `: ${confession.text}` },
          ] }] }],
          unfurl_links: false, unfurl_media: false,
        });
        if (!published.ts) throw new Error('Slack returned no publication timestamp');
        await db.update(confessions).set({ status: 'accepted', postTs: published.ts, updatedAt: reviewedAt })
          .where(eq(confessions.id, id));
      }
      const verdict = accepting ? 'accepted' : 'rejected';
      await db.transaction(async (tx) => {
        const [current] = await tx.select().from(confessions).where(and(eq(confessions.id, id),
          eq(confessions.status, verdict), eq(confessions.updatedAt, reviewedAt))).for('update');
        if (!current?.text) return;
        await client.chat.update({ channel: config.channels.review, ts: body.message!.ts,
          text: `Post #${id} ${verdict}`, blocks: decisionBlocks(id, current.text, verdict, body.user.id, reviewedAt.getTime()) });
      });
      await client.chat.postMessage({ channel: config.channels.log, text: `Post #${id} ${verdict} by <@${body.user.id}>.` });
    });
  }

  app.action<BlockAction<ButtonAction>>('undo_review', async ({ ack, body, action, client, respond }) => {
    await ack();
    if (body.channel?.id !== config.channels.review || !body.message?.ts) return;
    const parts = action.value?.split(':') ?? [];
    if (parts.length !== 2 || !parts.every(part => /^\d+$/.test(part))) return;
    const [id, revision] = parts.map(Number);
    if (!Number.isSafeInteger(id) || !id || !Number.isSafeInteger(revision)) return;
    let undone = false;
    try {
      await db.transaction(async (tx) => {
        const [post] = await tx.select().from(confessions).where(and(eq(confessions.id, id!),
          eq(confessions.reviewTs, body.message!.ts))).for('update');
        if (!post || !['accepted', 'rejected'].includes(post.status) || post.updatedAt.getTime() !== revision ||
          !post.text || (!post.replyKeyHash && (!post.authorHash || !post.authorSalt))) return;
        if (post.status === 'accepted') {
          if (!post.postTs) throw new Error('No publication timestamp');
          try { await client.chat.delete({ channel: post.postChannel, ts: post.postTs }); }
          catch (error) { if (!slackError(error, 'message_not_found')) throw error; }
        }
        await tx.update(confessions).set({ status: 'pending', postTs: null, updatedAt: new Date() })
          .where(eq(confessions.id, post.id));
        await client.chat.update({ channel: config.channels.review, ts: body.message!.ts,
          text: `Anonymous post #${post.id} awaiting review`, blocks: reviewBlocks(post.id, post.text) });
        undone = true;
      });
    } catch {
      await respond({ response_type: 'ephemeral', replace_original: false,
        text: 'Undo could not be confirmed. Retry Undo; the published message may already have been removed.' });
      return;
    }
    if (!undone) {
      await respond({ response_type: 'ephemeral', replace_original: false,
        text: 'This decision has already changed, or the post was withdrawn. Nothing was undone.' });
      return;
    }
    await client.chat.postMessage({ channel: config.channels.log, text: `Decision for post #${id} undone by <@${body.user.id}>; returned to pending review.` });
  });

  app.shortcut<MessageShortcut>('reply_anon', async ({ ack, shortcut, client }) => {
    await ack();
    await client.views.open({ trigger_id: shortcut.trigger_id,
      view: replyView(shortcut.channel.id, shortcut.message.thread_ts ?? shortcut.message.ts) });
  });

  app.view('reply_anon_view', async ({ ack, view, body, client }) => {
    const key = view.state.values.key?.key?.value?.trim() ?? '';
    const text = view.state.values.text?.text?.value?.trim() ?? '';
    if (!text || text.length > MAX_TEXT) {
      await ack({ response_action: 'errors', errors: { text: `Enter between 1 and ${MAX_TEXT} characters.` } });
      return;
    }
    let context: { channel: string; ts: string };
    try {
      context = JSON.parse(view.private_metadata);
      if (typeof context.channel !== 'string' || typeof context.ts !== 'string') throw new Error('Invalid context');
    } catch {
      await ack({ response_action: 'errors', errors: { text: 'Reopen this form from the post you want to reply to.' } });
      return;
    }
    let confession;
    try {
      confession = await published(context.channel, context.ts);
    } catch {
      await ack({ response_action: 'errors', errors: { key: 'Could not verify the key. Please try again.' } });
      return;
    }
    if (!confession || !ownsPost(confession, body.user.id, key)) {
      await ack({ response_action: 'errors', errors: { key: 'Use the original account, plus its private reply key if you chose that option.' } });
      return;
    }
    await ack();
    try {
      await client.chat.postMessage({ channel: confession.postChannel, thread_ts: confession.postTs!,
        text, blocks: [{ type: 'section', text: { type: 'plain_text', text } }],
        unfurl_links: false, unfurl_media: false });
    } catch {
      await client.chat.postEphemeral({ channel: confession.postChannel, user: body.user.id,
        text: 'Your anonymous reply could not be confirmed. Check the thread before trying again.' });
    }
  });
}
