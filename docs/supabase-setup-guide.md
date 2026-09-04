# Supabase Setup Guide -- Phase 1: Foundation

**Status: Complete.** All Phase 1 issues (#202-206) are closed. The JavaScript
smoke test from issue #206 was not fully run because supabase-js is not loaded on
any page yet -- it carries over to the start of Phase 2 (issue #207) once the
client is initialized.

This guide covers everything in the **Supabase Phase 1: Foundation** milestone
(issues #202-206). Each section below maps directly to one issue.

**What is already done:**
- Supabase project created (ID: `kxgjqnpwfklbgrxdgmmv`, Americas region, auto RLS enabled)
- Both bots on HTTPS: Phoenix at `https://wga-phoenix.duckdns.org`,
  Hellfire at `https://wga-hellfire.duckdns.org`
- Rex has dashboard access
- Three teams seeded: Phoenix (1), Hellfire (2), Immolation (3)

---

## Before any SQL: concepts you will see everywhere

Every table you create in this guide uses the same small set of building blocks.
Understanding them once here means you will not be confused when you see them
repeated across every table.

### Columns and types

A table is a grid. Each column has a **type** that tells the database what kind of
data goes there. The types you will see in this guide:

- `text` -- any string of any length. Used for names, IDs, notes.
- `integer` -- a whole number. Used for IDs and counts.
- `numeric` -- a decimal number. Used for scores and percentages.
- `boolean` -- true or false only. Used for flags like `is_trial`.
- `date` -- a calendar date with no time (e.g. `2025-01-15`). Used for raid dates.
- `timestamptz` -- a date and time that includes timezone information, stored in UTC.
  Used for anything where the exact moment matters, like when a loot award happened.
  The `tz` suffix is important: without it, the database stores time with no timezone,
  which causes sorting problems when data comes from different locations.
- `uuid` -- a 36-character globally unique identifier like
  `550e8400-e29b-41d4-a716-446655440000`. Supabase uses these for user IDs because
  they can be generated anywhere without two systems accidentally creating the same ID.
- `jsonb` -- stores arbitrary JSON as a compressed binary. Use it when a column needs
  to hold data where the shape varies row by row.

### Constraints

A **constraint** is a rule the database enforces on every write. These replace
code-level validation -- instead of trusting the app to only save valid values, the
database itself refuses anything that breaks the rule.

- `not null` -- this column must always have a value. Inserting a row without it fails.
- `default <value>` -- if you do not provide a value, the database uses this fallback.
- `unique` -- no two rows may have the same value in this column (or combination of
  columns). The database rejects any insert or update that would create a duplicate.
- `check (condition)` -- the condition must be true for every row. A common use is
  `check (role in ('raider', 'officer', 'team_leader'))`, which rejects any value outside
  that list.

### Primary keys

Every table needs a way to uniquely identify each row. That is the **primary key**.
In this guide, most tables use `serial primary key`, which means:

- `serial` -- the database automatically assigns the next integer (1, 2, 3...) when a
  row is inserted. You never write this value yourself; the database manages it.
- `primary key` -- this column uniquely identifies each row. No two rows can share the
  same value, and it can never be null.

Think of it like a row number that is permanent and never reused. Even if you delete
row 5, the next row is still 6.

### Foreign keys

A **foreign key** creates a hard link between two tables. For example:

```sql
team_id integer not null references teams(id)
```

This says: the value in `team_id` must exist in the `id` column of the `teams` table.
`teams` is the table name, and `(id)` is the specific column in that table you are
linking to. If you try to insert a `team_id` of 99 and there is no team with id 99,
the database refuses. This is how you get referential integrity -- it becomes
physically impossible to have a loot record pointing to a player that does not exist.

The `on delete` clause says what happens when the referenced row is deleted:
- `on delete cascade` -- delete this row too. If a team is deleted, all its players
  go with it. Use this when the child data has no meaning without the parent.
- `on delete set null` -- set this column to null instead. Use this when you want to
  keep the row but acknowledge the reference is gone. For example, if a Supabase
  user account is deleted, we want to keep the `team_members` record (it still holds
  the Discord ID and role history) but clear the auth link.

---

## Prerequisites: Collect your project credentials

Before writing any SQL, collect these three values. The anon key and project URL are
not used in this guide -- they go into `js/common.js` when the Supabase client is
initialized in Phase 2 (issue #207). Collect them now so they are ready when that
work starts.

**Project URL** -- the base address of your Supabase project's API. Every request
from the website goes through this URL. It is not a secret; it is in the page source.

**anon public key** -- this is what the website uses to talk to Supabase. It
activates Row Level Security so the database knows to apply your policies to every
request. Because the anon key ships in the page source, anyone can see it. That is
by design. It does not grant access to data -- it just identifies which project you
are connecting to. Your RLS policies are what actually control what anyone can do.

**service_role key** -- this key bypasses RLS entirely. It is the database admin
key. It must never appear in the website's JavaScript or in any file committed to the
repo. It lives only inside Edge Function secrets, running on Supabase's servers where
users cannot reach it.

To get them:
1. Open your project at [supabase.com](https://supabase.com).
2. Left sidebar -> **Project Settings** -> **API**.
3. Your Project URL for this project is `https://kxgjqnpwfklbgrxdgmmv.supabase.co`.
4. Copy the **anon public** key.
5. Copy the **service_role** key -- store it in a password manager, not a text file.

---

## Issue #202: Write migration files for the full schema

This issue covers creating every table, enabling RLS, and writing all the policies
and the auth trigger. Open **SQL Editor** in the Supabase left sidebar and click
**New query**. Run each table individually so that if something goes wrong you know
exactly which statement caused the error. "Success. No rows returned" is the expected
result for every `create table` statement.

### Reference tables

Reference tables hold shared data that belongs to both teams -- the master item list,
which boss drops each item, and the class/spec reference. They have no `team_id`
because they are not owned by Phoenix or Hellfire, they are just lookup data.

```sql
create table items (
  id          serial primary key,
  wow_item_id integer,
  name        text not null,
  slot        text not null,
  armor_type  text,
  sort_id     integer
);
```

Reading this line by line:
- `id serial primary key` -- the auto-assigned row number that uniquely identifies
  each item. You will never write this value; the database picks the next one.
- `wow_item_id integer` -- the numeric ID WoW uses internally for each item. It
  appears in RCLootCouncil exports. No `not null` here because we may add items to
  the list before we have confirmed their WoW ID.
- `name text not null` -- every item must have a name. `not null` enforces this.
- `slot text not null` -- every item must have a slot (Head, Trinket, etc.).
- `armor_type text` -- optional (no `not null`), so it can be null for weapons and
  accessories that are not armor-type specific.
- `sort_id integer` -- an optional number used to control display order.

```sql
create table item_bosses (
  item_id  integer references items(id) on delete cascade,
  boss     text not null,
  primary key (item_id, boss)
);
```

New concepts here:
- `references items(id) on delete cascade` -- this is a foreign key. `items` is the
  table and `(id)` is the column in that table being linked to. The `item_id` value
  must exist in the `items` table. If that item is deleted, all its boss rows are
  deleted too (`cascade`).
- `primary key (item_id, boss)` -- this is a **composite primary key** using two
  columns together. A single item can drop from multiple bosses, and a single boss
  drops multiple items, so neither column alone is unique. But the same item-boss
  pair should only appear once, so the combination is the primary key.

```sql
create table classes_specs (
  id    serial primary key,
  class text not null,
  spec  text not null,
  role  text  -- 'Tank', 'Heal', 'Melee', 'Ranged'
);
```

### Teams table

```sql
create table teams (
  id    serial primary key,
  name  text not null unique,
  slug  text not null unique
);
```

`unique` on both `name` and `slug` means no two teams can share a name or a slug.
The `slug` is a short URL-safe identifier (`phoenix`, `hellfire`) that the app uses
in query strings and code. Storing it in the database means it never needs to be
hardcoded anywhere in the JavaScript.

Now seed the two teams. Phoenix will be team 1, Hellfire will be team 2 -- not
because we configured that, but because `serial` assigns numbers in insertion order.

```sql
insert into teams (name, slug) values
  ('Phoenix', 'phoenix'),
  ('Hellfire', 'hellfire');
```

### team_members table

This is the most important table to understand because it is the foundation of the
entire authorization system.

**Authentication vs. authorization -- the distinction that matters here:**

When someone logs in with Discord, Supabase *authenticates* them: it confirms who
they are and creates a session. But that does not tell the app what the person is
allowed to do. That is *authorization*, and `team_members` is where it comes from.

Every row in `team_members` says: "this Discord user, on this team, has this role."
The RLS policies check a function that looks up a row in this table. If a row exists
and says `officer`, officer-level access is granted. If no row exists, the caller is
treated as an anonymous visitor regardless of whether they are logged in.

```sql
create table team_members (
  id            serial primary key,
  team_id       integer not null references teams(id) on delete cascade,
  discord_id    text not null,
  auth_user_id  uuid references auth.users(id) on delete set null,
  role          text not null check (role in ('raider', 'officer', 'team_leader')),
  name_realm    text,
  unique (team_id, discord_id)
);
```

Walking through the new parts:
- `auth_user_id uuid references auth.users(id) on delete set null` -- `auth.users` is
  Supabase's internal user table. When someone logs in, Supabase creates a row there
  and assigns a UUID. This column links that UUID to your team membership record.
  It starts as null because we seed officers before they have logged in yet.
  `on delete set null` (not cascade) means if the Supabase account is deleted, we
  keep the `team_members` row but clear the auth link.
- `check (role in ('raider', 'officer', 'team_leader'))` -- the database rejects any value
  outside this list.
- `unique (team_id, discord_id)` -- a composite unique constraint. A Discord user
  can have a row in both teams but cannot have two rows in the same team.

### Players and scoring tables

**Why `name_realm` and not just a first name:**

The current Sheet sometimes references players by first name alone, which breaks
when two people share a name. In the database, every player is uniquely identified
by `Name-Realm` (e.g. `Katarii-Stormrage`). This is exactly the format RCLootCouncil
exports use, so when loot is pasted in, the player lookup is a direct match.

```sql
create table players (
  id              serial primary key,
  team_id         integer not null references teams(id) on delete cascade,
  name_realm      text not null,
  class           text,
  spec            text,
  role            text check (role in ('Tank', 'Heal', 'Melee', 'Ranged')),
  is_trial        boolean not null default false,
  is_bench        boolean not null default false,
  nickname        text,
  bis_link        text,
  join_date       date,
  m_plus_excluded boolean not null default false,
  m_plus_note     text,
  unique (team_id, name_realm)
);
```

- `role check (role in ('Tank', 'Heal', 'Melee', 'Ranged'))` -- notice there is no
  `not null` here, so `role` can be null if it has not been set yet. The `check`
  constraint only runs when a value is provided; null values skip it.
- `is_trial boolean not null default false` -- every player starts as not-a-trial.
  Storing this in the database (instead of inferring it from a rank text field) is
  what lets the priority generator query it directly.

```sql
create table scoring (
  id                 serial primary key,
  player_id          integer not null references players(id) on delete cascade unique,
  recent_score       numeric,
  trend_score        numeric,
  best_score         numeric,
  performance_score  numeric,
  attendance_score   numeric,
  attendance_pct     numeric
);
```

Scoring is a separate table rather than columns on `players` because it is written
by the WCL sync Edge Function on a completely different schedule than roster edits.
`player_id ... unique` enforces the one-to-one relationship -- every player can have
at most one scoring row.

### BiS items and loot tables

**The grid-to-rows shift for BiS:**

In the Sheet, the BiS list is a grid: players across columns, item slots down the
rows. In the database, each player-item pair is one row. This layout is called
*long form*. Querying becomes: `select player_id from bis_items where slot = 'Trinket'`
-- one line, instant, instead of scanning every column.

```sql
create table bis_items (
  id         serial primary key,
  player_id  integer not null references players(id) on delete cascade,
  item_id    integer references items(id) on delete set null,
  item_name  text,
  slot       text,
  obtained   boolean not null default false
);
```

`item_id references items(id) on delete set null` -- if an item is removed from the
master list, the BiS entry is kept and falls back to the `item_name` text column
for display. That is why both columns exist -- one is the reliable link, the other
is a human-readable fallback when the link is broken.

```sql
create table loot (
  id           serial primary key,
  team_id      integer not null references teams(id) on delete cascade,
  player_id    integer references players(id) on delete set null,
  item_id      integer references items(id) on delete set null,
  item_name    text not null,
  slot         text,
  boss         text,
  track        text check (track in ('Champion', 'Hero', 'Myth')),
  source       text,
  season       text,
  awarded_at   timestamptz not null default now(),
  rclc_id      text,
  dedupe_key   text unique
);
```

`dedupe_key text unique` -- a hash of `(team_id, rclc_id)`. When the app pastes a
loot export, it computes this hash for each row. If a row with that key already
exists, the database rejects the insert silently. Pasting the same export twice does
nothing the second time.

`awarded_at timestamptz not null default now()` -- `now()` is a database function
that returns the current time at the moment of insert. More reliable than letting
the app supply the time.

### Attendance table

```sql
create table attendance (
  id               serial primary key,
  team_id          integer not null references teams(id) on delete cascade,
  player_id        integer not null references players(id) on delete cascade,
  raid_date        date not null,
  report_id        text,
  status           text not null default 'Present'
    check (status in ('Present', 'Bench', 'Medical Leave', 'Excused',
                      'No Show', 'Not on Roster')),
  report_excluded  boolean not null default false,
  unique (team_id, player_id, raid_date)
);
```

Six statuses instead of a boolean because each scores differently: Present/Bench/
Medical Leave = full, Excused = 0.8, No Show = 0, Not on Roster = excluded entirely.
`unique (team_id, player_id, raid_date)` means the WCL sync is safe to run more
than once -- duplicate entries are rejected.

### Priority order table

```sql
create table priority_order (
  id         serial primary key,
  team_id    integer not null references teams(id) on delete cascade,
  season     text not null,
  item       text not null,
  track      text not null check (track in ('Hero', 'Myth')),
  rank       integer not null,
  player_id  integer not null references players(id) on delete cascade,
  unique (team_id, season, item, track, rank)
);
```

Priority is ranked per item per track -- a player might be rank 1 for the
Hero-track trinket and rank 4 for the Myth-track trinket. The unique constraint
means within a team and season, each (item, track, rank) slot can only be occupied
by one player. Champion-track loot never enters the priority system: it drops in
the first weeks of a raid and is handed out by loot council instead (#343).

### Request queue tables

These are where public-facing forms land before an officer acts on them. They have
no anon insert policy -- form submissions go through an Edge Function (Phase 5) that
verifies a Turnstile spam-check token before inserting. If these had open insert
policies, anyone who grabbed the anon key from the page source could post directly
to the database.

```sql
create table signups (
  id              serial primary key,
  team_id         integer not null references teams(id) on delete cascade,
  character_name  text not null,
  realm           text not null,
  discord         text,
  class           text,
  spec            text,
  role            text,
  off_specs       text,
  main_swap       boolean not null default false,
  note            text,
  submitted_at    timestamptz not null default now(),
  status          text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected'))
);

create table bis_requests (
  id           serial primary key,
  team_id      integer not null references teams(id) on delete cascade,
  player_id    integer references players(id) on delete set null,
  item_name    text not null,
  slot         text,
  submitted_at timestamptz not null default now(),
  status       text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected'))
);

create table self_received_requests (
  id           serial primary key,
  team_id      integer not null references teams(id) on delete cascade,
  player_id    integer references players(id) on delete set null,
  item_name    text not null,
  submitted_at timestamptz not null default now(),
  status       text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected'))
);

create table mplus_exclusion_requests (
  id           serial primary key,
  team_id      integer not null references teams(id) on delete cascade,
  player_id    integer references players(id) on delete set null,
  week_of      date not null,
  reason       text,
  submitted_at timestamptz not null default now(),
  status       text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected'))
);

create table pending_roster (
  id              serial primary key,
  team_id         integer not null references teams(id) on delete cascade,
  name_realm      text not null,
  class           text,
  spec            text,
  role            text,
  submitted_at    timestamptz not null default now(),
  status          text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected'))
);
```

### Audit log table

```sql
create table audit_log (
  id          serial primary key,
  team_id     integer not null references teams(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  target_type text,
  target_id   integer,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
```

`detail jsonb` -- stores whatever context makes sense for each action type. A roster
edit stores before and after values. A loot award stores the item name and player.
`jsonb` handles this without needing a separate column for every possible field.

There is no insert policy on this table. Writes only come from security-definer
functions and Edge Functions using the service-role key.

### Settings and season snapshots tables

```sql
create table settings (
  team_id  integer primary key references teams(id) on delete cascade,
  config   jsonb not null default '{}'
);

insert into settings (team_id, config) values (1, '{}'), (2, '{}');

create table season_snapshots (
  id         serial primary key,
  team_id    integer not null references teams(id) on delete cascade,
  season     text not null,
  snapped_at timestamptz not null default now(),
  data       jsonb not null,
  unique (team_id, season)
);
```

`team_id integer primary key` -- here `team_id` is both the primary key and a foreign
key. This table has exactly one row per team, guaranteed. `unique (team_id, season)`
means each team can only have one snapshot per season.

### Enable Row Level Security

Run this block all at once. Once RLS is on for a table, every query is filtered
through the policies below. If there is no policy that allows an action, the action
is denied. This is the correct order: lock everything down first, then open it up
exactly as much as needed.

```sql
alter table items                    enable row level security;
alter table item_bosses              enable row level security;
alter table classes_specs            enable row level security;
alter table teams                    enable row level security;
alter table team_members             enable row level security;
alter table players                  enable row level security;
alter table scoring                  enable row level security;
alter table bis_items                enable row level security;
alter table loot                     enable row level security;
alter table attendance               enable row level security;
alter table priority_order           enable row level security;
alter table signups                  enable row level security;
alter table bis_requests             enable row level security;
alter table self_received_requests   enable row level security;
alter table mplus_exclusion_requests enable row level security;
alter table pending_roster           enable row level security;
alter table audit_log                enable row level security;
alter table settings                 enable row level security;
alter table season_snapshots         enable row level security;
```

### RLS policies

Before writing policies, know the types of caller (tier names decided in
[#294](https://github.com/katogaming88/WGA-Raid-Hub/issues/294)):

- **Anonymous:** has the anon key, no session. Can see public data (roster, loot,
  item lists), cannot write anything.
- **Logged-in raider:** has a Discord session and a `team_members` row with
  `role = 'raider'`. Can submit forms via Edge Functions. The role grants nothing
  beyond public read; it is roster bookkeeping.
- **Officer:** has a session and a `team_members` row with `role = 'officer'`.
  Can read queues, approve requests, and write data for their own team.
- **Team leader:** `role = 'team_leader'`, one per team. Passes every officer
  check, plus the three team-leader-only write policies officers do not:
  `team_settings`, `team_members` (their own roster and promotions), and
  `season_snapshots`.
- **Site admin:** a row in `site_admins`, checked by `is_site_admin()`. Global,
  not team-scoped; passes every policy that ORs it in, on every team.

**The role-checking function -- run this first:**

Every policy that checks "is this person an officer?" needs to look up their role
in `team_members`. We define it once as a function so it is not repeated in every
policy.

`security definer` means this function runs with the permissions of whoever created
it (the database owner), not the caller. Without this, the function would try to
read `team_members` using the caller's RLS policies -- but there is no "read your
own row" policy yet, creating a catch-22. `security definer` breaks that loop.

`stable` tells PostgreSQL the function returns the same result for the same input
within a single query, so it can cache the result rather than running it once per
row evaluated.

`auth.uid()` is a Supabase built-in that returns the UUID of the currently logged-in
user, or null for anonymous callers.

```sql
create or replace function my_team_role(p_team_id integer)
returns text
language sql
security definer
stable
as $$
  select role
  from team_members
  where team_id = p_team_id
    and auth_user_id = auth.uid()
  limit 1;
$$;
```

**How `using` and `with check` work:**
- `using (...)` filters which rows the caller can *see or target* (SELECT, UPDATE,
  DELETE). A row that fails is invisible, not an error.
- `with check (...)` applies to INSERT and UPDATE. A row that fails causes a
  permission error.

For a write policy you need both.

```sql
-- Reference tables: open to everyone
create policy "Public read items"         on items         for select using (true);
create policy "Public read item_bosses"   on item_bosses   for select using (true);
create policy "Public read classes_specs" on classes_specs for select using (true);
create policy "Public read teams"         on teams         for select using (true);

-- Roster: public read, officers write
create policy "Public read players"
  on players for select using (true);
create policy "Officers write players"
  on players for all
  using      (my_team_role(team_id) in ('officer', 'team_leader'))
  with check (my_team_role(team_id) in ('officer', 'team_leader'));

-- Scoring: public read, officers write
-- No team_id on scoring rows, so follow the foreign key to players to find the team
create policy "Public read scoring"
  on scoring for select using (true);
create policy "Officers write scoring"
  on scoring for all
  using (
    my_team_role((select team_id from players where id = player_id))
    in ('officer', 'team_leader')
  )
  with check (
    my_team_role((select team_id from players where id = player_id))
    in ('officer', 'team_leader')
  );

-- BiS items: public read, officers write (also needs the player subquery)
create policy "Public read bis_items"
  on bis_items for select using (true);
create policy "Officers write bis_items"
  on bis_items for all
  using (
    my_team_role((select team_id from players where id = player_id))
    in ('officer', 'team_leader')
  )
  with check (
    my_team_role((select team_id from players where id = player_id))
    in ('officer', 'team_leader')
  );

-- Loot, attendance, priority: public read, officers write
create policy "Public read loot"           on loot           for select using (true);
create policy "Public read attendance"     on attendance      for select using (true);
create policy "Public read priority_order" on priority_order  for select using (true);

create policy "Officers write loot"
  on loot for all
  using      (my_team_role(team_id) in ('officer', 'team_leader'))
  with check (my_team_role(team_id) in ('officer', 'team_leader'));
create policy "Officers write attendance"
  on attendance for all
  using      (my_team_role(team_id) in ('officer', 'team_leader'))
  with check (my_team_role(team_id) in ('officer', 'team_leader'));
create policy "Officers write priority_order"
  on priority_order for all
  using      (my_team_role(team_id) in ('officer', 'team_leader'))
  with check (my_team_role(team_id) in ('officer', 'team_leader'));

-- Request queues: officers read and update only, no anon insert path
create policy "Officers read signups"
  on signups for select
  using (my_team_role(team_id) in ('officer', 'team_leader'));
create policy "Officers update signups"
  on signups for update
  using      (my_team_role(team_id) in ('officer', 'team_leader'))
  with check (my_team_role(team_id) in ('officer', 'team_leader'));

create policy "Officers read bis_requests"
  on bis_requests for select
  using (my_team_role(team_id) in ('officer', 'team_leader'));
create policy "Officers update bis_requests"
  on bis_requests for update
  using      (my_team_role(team_id) in ('officer', 'team_leader'))
  with check (my_team_role(team_id) in ('officer', 'team_leader'));

create policy "Officers read self_received_requests"
  on self_received_requests for select
  using (my_team_role(team_id) in ('officer', 'team_leader'));
create policy "Officers update self_received_requests"
  on self_received_requests for update
  using      (my_team_role(team_id) in ('officer', 'team_leader'))
  with check (my_team_role(team_id) in ('officer', 'team_leader'));

create policy "Officers read mplus_exclusion_requests"
  on mplus_exclusion_requests for select
  using (my_team_role(team_id) in ('officer', 'team_leader'));
create policy "Officers update mplus_exclusion_requests"
  on mplus_exclusion_requests for update
  using      (my_team_role(team_id) in ('officer', 'team_leader'))
  with check (my_team_role(team_id) in ('officer', 'team_leader'));

create policy "Officers read pending_roster"
  on pending_roster for select
  using (my_team_role(team_id) in ('officer', 'team_leader'));
create policy "Officers update pending_roster"
  on pending_roster for update
  using      (my_team_role(team_id) in ('officer', 'team_leader'))
  with check (my_team_role(team_id) in ('officer', 'team_leader'));

-- Audit log: officers read only, no direct write path
create policy "Officers read audit_log"
  on audit_log for select
  using (my_team_role(team_id) in ('officer', 'team_leader'));

-- Settings: public read, admins write
create policy "Public read settings"
  on settings for select using (true);
create policy "Admins write settings"
  on settings for all
  using      (my_team_role(team_id) = 'team_leader')
  with check (my_team_role(team_id) = 'team_leader');

-- Season snapshots: public read, admins write
create policy "Public read season_snapshots"
  on season_snapshots for select using (true);
create policy "Admins write season_snapshots"
  on season_snapshots for all
  using      (my_team_role(team_id) = 'team_leader')
  with check (my_team_role(team_id) = 'team_leader');

-- team_members: officers read their team, admins and site admins write
create policy "Officers read own team_members"
  on team_members for select
  using (my_team_role(team_id) in ('officer', 'team_leader') or is_site_admin());
create policy "Admins write team_members"
  on team_members for all
  using      (my_team_role(team_id) = 'team_leader' or is_site_admin())
  with check (my_team_role(team_id) = 'team_leader' or is_site_admin());
```

### Site admin table and policies

A site admin has access above the team level -- they can manage settings and
team membership across both teams without needing a team-specific role. This is
separate from the `team_members` admin role, which is scoped to one team.

```sql
create table site_admins (
  id            serial primary key,
  discord_id    text not null unique,
  auth_user_id  uuid references auth.users(id) on delete set null
);

alter table site_admins enable row level security;
```

The `is_site_admin()` helper works the same way as `my_team_role()` -- it is
`security definer` so it can read `site_admins` without hitting an RLS catch-22,
and `stable` so it is cached within a query rather than called once per row.

```sql
create or replace function is_site_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from site_admins
    where auth_user_id = auth.uid()
  );
$$;

-- Only site admins can read or write the site_admins table itself
create policy "Site admins read site_admins"
  on site_admins for select
  using (is_site_admin());

create policy "Site admins write site_admins"
  on site_admins for all
  using      (is_site_admin())
  with check (is_site_admin());

-- Update policies that were admin-only to also allow site admins
drop policy "Admins write settings" on settings;
create policy "Admins write settings"
  on settings for all
  using      (my_team_role(team_id) = 'team_leader' or is_site_admin())
  with check (my_team_role(team_id) = 'team_leader' or is_site_admin());

drop policy "Admins write season_snapshots" on season_snapshots;
create policy "Admins write season_snapshots"
  on season_snapshots for all
  using      (my_team_role(team_id) = 'team_leader' or is_site_admin())
  with check (my_team_role(team_id) = 'team_leader' or is_site_admin());

drop policy "Officers read audit_log" on audit_log;
create policy "Officers read audit_log"
  on audit_log for select
  using (my_team_role(team_id) in ('officer', 'team_leader') or is_site_admin());
```

### Auth trigger

When an officer or site admin logs in with Discord for the first time, Supabase
creates a row in `auth.users`. At that moment they already have a row in
`team_members` or `site_admins` (seeded in issue #203) but `auth_user_id` is still
null. This trigger fires automatically on every new `auth.users` insert, reads the
Discord user ID from the login metadata, and fills in the UUID on both tables.

Without this trigger, an officer would log in successfully but `my_team_role()` and
`is_site_admin()` would both return null -- they would be logged in but treated as
anonymous.

```sql
create or replace function link_auth_user_to_member()
returns trigger
language plpgsql
security definer
as $$
begin
  update team_members
  set auth_user_id = new.id
  where discord_id = new.raw_user_meta_data ->> 'provider_id'
    and auth_user_id is null;

  update site_admins
  set auth_user_id = new.id
  where discord_id = new.raw_user_meta_data ->> 'provider_id'
    and auth_user_id is null;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function link_auth_user_to_member();
```

`new` is a special variable inside trigger functions that holds the row that was just
inserted. `new.id` is the Supabase UUID. `new.raw_user_meta_data ->> 'provider_id'`
extracts the Discord user ID from the login metadata. `->>` reads a JSON field as
text.

---

## Issue #203: Seed officer and admin data

**How to find a Discord user ID:** in Discord go to Settings -> Advanced -> turn on
Developer Mode. Then right-click any user and choose "Copy User ID".

First, seed yourself into `site_admins`:

```sql
insert into site_admins (discord_id) values ('YOUR_DISCORD_ID_HERE');
```

Then insert all current Phoenix and Hellfire officers and team leaders into `team_members`:

```sql
insert into team_members (team_id, discord_id, role) values
  (1, 'DISCORD_ID_HERE', 'team_leader'),    -- Phoenix team leader
  (1, 'DISCORD_ID_HERE', 'officer'),  -- Phoenix officer
  (2, 'DISCORD_ID_HERE', 'officer');  -- Hellfire officer
  -- add all current officers for both teams
```

Do not insert `auth_user_id` in either table -- it starts as null and is filled in
automatically when each person logs in for the first time via the auth trigger.

Team IDs: Phoenix = 1, Hellfire = 2, Immolation = 3, Wrathless = 4.

**Officers on a team without a page.** Immolation and Wrathless raid with the guild and do not
otherwise use the site. The same insert works for any team id, hidden teams included, and it is
the only step: a `team_members` row with `role = 'officer'` or `'team_leader'` lets that person
settle their own team's BoE payouts on the BoE page (`can_settle_boe()`, #888) and nothing else,
and `auth_user_id` fills itself on their first Discord sign-in. Insert the row when an officer
asks for it, not ahead of time: a row assigns them the work.

```sql
insert into team_members (team_id, discord_id, role) values (4, 'DISCORD_ID_HERE', 'officer');  -- Wrathless officer
```

---

## Issue #204: Configure Discord OAuth

1. In Supabase: **Authentication** -> **Providers** -> **Discord** -> toggle on.
2. Copy the Callback URL from that page:
   `https://kxgjqnpwfklbgrxdgmmv.supabase.co/auth/v1/callback`
3. Open the [Discord Developer Portal](https://discord.com/developers/applications)
   and open the existing Raid Hub application.
4. **OAuth2** -> **Redirects** -> **Add Redirect** -> paste the callback URL.
   Do not remove the existing redirect -- both can be registered at the same time,
   keeping the current login working during the transition.
5. Copy the **Client ID** and **Client Secret** from the Discord app page.
6. Paste them into the Supabase Discord provider form and save.

The callback URL is where Discord sends the user after they authenticate. It goes to
Supabase's auth service, which finalizes the session and fires the trigger from
issue #202.

---

## Issue #205: Store Edge Function secrets

Edge Functions are small server-side scripts that run inside Supabase. They are the
only place where secrets can safely live. The website never sees these values.

In Supabase: **Project Settings** -> **Edge Functions** -> **Secrets**. Add each:

| Secret name                    | Where to find the value                                  |
|--------------------------------|----------------------------------------------------------|
| `WCL_CLIENT_ID`                | WarcraftLogs OAuth app                                   |
| `WCL_CLIENT_SECRET`            | WarcraftLogs OAuth app                                   |
| `BOT_WEBHOOK_SECRET_PHOENIX`   | Apps Script Script Properties for the Phoenix bot        |
| `BOT_WEBHOOK_SECRET_HELLFIRE`  | Apps Script Script Properties for the Hellfire bot       |
| `BOT_WEBHOOK_URL_PHOENIX`      | `https://wga-phoenix.duckdns.org` (already live)         |
| `BOT_WEBHOOK_URL_HELLFIRE`     | `https://wga-hellfire.duckdns.org` (already live)        |
| `SERVICE_ROLE_KEY`             | Supabase -> Project Settings -> API -> service_role      |
| `BOE_WEBHOOK_URL`              | Discord channel settings -> Integrations -> Webhooks (#746) |
| `BOE_SOLD_WEBHOOK_URL`         | Optional (#873). Same place, for a separate sold channel   |

Note: the BoE webhook secret exists on prod under the name `BOE-Found-Webhook`
(created that way in the dashboard, 2026-08-26). The boe-webhook function reads
`BOE_WEBHOOK_URL` first and falls back to that name, so either works.

Note: `BOE_SOLD_WEBHOOK_URL` is optional. `boe-sold-webhook` reads it first and
falls back to the found pair, so with nothing added the sold message lands in the
found channel and moving it later is one dashboard entry rather than a code change.
With none of the three set the function no-ops with `{ skipped: true }`.

Deploy the sold function by hand after adding (or deciding against) that secret:

```bash
supabase functions deploy boe-sold-webhook
```

Note: Supabase does not allow secrets prefixed with `SUPABASE_`, so the service role
key is stored as `SERVICE_ROLE_KEY`.

The `SUPABASE_SERVICE_KEY` bypasses RLS entirely. It must never appear outside of
Edge Function secrets.

---

## Issue #206: Smoke test Phase 1

Before touching any app code, confirm the database is reachable and RLS is working.
Open your browser's developer console (F12) on any page and run:

```js
const { createClient } = supabase;
const sb = createClient(
  'https://kxgjqnpwfklbgrxdgmmv.supabase.co',
  'YOUR_ANON_KEY'
);

// Test 1: public read -- expect two rows (Phoenix, Hellfire)
const { data: teams, error: e1 } = await sb.from('teams').select('*');
console.log('Teams:', teams, e1);

// Test 2: RLS blocking officers-only table -- expect [], not an error
const { data: members, error: e2 } = await sb.from('team_members').select('*');
console.log('team_members (expect []):', members, e2);

// Test 3: cross-team isolation -- log in as a Phoenix officer first, then run
const { data: players, error: e3 } = await sb
  .from('players').select('*').eq('team_id', 2);
console.log('Hellfire players as Phoenix officer (expect []):', players, e3);
```

**What to do if tests fail:**
- Test 1 errors: check the project URL and anon key.
- Test 1 returns zero rows: re-run the `insert into teams` from issue #202.
- Test 2 returns actual rows: a policy is too permissive -- check that the
  `team_members` select policy calls `my_team_role()` and is not set to `using (true)`.
- Test 3 returns Hellfire rows while logged in as a Phoenix officer: cross-team
  isolation is broken. Must be fixed before Phase 2 starts.

Also confirm: at least one officer logs in and their role is active (they can see
officer-only data in the dashboard). This confirms the auth trigger fired correctly.

---

## What comes next

Phase 1 is complete when issue #206 is closed. The next milestone is
**Supabase Phase 2: Public Reads** (issues #207-210), which switches the public
roster and loot feed to read from Supabase without touching any write paths or login.
