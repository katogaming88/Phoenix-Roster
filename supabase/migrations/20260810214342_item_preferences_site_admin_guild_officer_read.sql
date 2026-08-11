-- item_preferences was missed when guild-officer tier (20260730113259_guild_officer_tier.sql)
-- extended cross-team view access to audit_log/team_members read -- a site
-- admin or guild officer covering another team could not see that team's
-- raider wishlist tags at all, unlike every other officer-view-scoped
-- table. Same "view-only" category as audit_log/team_members (not an
-- action like approvals/priority generation, which deliberately stay
-- excluded), so extended the same way.
alter policy "Officers read item_preferences" on "public"."item_preferences"
    using ((("public"."my_team_role"("team_id") = any (array['officer'::text, 'team_leader'::text])) or "public"."is_site_admin"() or "public"."is_guild_officer"()));
