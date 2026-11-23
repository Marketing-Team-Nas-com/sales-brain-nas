import { getCrawlIntervalMinutes } from "./crawl-interval";
import { crawlSalesMemory, getConfiguredSalesBoardIds } from "./sales-memory";

declare global {
  var salesBrainMemoryScheduler:
    | {
        startedAt: string;
        intervalMinutes: number;
        timer: NodeJS.Timeout;
      }
    | undefined;
}

export function ensureSalesMemorySchedulerStarted() {
  if (process.env.SALES_BRAIN_ENABLE_SCHEDULER !== "true") {
    return { enabled: false, started: false };
  }

  if (globalThis.salesBrainMemoryScheduler) {
    return {
      enabled: true,
      started: true,
      startedAt: globalThis.salesBrainMemoryScheduler.startedAt,
      intervalMinutes: globalThis.salesBrainMemoryScheduler.intervalMinutes,
    };
  }

  const boardIds = getConfiguredSalesBoardIds();

  if (!boardIds.length) {
    return { enabled: true, started: false, error: "MONDAY_SALES_BOARD_IDS is missing." };
  }

  const run = () => {
    crawlSalesMemory(boardIds).catch((error) => {
      console.error("Sales Brain memory crawl failed", error);
    });
  };

  const intervalMinutes = getCrawlIntervalMinutes();
  const timer = setInterval(run, intervalMinutes * 60 * 1000);
  timer.unref?.();
  globalThis.salesBrainMemoryScheduler = {
    startedAt: new Date().toISOString(),
    intervalMinutes,
    timer,
  };

  setTimeout(run, 5_000).unref?.();

  return {
    enabled: true,
    started: true,
    startedAt: globalThis.salesBrainMemoryScheduler.startedAt,
    intervalMinutes,
  };
}
