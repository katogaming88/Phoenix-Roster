-- Who the sold ping notifies (#918).
--
-- The first live sold post missed its finder. The row carried no
-- finder_discord_id (it predates #889's stamp) and no player_id, because
-- submit_boe_found matches a finder's character within p_team_id only and
-- that character sat on another team, removed from its roster a month
-- earlier. boe-sold-webhook fell through to the bold name it renders when
-- nobody can be found. Seven open or sold rows are in that state.
--
-- The resolution lives here rather than inline in the edge function for one
-- practical reason: nothing in CI parses supabase/functions, so the same code
-- written there would ship unexercised. Shape copied from resolve_actor_name
-- and resolve_discord_display_name, down to the security definer plus gate
-- plus authenticated grant.
--
-- security definer also replaces a service-role reach the edge function
-- needed: team_members' self-read returns only the caller's own row, so a BoE
-- manager holding no officer role anywhere could not read the finder's row
-- for themselves.

create or replace function public.resolve_boe_finder_discord_id(p_boe_id integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.boe_items%rowtype;
  v_discord_id text;
  v_first text;
  v_distinct integer;
begin
  -- The same pair boe_record_sale requires, so this admits exactly the people
  -- who could have caused the message it feeds.
  if not (public.is_boe_manager() or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select * into v_row from public.boe_items where id = p_boe_id;
  if not found then
    return null;
  end if;

  -- 1. Stamped at submit, when the finder was signed in (#889). Trusted over
  -- everything below: it is the finder saying who they are.
  if v_row.finder_discord_id is not null then
    return v_row.finder_discord_id;
  end if;

  -- 2. The claimed character submit_boe_found resolved on the finding team.
  if v_row.player_id is not null then
    select tm.discord_id
    into v_discord_id
    from public.players p
    join public.team_members tm on tm.id = p.team_member_id
    where p.id = v_row.player_id;

    if v_discord_id is not null then
      return v_discord_id;
    end if;
  end if;

  -- 3. The name, matched across every team.
  --
  -- Compare first name segments: a finder_name may be bare ("Brugamen") or
  -- carry a realm ("Glizzygary-Dalaran", "Warbird-Burning Blade"), so neither
  -- side compares whole.
  v_first := lower(btrim(split_part(coalesce(v_row.finder_name, ''), '-', 1)));
  if v_first = '' then
    return null;
  end if;

  -- Two rules that look like bugs and are not.
  --
  -- Removed characters count. The find that prompted this was reported a
  -- month after its character left the roster, so archived_at is not filtered
  -- here: the person is still in the guild's Discord and still owed their cut.
  --
  -- Ambiguity is judged on distinct discord_id, not on matching rows. A person
  -- with two character rows pointing at one member row is the common shape
  -- (a realm rename leaves one behind), and refusing that would help nobody.
  -- Two rows reaching two different people is the case worth refusing, and it
  -- falls back to the finder's name in bold rather than pinging a guess.
  select count(distinct tm.discord_id), min(tm.discord_id)
  into v_distinct, v_discord_id
  from public.players p
  join public.team_members tm on tm.id = p.team_member_id
  where lower(btrim(split_part(p.name_realm, '-', 1))) = v_first;

  if v_distinct = 1 then
    return v_discord_id;
  end if;

  return null;
end;
$$;

comment on function public.resolve_boe_finder_discord_id(integer) is
  'The finder of a BoE row as a Discord id, for the sold ping: the id stamped at submit, else the claimed character''s member row, else a guild-wide first-name match including removed characters. Null when nothing matches or when two matches reach two different people, which the caller renders as the finder''s name in bold. Gated on is_boe_manager() or is_site_admin(). (#918)';

revoke all on function public.resolve_boe_finder_discord_id(integer) from public;
revoke execute on function public.resolve_boe_finder_discord_id(integer) from anon;
grant execute on function public.resolve_boe_finder_discord_id(integer) to authenticated;
