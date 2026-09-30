import type { ModalView, KnownBlock, InputBlock } from '@slack/web-api';

export const MAX_TEXT = 2800;
const plain = (text: string) => ({ type: 'plain_text' as const, text });
const input = (id: string, label: string, multiline = false, optional = false): InputBlock => ({
  type: 'input', block_id: id, label: plain(label), optional,
  element: { type: 'plain_text_input', action_id: id, multiline, max_length: multiline ? MAX_TEXT : 64 },
});
const key = () => input('key', 'Private reply key (leave blank for account hash)', false, true);
export function postView(initialText = ''): ModalView {
  return { type: 'modal', callback_id: 'anon_post_view', title: plain('New anonymous post'),
    submit: plain('Submit'), close: plain('Cancel'), blocks: [{ type: 'input', block_id: 'text', label: plain('Your message'),
      element: { type: 'plain_text_input', action_id: 'text', multiline: true, max_length: MAX_TEXT,
        ...(initialText ? { initial_value: initialText.slice(0, MAX_TEXT) } : {}) } }, {
      type: 'input', block_id: 'ownership', label: plain('How should we recognize your replies?'),
      element: { type: 'radio_buttons', action_id: 'mode',
        initial_option: { text: plain('Slack account hash'), value: 'account' },
        options: [
          { text: plain('Slack account hash'), value: 'account', description: plain('Automatically recognizes this account using a salted hash.') },
          { text: plain('Private reply key'), value: 'passphrase', description: plain('Requires this account and a generated secret you save.') },
        ] },
    }] };
}
export function withdrawView(id: number): ModalView {
  return { type: 'modal', callback_id: 'self_reject_view', title: plain('Withdraw your post'),
    private_metadata: String(id), submit: plain('Withdraw'), close: plain('Cancel'),
    blocks: [input('key', 'Private reply key')] };
}
export function reactionView(channel: string, ts: string, targetTs: string): ModalView {
  return { type: 'modal', callback_id: 'react_anon_view', title: plain('React anonymously'),
    private_metadata: JSON.stringify({ channel, ts, targetTs }), submit: plain('Toggle reaction'), close: plain('Cancel'),
    blocks: [key(),
      { type: 'input', block_id: 'emoji', label: plain('Emoji'), element: {
        type: 'external_select', action_id: 'emoji', min_query_length: 0, placeholder: plain('Choose an emoji'),
      } }, { type: 'context', elements: [plain('Choosing the same emoji again removes your anonymous reaction.')] }] };
}
export function confirmationView(id: number, key: string | null): ModalView {
  return { type: 'modal', title: plain('Post submitted'), close: plain('Done'), blocks: [{
    type: 'section', text: { type: 'mrkdwn', text: `Post *#${id}* is awaiting review.\n\n${key ? `Your private reply key:\n\`${key}\`\n\nSave it now. You will need this key and this Slack account to reply.` : 'Your Slack account will be recognized through its salted hash. No reply key is needed.'}\n\nUse “Reply anonymously” on your approved post to reply.` },
  }] };
}
export function replyView(channel: string, ts: string): ModalView {
  return { type: 'modal', callback_id: 'reply_anon_view', title: plain('Reply anonymously'),
    private_metadata: JSON.stringify({ channel, ts }), submit: plain('Reply'), close: plain('Cancel'),
    blocks: [key(), input('text', 'Your reply', true)] };
}
export function reviewBlocks(id: number, text: string): KnownBlock[] {
  return [
    { type: 'section', text: plain(`Anonymous post #${id}\n${text}`) },
    { type: 'actions', elements: [
      { type: 'button', action_id: 'accept_confession', value: String(id), text: plain('Accept'), style: 'primary' },
      { type: 'button', action_id: 'reject_confession', value: String(id), text: plain('Reject'), style: 'danger' },
    ] },
  ];
}
