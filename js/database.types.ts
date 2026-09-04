export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      attendance: {
        Row: {
          id: number
          player_id: number | null
          raid_date: string
          report_excluded: boolean
          report_id: string | null
          report_title: string | null
          source: string
          status: string | null
          team_id: number
        }
        Insert: {
          id?: number
          player_id?: number | null
          raid_date: string
          report_excluded?: boolean
          report_id?: string | null
          report_title?: string | null
          source?: string
          status?: string | null
          team_id: number
        }
        Update: {
          id?: number
          player_id?: number | null
          raid_date?: string
          report_excluded?: boolean
          report_id?: string | null
          report_title?: string | null
          source?: string
          status?: string | null
          team_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "attendance_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "attendance_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "attendance_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: Json | null
          id: number
          target_id: number | null
          target_type: string | null
          team_id: number | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: number
          target_id?: number | null
          target_type?: string | null
          team_id?: number | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: number
          target_id?: number | null
          target_type?: string | null
          team_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      bis_items: {
        Row: {
          id: number
          item_id: number
          obtained: boolean
          player_id: number
          season: string | null
          slot: string | null
          updated_at: string | null
        }
        Insert: {
          id?: number
          item_id: number
          obtained?: boolean
          player_id: number
          season?: string | null
          slot?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: number
          item_id?: number
          obtained?: boolean
          player_id?: number
          season?: string | null
          slot?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bis_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bis_items_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bis_items_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "bis_items_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
        ]
      }
      bis_requests: {
        Row: {
          bis_link: string
          id: number
          officer_notes: string | null
          player_id: number | null
          player_note: string | null
          status: string
          submitted_at: string
          team_id: number
        }
        Insert: {
          bis_link: string
          id?: number
          officer_notes?: string | null
          player_id?: number | null
          player_note?: string | null
          status?: string
          submitted_at?: string
          team_id: number
        }
        Update: {
          bis_link?: string
          id?: number
          officer_notes?: string | null
          player_id?: number | null
          player_note?: string | null
          status?: string
          submitted_at?: string
          team_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "bis_requests_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bis_requests_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "bis_requests_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "bis_requests_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      boe_items: {
        Row: {
          ah_fee: number | null
          created_at: string
          finder_discord_id: string | null
          finder_name: string | null
          finder_payout: number | null
          found_at: string
          guild_cut: number | null
          id: number
          item_id: number | null
          item_name: string
          note: string | null
          payout_donated: boolean
          upgrade_rank: string | null
          payout_floor: number | null
          payout_paid_at: string | null
          payout_pivot: number | null
          player_id: number | null
          retired_at: string | null
          sale_price: number | null
          season: string | null
          sold_at: string | null
          status: string
          team_id: number
          track: string | null
          updated_at: string | null
        }
        Insert: {
          ah_fee?: number | null
          created_at?: string
          finder_discord_id?: string | null
          finder_name?: string | null
          finder_payout?: number | null
          found_at?: string
          guild_cut?: number | null
          id?: number
          item_id?: number | null
          item_name: string
          note?: string | null
          payout_donated?: boolean
          upgrade_rank?: string | null
          payout_floor?: number | null
          payout_paid_at?: string | null
          payout_pivot?: number | null
          player_id?: number | null
          retired_at?: string | null
          sale_price?: number | null
          season?: string | null
          sold_at?: string | null
          status?: string
          team_id: number
          track?: string | null
          updated_at?: string | null
        }
        Update: {
          ah_fee?: number | null
          created_at?: string
          finder_discord_id?: string | null
          finder_name?: string | null
          finder_payout?: number | null
          found_at?: string
          guild_cut?: number | null
          id?: number
          item_id?: number | null
          item_name?: string
          note?: string | null
          payout_donated?: boolean
          upgrade_rank?: string | null
          payout_floor?: number | null
          payout_paid_at?: string | null
          payout_pivot?: number | null
          player_id?: number | null
          retired_at?: string | null
          sale_price?: number | null
          season?: string | null
          sold_at?: string | null
          status?: string
          team_id?: number
          track?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boe_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boe_items_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boe_items_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "boe_items_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "boe_items_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      boe_listings: {
        Row: {
          boe_item_id: number
          created_at: string
          id: number
          listed_at: string
          note: string | null
          price: number
          team_id: number
          updated_at: string | null
        }
        Insert: {
          boe_item_id: number
          created_at?: string
          id?: number
          listed_at?: string
          note?: string | null
          price: number
          team_id: number
          updated_at?: string | null
        }
        Update: {
          boe_item_id?: number
          created_at?: string
          id?: number
          listed_at?: string
          note?: string | null
          price?: number
          team_id?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boe_listings_boe_item_id_fkey"
            columns: ["boe_item_id"]
            isOneToOne: false
            referencedRelation: "boe_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boe_listings_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      boe_managers: {
        Row: {
          auth_user_id: string | null
          created_at: string
          discord_id: string
          id: number
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          discord_id: string
          id?: number
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          discord_id?: string
          id?: number
        }
        Relationships: []
      }
      classes_specs: {
        Row: {
          class: string
          id: number
          role: string | null
          spec: string
        }
        Insert: {
          class: string
          id?: number
          role?: string | null
          spec: string
        }
        Update: {
          class?: string
          id?: number
          role?: string | null
          spec?: string
        }
        Relationships: []
      }
      guild_officers: {
        Row: {
          auth_user_id: string | null
          discord_id: string
          id: number
        }
        Insert: {
          auth_user_id?: string | null
          discord_id: string
          id?: number
        }
        Update: {
          auth_user_id?: string | null
          discord_id?: string
          id?: number
        }
        Relationships: []
      }
      item_bosses: {
        Row: {
          boss: string
          item_id: number
        }
        Insert: {
          boss: string
          item_id: number
        }
        Update: {
          boss?: string
          item_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "item_bosses_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      item_preferences: {
        Row: {
          created_at: string
          id: number
          item_id: number
          note: string | null
          player_id: number
          season: string | null
          slot: string | null
          status: string
          synced_bis: boolean
          team_id: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          item_id: number
          note?: string | null
          player_id: number
          season?: string | null
          slot?: string | null
          status: string
          synced_bis?: boolean
          team_id: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          item_id?: number
          note?: string | null
          player_id?: number
          season?: string | null
          slot?: string | null
          status?: string
          synced_bis?: boolean
          team_id?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_preferences_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_preferences_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_preferences_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "item_preferences_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "item_preferences_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          armor_type: string | null
          icon: string | null
          id: number
          is_boe: boolean
          is_placeholder: boolean
          is_ptr: boolean
          main_stats: Json | null
          name: string
          secondary_stats: Json | null
          slot: string
          sort_id: number | null
          wcl_zone_id: number | null
          weapon_subtype: string | null
          wow_item_id: number | null
        }
        Insert: {
          armor_type?: string | null
          icon?: string | null
          id?: number
          is_boe?: boolean
          is_placeholder?: boolean
          is_ptr?: boolean
          main_stats?: Json | null
          name: string
          secondary_stats?: Json | null
          slot: string
          sort_id?: number | null
          wcl_zone_id?: number | null
          weapon_subtype?: string | null
          wow_item_id?: number | null
        }
        Update: {
          armor_type?: string | null
          icon?: string | null
          id?: number
          is_boe?: boolean
          is_placeholder?: boolean
          is_ptr?: boolean
          main_stats?: Json | null
          name?: string
          secondary_stats?: Json | null
          slot?: string
          sort_id?: number | null
          wcl_zone_id?: number | null
          weapon_subtype?: string | null
          wow_item_id?: number | null
        }
        Relationships: []
      }
      mplus_exclusion_requests: {
        Row: {
          id: number
          officer_notes: string | null
          player_id: number
          raiderio_url: string | null
          reason: string | null
          status: string
          submitted_at: string
          team_id: number
          updated_at: string | null
        }
        Insert: {
          id?: number
          officer_notes?: string | null
          player_id: number
          raiderio_url?: string | null
          reason?: string | null
          status?: string
          submitted_at?: string
          team_id: number
          updated_at?: string | null
        }
        Update: {
          id?: number
          officer_notes?: string | null
          player_id?: number
          raiderio_url?: string | null
          reason?: string | null
          status?: string
          submitted_at?: string
          team_id?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mplus_exclusion_requests_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mplus_exclusion_requests_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "mplus_exclusion_requests_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "mplus_exclusion_requests_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      no_character_dismissals: {
        Row: {
          auth_user_id: string
          dismissed_at: string
          id: number
        }
        Insert: {
          auth_user_id: string
          dismissed_at?: string
          id?: number
        }
        Update: {
          auth_user_id?: string
          dismissed_at?: string
          id?: number
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: number
          message: string
          player_id: number
          read: boolean
          team_id: number
        }
        Insert: {
          created_at?: string
          id?: number
          message: string
          player_id: number
          read?: boolean
          team_id: number
        }
        Update: {
          created_at?: string
          id?: number
          message?: string
          player_id?: number
          read?: boolean
          team_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "notifications_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "notifications_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "notifications_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      player_equipped_gear: {
        Row: {
          equipment_slot: string
          id: number
          item_id: number | null
          item_level: number | null
          player_id: number
          synced_at: string
          track: string | null
        }
        Insert: {
          equipment_slot: string
          id?: number
          item_id?: number | null
          item_level?: number | null
          player_id: number
          synced_at?: string
          track?: string | null
        }
        Update: {
          equipment_slot?: string
          id?: number
          item_id?: number | null
          item_level?: number | null
          player_id?: number
          synced_at?: string
          track?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_equipped_gear_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_equipped_gear_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_equipped_gear_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
        ]
      }
      player_wcl_season_perf: {
        Row: {
          best_perf_avg: number | null
          fetched_at: string
          id: number
          median_perf_avg: number | null
          player_id: number
          season: string
          team_id: number
        }
        Insert: {
          best_perf_avg?: number | null
          fetched_at?: string
          id?: never
          median_perf_avg?: number | null
          player_id: number
          season: string
          team_id: number
        }
        Update: {
          best_perf_avg?: number | null
          fetched_at?: string
          id?: never
          median_perf_avg?: number | null
          player_id?: number
          season?: string
          team_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_wcl_season_perf_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_wcl_season_perf_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_wcl_season_perf_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_wcl_season_perf_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          archived_at: string | null
          archived_reason: string | null
          archived_reason_detail: string | null
          bis_allowed: boolean
          bis_link: string | null
          bonus_roll_encounter_id: number | null
          class_spec_id: number | null
          id: number
          is_backup_healer: boolean
          is_backup_tank: boolean
          is_bench: boolean
          is_trial: boolean
          join_date: string | null
          m_plus_excluded: boolean
          m_plus_note: string | null
          name_realm: string
          nickname: string | null
          officer_notes: string | null
          team_id: number
          team_member_id: number | null
          tier_pieces_equipped: number | null
          tier_pieces_synced_at: string | null
          updated_at: string | null
          wishlist_allowed: boolean
        }
        Insert: {
          archived_at?: string | null
          archived_reason?: string | null
          archived_reason_detail?: string | null
          bis_allowed?: boolean
          bis_link?: string | null
          bonus_roll_encounter_id?: number | null
          class_spec_id?: number | null
          id?: number
          is_backup_healer?: boolean
          is_backup_tank?: boolean
          is_bench?: boolean
          is_trial?: boolean
          join_date?: string | null
          m_plus_excluded?: boolean
          m_plus_note?: string | null
          name_realm: string
          nickname?: string | null
          officer_notes?: string | null
          team_id: number
          team_member_id?: number | null
          tier_pieces_equipped?: number | null
          tier_pieces_synced_at?: string | null
          updated_at?: string | null
          wishlist_allowed?: boolean
        }
        Update: {
          archived_at?: string | null
          archived_reason?: string | null
          archived_reason_detail?: string | null
          bis_allowed?: boolean
          bis_link?: string | null
          bonus_roll_encounter_id?: number | null
          class_spec_id?: number | null
          id?: number
          is_backup_healer?: boolean
          is_backup_tank?: boolean
          is_bench?: boolean
          is_trial?: boolean
          join_date?: string | null
          m_plus_excluded?: boolean
          m_plus_note?: string | null
          name_realm?: string
          nickname?: string | null
          officer_notes?: string | null
          team_id?: number
          team_member_id?: number | null
          tier_pieces_equipped?: number | null
          tier_pieces_synced_at?: string | null
          updated_at?: string | null
          wishlist_allowed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "players_bonus_roll_encounter_id_fkey"
            columns: ["bonus_roll_encounter_id"]
            isOneToOne: false
            referencedRelation: "raid_encounters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_class_spec_id_fkey"
            columns: ["class_spec_id"]
            isOneToOne: false
            referencedRelation: "classes_specs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      priority_conflict_dismissals: {
        Row: {
          boss: string
          dismissed_at: string
          dismissed_by: string | null
          id: number
          player_id: number | null
          season: string
          team_id: number
          track: string
        }
        Insert: {
          boss: string
          dismissed_at?: string
          dismissed_by?: string | null
          id?: number
          player_id?: number | null
          season: string
          team_id: number
          track: string
        }
        Update: {
          boss?: string
          dismissed_at?: string
          dismissed_by?: string | null
          id?: number
          player_id?: number | null
          season?: string
          team_id?: number
          track?: string
        }
        Relationships: [
          {
            foreignKeyName: "priority_conflict_dismissals_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_conflict_dismissals_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "priority_conflict_dismissals_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "priority_conflict_dismissals_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      priority_order: {
        Row: {
          id: number
          item_id: number
          player_id: number
          rank: number
          season: string
          team_id: number
          track: string
          updated_at: string | null
        }
        Insert: {
          id?: number
          item_id: number
          player_id: number
          rank: number
          season: string
          team_id: number
          track: string
          updated_at?: string | null
        }
        Update: {
          id?: number
          item_id?: number
          player_id?: number
          rank?: number
          season?: string
          team_id?: number
          track?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "priority_order_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_order_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_order_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "priority_order_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "priority_order_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      priority_order_confirmed_empty: {
        Row: {
          item_id: number
          marked_at: string
          season: string
          team_id: number
          track: string
        }
        Insert: {
          item_id: number
          marked_at?: string
          season: string
          team_id: number
          track: string
        }
        Update: {
          item_id?: number
          marked_at?: string
          season?: string
          team_id?: number
          track?: string
        }
        Relationships: [
          {
            foreignKeyName: "priority_order_confirmed_empty_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_order_confirmed_empty_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      priority_stale_dismissals: {
        Row: {
          dismissed_at: string
          dismissed_by: string | null
          id: number
          item_id: number
          player_id: number | null
          season: string
          team_id: number
        }
        Insert: {
          dismissed_at?: string
          dismissed_by?: string | null
          id?: number
          item_id: number
          player_id?: number | null
          season: string
          team_id: number
        }
        Update: {
          dismissed_at?: string
          dismissed_by?: string | null
          id?: number
          item_id?: number
          player_id?: number | null
          season?: string
          team_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "priority_stale_dismissals_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_stale_dismissals_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_stale_dismissals_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "priority_stale_dismissals_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "priority_stale_dismissals_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      raid_encounters: {
        Row: {
          id: number
          name: string
          sort_index: number
          wcl_encounter_id: number
          zone_id: number
        }
        Insert: {
          id?: number
          name: string
          sort_index?: number
          wcl_encounter_id: number
          zone_id: number
        }
        Update: {
          id?: number
          name?: string
          sort_index?: number
          wcl_encounter_id?: number
          zone_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "raid_encounters_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "raid_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      raid_zones: {
        Row: {
          id: number
          is_mini_raid: boolean
          name: string
          season: string
          sort_index: number
          wcl_zone_id: number
        }
        Insert: {
          id?: number
          is_mini_raid?: boolean
          name: string
          season: string
          sort_index?: number
          wcl_zone_id: number
        }
        Update: {
          id?: number
          is_mini_raid?: boolean
          name?: string
          season?: string
          sort_index?: number
          wcl_zone_id?: number
        }
        Relationships: []
      }
      rclc_loot: {
        Row: {
          awarded_at: string
          boss: string | null
          dedupe_key: string | null
          id: number
          item_id: number | null
          player_id: number | null
          rclc_id: string | null
          response: string | null
          season: string | null
          team_id: number
          track: string | null
        }
        Insert: {
          awarded_at?: string
          boss?: string | null
          dedupe_key?: string | null
          id?: number
          item_id?: number | null
          player_id?: number | null
          rclc_id?: string | null
          response?: string | null
          season?: string | null
          team_id: number
          track?: string | null
        }
        Update: {
          awarded_at?: string
          boss?: string | null
          dedupe_key?: string | null
          id?: number
          item_id?: number | null
          player_id?: number | null
          rclc_id?: string | null
          response?: string | null
          season?: string | null
          team_id?: number
          track?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loot_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loot_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loot_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "loot_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "loot_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring: {
        Row: {
          attendance_pct: number | null
          attendance_score: number | null
          best_score: number | null
          id: number
          performance_score: number | null
          player_id: number
          recent_score: number | null
          season: string
          trend_score: number | null
          updated_at: string | null
        }
        Insert: {
          attendance_pct?: number | null
          attendance_score?: number | null
          best_score?: number | null
          id?: number
          performance_score?: number | null
          player_id: number
          recent_score?: number | null
          season: string
          trend_score?: number | null
          updated_at?: string | null
        }
        Update: {
          attendance_pct?: number | null
          attendance_score?: number | null
          best_score?: number | null
          id?: number
          performance_score?: number | null
          player_id?: number
          recent_score?: number | null
          season?: string
          trend_score?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scoring_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "scoring_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
        ]
      }
      season_signups: {
        Row: {
          approved_player_id: number | null
          auth_user_id: string | null
          class_spec_id: number | null
          id: number
          main_swap: boolean
          off_specs: string | null
          player_note: string | null
          reviewed_at: string | null
          reviewed_by: number | null
          season: string | null
          signup_name_realm: string
          signup_officer_note: string | null
          status: string
          submitted_at: string
          swap_class_spec_id: number | null
          swap_from_name_realm: string | null
          team_id: number
          updated_at: string | null
        }
        Insert: {
          approved_player_id?: number | null
          auth_user_id?: string | null
          class_spec_id?: number | null
          id?: number
          main_swap?: boolean
          off_specs?: string | null
          player_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: number | null
          season?: string | null
          signup_name_realm: string
          signup_officer_note?: string | null
          status?: string
          submitted_at?: string
          swap_class_spec_id?: number | null
          swap_from_name_realm?: string | null
          team_id: number
          updated_at?: string | null
        }
        Update: {
          approved_player_id?: number | null
          auth_user_id?: string | null
          class_spec_id?: number | null
          id?: number
          main_swap?: boolean
          off_specs?: string | null
          player_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: number | null
          season?: string | null
          signup_name_realm?: string
          signup_officer_note?: string | null
          status?: string
          submitted_at?: string
          swap_class_spec_id?: number | null
          swap_from_name_realm?: string | null
          team_id?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "season_signups_approved_player_id_fkey"
            columns: ["approved_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_signups_approved_player_id_fkey"
            columns: ["approved_player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "season_signups_approved_player_id_fkey"
            columns: ["approved_player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "season_signups_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_signups_swap_class_spec_id_fkey"
            columns: ["swap_class_spec_id"]
            isOneToOne: false
            referencedRelation: "classes_specs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signups_class_spec_id_fkey"
            columns: ["class_spec_id"]
            isOneToOne: false
            referencedRelation: "classes_specs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      self_received_requests: {
        Row: {
          id: number
          note: string | null
          player_id: number | null
          self_item_id: number
          slot: string | null
          source: string | null
          status: string
          submitted_at: string
          team_id: number
          track: string | null
        }
        Insert: {
          id?: number
          note?: string | null
          player_id?: number | null
          self_item_id: number
          slot?: string | null
          source?: string | null
          status?: string
          submitted_at?: string
          team_id: number
          track?: string | null
        }
        Update: {
          id?: number
          note?: string | null
          player_id?: number | null
          self_item_id?: number
          slot?: string | null
          source?: string | null
          status?: string
          submitted_at?: string
          team_id?: number
          track?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "self_received_requests_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "self_received_requests_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "self_received_requests_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "self_received_requests_self_item_id_fkey"
            columns: ["self_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "self_received_requests_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      site_admins: {
        Row: {
          auth_user_id: string | null
          discord_id: string
          id: number
        }
        Insert: {
          auth_user_id?: string | null
          discord_id: string
          id?: number
        }
        Update: {
          auth_user_id?: string | null
          discord_id?: string
          id?: number
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          boe_payout_floor: number
          boe_payout_pivot: number
          guild_officer_bios: Json
          id: number
          maintenance_message: string | null
          maintenance_mode: boolean
          updated_at: string
        }
        Insert: {
          boe_payout_floor?: number
          boe_payout_pivot?: number
          guild_officer_bios?: Json
          id?: number
          maintenance_message?: string | null
          maintenance_mode?: boolean
          updated_at?: string
        }
        Update: {
          boe_payout_floor?: number
          boe_payout_pivot?: number
          guild_officer_bios?: Json
          id?: number
          maintenance_message?: string | null
          maintenance_mode?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      streamers: {
        Row: {
          created_at: string
          guild_wide_opt_out: boolean
          id: number
          is_live: boolean
          last_checked_at: string | null
          player_id: number
          schedule_note: string | null
          team_id: number
          twitch_channel: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          guild_wide_opt_out?: boolean
          id?: number
          is_live?: boolean
          last_checked_at?: string | null
          player_id: number
          schedule_note?: string | null
          team_id: number
          twitch_channel: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          guild_wide_opt_out?: boolean
          id?: number
          is_live?: boolean
          last_checked_at?: string | null
          player_id?: number
          schedule_note?: string | null
          team_id?: number
          twitch_channel?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "streamers_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streamers_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "streamers_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "streamers_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          auth_user_id: string | null
          discord_id: string
          id: number
          name_realm: string | null
          role: string
          team_id: number
          updated_at: string | null
        }
        Insert: {
          auth_user_id?: string | null
          discord_id: string
          id?: number
          name_realm?: string | null
          role: string
          team_id: number
          updated_at?: string | null
        }
        Update: {
          auth_user_id?: string | null
          discord_id?: string
          id?: number
          name_realm?: string | null
          role?: string
          team_id?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_raid_progress: {
        Row: {
          encounter_id: number
          heroic_best_pct: number | null
          heroic_date: string | null
          heroic_fight_id: number | null
          heroic_pulls: number | null
          heroic_report_code: string | null
          id: number
          mythic_best_pct: number | null
          mythic_date: string | null
          mythic_fight_id: number | null
          mythic_pulls: number | null
          mythic_report_code: string | null
          team_id: number
          updated_at: string | null
        }
        Insert: {
          encounter_id: number
          heroic_best_pct?: number | null
          heroic_date?: string | null
          heroic_fight_id?: number | null
          heroic_pulls?: number | null
          heroic_report_code?: string | null
          id?: number
          mythic_best_pct?: number | null
          mythic_date?: string | null
          mythic_fight_id?: number | null
          mythic_pulls?: number | null
          mythic_report_code?: string | null
          team_id: number
          updated_at?: string | null
        }
        Update: {
          encounter_id?: number
          heroic_best_pct?: number | null
          heroic_date?: string | null
          heroic_fight_id?: number | null
          heroic_pulls?: number | null
          heroic_report_code?: string | null
          id?: number
          mythic_best_pct?: number | null
          mythic_date?: string | null
          mythic_fight_id?: number | null
          mythic_pulls?: number | null
          mythic_report_code?: string | null
          team_id?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_raid_progress_encounter_id_fkey"
            columns: ["encounter_id"]
            isOneToOne: false
            referencedRelation: "raid_encounters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_raid_progress_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_settings: {
        Row: {
          config: Json
          team_id: number
          updated_at: string | null
        }
        Insert: {
          config?: Json
          team_id: number
          updated_at?: string | null
        }
        Update: {
          config?: Json
          team_id?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settings_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          archived_at: string | null
          id: number
          name: string
          slug: string
          wcl_guild_id: number | null
        }
        Insert: {
          archived_at?: string | null
          id?: number
          name: string
          slug: string
          wcl_guild_id?: number | null
        }
        Update: {
          archived_at?: string | null
          id?: number
          name?: string
          slug?: string
          wcl_guild_id?: number | null
        }
        Relationships: []
      }
      tier_token_map: {
        Row: {
          class: string
          created_at: string
          id: number
          resolved_item_id: number
          token_item_id: number
        }
        Insert: {
          class: string
          created_at?: string
          id?: number
          resolved_item_id: number
          token_item_id: number
        }
        Update: {
          class?: string
          created_at?: string
          id?: number
          resolved_item_id?: number
          token_item_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "tier_token_map_resolved_item_id_fkey"
            columns: ["resolved_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_token_map_token_item_id_fkey"
            columns: ["token_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      bis_demand_vs_awards: {
        Row: {
          awarded_count: number | null
          demand_count: number | null
          item_id: number | null
          item_name: string | null
          season: string | null
          slot: string | null
          team_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "item_preferences_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      incoming_roster: {
        Row: {
          class: string | null
          role: string | null
          signup_id: number | null
          signup_name_realm: string | null
          spec: string | null
          swap_from_name_realm: string | null
          team_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "signups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_roster: {
        Row: {
          class: string | null
          class_spec_id: number | null
          main_swap: boolean | null
          off_specs: string | null
          player_note: string | null
          reviewed_at: string | null
          reviewed_by: number | null
          role: string | null
          season: string | null
          signup_id: number | null
          signup_name_realm: string | null
          signup_officer_note: string | null
          spec: string | null
          swap_from_name_realm: string | null
          team_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "season_signups_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      priority_order_first_prio_counts: {
        Row: {
          first_prio_count: number | null
          name_realm: string | null
          player_id: number | null
          season: string | null
          team_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "priority_order_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_order_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "priority_order_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "priority_order_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      priority_order_gaps: {
        Row: {
          name_realm: string | null
          player_id: number | null
          season: string | null
          team_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "priority_order_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      priority_order_live_first_prios: {
        Row: {
          boss: string | null
          item_id: number | null
          item_name: string | null
          name_realm: string | null
          player_id: number | null
          priority_order_id: number | null
          season: string | null
          team_id: number | null
          track: string | null
        }
        Relationships: [
          {
            foreignKeyName: "priority_order_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_order_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_order_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "priority_order_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "priority_order_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      priority_order_same_boss_conflicts: {
        Row: {
          boss: string | null
          item_id: number | null
          item_name: string | null
          name_realm: string | null
          other_item_id: number | null
          other_item_name: string | null
          player_id: number | null
          season: string | null
          team_id: number | null
          track: string | null
        }
        Relationships: [
          {
            foreignKeyName: "priority_order_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_order_item_id_fkey"
            columns: ["other_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_order_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_order_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "priority_order_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "priority_order_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      priority_order_stale_after_heroic: {
        Row: {
          item_id: number | null
          item_name: string | null
          name_realm: string | null
          player_id: number | null
          priority_order_id: number | null
          season: string | null
          team_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "priority_order_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_order_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_order_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "priority_order_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "priority_order_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      priority_order_stale_entries: {
        Row: {
          archived_at: string | null
          item_id: number | null
          item_name: string | null
          name_realm: string | null
          player_id: number | null
          priority_order_id: number | null
          rank: number | null
          season: string | null
          team_id: number | null
          track: string | null
        }
        Relationships: [
          {
            foreignKeyName: "priority_order_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_order_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_order_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "priority_order_gaps"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "priority_order_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "rnlsi"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "priority_order_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      rnlsi: {
        Row: {
          last_award_at: string | null
          name_realm: string | null
          player_id: number | null
          raid_nights_since_last_item: number | null
          role: string | null
          team_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "players_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      season_loot_pace: {
        Row: {
          items_awarded: number | null
          season: string | null
          season_week: number | null
          slot: string | null
          team_id: number | null
          track: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loot_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      add_signup_to_roster: {
        Args: {
          p_archive_player_id?: number
          p_is_backup_healer?: boolean
          p_is_backup_tank?: boolean
          p_is_trial?: boolean
          p_signup_id: number
        }
        Returns: number
      }
      admin_create_team: {
        Args: { p_name: string; p_slug: string }
        Returns: number
      }
      admin_grant_boe_manager: {
        Args: { p_discord_id: string }
        Returns: number
      }
      admin_grant_guild_officer: {
        Args: { p_discord_id: string }
        Returns: number
      }
      admin_grant_site_admin: {
        Args: { p_discord_id: string }
        Returns: number
      }
      admin_grant_team_role: {
        Args: { p_discord_id: string; p_role: string; p_team_id: number }
        Returns: string
      }
      admin_list_boe_managers: {
        Args: never
        Returns: {
          auth_user_id: string
          discord_id: string
          display_name: string
          id: number
        }[]
      }
      admin_list_guild_officers: {
        Args: never
        Returns: {
          auth_user_id: string
          discord_id: string
          display_name: string
          id: number
        }[]
      }
      admin_list_site_admins: {
        Args: never
        Returns: {
          auth_user_id: string
          discord_id: string
          display_name: string
          id: number
        }[]
      }
      admin_revoke_boe_manager: {
        Args: { p_discord_id: string }
        Returns: undefined
      }
      admin_revoke_guild_officer: {
        Args: { p_discord_id: string }
        Returns: undefined
      }
      admin_revoke_site_admin: {
        Args: { p_discord_id: string }
        Returns: undefined
      }
      admin_revoke_team_role: {
        Args: { p_discord_id: string; p_team_id: number }
        Returns: undefined
      }
      admin_set_maintenance_mode: {
        Args: { p_enabled: boolean; p_message?: string }
        Returns: undefined
      }
      admin_set_team_archived: {
        Args: { p_archived: boolean; p_team_id: number }
        Returns: undefined
      }
      admin_update_team: {
        Args: { p_name: string; p_slug: string; p_team_id: number }
        Returns: undefined
      }
      archive_current_season: {
        Args: { p_roster_snapshot: Json; p_team_id: number }
        Returns: Json
      }
      boe_mark_paid: {
        Args: { p_donated?: boolean; p_id: number; p_paid_at?: string }
        Returns: undefined
      }
      boe_record_listing: {
        Args: {
          p_id: number
          p_listed_at?: string
          p_note?: string
          p_price: number
        }
        Returns: undefined
      }
      boe_record_sale: {
        Args: { p_id: number; p_sale_price: number; p_sold_at?: string }
        Returns: {
          ah_fee: number
          finder_payout: number
          guild_cut: number
          sale_price: number
        }[]
      }
      boe_retire: {
        Args: { p_id: number; p_note?: string }
        Returns: undefined
      }
      boe_revert: { Args: { p_id: number }; Returns: string }
      build_rclc_export: {
        Args: { p_season: string; p_team_id: number; p_track: string }
        Returns: Json
      }
      can_settle_boe: { Args: { p_team_id: number }; Returns: boolean }
      check_priority_order_drift: {
        Args: { p_season: string; p_team_id: number }
        Returns: {
          current_top3: string[]
          item_id: number
          item_name: string
          saved_top3: string[]
          track: string
        }[]
      }
      claim_character: {
        Args: { p_name_realm: string; p_team_id: number }
        Returns: {
          name_realm: string
          role: string
        }[]
      }
      current_discord_id: { Args: never; Returns: string }
      danger_clear_bis_requests: {
        Args: { p_team_id: number }
        Returns: number
      }
      danger_clear_mplus_exclusion_requests: {
        Args: { p_team_id: number }
        Returns: number
      }
      danger_clear_pending_roster: {
        Args: { p_team_id: number }
        Returns: number
      }
      danger_clear_season_signups: {
        Args: { p_team_id: number }
        Returns: number
      }
      danger_clear_self_received_requests: {
        Args: { p_team_id: number }
        Returns: number
      }
      delete_self_received_request: {
        Args: { p_id: number }
        Returns: undefined
      }
      direct_mark_received: {
        Args: {
          p_item_name: string
          p_name_realm: string
          p_note?: string
          p_slot?: string
          p_source?: string
          p_team_id: number
          p_track?: string
        }
        Returns: number
      }
      flag_bis_list_changed: {
        Args: {
          p_name_realm: string
          p_player_note?: string
          p_team_id: number
        }
        Returns: number
      }
      generate_priority_order: {
        Args: {
          p_item_id: number
          p_season: string
          p_team_id: number
          p_track: string
        }
        Returns: {
          name_realm: string
          player_id: number
          role: string
          status_label: string
          weighted_total: number
          wishlist_status: string
        }[]
      }
      get_own_signup: {
        Args: { p_team_id: number }
        Returns: {
          class: string
          id: number
          main_swap: boolean
          off_specs: string
          player_note: string
          season: string
          signup_name_realm: string
          spec: string
          status: string
          submitted_at: string
          swap_class: string
          swap_from_name_realm: string
          swap_spec: string
        }[]
      }
      import_rclc_loot: {
        Args: { p_rows: Json; p_season: string; p_team_id: number }
        Returns: Json
      }
      is_any_team_officer: { Args: never; Returns: boolean }
      is_boe_manager: { Args: never; Returns: boolean }
      is_guild_officer: { Args: never; Returns: boolean }
      is_own_player: { Args: { p_player_id: number }; Returns: boolean }
      is_site_admin: { Args: never; Returns: boolean }
      is_team_leader_anywhere: { Args: never; Returns: boolean }
      my_team_role: { Args: { p_team_id: number }; Returns: string }
      notify_player: {
        Args: { p_message: string; p_player_id: number }
        Returns: number
      }
      remove_player_priority_order: {
        Args: { p_player_id: number; p_season: string; p_team_id: number }
        Returns: number
      }
      resolve_actor_name: {
        Args: { p_actor_id: string; p_team_id: number }
        Returns: string
      }
      resolve_boe_finder_discord_id: {
        Args: { p_boe_id: number }
        Returns: string
      }
      resolve_discord_display_name: {
        Args: { p_actor_id: string; p_team_id: number }
        Returns: string
      }
      save_priority_order: {
        Args: {
          p_item_id: number
          p_player_ids: Json
          p_season: string
          p_team_id: number
          p_track: string
        }
        Returns: number
      }
      set_boe_payout_settings: {
        Args: { p_floor: number; p_pivot: number }
        Returns: undefined
      }
      set_guild_officer_bios: { Args: { p_bios: Json }; Returns: Json }
      set_team_officer_bios: {
        Args: { p_bios: Json; p_team_id: number }
        Returns: Json
      }
      set_team_setting: {
        Args: { p_skip_audit?: boolean; p_team_id: number; p_updates: Json }
        Returns: Json
      }
      submit_bis_link: {
        Args: {
          p_bis_link: string
          p_name_realm: string
          p_player_note?: string
          p_team_id: number
        }
        Returns: number
      }
      submit_boe_found: {
        Args: {
          p_donate?: boolean
          p_item_name: string
          p_name_realm: string
          p_note?: string
          p_team_id: number
          p_track?: string
          p_upgrade_rank?: string
        }
        Returns: number
      }
      submit_mplus_exclusion: {
        Args: {
          p_name_realm: string
          p_raiderio_url?: string
          p_reason?: string
          p_team_id: number
        }
        Returns: number
      }
      submit_season_signup: {
        Args: {
          p_class: string
          p_main_swap?: boolean
          p_name_realm: string
          p_off_specs?: string
          p_player_note?: string
          p_spec: string
          p_swap_from_name_realm?: string
          p_team_id: number
        }
        Returns: number
      }
      submit_self_received: {
        Args: {
          p_item_name: string
          p_name_realm: string
          p_note?: string
          p_slot?: string
          p_source?: string
          p_team_id: number
          p_track?: string
        }
        Returns: {
          auto_approved: boolean
          id: number
        }[]
      }
      unarchive_season: {
        Args: { p_index: number; p_team_id: number }
        Returns: Json
      }
      update_own_signup: {
        Args: {
          p_class: string
          p_main_swap?: boolean
          p_name_realm: string
          p_off_specs?: string
          p_player_note?: string
          p_signup_id: number
          p_spec: string
          p_swap_from_name_realm?: string
        }
        Returns: number
      }
      wishlist_setup_status: {
        Args: { p_team_id: number }
        Returns: {
          bis_link: string
          discord_id: string
          missing_bis_rows: string[]
          name_realm: string
          player_id: number
          wishlist_count: number
        }[]
      }
      write_audit_log: {
        Args: {
          p_action: string
          p_detail?: Json
          p_target_id?: number
          p_target_type?: string
          p_team_id: number
        }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
