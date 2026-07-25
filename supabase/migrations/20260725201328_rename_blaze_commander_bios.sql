-- Rename team_settings.config key blazeCommanderBios -> teamOfficerBios (#577).
-- "Blaze Commander" was We Go Again's own guild-specific officer rank name,
-- baked into a field every team uses regardless of what they call their own
-- leadership rank.
update public.team_settings
set config = (config - 'blazeCommanderBios') || jsonb_build_object('teamOfficerBios', config->'blazeCommanderBios')
where config ? 'blazeCommanderBios';
