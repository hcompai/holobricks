import { expect, test } from "@playwright/test";
import { gunzipSync, gzipSync } from "node:zlib";
import { find, save, stripPublicChats } from "../api/lib/store";
import { blobStore } from "./blobStore";
import { fixture } from "./fixtures";

const blob = blobStore();
test.beforeAll(() => blob.start());
test.afterAll(() => blob.stop());

test("stripping old public builds backs each one up, then leaves no chat, prompt or chat image public", async () => {
  const image = await save("tower", "images/1.png", Buffer.from("photo"), "image/png");
  const thumbnail = await save("tower", "thumbnail-1.webp", Buffer.from("cover"), "image/webp");
  const chat = [{ role: "user", text: "My private request", images: [image] }];
  const build = await save(
    "tower",
    "build.json.gz",
    gzipSync(JSON.stringify({ ...fixture(), messages: chat })),
    "application/gzip",
  );
  const entry = {
    id: "tower",
    name: "Tower",
    prompt: "My private request",
    author: "Ada",
    owner: "u-ada",
    build,
    thumbnail,
  };
  blob.objects.set("library/tower.json", Buffer.from(JSON.stringify(entry)));
  const backups = new Map<string, Buffer>();
  const keep = async (path: string, data: Buffer) => void backups.set(path, data);

  expect(await stripPublicChats(false, keep)).toEqual({ builds: 1, chats: 1, prompts: 1, images: 1 });
  expect(backups.size).toBe(0);
  expect(blob.objects.has("builds/tower/images/1.png")).toBe(true);

  expect(await stripPublicChats(true, keep)).toEqual({ builds: 1, chats: 1, prompts: 1, images: 1 });
  expect([...backups.keys()].sort()).toEqual(["tower/build.json.gz", "tower/entry.json", "tower/images/1.png"]);
  expect(JSON.parse(gunzipSync(backups.get("tower/build.json.gz")!).toString()).messages).toEqual(chat);
  expect(JSON.parse(backups.get("tower/entry.json")!.toString())).toEqual(entry);

  const stripped = JSON.parse(gunzipSync(blob.objects.get("builds/tower/build.json.gz")!).toString());
  expect(stripped.messages).toEqual([]);
  expect(stripped.revision).toBe(fixture().revision);
  expect(await find("tower")).toEqual({ id: "tower", name: "Tower", author: "Ada", owner: "u-ada", build, thumbnail });
  expect(blob.objects.has("builds/tower/images/1.png")).toBe(false);
  expect(blob.objects.has("builds/tower/thumbnail-1.webp")).toBe(true);
  expect(await stripPublicChats(true, keep)).toEqual({ builds: 0, chats: 0, prompts: 0, images: 0 });
});
