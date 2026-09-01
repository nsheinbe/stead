import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { getSessionUser, type SessionUser } from "../auth";
import { getDb, type Db } from "../db/client";

export type AppEnv = {
  Variables: {
    user: SessionUser | null;
    db: Db;
  };
};

export const withDb: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("db", getDb());
  await next();
};

export const withSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", await getSessionUser(c.req.raw));
  await next();
};

/** Guards every route that touches a member's own rows. There is no RLS behind this. */
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
