/**
 * Applies the SQL files in scripts/migrations in name order, each in one transaction.
 * Files are written to be idempotent, so re-running is safe.  Usage: npm run db:migrate
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const dir = path.join(__dirname, "migrations");

async function main() {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const statements = readFileSync(path.join(dir, file), "utf8")
      .replace(/^\s*--.*$/gm, "")
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .filter(Boolean);
    await sql.transaction(statements.map((s) => sql.query(s)));
    console.log(`applied ${file} (${statements.length} statements)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
