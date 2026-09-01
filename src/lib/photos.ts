import { supabase } from './supabase'

/** Seed data uses picsum placeholders until real photography lands, so a
 *  stored path may already be an absolute URL. */
export function photoUrl(storagePath: string): string {
  if (/^https?:\/\//.test(storagePath)) return storagePath
  return supabase.storage.from('listing-photos').getPublicUrl(storagePath).data.publicUrl
}
