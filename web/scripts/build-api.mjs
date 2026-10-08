// Bundle each function in api/ into a Vercel Build Output directory, with its routes: node scripts/build-api.mjs .vercel/output
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rolldown } from "rolldown";

const out = process.argv[2];
if (!out) throw new Error("usage: node scripts/build-api.mjs <output directory>");
const MAX_DURATION_S = { builds: 300 };
/** Paris: beside the Blob store, the Agents API and most users. */
const REGIONS = ["cdg1"];
/** Build assets are named by their content, so browsers keep them; a link to a public build or a showcase gets the app's page with that build's link preview. */
const ROUTES = [
  { src: "^/assets/.+$", headers: { "cache-control": "public, max-age=31536000, immutable" }, continue: true },
  ...["public", "showcase"].map((key) => ({ src: "^/$", has: [{ type: "query", key }], dest: "/api/preview" })),
  { handle: "filesystem" },
];

/** Vite's `?raw` imports, such as the built index.html: the file's text. */
const raw = {
  name: "raw",
  load: async (id) =>
    id.endsWith("?raw") ? { code: await readFile(id.slice(0, -4), "utf8"), moduleType: "text" } : null,
};

for (const file of (await readdir("api")).filter((f) => f.endsWith(".ts"))) {
  const name = file.slice(0, -3);
  const dir = join(out, "functions", "api", `${name}.func`);
  await mkdir(dir, { recursive: true });
  const bundle = await rolldown({
    input: join("api", file),
    platform: "node",
    logLevel: "warn",
    plugins: [raw],
  });
  await bundle.write({ file: join(dir, "index.mjs"), format: "esm", codeSplitting: false });
  await writeFile(
    join(dir, ".vc-config.json"),
    JSON.stringify({
      runtime: "nodejs24.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: true,
      maxDuration: MAX_DURATION_S[name] ?? 30,
      regions: REGIONS,
    }),
  );
  console.log(`api/${name}`);
}
await writeFile(join(out, "config.json"), JSON.stringify({ version: 3, routes: ROUTES }));
