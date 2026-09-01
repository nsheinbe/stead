import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button, Card, ErrorState } from '@/components/ui'

// Magic link only for now. Google OAuth is deferred until the OAuth client
// is supplied (see CLAUDE.md gotchas).
export default function Login() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setStatus('sending')
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (signInError) {
      setError(signInError.message)
      setStatus('idle')
      return
    }
    setStatus('sent')
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold">Sign in</h1>
      <p className="mt-2 text-sm text-ink/70">
        We'll email you a link. No password to remember.
      </p>

      {status === 'sent' ? (
        <Card className="mt-6 p-6">
          <h2 className="text-base font-semibold">Check your email</h2>
          <p className="mt-1 text-sm text-ink/70">
            We sent a sign-in link to {email}.
          </p>
        </Card>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-linen-tint bg-paper px-3 py-2 text-sm"
            />
          </div>
          {error && <ErrorState title="Could not send the link" body={error} />}
          <Button type="submit" disabled={status === 'sending'} className="w-full">
            {status === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
          </Button>
        </form>
      )}
    </div>
  )
}
