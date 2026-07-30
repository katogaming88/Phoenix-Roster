import { Pool } from 'pg';

// Supabase CLI local stack default. CI and local dev both use it.
export const DSN = process.env.SUPABASE_DB_URL || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';

export const pool = new Pool({ connectionString: DSN });

// Must stay in sync with supabase/seed.sql.
export const OFFICER_T1 = '00000000-0000-0000-0000-000000000001';
export const TEAM_LEADER_T1 = '00000000-0000-0000-0000-000000000002';
export const RAIDER_T1 = '00000000-0000-0000-0000-000000000003';
export const SITE_ADMIN = '00000000-0000-0000-0000-000000000004';
export const OFFICER_T2 = '00000000-0000-0000-0000-000000000005';
export const SIGNUP_OWNER_T1 = '00000000-0000-0000-0000-000000000006';
// #607: raider on team 1, no officer/team_leader role anywhere, granted
// via guild_officers (not derived from any team_members role).
export const GUILD_OFFICER = '00000000-0000-0000-0000-000000000007';

// SQLSTATE for "new row violates row-level security policy".
export const RLS_DENIED = '42501';

// Runs fn inside a transaction that is always rolled back, impersonating a
// PostgREST role. `uid` lands in request.jwt.claims and becomes auth.uid();
// pass null for anon. The claims must be set before `set local role` drops
// the superuser-ish postgres privileges.
export async function withRole(role, uid, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (uid) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role })]);
    }
    await client.query(`set local role ${role}`);
    return await fn((text, params) => client.query(text, params));
  } finally {
    await client.query('rollback');
    client.release();
  }
}

// One-shot query under a role.
export function queryAs(role, uid, text, params) {
  return withRole(role, uid, (q) => q(text, params));
}

// Visible row count under a role.
export async function countAs(role, uid, table, where = 'true') {
  const res = await queryAs(role, uid, `select count(*)::int as n from public.${table} where ${where}`);
  return res.rows[0].n;
}
