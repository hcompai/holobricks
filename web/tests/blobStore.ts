import { createServer } from "node:http";

/**
 * An isolated local transport for the real Blob SDK, as forks-api.spec.ts uses: objects in memory, no production
 * credentials or writes. Call `start()` in beforeAll and `stop()` in afterAll; `objects` holds what was written.
 */
export function blobStore() {
  const objects = new Map<string, Buffer>();
  let base = "";
  const metadata = (pathname: string) => ({
    pathname,
    url: `${base}/objects/${pathname}`,
    downloadUrl: `${base}/objects/${pathname}`,
    size: objects.get(pathname)?.length ?? 0,
    uploadedAt: new Date().toISOString(),
    contentType: pathname.endsWith(".gz") ? "application/gzip" : "application/json",
    etag: "etag",
  });
  const pathOf = (url: string) => url.replace(`${base}/objects/`, "").split("?")[0];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, base);
    const send = (data: unknown, status = 200) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(data));
    };
    const read = async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    };
    if (url.pathname.startsWith("/objects/")) {
      const data = objects.get(url.pathname.slice(9));
      response.writeHead(data ? 200 : 404);
      response.end(data);
    } else if (request.method === "PUT") {
      const pathname = url.searchParams.get("pathname")!;
      const body = await read();
      if (request.headers["x-allow-overwrite"] === "0" && objects.has(pathname))
        return send({ error: { code: "bad_request", message: "Blob already exists" } }, 400);
      objects.set(pathname, body);
      send(metadata(pathname));
    } else if (request.method === "POST" && url.pathname.endsWith("/delete")) {
      for (const u of JSON.parse((await read()).toString()).urls as string[]) objects.delete(pathOf(u));
      send({});
    } else if (url.searchParams.has("url")) {
      const pathname = pathOf(url.searchParams.get("url")!);
      send(
        objects.has(pathname) ? metadata(pathname) : { error: { code: "not_found" } },
        objects.has(pathname) ? 200 : 404,
      );
    } else {
      const prefix = url.searchParams.get("prefix") ?? "";
      send({ blobs: [...objects.keys()].filter((p) => p.startsWith(prefix)).map(metadata), hasMore: false });
    }
  });
  return {
    objects,
    get base() {
      return base;
    },
    async start() {
      process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_teststore_testsecret";
      process.env.VERCEL_BLOB_RETRIES = "0";
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      process.env.VERCEL_BLOB_API_URL = base;
    },
    async stop() {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
      delete process.env.VERCEL_BLOB_API_URL;
    },
  };
}
