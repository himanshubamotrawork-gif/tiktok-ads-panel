/** Default number of TikTok writes in flight at once during a bulk action. */
export const BULK_CONCURRENCY = 3;

export interface BulkItemResult<TItem, TResult> {
  item: TItem;
  ok: boolean;
  result?: TResult;
  error?: string;
}

/**
 * Runs `fn` over `items` with at most `limit` in flight. One item failing never stops
 * the others; every item gets its own result, in input order.
 */
export async function runBulk<TItem, TResult>(
  items: TItem[],
  limit: number,
  fn: (item: TItem) => Promise<TResult>,
  isOk: (result: TResult) => boolean = () => true,
): Promise<BulkItemResult<TItem, TResult>[]> {
  const results = new Array<BulkItemResult<TItem, TResult>>(items.length);
  let next = 0;

  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index] as TItem;
      try {
        const result = await fn(item);
        results[index] = { item, ok: isOk(result), result };
      } catch (err) {
        results[index] = { item, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
