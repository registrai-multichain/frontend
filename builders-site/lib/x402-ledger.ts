/** One row per payment, unique per (scheme, payer, nonce): a signed payment is charged and served at most once. */
import type { D1Database } from "./env";

export type Scheme = "gateway" | "eip3009";
export type Reservation = { scheme: Scheme; payer: string; nonce: string; product: string; amount: number };

export async function reserve(db: D1Database, r: Reservation): Promise<"ok" | "duplicate"> {
  const res = await db.prepare("INSERT INTO x402_payments (scheme, payer, nonce, product, amount, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?) ON CONFLICT DO NOTHING RETURNING scheme")
    .bind(r.scheme, r.payer.toLowerCase(), r.nonce.toLowerCase(), r.product, r.amount, Math.floor(Date.now() / 1000)).all();
  return res.results.length ? "ok" : "duplicate";
}

export async function markSettled(db: D1Database, scheme: Scheme, payer: string, nonce: string, tx: string | null): Promise<void> {
  await db.prepare("UPDATE x402_payments SET status = 'settled', tx_hash = ? WHERE scheme = ? AND payer = ? AND nonce = ?").bind(tx, scheme, payer.toLowerCase(), nonce.toLowerCase()).run();
}

export async function markFailed(db: D1Database, scheme: Scheme, payer: string, nonce: string, status: "failed" | "unknown"): Promise<void> {
  await db.prepare("UPDATE x402_payments SET status = ? WHERE scheme = ? AND payer = ? AND nonce = ?").bind(status, scheme, payer.toLowerCase(), nonce.toLowerCase()).run();
}

export async function findPayment(db: D1Database, scheme: Scheme, payer: string, nonce: string): Promise<{ status: string; tx_hash: string | null } | null> {
  return (await db.prepare("SELECT status, tx_hash FROM x402_payments WHERE scheme = ? AND payer = ? AND nonce = ?").bind(scheme, payer.toLowerCase(), nonce.toLowerCase()).first<{ status: string; tx_hash: string | null }>()) ?? null;
}

/** Public, aggregate only: settled sales per UTC day and product. Never payer addresses. */
export async function salesStats(db: D1Database): Promise<{ day: string; product: string; sales: number; usdc: number }[]> {
  return (await db.prepare("SELECT date(created_at, 'unixepoch') AS day, product, COUNT(*) AS sales, SUM(amount) / 1e6 AS usdc FROM x402_payments WHERE status = 'settled' GROUP BY day, product ORDER BY day DESC, product")
    .all<{ day: string; product: string; sales: number; usdc: number }>()).results;
}
