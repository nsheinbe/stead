import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/hooks/useSession'
import { Button } from '@/components/ui'

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive
    ? 'text-spruce font-semibold'
    : 'text-ink/70 hover:text-ink transition-colors'
}

export function AppShell({ children }: { children: ReactNode }) {
  const { session } = useSession()

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-linen-tint">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-4">
          <Link to="/" className="font-display text-xl font-bold text-spruce">
            Stead
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <NavLink to="/explore" className={navClass}>
              Explore
            </NavLink>
            {session && (
              <NavLink to="/trips" className={navClass}>
                Trips
              </NavLink>
            )}
            {session ? (
              <Button variant="secondary" onClick={() => void supabase.auth.signOut()}>
                Sign out
              </Button>
            ) : (
              <Link to="/login">
                <Button>Sign in</Button>
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>

      <footer className="mt-16 border-t border-linen-tint">
        <div className="mx-auto max-w-6xl px-5 py-8 text-sm text-ink/60">
          Community-owned rentals. A flat 2% network fee, deposits held in neutral
          escrow, and reputation you can take with you.
        </div>
      </footer>
    </div>
  )
}
