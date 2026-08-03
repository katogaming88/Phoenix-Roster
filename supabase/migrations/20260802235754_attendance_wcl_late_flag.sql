-- Supports the WCL sync flagging a probable late arrival (missed the raid's
-- first pull, present in later ones) instead of guessing which Late status
-- applies: a new attendance.source value the sync can write, paired with
-- status left unset (NULL) for an officer to manually classify via the grid.

alter table "public"."attendance" alter column "status" drop not null;

alter table "public"."attendance" drop constraint "attendance_source_check";

alter table "public"."attendance" add constraint "attendance_source_check"
  check (source in ('WCL', 'Officer', 'Auto (Bench)', 'WCL (Late?)'));
