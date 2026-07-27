import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDailyNewspaperReport } from "./daily-newspaper-report";

declare global {
  var salesBrainDailyNewspaperScheduler:
    | {
        startedAt: string;
        timer: NodeJS.Timeout;
      }
    | undefined;
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

export function ensureDailyNewspaperSchedulerStarted() {
  if (process.env.SALES_BRAIN_ENABLE_DAILY_NEWSPAPER === "false") {
    return { enabled: false, started: false };
  }

  if (globalThis.salesBrainDailyNewspaperScheduler) {
    return {
      enabled: true,
      started: true,
      startedAt: globalThis.salesBrainDailyNewspaperScheduler.startedAt,
      schedule: scheduleDescription(),
    };
  }

  const run = () => {
    maybeSendDailyNewspaper().catch((error) => {
      console.error("Sales Brain daily newspaper failed", error);
    });
  };

  const timer = setInterval(run, FIFTEEN_MINUTES);
  timer.unref?.();
  globalThis.salesBrainDailyNewspaperScheduler = {
    startedAt: new Date().toISOString(),
    timer,
  };

  setTimeout(run, 25_000).unref?.();

  return {
    enabled: true,
    started: true,
    startedAt: globalThis.salesBrainDailyNewspaperScheduler.startedAt,
    schedule: scheduleDescription(),
  };
}

async function maybeSendDailyNewspaper() {
  const now = singaporeNow();

  if (now.hour < reportHour()) return;

  const sent = await getLastSentKey();
  if (sent === now.date) return;

  await createDailyNewspaperReport({ sendToChat: true });
  await setLastSentKey(now.date);
}

async function getLastSentKey() {
  try {
    return (await readFile(statePath(), "utf8")).trim();
  } catch {
    return "";
  }
}

async function setLastSentKey(key: string) {
  await mkdir(stateDir(), { recursive: true });
  await writeFile(statePath(), key);
}

function reportHour() {
  const parsed = Number(process.env.SALES_BRAIN_DAILY_NEWSPAPER_HOUR || "21");
  return Number.isFinite(parsed) ? Math.max(0, Math.min(23, parsed)) : 21;
}

function singaporeNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
  };
}

function scheduleDescription() {
  return `daily at ${String(reportHour()).padStart(2, "0")}:00 Asia/Singapore`;
}

function stateDir() {
  return path.join(
    process.env.SALES_BRAIN_MEMORY_DIR || path.join(process.cwd(), ".sales-brain-memory"),
    "scheduled-reports",
  );
}

function statePath() {
  return path.join(stateDir(), "daily-newspaper-last-sent.txt");
}
