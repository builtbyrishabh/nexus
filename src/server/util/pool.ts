/**
 * Bounded-concurrency map: run `fn` over every item with at most `limit` in flight, preserving
 * input order in the output. The shape recurs across Nexus — contextualizing a video is N
 * independent model calls, ingesting a channel is N independent video ingests — so the pattern
 * lives here once rather than being re-derived per caller.
 *
 * `limit` is the one contract that must hold: a caller passing `0`, a negative, or `NaN` (an
 * unvalidated `--concurrency`, say) would otherwise spawn zero workers and return an array of
 * `undefined` holes without ever calling `fn`. We clamp it to at least one worker (never more
 * than there is work to do) so the pool always makes progress.
 *
 * On failure we fail fast: as soon as one call throws, no worker starts a new item. `Promise.all`
 * already rejects on the first rejection, but its workers would otherwise keep draining the queue
 * in the background — and for network/model work (a rate-limited channel ingest, a doomed
 * contextualize) that continued spend is exactly what we don't want after the result is lost.
 */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let cursor = 0;
  let failed = false;
  const worker = async () => {
    while (!failed) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}
