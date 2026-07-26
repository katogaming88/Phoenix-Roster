-- Lets a caller that already writes its own friendlier-named audit_log entry
-- (e.g. "M+ Exclusions Closed") opt out of set_team_setting's generic
-- 'team_setting_updated' one for that same save, instead of both landing in
-- the Audit Log tab for a single user action. Off by default -- every caller
-- that has no friendly entry of its own (feature flags, seasonView,
-- activeSignupSeason) keeps the automatic logging as its only audit trail.
--
-- Adding p_skip_audit as a new trailing parameter produces a second, distinct
-- function overload rather than replacing set_team_setting(integer, jsonb) in
-- place (Postgres only replaces in-place at matching arg count -- confirmed
-- against a local reset in #593/#594). Drop the old one explicitly so there's
-- exactly one, and re-grant from scratch: a genuinely new function doesn't
-- inherit the original's grants, and Postgres grants EXECUTE to PUBLIC by
-- default (anon included) for any new function, not just authenticated.
drop function if exists public.set_team_setting(integer, jsonb);

create function public.set_team_setting(p_team_id integer, p_updates jsonb, p_skip_audit boolean default false)
returns jsonb
language plpgsql
as $$
declare
  v_old_config jsonb;
  v_config jsonb;
  v_diff jsonb := '{}'::jsonb;
  v_key text;
  v_sub_key text;
  v_old_val jsonb;
  v_new_val jsonb;
  v_sub_diff jsonb;
begin
  select config into v_old_config from public.team_settings where team_id = p_team_id;

  update public.team_settings
  set config = config || p_updates
  where team_id = p_team_id
  returning config into v_config;

  if not found then
    raise exception 'Not authorized';
  end if;

  if not p_skip_audit then
    for v_key in select jsonb_object_keys(p_updates) loop
      v_old_val := v_old_config -> v_key;
      v_new_val := v_config -> v_key;
      if v_old_val is distinct from v_new_val then
        if jsonb_typeof(v_old_val) = 'object' and jsonb_typeof(v_new_val) = 'object' then
          v_sub_diff := '{}'::jsonb;
          for v_sub_key in select jsonb_object_keys(v_new_val) loop
            if (v_old_val -> v_sub_key) is distinct from (v_new_val -> v_sub_key) then
              v_sub_diff := v_sub_diff || jsonb_build_object(v_sub_key, v_new_val -> v_sub_key);
            end if;
          end loop;
          v_diff := v_diff || jsonb_build_object(v_key, v_sub_diff);
        else
          v_diff := v_diff || jsonb_build_object(v_key, v_new_val);
        end if;
      end if;
    end loop;

    if v_diff <> '{}'::jsonb then
      perform public.write_audit_log(p_team_id, 'team_setting_updated', 'team_settings', null, v_diff);
    end if;
  end if;

  return v_config;
end;
$$;

revoke execute on function public.set_team_setting(integer, jsonb, boolean) from public, anon;
grant execute on function public.set_team_setting(integer, jsonb, boolean) to authenticated;
