/**
 * Transaction notes ("✓ Bought 33.3 Yes for $10.00 · view receipt"): a tiny
 * module store the paper frames render bottom-right. Successes fade after
 * OK_TTL_MS; errors stay until dismissed. Pure reducer + subscribe, no React.
 */
export type ToastKind = "ok" | "error" | "info";
export interface Toast { id: number; kind: ToastKind; text: string; href?: string; at: number }
export interface ToastState { next: number; list: Toast[] }
export type ToastAction =
  | { type: "push"; toast: { kind: ToastKind; text: string; href?: string }; now: number }
  | { type: "dismiss"; id: number }
  | { type: "expire"; now: number };

export const EMPTY_TOASTS: ToastState = { next: 1, list: [] };
export const OK_TTL_MS = 6000;
export const MAX_TOASTS = 3;

export function toastReducer(s: ToastState, a: ToastAction): ToastState {
  if (a.type === "push") {
    const list = [...s.list, { ...a.toast, id: s.next, at: a.now }].slice(-MAX_TOASTS);
    return { next: s.next + 1, list };
  }
  if (a.type === "dismiss") return { ...s, list: s.list.filter((t) => t.id !== a.id) };
  const list = s.list.filter((t) => t.kind === "error" || a.now - t.at < OK_TTL_MS);
  return list.length === s.list.length ? s : { ...s, list };
}

let state: ToastState = EMPTY_TOASTS;
const subs = new Set<() => void>();
function dispatch(a: ToastAction) {
  const next = toastReducer(state, a);
  if (next === state) return;
  state = next;
  subs.forEach((fn) => fn());
}

export const getToasts = () => state;
export function subscribeToasts(fn: () => void): () => void {
  subs.add(fn);
  return () => void subs.delete(fn);
}
export const pushToast = (toast: { kind: ToastKind; text: string; href?: string }) => dispatch({ type: "push", toast, now: Date.now() });
export const dismissToast = (id: number) => dispatch({ type: "dismiss", id });
export const expireToasts = (now = Date.now()) => dispatch({ type: "expire", now });
