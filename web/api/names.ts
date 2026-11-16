import { holder } from "./lib/account";
import { body, Refusal, route } from "./lib/http";
import { readFork } from "./lib/forks";
import { MAX_NAME_CHARS, projectNames, saveProjectName, validName } from "./lib/names";
import { ownedSession } from "./lib/snapshot";
import { findOwn, ID, renamePublished } from "./lib/store";

const headers = { "Cache-Control": "private, no-store" };

export const GET = route(async (request) => {
  const { user } = holder(request);
  return Response.json(await projectNames(user.id), { headers });
});

export const PATCH = route(async (request) => {
  const { user, key } = holder(request);
  const given = await body<{ id?: unknown; source?: unknown; name?: unknown }>(request);
  if (typeof given.id !== "string" || !ID.test(given.id)) throw new Refusal(400, "Invalid project.");
  const name = validName(given.name);
  if (!name) throw new Refusal(400, `Use a name of 1–${MAX_NAME_CHARS} characters.`);
  if (given.source === "fork") {
    if (!(await readFork(user.id, given.id))) throw new Refusal(404, "No such project of yours.");
  } else if (given.source === "public") {
    const published = await findOwn(user.id, given.id);
    if (!published || published.owner !== user.id) throw new Refusal(404, "No such project of yours.");
  } else if (given.source === "session") {
    await ownedSession(given.id, key).catch((e) => {
      if (e instanceof Refusal && e.status === 403) throw new Refusal(403, "Only its owner can rename it.");
      throw e;
    });
  } else throw new Refusal(400, "This project cannot be renamed.");
  await renamePublished(user.id, given.id, name);
  return Response.json(await saveProjectName(user.id, given.id, name), { headers });
});
