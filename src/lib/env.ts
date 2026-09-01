export function stripePublishableKey(): string | undefined {
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
  return key && key.startsWith("pk_") ? key : undefined;
}
