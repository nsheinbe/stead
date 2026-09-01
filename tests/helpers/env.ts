import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Minimal .env reader — Vitest runs in node, where Vite's env loading does
 *  not apply, and this avoids taking a dependency just to read a file. */
function loadDotEnv(): Record<string, string> {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
    const out: Record<string, string> = {}
    for (const line of raw.split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
      if (!match) continue
      const key = match[1]
      let value = (match[2] ?? '').trim()
      // Strip an inline comment, whether the value is empty ("KEY= # note")
      // or trailing ("KEY=abc # note"), then unquote.
      value = value.replace(/(^|\s)#.*$/, '').trim().replace(/^["']|["']$/g, '')
      if (key && value) out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

const fileEnv = loadDotEnv()

export function env(name: string): string | undefined {
  return process.env[name] ?? fileEnv[name]
}

export const SUPABASE_URL = env('SUPABASE_URL') ?? env('VITE_SUPABASE_URL')
export const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')

/** These suites write to bookings, which RLS denies to every client role, so
 *  they need the service role. Without it they skip rather than fail. */
export const hasDbAccess = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY)
