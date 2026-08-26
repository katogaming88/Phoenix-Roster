# public.boe_items

## Columns

| Name | Type | Default | Nullable | Children | Parents | Comment |
| ---- | ---- | ------- | -------- | -------- | ------- | ------- |
| id | integer | nextval('boe_items_id_seq'::regclass) | false | [public.boe_listings](public.boe_listings.md) |  |  |
| team_id | integer |  | false |  | [public.teams](public.teams.md) |  |
| player_id | integer |  | true |  | [public.players](public.players.md) |  |
| finder_name | text |  | true |  |  |  |
| item_id | integer |  | true |  | [public.items](public.items.md) |  |
| item_name | text |  | false |  |  |  |
| track | text |  | true |  |  |  |
| season | text |  | true |  |  |  |
| note | text |  | true |  |  |  |
| status | text | 'found'::text | false |  |  |  |
| found_at | timestamp with time zone | now() | false |  |  |  |
| sold_at | timestamp with time zone |  | true |  |  |  |
| payout_paid_at | timestamp with time zone |  | true |  |  |  |
| retired_at | timestamp with time zone |  | true |  |  |  |
| sale_price | bigint |  | true |  |  |  |
| finder_payout | bigint |  | true |  |  |  |
| guild_cut | bigint |  | true |  |  |  |
| payout_floor | bigint |  | true |  |  |  |
| payout_pivot | bigint |  | true |  |  |  |
| updated_at | timestamp with time zone |  | true |  |  |  |
| created_at | timestamp with time zone | now() | false |  |  |  |

## Constraints

| Name | Type | Definition |
| ---- | ---- | ---------- |
| boe_items_finder_payout_nonneg | CHECK | CHECK ((finder_payout >= 0)) |
| boe_items_floor_nonneg | CHECK | CHECK ((payout_floor >= 0)) |
| boe_items_guild_cut_nonneg | CHECK | CHECK ((guild_cut >= 0)) |
| boe_items_money_complete_when_sold | CHECK | CHECK (((status <> ALL (ARRAY['sold'::text, 'paid'::text])) OR ((sale_price IS NOT NULL) AND (finder_payout IS NOT NULL) AND (guild_cut IS NOT NULL) AND (payout_floor IS NOT NULL) AND (payout_pivot IS NOT NULL)))) |
| boe_items_money_only_when_sold | CHECK | CHECK (((status = ANY (ARRAY['sold'::text, 'paid'::text])) OR ((sale_price IS NULL) AND (finder_payout IS NULL) AND (guild_cut IS NULL) AND (payout_floor IS NULL) AND (payout_pivot IS NULL)))) |
| boe_items_paid_at_iff_paid | CHECK | CHECK (((status = 'paid'::text) = (payout_paid_at IS NOT NULL))) |
| boe_items_payout_lte_sale | CHECK | CHECK ((finder_payout <= sale_price)) |
| boe_items_pivot_positive | CHECK | CHECK ((payout_pivot > 0)) |
| boe_items_retired_at_iff_retired | CHECK | CHECK (((status = 'retired'::text) = (retired_at IS NOT NULL))) |
| boe_items_sale_price_nonneg | CHECK | CHECK ((sale_price >= 0)) |
| boe_items_sold_at_iff_sold | CHECK | CHECK (((status = ANY (ARRAY['sold'::text, 'paid'::text])) = (sold_at IS NOT NULL))) |
| boe_items_status_check | CHECK | CHECK ((status = ANY (ARRAY['found'::text, 'listed'::text, 'sold'::text, 'paid'::text, 'retired'::text]))) |
| boe_items_track_check | CHECK | CHECK ((track = ANY (ARRAY['Champion'::text, 'Hero'::text, 'Myth'::text]))) |
| boe_items_item_id_fkey | FOREIGN KEY | FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL |
| boe_items_player_id_fkey | FOREIGN KEY | FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL |
| boe_items_team_id_fkey | FOREIGN KEY | FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE |
| boe_items_pkey | PRIMARY KEY | PRIMARY KEY (id) |

## Indexes

| Name | Definition |
| ---- | ---------- |
| boe_items_pkey | CREATE UNIQUE INDEX boe_items_pkey ON public.boe_items USING btree (id) |

## Triggers

| Name | Definition |
| ---- | ---------- |
| trg_boe_items_status_transition | CREATE TRIGGER trg_boe_items_status_transition BEFORE UPDATE ON public.boe_items FOR EACH ROW EXECUTE FUNCTION check_boe_status_transition() |
| trg_boe_items_team_id_check | CREATE TRIGGER trg_boe_items_team_id_check BEFORE INSERT OR UPDATE ON public.boe_items FOR EACH ROW EXECUTE FUNCTION check_team_id_matches_player() |
| trg_boe_items_updated_at | CREATE TRIGGER trg_boe_items_updated_at BEFORE UPDATE ON public.boe_items FOR EACH ROW EXECUTE FUNCTION set_updated_at() |

## Relations

```mermaid
erDiagram

"public.boe_listings" }o--|| "public.boe_items" : "FOREIGN KEY (boe_item_id) REFERENCES boe_items(id) ON DELETE CASCADE"
"public.boe_items" }o--|| "public.teams" : "FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE"
"public.boe_items" }o--o| "public.players" : "FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL"
"public.boe_items" }o--o| "public.items" : "FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL"

"public.boe_items" {
  integer id
  integer team_id FK
  integer player_id FK
  text finder_name
  integer item_id FK
  text item_name
  text track
  text season
  text note
  text status
  timestamp_with_time_zone found_at
  timestamp_with_time_zone sold_at
  timestamp_with_time_zone payout_paid_at
  timestamp_with_time_zone retired_at
  bigint sale_price
  bigint finder_payout
  bigint guild_cut
  bigint payout_floor
  bigint payout_pivot
  timestamp_with_time_zone updated_at
  timestamp_with_time_zone created_at
}
"public.boe_listings" {
  integer id
  integer team_id FK
  integer boe_item_id FK
  timestamp_with_time_zone listed_at
  bigint price
  text note
  timestamp_with_time_zone updated_at
  timestamp_with_time_zone created_at
}
"public.teams" {
  integer id
  text name
  text slug
  timestamp_with_time_zone archived_at
  integer wcl_guild_id
}
"public.players" {
  integer id
  integer team_id FK
  text name_realm
  integer class_spec_id FK
  boolean is_trial
  boolean is_bench
  text nickname
  text bis_link
  date join_date
  boolean m_plus_excluded
  text m_plus_note
  integer team_member_id FK
  timestamp_with_time_zone archived_at
  timestamp_with_time_zone updated_at
  boolean bis_allowed
  text officer_notes
  boolean is_backup_tank
  boolean is_backup_healer
  boolean wishlist_allowed
  integer tier_pieces_equipped
  timestamp_with_time_zone tier_pieces_synced_at
  integer bonus_roll_encounter_id FK
}
"public.items" {
  integer id
  integer wow_item_id
  text name
  text slot
  text armor_type
  integer sort_id
  boolean is_placeholder
  text icon
  jsonb secondary_stats
  integer wcl_zone_id
  boolean is_ptr
  jsonb main_stats
  text weapon_subtype
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
