ALTER TABLE "confessions" ALTER COLUMN "reply_key_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "confessions" ADD COLUMN "author_salt" text;--> statement-breakpoint
ALTER TABLE "confessions" ADD COLUMN "author_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "confessions_published_message_idx" ON "confessions" USING btree ("post_channel","post_ts");--> statement-breakpoint
ALTER TABLE "confessions" ADD CONSTRAINT "confessions_ownership_check" CHECK (("confessions"."reply_key_hash" IS NOT NULL AND "confessions"."author_salt" IS NULL AND "confessions"."author_hash" IS NULL) OR ("confessions"."reply_key_hash" IS NULL AND "confessions"."author_salt" IS NOT NULL AND "confessions"."author_hash" IS NOT NULL) OR "confessions"."status" = 'rejected');