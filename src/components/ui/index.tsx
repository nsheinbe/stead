import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary'
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
  const styles =
    variant === 'primary'
      ? 'bg-spruce text-paper hover:bg-spruce-deep'
      : 'border border-linen-tint bg-paper text-ink hover:bg-linen'
  return <button className={`${base} ${styles} ${className}`} {...props} />
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-card bg-paper shadow-card ring-1 ring-linen-tint ${className}`}>
      {children}
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink/60" role="status">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-linen-tint border-t-spruce"
      />
      {label}
    </div>
  )
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card className="p-8 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-ink/70">{body}</p>
    </Card>
  )
}

export function ErrorState({ title, body }: { title: string; body: string }) {
  return (
    <Card className="border-l-4 border-l-claim p-6">
      <h2 className="text-base font-semibold text-claim">{title}</h2>
      <p className="mt-1 text-sm text-ink/70">{body}</p>
    </Card>
  )
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-linen px-2.5 py-1 text-xs font-medium text-spruce">
      {children}
    </span>
  )
}
