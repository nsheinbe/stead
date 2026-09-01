import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '@/hooks/useSession'
import { Spinner } from '@/components/ui'

/** detectSessionInUrl handles the token exchange; this just waits and moves on. */
export default function AuthCallback() {
  const { session, loading } = useSession()
  const navigate = useNavigate()

  useEffect(() => {
    if (loading) return
    navigate(session ? '/trips' : '/login', { replace: true })
  }, [session, loading, navigate])

  return <Spinner label="Signing you in…" />
}
