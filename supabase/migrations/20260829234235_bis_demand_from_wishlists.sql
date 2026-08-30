-- BiS demand vs awards was sourced from public.bis_items -- the officer-
-- curated BiS Manager grid -- which almost nobody has populated (it's a
-- separate, rarely-touched tool from the per-player wishlist). Demand should
-- instead come from wishlists (public.item_preferences), which raiders
-- actually keep up to date. "Demand" = players who've tagged the item 'bis'
-- on their wishlist, active roster only, same shape as before.
create or replace view public.bis_demand_vs_awards
with (security_invoker = on)
as
with demand as (
  select p.team_id, ip.item_id, count(distinct ip.player_id) as demand_count
  from public.item_preferences ip
  join public.players p on p.id = ip.player_id
  where p.archived_at is null
    and ip.status = 'bis'
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
