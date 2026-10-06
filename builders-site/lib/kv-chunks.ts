import type { KV } from "./env";

/** Stay inside the Workers subrequest budget: per-source reads run 25 at a time, and at most 400 sources are served. */
export const KV_CHUNK = 25;
export const MAX_SOURCES = 400;
export const FACTS_KEY_PREFIX = "facts:";

/** Every KV key name under `prefix` (paginated). */
export async function listNames(kv: KV, prefix: string): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await kv.list({ prefix, cursor });
    for (const k of page.keys) names.push(k.name);
    if (page.list_complete || !page.cursor) return names;
    cursor = page.cursor;
  }
}

/** `fn` over `items`, KV_CHUNK at a time with Promise.all; results in input order. */
export async function mapChunks<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += KV_CHUNK) out.push(...(await Promise.all(items.slice(i, i + KV_CHUNK).map(fn))));
  return out;
}
