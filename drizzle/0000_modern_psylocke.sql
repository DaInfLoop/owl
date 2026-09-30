CREATE TYPE "public"."confession_status" AS ENUM('pending', 'publishing', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "confessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "confessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"submission_id" text NOT NULL,
	"text" text NOT NULL,
	"reply_key_hash" text NOT NULL,
	"post_channel" text NOT NULL,
	"review_ts" text,
	"post_ts" text,
	"status" "confession_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "confessions_submission_id_unique" UNIQUE("submission_id"),
	CONSTRAINT "confessions_reply_key_hash_unique" UNIQUE("reply_key_hash")
);
