import type { Transport } from "viem";

/**
 * Arc's public RPC limits eth_getLogs per IP, and the limit is tight (measured on
 * rpc.mainnet.arc.io, 2026-09-27): calls 0.25 s apart passed 40 of 40, calls 0.15 s
 * apart passed 3 of 40, a JSON-RPC batch of 8 getLogs passed 1, and the limit lifted
 * about 2 s after a 429. The dashboard's log scans (buyback, economy, common markets)
 * used to run at once and in parallel, tripping it on every load; the 429s then failed
 * the plain reads too and the page sat on "Reading Arc mainnet…".
 *
 * So every eth_getLogs in the page goes through one queue: one in flight at a time
 * (so a batching transport never puts two in one batch), starts at least `gapMs`
 * apart, and a rate-limited call waits `backoffMs` and is tried again, up to
 * `retries` times. Other methods pass straight through (batched eth_calls are fine).
 */
export const LOGS_PACING = { gapMs: 350, backoffMs: 2_500, retries: 4 } as const;

type Pacing = { gapMs: number; backoffMs: number; retries: number };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** True for a rate-limit refusal: HTTP 429, JSON-RPC -32005, or its message, anywhere in the cause chain. */
export function isRateLimit(e: unknown): boolean {
  for (let x = e as { status?: unknown; code?: unknown; message?: unknown; cause?: unknown } | undefined, i = 0; x && i < 8; x = x.cause as typeof x, i++) {
    if (x.status === 429 || x.code === -32005 || x.code === 429) return true;
    if (typeof x.message === "string" && /rate limit|too many requests|\b429\b/i.test(x.message)) return true;
  }
  return false;
}

/** A queue that runs one task at a time, starts `gapMs` apart, and retries rate-limited tasks. */
export function makeLogsQueue(p: Pacing = LOGS_PACING, clock: { now: () => number; sleep: (ms: number) => Promise<void> } = { now: Date.now, sleep }) {
  let tail: Promise<unknown> = Promise.resolve();
  let nextAt = 0;
  return function enqueue<T>(run: () => Promise<T>): Promise<T> {
    const job = tail.then(async () => {
      for (let attempt = 0; ; attempt++) {
        const wait = nextAt - clock.now();
        if (wait > 0) await clock.sleep(wait);
        nextAt = clock.now() + p.gapMs;
        try {
          return await run();
        } catch (e) {
          if (!isRateLimit(e) || attempt >= p.retries) throw e;
          nextAt = clock.now() + p.backoffMs;
        }
      }
    });
    tail = job.catch(() => undefined); // one failure must not stall the queue
    return job;
  };
}

// One queue for the whole page: every client (builders, perennial, rounds) shares the IP's limit.
const pageQueue = makeLogsQueue();

/** Wrap a transport so its eth_getLogs calls go through `queue`; the queue owns their retries. */
export function paceLogs(inner: Transport, queue: <T>(run: () => Promise<T>) => Promise<T> = pageQueue): Transport {
  return ((params: Parameters<Transport>[0]) => {
    const t = inner(params);
    const request = ((args: { method: string }, opts?: object) =>
      args.method === "eth_getLogs"
        ? queue(() => t.request(args as never, { ...opts, retryCount: 0 } as never))
        : t.request(args as never, opts as never)) as typeof t.request;
    return { ...t, request };
  }) as Transport;
}
