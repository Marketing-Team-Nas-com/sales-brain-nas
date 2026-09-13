import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { create12HourSalesPulse } from "./sales-pulse-12h-report";

declare global {
  var salesPulse12HourScheduler:
    | { startedAt: string; timer: NodeJS.Timeout }
    | undefined;
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

export function ensure12HourSalesPulseSchedulerStarted() {
  if (process.env.SALES_BRAIN_ENABLE_12H_PULSE === "false") {
    return { enabled: false, started: false };
  }
  if (globalThis.salesPulse12HourScheduler) {
    return {
      enabled: true,
      started: true,
      startedAt: globalThis.salesPulse12HourScheduler.startedAt,
      schedule: scheduleDescription(),
    };
  }
  const run = () => maybeSend12HourPulse().catch((error) => {
    console.error("Scheduled 12-hour Sales Pulse failed", safeError(error));
  });
  const timer = setInterval(run, FIFTEEN_MINUTES);
  timer.unref?.();
  globalThis.salesPulse12HourScheduler = {
    startedAt: new Date().toISOString(),
    timer,
  };
  setTimeout(run, 30_000).unref?.();
  return {
    enabled: true,
    started: true,
    startedAt: globalThis.salesPulse12HourScheduler.startedAt,
    schedule: scheduleDescription(),
  };
}

async function maybeSend12HourPulse() {
  const now = sgtNow();
  if (now.weekday === "sunday" || ![9, 21].includes(now.hour)) return;
  const key = `${now.date}:${now.hour}`;
  if (await lastSentKey() === key) return;
  await create12HourSalesPulse({ scheduledAt: `${now.date}T${String(now.hour).padStart(2, "0")}:00:00+08:00` });
  await setLastSentKey(key);
}

async function lastSentKey() {
  try { return (await readFile(statePath(), "utf8")).trim(); } catch { return ""; }
}

async function setLastSentKey(key: string) {
  await mkdir(path.dirname(statePath()), { recursive: true });
  await writeFile(statePath(), key);
}

function statePath() {
  const root = process.env.SALES_BRAIN_MEMORY_DIR || path.join(process.cwd(), ".sales-brain-memory");
  return path.join(root, "scheduled-reports", "12-hour-pulse-last-sent.txt");
}

function sgtNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Singapore", weekday: "long", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return {
    weekday: get("weekday").toLowerCase(),
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
  };
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown report error";
}

function scheduleDescription() {
  return "Monday-Saturday at 09:00 and 21:00 Asia/Singapore; Monday 09:00 includes the Sunday-off catch-up window";
}
