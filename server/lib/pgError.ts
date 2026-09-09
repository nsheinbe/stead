/** Drizzle wraps driver errors, so the Postgres message and code sit down the cause chain. */

export function pgMessage(err: unknown): string {
  const parts: string[] = [];
  let cursor: unknown = err;
  for (let depth = 0; depth < 5 && cursor; depth += 1) {
    const message = (cursor as { message?: unknown }).message;
    if (typeof message === "string") parts.push(message);
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

export function pgCode(err: unknown): string | undefined {
  let cursor: unknown = err;
  for (let depth = 0; depth < 5 && cursor; depth += 1) {
    const code = (cursor as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return undefined;
}
