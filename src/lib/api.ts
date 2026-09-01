/**
 * Same-origin API client. The session is an httpOnly cookie, so there is no
 * token for this file to hold and nothing to leak into localStorage.
 */
import type {
  CreateBookingRequest,
  CreateBookingResponse,
  ListingDetail,
  ListingSummary,
  PublicConfig,
  SessionResponse,
  TripDetail,
  TripSummary,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * A platform error page (a plain-text 500 from the host, an HTML 502 from a
 * proxy) is not JSON. Treat it as an empty body so the caller sees the status
 * code in an ApiError rather than a raw SyntaxError.
 */
function parseJsonBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { Accept: "application/json", ...init?.headers },
  });
  const text = await response.text();
  const body = parseJsonBody(text);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed (${response.status})`;
    throw new ApiError(response.status, message);
  }
  return body as T;
}

async function csrfToken(): Promise<string> {
  const { csrfToken: token } = await request<{ csrfToken: string }>("/api/auth/csrf");
  return token;
}

export const api = {
  me: () => request<SessionResponse>("/api/me"),
  config: () => request<PublicConfig>("/api/config"),
  listings: () => request<ListingSummary[]>("/api/listings"),
  listing: (id: string) => request<ListingDetail>(`/api/listings/${id}`),
  trips: () => request<TripSummary[]>("/api/trips"),
  trip: (id: string) => request<TripDetail>(`/api/trips/${id}`),

  createBooking: (body: CreateBookingRequest) =>
    request<CreateBookingResponse>("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  /** Auth.js magic link. Returns once the email is on its way. */
  async sendSignInLink(email: string, callbackUrl: string): Promise<void> {
    const body = new URLSearchParams({ csrfToken: await csrfToken(), email, callbackUrl });
    const response = await fetch("/api/auth/signin/resend", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Auth-Return-Redirect": "1",
      },
      body,
    });
    if (!response.ok) {
      throw new ApiError(response.status, "Could not send the sign-in link. Try again shortly.");
    }
    const result = (await response.json().catch(() => null)) as { url?: string } | null;
    if (result?.url && new URL(result.url, window.location.origin).searchParams.get("error")) {
      throw new ApiError(400, "Could not send the sign-in link. Check the address and try again.");
    }
  },

  async signOut(): Promise<void> {
    const body = new URLSearchParams({ csrfToken: await csrfToken() });
    await fetch("/api/auth/signout", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Auth-Return-Redirect": "1",
      },
      body,
    });
  },
};
