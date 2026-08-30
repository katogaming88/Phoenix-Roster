-- Exclude placeholder items from BiS demand -- they're catalog stand-ins
-- (e.g. "any trinket") a player wishlists when the real item isn't in the
-- catalog yet, not a real drop that can ever show a meaningful
-- awarded_count.
create or replace view public.bis_demand_vs_awards
with (security_invoker = on)
as
with demand as (
  select p.team_id, ip.item_id, count(distinct ip.player_id) as demand_count
  from public.item_preferences ip
  join public.players p on p.id = ip.player_id
  join public.items i on i.id = ip.item_id
  where p.archived_at is null
    and ip.status = 'bis'
    and not i.is_placeholder
  group by p.team_id, ip.item_id
),
awards as (
  select team_id, item_id, season, count(*) as awarded_count
  from public.rclc_loot
  where item_id is not null
  group by team_id, item_id, season
)
select
  d.team_id,
  d.item_id,
  i.name as item_name,
  i.slot,
  d.demand_count,
  a.season,
  coalesce(a.awarded_count, 0) as awarded_count
from demand d
join public.items i on i.id = d.item_id
left join awards a on a.team_id = d.team_id and a.item_id = d.item_id
order by d.team_id, d.demand_count desc, coalesce(a.awarded_count, 0) asc;
