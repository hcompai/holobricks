// Bundle each function in api/ into a Vercel Build Output directory: node scripts/build-api.mjs .vercel/output
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rolldown } from "rolldown";
import { loadEnv } from "vite";

const out = process.argv[2];
if (!out) throw new Error("usage: node scripts/build-api.mjs <output directory>");
const MAX_DURATION_S = { builds: 300 };
const { VITE_PLATFORM = "" } = loadEnv("production", process.cwd(), "VITE_");

for (const file of (await readdir("api")).filter((f) => f.endsWith(".ts"))) {
  const name = file.slice(0, -3);
  const dir = join(out, "functions", "api", `${name}.func`);
  await mkdir(dir, { recursive: true });
  const bundle = await rolldown({
    input: join("api", file),
    platform: "node",
    logLevel: "warn",
    transform: { define: { "import.meta.env.VITE_PLATFORM": JSON.stringify(VITE_PLATFORM) } },
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
    }),
  );
  console.log(`api/${name}`);
}
