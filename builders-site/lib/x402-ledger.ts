/** One row per payment, unique per (scheme, payer, nonce): a signed payment is charged and served at most once. */
import type { D1Database } from "./env";

export type Scheme = "gateway" | "eip3009";
export type Reservation = { scheme: Scheme; payer: string; nonce: string; product: string; amount: number };
export type PaymentRow = { status: string; tx_hash: string | null; product: string; created_at: number };
const nowS = () => Math.floor(Date.now() / 1000);

export async function reserve(db: D1Database, r: Reservation): Promise<"ok" | "duplicate"> {
  const res = await db.prepare("INSERT INTO x402_payments (scheme, payer, nonce, product, amount, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?) ON CONFLICT DO NOTHING RETURNING scheme")
    .bind(r.scheme, r.payer.toLowerCase(), r.nonce.toLowerCase(), r.product, r.amount, nowS()).all();
  return res.results.length ? "ok" : "duplicate";
}

/** The signed transaction's hash is stored BEFORE it is broadcast, so any later failure can be reconciled from the receipt. */
export async function markSubmitting(db: D1Database, scheme: Scheme, payer: string, nonce: string, tx: string): Promise<void> {
  await db.prepare("UPDATE x402_payments SET status = 'submitting', tx_hash = ? WHERE scheme = ? AND payer = ? AND nonce = ?").bind(tx, scheme, payer.toLowerCase(), nonce.toLowerCase()).run();
}

export async function markSettled(db: D1Database, scheme: Scheme, payer: string, nonce: string, tx: string | null): Promise<void> {
  await db.prepare("UPDATE x402_payments SET status = 'settled', tx_hash = COALESCE(?, tx_hash) WHERE scheme = ? AND payer = ? AND nonce = ?").bind(tx, scheme, payer.toLowerCase(), nonce.toLowerCase()).run();
}

/** Flip an unconfirmed payment to settled exactly once (concurrent retries: only one is served). */
export async function claimSettled(db: D1Database, scheme: Scheme, payer: string, nonce: string): Promise<boolean> {
  const r = await db.prepare("UPDATE x402_payments SET status = 'settled' WHERE scheme = ? AND payer = ? AND nonce = ? AND status IN ('unknown', 'submitting') RETURNING scheme")
    .bind(scheme, payer.toLowerCase(), nonce.toLowerCase()).all();
  return r.results.length > 0;
}

export async function markFailed(db: D1Database, scheme: Scheme, payer: string, nonce: string, status: "failed" | "unknown"): Promise<void> {
  await db.prepare("UPDATE x402_payments SET status = ? WHERE scheme = ? AND payer = ? AND nonce = ?").bind(status, scheme, payer.toLowerCase(), nonce.toLowerCase()).run();
}

export async function findPayment(db: D1Database, scheme: Scheme, payer: string, nonce: string): Promise<PaymentRow | null> {
  return (await db.prepare("SELECT status, tx_hash, product, created_at FROM x402_payments WHERE scheme = ? AND payer = ? AND nonce = ?").bind(scheme, payer.toLowerCase(), nonce.toLowerCase()).first<PaymentRow>()) ?? null;
}

/** Public, aggregate only: settled sales per UTC day and product. Never payer addresses. */
export async function salesStats(db: D1Database): Promise<{ day: string; product: string; sales: number; usdc: number }[]> {
  return (await db.prepare("SELECT date(created_at, 'unixepoch') AS day, product, COUNT(*) AS sales, SUM(amount) / 1e6 AS usdc FROM x402_payments WHERE status = 'settled' GROUP BY day, product ORDER BY day DESC, product")
    .all<{ day: string; product: string; sales: number; usdc: number }>()).results;
}

/** The gas wallet settles one payment at a time. Returns true when this holder got the lock (expires after ttlS). */
export async function acquireSettler(db: D1Database, holder: string, ttlS = 20): Promise<boolean> {
  const t = nowS();
  const r = await db.prepare("UPDATE x402_settler_lock SET holder = ?, until = ? WHERE id = 1 AND until < ? RETURNING id").bind(holder, t + ttlS, t).all();
  return r.results.length > 0;
}
export async function releaseSettler(db: D1Database, holder: string): Promise<void> {
  await db.prepare("UPDATE x402_settler_lock SET until = 0 WHERE id = 1 AND holder = ?").bind(holder).run();
}
