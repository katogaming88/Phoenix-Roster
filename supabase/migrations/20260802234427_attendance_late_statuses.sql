-- Adds "Late (with notice)" and "Late (no notice)" to attendance.status's
-- allowed values (90%/50% attendance weight respectively, see
-- js/common.js's ATTENDANCE_WEIGHTS_JS) alongside the 7 existing statuses.

ALTER TABLE "public"."attendance" DROP CONSTRAINT "attendance_status_check";

ALTER TABLE "public"."attendance" ADD CONSTRAINT "attendance_status_check" CHECK (("status" = ANY (ARRAY[
  'Present'::"text",
  'Bench'::"text",
  'Medical Leave'::"text",
  'Excused'::"text",
  'Extended Leave'::"text",
  'Late (with notice)'::"text",
  'Late (no notice)'::"text",
  'No Show'::"text",
  'Not on Roster'::"text"
])));
