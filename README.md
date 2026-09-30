# Owl

*hoot hoot!*

a simple Slack bot for anonymous confessions, replies, and reactions. built to be fast, secure, and not fancy. it should stand the test of time, and not be a burden to maintain. best deployed to Coolify via the [`Dockerfile`](Dockerfile).

## local setup

```sh
bun install --frozen-lockfile
cp .env.example .env
# set Slack creds and channel IDs now
docker compose up -d --wait
bun run db:migrate
bun run dev
```

invite the bot to `POST_CHANNEL`, `META_CHANNEL`, `REVIEW_CHANNEL`, and `LOG_CHANNEL`. keep the review channel private: its members choose **Post to confessions** (`POST_CHANNEL`), **Post to #meta** (`META_CHANNEL`), or **Reject**. each approved confession is published only to the chosen channel.

rejected posts retain their original text in the private review channel. **Undo decision** returns a rejected or approved post to pending review; undoing approval deletes its published message from the selected channel. existing thread replies may remain. author withdrawals still erase the post text and ownership credentials and cannot be undone. previously erased rejection text cannot be recovered.

## cmds

| what it is | what it do |
| --- | --- |
| `/owl [message]` | open the confession form, optionally with your message filled in |
| `/owl-self-reject <id>` | withdraw your pending or published confession |
| `/owl-revive` | recover up to 50 pending confessions missing a review message; review channel only |
| reply anon | reply as the original author; works from the post or anywhere in its thread |
| react anon | toggle a bot reaction on the selected post or thread message |

the submission form lets you choose a salted account hash or a generated private reply key. neither mode stores your raw Slack user ID. the private key mode needs both the key and the original account for replies, reactions, and withdrawal. save the key when it is shown; it cannot be recovered. salted account hashes recognize your account automatically, but someone with database access can check them against known Slack user IDs.
