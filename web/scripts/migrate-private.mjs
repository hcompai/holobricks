import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { rolldown } from "rolldown";

// Reuse the API bundler to run the exact same migration as owner access.
const dir = await mkdtemp(join(tmpdir(), "brickyard-private-"));
try {
  const bundle = await rolldown({ input: "api/lib/store.ts", platform: "node", logLevel: "warn" });
  const file = join(dir, "migrate.mjs");
  await bundle.write({ file, format: "esm", codeSplitting: false });
  await bundle.close();
  const { migratePrivate } = await import(pathToFileURL(file).href);
  console.log(`Migrated ${await migratePrivate()} private builds.`);
} catch {
  // Never dump SDK responses, user content or configuration into operator logs.
  console.error("Private migration failed. Check store configuration and retry.");
  process.exitCode = 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
