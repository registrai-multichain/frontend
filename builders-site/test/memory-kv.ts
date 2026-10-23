import type { KV, KVListKey } from "../lib/env";

/** A tiny in-memory Workers KV for tests: TTLs against an injectable clock. */
export class MemoryKV implements KV {
  readonly store = new Map<string, { value: string; metadata?: unknown; expiresAt?: number }>();
  constructor(public now: () => number = () => Date.now()) {}

  private live(key: string) {
    const e = this.store.get(key);
    if (e?.expiresAt !== undefined && e.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return e;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }): Promise<void> {
    this.store.set(key, {
      value,
      metadata: options?.metadata,
      expiresAt: options?.expirationTtl ? this.now() + options.expirationTtl * 1000 : undefined,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list<M = unknown>(options?: { prefix?: string; cursor?: string; limit?: number }) {
    const names = [...this.store.keys()].filter((k) => k.startsWith(options?.prefix ?? "") && this.live(k)).sort();
    const start = options?.cursor ? Number(options.cursor) : 0;
    const limit = options?.limit ?? 1000;
    const page = names.slice(start, start + limit);
    const done = start + limit >= names.length;
    return {
      keys: page.map((name): KVListKey<M> => ({ name, metadata: this.store.get(name)!.metadata as M })),
      list_complete: done,
      cursor: done ? undefined : String(start + limit),
    };
  }
}
