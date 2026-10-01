/** A Map-backed stand-in for the Workers edge cache (caches.default), keyed by URL. */
export class MemoryCache {
  readonly store = new Map<string, Response>();
  async match(req: Request) {
    return this.store.get(req.url)?.clone();
  }
  async put(req: Request, res: Response) {
    this.store.set(req.url, res.clone());
  }
  async delete(req: Request) {
    return this.store.delete(req.url);
  }
}
