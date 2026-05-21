/// <reference path="./asset-modules.d.ts" />
// Each migration `.sql` file under `drizzle/` is imported as text and embedded
// into the bundle. Running through bun:sqlite directly avoids depending on the
// `drizzle/` folder being present on disk at runtime, which makes the migrator
// work identically when Bun runs the source files and when the package is
// bundled via `bun build`.
//
// When `bun run db:generate` produces a new migration file, add a matching
// `import migrationNNNN from "../drizzle/<tag>.sql" with { type: "text" };`
// line below and register the source under SOURCES. The journal entry's `when`
// timestamp drives apply-vs-skip detection, so file order here doesn't matter.
import { createHash } from "node:crypto";
import migration0000 from "../drizzle/0000_cooing_mole_man.sql" with { type: "text" };
import migration0001 from "../drizzle/0001_cute_earthquake.sql" with { type: "text" };
import journal from "../drizzle/meta/_journal.json" with { type: "json" };

const SOURCES: Record<string, string> = {
  "0000_cooing_mole_man": migration0000,
  "0001_cute_earthquake": migration0001,
};

export interface EmbeddedMigration {
  tag: string;
  /** Folder timestamp from `_journal.json`; how Drizzle decides if a migration is new. */
  when: number;
  /** SHA-256 of the SQL file, matching the hash Drizzle's stock migrator stores. */
  hash: string;
  /** Statements split on `--> statement-breakpoint`, ready to run in order. */
  statements: string[];
}

export const MIGRATIONS: readonly EmbeddedMigration[] = (
  journal as { entries: { tag: string; when: number }[] }
).entries.map((entry) => {
  const sql = SOURCES[entry.tag];
  if (sql === undefined) {
    throw new Error(
      `Embedded migration source missing for ${entry.tag}. Re-run \`bun run db:generate\` to update packages/core/src/migrations.ts.`,
    );
  }
  return {
    tag: entry.tag,
    when: entry.when,
    hash: createHash("sha256").update(sql).digest("hex"),
    statements: sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0),
  };
});
