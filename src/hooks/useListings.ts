import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Listing, ListingPhoto } from '@/types/database'

export type ListingWithPhotos = Listing & { listing_photos: ListingPhoto[] }

export function useListings() {
  return useQuery({
    queryKey: ['listings'],
    queryFn: async (): Promise<ListingWithPhotos[]> => {
      const { data, error } = await supabase
        .from('listings')
        .select('*, listing_photos(*)')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ListingWithPhotos[]
    },
  })
}

export function useListing(id: string | undefined) {
  return useQuery({
    queryKey: ['listing', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<ListingWithPhotos | null> => {
      const { data, error } = await supabase
        .from('listings')
        .select('*, listing_photos(*)')
        .eq('id', id as string)
        .maybeSingle()
      if (error) throw error
      return (data as ListingWithPhotos | null) ?? null
    },
  })
}
