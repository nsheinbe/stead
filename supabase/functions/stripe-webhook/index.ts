// Idempotent Stripe webhook per BUILD_PROMPT §7.
// payment_intent.succeeded → booking confirmed. stripe_events insert-first dedupe.
// Dispute / account.updated are acknowledged in Slice 1; freeze/unfreeze lands in later slices.
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@18";
import { handleStripeEvent } from "../_shared/stripeWebhook.ts";

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
    event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret);
  } catch {
    return new Response("Signature verification failed", { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return new Response("Supabase is not configured", { status: 500 });
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const result = await handleStripeEvent(
    {
      id: event.id,
      type: event.type,
      data: {
        object: {
          id: "id" in event.data.object ? String(event.data.object.id) : undefined,
        },
      },
    },
    {
      claimEvent: async (id, type) => {
        const { error } = await admin.from("stripe_events").insert({ id, type });
        if (!error) return true;
        if (error.code === "23505") return false;
        throw new Error(error.message);
      },
      confirmBookingByPaymentIntent: async (paymentIntentId) => {
        const { data, error } = await admin.rpc("confirm_booking_for_payment_intent", {
          pi_id: paymentIntentId,
        });
        if (error) throw new Error(error.message);
        return Boolean(data);
      },
    },
  );

  console.log(
    `stripe-webhook: ${event.type} (${event.id}) skipped=${result.skipped} confirmed=${result.confirmed}`,
  );
  return new Response(JSON.stringify({ received: true, ...result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
