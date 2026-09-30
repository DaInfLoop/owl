import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { registerHandlers } from '../src/slack/handlers.js';

test('owl commands match the Slack manifest and bot branding', () => {
  const commands: string[] = [];
  const app = {
    command: (name: string) => commands.push(name),
    view() {}, action() {}, options() {}, shortcut() {},
  };
  registerHandlers(
    app as unknown as Parameters<typeof registerHandlers>[0],
    {} as Parameters<typeof registerHandlers>[1],
    {} as Parameters<typeof registerHandlers>[2],
  );
  const manifest = parse(readFileSync(new URL('../slack.manifest.yaml', import.meta.url), 'utf8'));
  const expected = ['/owl', '/owl-revive', '/owl-self-reject'];
  assert.deepEqual(commands.sort(), expected);
  assert.deepEqual(manifest.features.slash_commands.map((entry: { command: string }) => entry.command).sort(), expected);
  assert.equal(manifest.display_information.name, 'owl');
  assert.equal(manifest.features.bot_user.display_name, 'owl');
  for (const entry of manifest.features.slash_commands) {
    assert.equal(entry.url, 'https://prox3.3kh0.dev/slack/events');
  }
});
