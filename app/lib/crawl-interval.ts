export const DEFAULT_CRAWL_INTERVAL_MINUTES = 10;
const MIN_CRAWL_INTERVAL_MINUTES = 5;
const MAX_CRAWL_INTERVAL_MINUTES = 24 * 60;

// SALES_BRAIN_CRAWL_INTERVAL_MINUTES must be a whole number of minutes between
// 5 and 1440. Anything else (unset, blank, non-numeric, too small, too large)
// falls back to the default so a typo can never make the crawl hammer monday.
export function getCrawlIntervalMinutes(value = process.env.SALES_BRAIN_CRAWL_INTERVAL_MINUTES) {
  const trimmed = value?.trim();

  if (!trimmed) return DEFAULT_CRAWL_INTERVAL_MINUTES;

  if (!/^\d+$/.test(trimmed)) {
    console.warn(
      `Ignoring invalid SALES_BRAIN_CRAWL_INTERVAL_MINUTES; using ${DEFAULT_CRAWL_INTERVAL_MINUTES} minutes.`,
    );
    return DEFAULT_CRAWL_INTERVAL_MINUTES;
  }

  const minutes = Number(trimmed);

  if (minutes < MIN_CRAWL_INTERVAL_MINUTES || minutes > MAX_CRAWL_INTERVAL_MINUTES) {
    console.warn(
      `SALES_BRAIN_CRAWL_INTERVAL_MINUTES must be between ${MIN_CRAWL_INTERVAL_MINUTES} and ${MAX_CRAWL_INTERVAL_MINUTES}; using ${DEFAULT_CRAWL_INTERVAL_MINUTES} minutes.`,
    );
    return DEFAULT_CRAWL_INTERVAL_MINUTES;
  }

  return minutes;
}
