// Strip the chat from every published build: node scripts/strip-public-chats.mjs [--apply <backup dir>]
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { rolldown } from "rolldown";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const target = args.find((a) => a !== "--apply");
if (apply && !target) throw new Error("usage: node scripts/strip-public-chats.mjs [--apply <backup dir>]");

/** Keep the first backup of each file: a rerun after a failure must not overwrite the original with a stripped copy. */
async function backup(path, data) {
  const file = join(resolve(target), path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, data, { flag: "wx" }).catch((e) => {
    if (e.code !== "EEXIST") throw e;
  });
}

// Reuse the API bundler to run the same store code as the deployed API.
const dir = await mkdtemp(join(tmpdir(), "brickyard-strip-"));
try {
  const bundle = await rolldown({ input: "api/lib/store.ts", platform: "node", logLevel: "warn" });
  const file = join(dir, "strip.mjs");
  await bundle.write({ file, format: "esm", codeSplitting: false });
  await bundle.close();
  const { stripPublicChats } = await import(pathToFileURL(file).href);
  const { builds, chats, prompts, images } = await stripPublicChats(apply, backup);
  console.log(
    `${apply ? "Stripped" : "Would strip"} ${builds} public builds: ${chats} chats, ${prompts} prompts, ${images} chat images.`,
  );
  if (!apply) console.log("Dry run: nothing written. Rerun with --apply <backup dir>.");
} catch {
  // Never dump SDK responses, user content or configuration into operator logs.
  console.error("Stripping failed. Check store configuration and retry.");
  process.exitCode = 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
