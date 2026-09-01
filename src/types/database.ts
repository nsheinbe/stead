// Generated from the live schema via `supabase gen types typescript`.
// Regenerate after every migration; do not hand-edit the Database type.
// (The CLI also emits generic Tables<>/TablesInsert<> helpers; we derive the
// aliases we actually use at the bottom of this file instead.)

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: { PostgrestVersion: '14.5' }
  public: {
    Tables: {
      app_config: {
        Row: { key: string; updated_at: string; value: Json }
        Insert: { key: string; updated_at?: string; value: Json }
        Update: { key?: string; updated_at?: string; value?: Json }
        Relationships: []
      }
      bookings: {
        Row: {
          cancellation_policy: Database['public']['Enums']['cancellation_policy']
          check_in: string
          check_out: string
          created_at: string
          deposit_cents: number
          guest_id: string
          guest_total_cents: number
          guests: number
          id: string
          listing_id: string
          network_fee_cents: number
          nightly_rate_cents: number
          nights: number
          status: Database['public']['Enums']['booking_status']
          stay: unknown
          stay_subtotal_cents: number
          stripe_payment_intent_id: string | null
        }
        Insert: {
          cancellation_policy: Database['public']['Enums']['cancellation_policy']
          check_in: string
          check_out: string
          created_at?: string
          deposit_cents: number
          guest_id: string
          guest_total_cents: number
          guests: number
          id?: string
          listing_id: string
          network_fee_cents: number
          nightly_rate_cents: number
          nights: number
          status?: Database['public']['Enums']['booking_status']
          stay?: unknown
          stay_subtotal_cents: number
          stripe_payment_intent_id?: string | null
        }
        Update: {
          cancellation_policy?: Database['public']['Enums']['cancellation_policy']
          check_in?: string
          check_out?: string
          created_at?: string
          deposit_cents?: number
          guest_id?: string
          guest_total_cents?: number
          guests?: number
          id?: string
          listing_id?: string
          network_fee_cents?: number
          nightly_rate_cents?: number
          nights?: number
          status?: Database['public']['Enums']['booking_status']
          stay?: unknown
          stay_subtotal_cents?: number
          stripe_payment_intent_id?: string | null
        }
        Relationships: []
      }
      listing_blackouts: {
        Row: { end_date: string; id: string; listing_id: string; start_date: string }
        Insert: { end_date: string; id?: string; listing_id: string; start_date: string }
        Update: { end_date?: string; id?: string; listing_id?: string; start_date?: string }
        Relationships: []
      }
      listing_photos: {
        Row: { id: string; listing_id: string; sort_order: number; storage_path: string }
        Insert: { id?: string; listing_id: string; sort_order?: number; storage_path: string }
        Update: { id?: string; listing_id?: string; sort_order?: number; storage_path?: string }
        Relationships: []
      }
      listings: {
        Row: {
          address_line: string | null
          amenities: Json
          cancellation_policy: Database['public']['Enums']['cancellation_policy']
          city: string
          country: string
          created_at: string
          deposit_cents: number
          description: string | null
          host_id: string
          id: string
          instant_book: boolean
          lat: number | null
          lng: number | null
          max_guests: number
          nightly_rate_cents: number
          region: string | null
          status: Database['public']['Enums']['listing_status']
          timezone: string
          title: string
          type: Database['public']['Enums']['listing_type']
        }
        Insert: {
          address_line?: string | null
          amenities?: Json
          cancellation_policy?: Database['public']['Enums']['cancellation_policy']
          city: string
          country: string
          created_at?: string
          deposit_cents?: number
          description?: string | null
          host_id: string
          id?: string
          instant_book?: boolean
          lat?: number | null
          lng?: number | null
          max_guests: number
          nightly_rate_cents: number
          region?: string | null
          status?: Database['public']['Enums']['listing_status']
          timezone: string
          title: string
          type: Database['public']['Enums']['listing_type']
        }
        Update: {
          address_line?: string | null
          amenities?: Json
          cancellation_policy?: Database['public']['Enums']['cancellation_policy']
          city?: string
          country?: string
          created_at?: string
          deposit_cents?: number
          description?: string | null
          host_id?: string
          id?: string
          instant_book?: boolean
          lat?: number | null
          lng?: number | null
          max_guests?: number
          nightly_rate_cents?: number
          region?: string | null
          status?: Database['public']['Enums']['listing_status']
          timezone?: string
          title?: string
          type?: Database['public']['Enums']['listing_type']
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          display_name: string | null
          id: string
          id_verified: boolean
          is_host: boolean
          member_since: string
          phone_verified: boolean
        }
        Insert: {
          avatar_url?: string | null
          display_name?: string | null
          id: string
          id_verified?: boolean
          is_host?: boolean
          member_since?: string
          phone_verified?: boolean
        }
        Update: {
          avatar_url?: string | null
          display_name?: string | null
          id?: string
          id_verified?: boolean
          is_host?: boolean
          member_since?: string
          phone_verified?: boolean
        }
        Relationships: []
      }
      stripe_events: {
        Row: { id: string; processed_at: string; type: string }
        Insert: { id: string; processed_at?: string; type: string }
        Update: { id?: string; processed_at?: string; type?: string }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: {
      booking_status:
        | 'pending_payment'
        | 'confirmed'
        | 'checked_in'
        | 'completed'
        | 'canceled_by_guest'
        | 'canceled_by_host'
        | 'expired'
      cancellation_policy: 'flexible' | 'moderate' | 'strict'
      listing_status: 'draft' | 'active' | 'paused'
      listing_type: 'entire_home' | 'apartment' | 'private_room'
    }
    CompositeTypes: { [_ in never]: never }
  }
}

type PublicSchema = Database['public']

export type Listing = PublicSchema['Tables']['listings']['Row']
export type ListingInsert = PublicSchema['Tables']['listings']['Insert']
export type ListingPhoto = PublicSchema['Tables']['listing_photos']['Row']
export type ListingBlackout = PublicSchema['Tables']['listing_blackouts']['Row']
export type Booking = PublicSchema['Tables']['bookings']['Row']
export type BookingInsert = PublicSchema['Tables']['bookings']['Insert']
export type Profile = PublicSchema['Tables']['profiles']['Row']

export type BookingStatus = PublicSchema['Enums']['booking_status']
export type CancellationPolicy = PublicSchema['Enums']['cancellation_policy']
export type ListingStatus = PublicSchema['Enums']['listing_status']
export type ListingType = PublicSchema['Enums']['listing_type']

/** Booking statuses that hold dates against the availability constraint. */
export const BLOCKING_BOOKING_STATUSES: readonly BookingStatus[] = [
  'pending_payment',
  'confirmed',
  'checked_in',
]
