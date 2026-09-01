import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { getSessionUser, type SessionUser } from "../auth";
import { getAppDb, withMember, type Tx } from "../db/client";

export type AppEnv = {
  Variables: {
    user: SessionUser | null;
  };
};

export const withSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", await getSessionUser(c.req.raw));
  await next();
};

/**
 * Guards routes that touch a member's own rows.
 *
 * RLS is the enforcement — an unscoped query returns nothing rather than
 * everything — but a 401 is a better answer than an empty list.
 */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")) {
    throw new HTTPException(401, { message: "Sign in to continue" });
  }
  await next();
};

export function sessionUser(c: Context<AppEnv>): SessionUser {
  const user = c.get("user");
  if (!user) throw new HTTPException(401, { message: "Sign in to continue" });
  return user;
}

/**
 * Every tenant query goes through here: a short transaction carrying the
 * request's member id, which is what the policies read. Anonymous requests run
 * with no id and see only what is public.
 */
export function tenantQuery<T>(c: Context<AppEnv>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withMember(getAppDb(), c.get("user")?.id ?? null, fn);
}
