import Stripe from "stripe";

let client: Stripe | undefined;

export function stripeConfigured(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_");
}

export function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    client = new Stripe(key);
  }
  return client;
}
