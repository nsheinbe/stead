/**
 * Route metadata for the shell: the document title, and which workspace the
 * navigation should present. The workspace is a display preference derived
 * from where the member is, never a permission — the server decides what any
 * request may read or change.
 */
export type Workspace = "renter" | "hosting";

export type RouteMeta = {
  title: string;
  workspace: Workspace;
};

const ID = "[^/]+";

const TABLE: { pattern: RegExp; title: string; workspace: Workspace }[] = [
  { pattern: /^\/$/, title: "Homes for 30 nights or more", workspace: "renter" },
  { pattern: /^\/explore$/, title: "Find a home", workspace: "renter" },
  { pattern: /^\/for-homeowners$/, title: "For homeowners", workspace: "renter" },
  { pattern: new RegExp(`^/listing/${ID}$`), title: "Home details", workspace: "renter" },
  { pattern: new RegExp(`^/book/${ID}$`), title: "Book your stay", workspace: "renter" },
  { pattern: /^\/trips$/, title: "Your stays", workspace: "renter" },
  { pattern: new RegExp(`^/trips/${ID}$`), title: "Stay details", workspace: "renter" },
  { pattern: /^\/messages$/, title: "Messages", workspace: "renter" },
  { pattern: new RegExp(`^/messages/${ID}$`), title: "Opening conversation", workspace: "renter" },
  { pattern: new RegExp(`^/messages/${ID}/${ID}$`), title: "Conversation", workspace: "renter" },
  { pattern: new RegExp(`^/review/${ID}$`), title: "Write a review", workspace: "renter" },
  { pattern: new RegExp(`^/passport/${ID}$`), title: "Profile", workspace: "renter" },
  { pattern: /^\/host\/start$/, title: "Start your listing", workspace: "hosting" },
  { pattern: /^\/host\/listings$/, title: "Your homes", workspace: "hosting" },
  { pattern: new RegExp(`^/host/listings/${ID}$`), title: "Edit your home", workspace: "hosting" },
  { pattern: /^\/host\/payouts$/, title: "Payouts", workspace: "hosting" },
  { pattern: /^\/host\/claims$/, title: "Claims", workspace: "hosting" },
  { pattern: new RegExp(`^/host/claims/${ID}$`), title: "Claim details", workspace: "hosting" },
  { pattern: /^\/ops$/, title: "Operations", workspace: "renter" },
  { pattern: /^\/login$/, title: "Sign in", workspace: "renter" },
];

export function routeMeta(pathname: string): RouteMeta {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const hit = TABLE.find((row) => row.pattern.test(clean));
  return hit ? { title: hit.title, workspace: hit.workspace } : { title: "Page not found", workspace: "renter" };
}

export function documentTitle(title: string): string {
  return title === "Stead" ? title : `${title} · Stead`;
}

/** Routes whose content is private, so signing out should leave them. */
export function isMemberRoute(pathname: string): boolean {
  return /^\/(trips|messages|review|host|ops)(\/|$)/.test(pathname);
}
