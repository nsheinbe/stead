/**
 * Append-only migration runner. Applies every unapplied file in drizzle/ in
 * filename order, each inside its own transaction, and records it in
 * public._migrations. Never edit an applied file — add a new one.
 *
 *   DATABASE_URL=... npm run db:migrate
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../drizzle");

export async function runMigrations(connectionString: string): Promise<string[]> {
  const sql = postgres(connectionString, { max: 1, prepare: false, onnotice: () => {} });
  const applied: string[] = [];
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS public._migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    const done = new Set(
      (await sql<{ filename: string }[]>`SELECT filename FROM public._migrations`).map(
        (row) => row.filename,
      ),
    );
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

    for (const filename of files) {
      if (done.has(filename)) continue;
      const body = await readFile(path.join(migrationsDir, filename), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body).simple();
        await tx`INSERT INTO public._migrations (filename) VALUES (${filename})`;
      });
      applied.push(filename);
    }
  } finally {
    await sql.end();
  }
  return applied;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required. Never commit it — export it in your shell.");
    process.exit(1);
  }
  const applied = await runMigrations(url);
  console.log(applied.length ? `applied: ${applied.join(", ")}` : "already up to date");
}
