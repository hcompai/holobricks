export const SHARED = { "Cache-Control": "public, max-age=0, s-maxage=15, stale-while-revalidate=60" };

/** A request the API turns down, with the status and the message the caller sees. */
export class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A handler whose refusals become JSON errors, and whose failures are logged and hidden. */
export function route(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      return await handler(request);
    } catch (e) {
      if (e instanceof Refusal) return Response.json({ error: e.message }, { status: e.status });
      console.error(e);
      return Response.json({ error: "Something went wrong on our side." }, { status: 500 });
    }
  };
}

export async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Refusal(400, "The request body is not JSON.");
  }
}

export const bearer = (request: Request) => request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1] ?? null;
