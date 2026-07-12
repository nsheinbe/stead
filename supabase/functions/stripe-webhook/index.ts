// Bootstrap webhook receiver (preflight only): verifies the Stripe signature
// and acknowledges the event. Slice 1 replaces this with the full idempotent
// handler per BUILD_PROMPT §7 — stripe_events insert-first dedupe, booking
// confirmation on payment_intent.succeeded, dispute freeze/unfreeze, and
// account.updated payout readiness. It deliberately takes no other action,
// so acknowledged pre-launch events require no replay.
import Stripe from "npm:stripe@18";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "");
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!webhookSecret) {
    return new Response("Webhook secret not configured", { status: 500 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const payload = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      webhookSecret,
    );
  } catch {
    return new Response("Signature verification failed", { status: 400 });
  }

  console.log(`stripe-webhook: received ${event.type} (${event.id})`);
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
