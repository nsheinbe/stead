import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Booking, Listing } from '@/types/database'

export type BookingWithListing = Booking & {
  listings: Pick<Listing, 'id' | 'title' | 'city' | 'country' | 'timezone'> | null
}

/** RLS restricts this to the caller's own bookings (and, for a host, bookings
 *  on their listings), so no client-side filter is load-bearing here. */
export function useMyBookings(enabled: boolean) {
  return useQuery({
    queryKey: ['bookings', 'mine'],
    enabled,
    queryFn: async (): Promise<BookingWithListing[]> => {
      const { data, error } = await supabase
        .from('bookings')
        .select('*, listings(id, title, city, country, timezone)')
        .order('check_in', { ascending: true })
      if (error) throw error
      return (data ?? []) as BookingWithListing[]
    },
  })
}
