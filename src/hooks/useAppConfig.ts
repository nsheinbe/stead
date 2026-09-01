import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

const FALLBACK_NETWORK_FEE_BPS = 200

/** Pricing constants live in app_config. The client reads them only to show a
 *  breakdown; the server recomputes and snapshots the authoritative figures. */
export function useNetworkFeeBps() {
  return useQuery({
    queryKey: ['app_config', 'network_fee_bps'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from('app_config')
        .select('value')
        .eq('key', 'network_fee_bps')
        .single()
      if (error) throw error
      const bps = Number(data.value)
      return Number.isInteger(bps) ? bps : FALLBACK_NETWORK_FEE_BPS
    },
  })
}
