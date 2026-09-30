ALTER TABLE "confessions" ALTER COLUMN "id" SET START WITH 40442;
--> statement-breakpoint
-- Continue prox2's numbering without renumbering existing posts or reusing IDs.
DO $$
DECLARE
  next_id bigint;
BEGIN
  LOCK TABLE "confessions" IN ACCESS EXCLUSIVE MODE;
  EXECUTE format(
    'SELECT last_value + CASE WHEN is_called THEN 1 ELSE 0 END FROM %s',
    pg_get_serial_sequence('confessions', 'id')
  ) INTO next_id;
  SELECT greatest(40442, next_id, coalesce(max(id)::bigint + 1, 40442))
    INTO next_id FROM "confessions";
  EXECUTE format('ALTER TABLE "confessions" ALTER COLUMN "id" RESTART WITH %s', next_id);
END $$;