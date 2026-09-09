/**
 * Same-origin API client. The session is an httpOnly cookie, so there is no
 * token for this file to hold and nothing to leak into localStorage.
 */
import type {
  ClaimDetail,
  ClaimSummary,
  ConnectStatus,
  CreateBookingRequest,
  CreateBookingResponse,
  HostListing,
  HostPayout,
  ListingDetail,
  ListingInput,
  ListingSummary,
  Passport,
  PassportExport,
  PresignedUpload,
  PublicConfig,
  ReviewForm,
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

  // --- host surface -------------------------------------------------------
  hostListings: () => request<HostListing[]>("/api/listings/mine"),

  createListing: (body: ListingInput) =>
    request<{ id: string }>("/api/listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  updateListing: (id: string, body: Partial<ListingInput>) =>
    request<{ ok: true }>(`/api/listings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  deleteListing: (id: string) =>
    request<{ ok: true }>(`/api/listings/${id}`, { method: "DELETE" }),

  photoUploadUrl: (listingId: string, contentType: string) =>
    request<PresignedUpload>(`/api/listings/${listingId}/photo-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType }),
    }),

  attachPhoto: (listingId: string, key: string) =>
    request<{ id: string }>(`/api/listings/${listingId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    }),

  deletePhoto: (photoId: string) =>
    request<{ ok: true }>(`/api/listings/photos/${photoId}`, { method: "DELETE" }),

  connectStatus: () => request<ConnectStatus>("/api/connect/status"),

  connectOnboard: () =>
    request<{ url: string; accountId: string }>("/api/connect/onboard", { method: "POST" }),

  hostPayouts: () => request<HostPayout[]>("/api/host/payouts"),

  claims: () => request<ClaimSummary[]>("/api/claims"),

  claim: (id: string) => request<ClaimDetail>(`/api/claims/${id}`),

  fileClaim: (body: { bookingId: string; amountCents: number; description: string }) =>
    request<ClaimDetail>("/api/claims", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  respondClaim: (id: string, accept: boolean) =>
    request<ClaimDetail>(`/api/claims/${id}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accept }),
    }),

  resolveClaim: (
    id: string,
    body: { outcome: "host" | "guest" | "split"; amountCents?: number; note?: string },
  ) =>
    request<ClaimDetail>(`/api/claims/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  claimEvidenceUploadUrl: (claimId: string, contentType: string) =>
    request<PresignedUpload>(`/api/claims/${claimId}/evidence-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType }),
    }),

  attachClaimEvidence: (claimId: string, key: string, note?: string) =>
    request<ClaimDetail>(`/api/claims/${claimId}/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, note }),
    }),

  /**
   * The browser PUTs straight to the bucket. The content type must match what
   * was signed, or the upload is rejected.
   */
  async uploadToBucket(uploadUrl: string, file: File): Promise<void> {
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!response.ok) {
      throw new ApiError(response.status, "The upload was refused. Try again.");
    }
  },

  passport: (userId: string) => request<Passport>(`/api/passport/${userId}`),

  exportPassport: (userId: string) => request<PassportExport>(`/api/passport/${userId}/export`),

  verifyPassport: (body: PassportExport) =>
    request<{ valid: boolean }>("/api/passport/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: body.payload, signature: body.signature }),
    }),

  reviewForm: (bookingId: string) => request<ReviewForm>(`/api/reviews/${bookingId}`),

  submitReview: (bookingId: string, body: { rating: number; tags: string[]; body: string }) =>
    request<ReviewForm>(`/api/reviews/${bookingId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

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
