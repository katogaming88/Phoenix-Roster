-- #476 follow-up: the fixed-vocabulary archived_reason dropdown alone loses
-- the specifics officers actually want on record (which guild someone moved
-- to, what the schedule conflict was, etc.). archived_reason_detail is a
-- required freeform companion, captured alongside archived_reason at
-- removal time.
ALTER TABLE "public"."players"
  ADD COLUMN "archived_reason_detail" "text";
