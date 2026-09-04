/**
 * Bounded-concurrency map: run `fn` over every item with at most `limit` in flight, preserving
 * input order in the output. The shape recurs across Nexus — contextualizing a video is N
 * independent model calls, ingesting a channel is N independent video ingests — so the pattern
 * lives here once rather than being re-derived per caller.
 */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
