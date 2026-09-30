import { pgTable, integer, text, timestamp, pgEnum, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const confessionStatus = pgEnum('confession_status', ['pending', 'publishing', 'accepted', 'withdrawing', 'rejected']);
export const confessions = pgTable('confessions', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  submissionId: text('submission_id').notNull().unique(),
  text: text('text').notNull(),
  replyKeyHash: text('reply_key_hash').unique(),
  authorSalt: text('author_salt'),
  authorHash: text('author_hash'),
  postChannel: text('post_channel').notNull(),
  reviewTs: text('review_ts'),
  postTs: text('post_ts'),
  status: confessionStatus('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('confessions_published_message_idx').on(table.postChannel, table.postTs),
  check('confessions_ownership_check', sql`(${table.replyKeyHash} IS NOT NULL AND ${table.authorSalt} IS NULL AND ${table.authorHash} IS NULL) OR (${table.replyKeyHash} IS NULL AND ${table.authorSalt} IS NOT NULL AND ${table.authorHash} IS NOT NULL) OR ${table.status} = 'rejected'`),
]);
