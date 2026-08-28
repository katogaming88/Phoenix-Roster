-- #476: capture why a player was removed from the roster, alongside the
-- existing archived_at soft-delete timestamp. Restricted to a fixed set of
-- categories (matches the officer-facing dropdown) rather than free text, so
-- the data stays usable for spotting retention patterns across seasons.
ALTER TABLE "public"."players"
  ADD COLUMN "archived_reason" "text";

ALTER TABLE "public"."players"
  ADD CONSTRAINT "players_archived_reason_check" CHECK (
    "archived_reason" IS NULL OR "archived_reason" IN (
      'schedule_conflict',
      'performance',
      'drama',
      'moved_guilds',
      'switching_mains',
      'other'
    )
  );
