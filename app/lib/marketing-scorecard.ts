import { CALL_STAGE_PENDING_LABELS, countCallStagePending } from "./call-stage";

const sheetCsvUrl =
  "https://docs.google.com/spreadsheets/d/1OwqUo_S66hv8wG259ioXvc9DpSnVDGwLLeWM_pwtIos/export?format=csv&gid=0";

export type ScorecardRange = {
  from: string;
  to: string;
  spend: number | null;
  totalLeads: number;
  agentFitLeads: number;
  agentFitCpa: number | null;
  callActivity: number;
  callCpa: number | null;
  salesQualified: number;
  callStagePending: number;
  bookedMeetings: number;
  noShows: number;
  notQualified: number;
  rescheduled: number;
  cancelled: number;
  blanks: number;
  sqlRate: number | null;
  projectedSqls: number;
  projectedQualifiedCpa: number | null;
};

export type MarketingScorecard = {
  today: string;
  daily: ScorecardRange;
  previousDaily: ScorecardRange;
  rolling: ScorecardRange;
  previousRolling: ScorecardRange;
};

type ParsedSheet = string[][];

export async function getMarketingScorecard(): Promise<MarketingScorecard> {
  const today = sgtDateString(new Date());
  const yesterday = addDays(today, -1);
  const twoDaysAgo = addDays(today, -2);
  const current7Start = addDays(today, -6);
  const previous7Start = addDays(today, -13);
  const previous7End = addDays(today, -7);

  const [csv, cookie] = await Promise.all([
    fetch(sheetCsvUrl, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(`CSV export failed: ${response.status}`);
      return response.text();
    }),
    login(),
  ]);
  const parsedSheet = parseCsv(csv);

  const [daily, previousDaily, rolling, previousRolling] = await Promise.all([
    buildRange({ from: today, to: today, parsedSheet, cookie }),
    buildRange({ from: yesterday, to: yesterday, parsedSheet, cookie }),
    buildRange({ from: current7Start, to: today, parsedSheet, cookie }),
    buildRange({ from: previous7Start, to: previous7End, parsedSheet, cookie }),
  ]);

  return {
    today,
    daily,
    previousDaily,
    rolling,
    previousRolling,
  };
}

async function buildRange({
  from,
  to,
  parsedSheet,
  cookie,
}: {
  from: string;
  to: string;
  parsedSheet: ParsedSheet;
  cookie: string;
}): Promise<ScorecardRange> {
  const sheet = summarizeSheetRange({ parsedSheet, from, to });
  const dashboard = await summarizeDashboardRange({ from, to, cookie });
  const spend = dashboard.dashboardSpend ?? dashboard.campaignSpendTotal;
  const agentFitCpa = cost(spend, sheet.agentFitLeads);
  const callActivity = countStages(sheet.allByStage, [
    "Sales Qualified",
    "Not Qualified",
    ...CALL_STAGE_PENDING_LABELS,
    "No Show",
    "Rescheduled",
    "Booked a Meeting",
    "Cancelled",
  ]);
  const callCpa = cost(spend, callActivity);
  const salesQualified = sheet.allByStage["Sales Qualified"] || 0;
  const callStagePending = countCallStagePending(sheet.allByStage);
  const bookedMeetings = sheet.allByStage["Booked a Meeting"] || 0;
  const noShows = sheet.allByStage["No Show"] || 0;
  const notQualified = sheet.allByStage["Not Qualified"] || 0;
  const rescheduled = sheet.allByStage.Rescheduled || 0;
  const cancelled = sheet.allByStage.Cancelled || 0;
  const decidedCallBase = salesQualified + notQualified + noShows + rescheduled + cancelled;
  const sqlRate = decidedCallBase > 0 ? salesQualified / decidedCallBase : null;
  const projectedSqls = sqlRate === null ? salesQualified : Math.round(salesQualified + bookedMeetings * sqlRate);
  const projectedQualifiedCpa = cost(spend, projectedSqls);

  return {
    from,
    to,
    spend,
    totalLeads: sheet.totalLeads,
    agentFitLeads: sheet.agentFitLeads,
    agentFitCpa,
    callActivity,
    callCpa,
    salesQualified,
    callStagePending,
    bookedMeetings,
    noShows,
    notQualified,
    rescheduled,
    cancelled,
    blanks: sheet.allByStage.Blank || sheet.allByStage[" "] || 0,
    sqlRate,
    projectedSqls,
    projectedQualifiedCpa,
  };
}

async function login() {
  const baseUrl = process.env.DASHBOARD_BASE_URL || "https://analyst-dashboard-roan.vercel.app";
  const password = process.env.DASHBOARD_PASSWORD;

  if (!password) {
    throw new Error("DASHBOARD_PASSWORD is missing in Railway.");
  }

  const response = await fetch(new URL("/api/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new Error(body.reply || "Dashboard login failed.");
  return (response.headers.get("set-cookie") || "")
    .split(",")
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function summarizeDashboardRange({ from, to, cookie }: { from: string; to: string; cookie: string }) {
  const baseUrl = process.env.DASHBOARD_BASE_URL || "https://analyst-dashboard-roan.vercel.app";
  const url = new URL("/leads", baseUrl);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  const response = await fetch(url, { headers: { cookie }, cache: "no-store" });
  if (!response.ok) throw new Error(`Dashboard fetch failed: ${response.status}`);
  const html = await response.text();
  const campaigns: Record<string, { spend: number; leads: number; aiFit: number; sql: number }> = {};
  for (const ad of extractAdObjects(html)) {
    campaigns[ad.campaignName] ??= { spend: 0, leads: 0, aiFit: 0, sql: 0 };
    campaigns[ad.campaignName].spend += ad.spend || 0;
    campaigns[ad.campaignName].leads += ad.leads || 0;
    campaigns[ad.campaignName].aiFit += ad.mql || 0;
    campaigns[ad.campaignName].sql += ad.sql || 0;
  }
  return {
    dashboardSpend: parseOverallDashboard(html).dashboardSpend,
    campaignSpendTotal: Object.values(campaigns).reduce((sum, campaign) => sum + campaign.spend, 0),
    campaigns,
  };
}

function parseOverallDashboard(html: string) {
  const text = textOnly(html);
  const spendMatch = text.match(/Ad spend\s+\$([0-9,.]+)/i);
  return {
    dashboardSpend: number(spendMatch?.[1]),
  };
}

function textOnly(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function number(value: string | undefined) {
  if (value === undefined) return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function summarizeSheetRange({ parsedSheet, from, to }: { parsedSheet: ParsedSheet; from: string; to: string }) {
  const [headers, ...rawRows] = parsedSheet;
  const rows = rawRows.filter((row) => row.some(Boolean));
  const selected = rows.filter((row) => {
    const date = dateOnly(value(row, headers, "Date"));
    return date >= from && date <= to;
  });
  const allByStage: Record<string, number> = {};
  for (const row of selected) {
    const stage = value(row, headers, "STAGE") || "Blank";
    allByStage[stage] = (allByStage[stage] || 0) + 1;
  }
  const fit = selected.filter((row) => value(row, headers, "Agent Status") === "Fit");
  return {
    totalLeads: selected.length,
    allByStage,
    agentFitLeads: fit.length,
  };
}

function extractAdObjects(html: string) {
  const decoded = html.replaceAll('\\"', '"').replaceAll("\\u0026", "&");
  const regex = /\{"adId":"[^"]+","name":"[\s\S]*?","campaignId":"[^"]+","campaignName":"[\s\S]*?","market":"[\s\S]*?","leads":[0-9.]+,"mql":[0-9.]+,"sql":[0-9.]+,"spend":[0-9.]+,"costPerLead":[\s\S]*?,"costPerMql":[\s\S]*?,"costPerSql":[^}]+\}/g;
  const unique = new Map<string, { campaignName: string; spend?: number; leads?: number; mql?: number; sql?: number }>();
  for (const match of decoded.matchAll(regex)) {
    try {
      const ad = JSON.parse(match[0]) as {
        adId: string;
        campaignId: string;
        campaignName: string;
        spend?: number;
        leads?: number;
        mql?: number;
        sql?: number;
      };
      unique.set(`${ad.adId}:${ad.campaignId}:${ad.spend}:${ad.mql}:${ad.sql}`, ad);
    } catch {
      // Ignore malformed payload slices.
    }
  }
  return [...unique.values()];
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function value(row: string[], headers: string[], name: string) {
  const index = headers.indexOf(name);
  return index === -1 ? "" : row[index] || "";
}

function dateOnly(raw: string) {
  return String(raw || "").slice(0, 10);
}

function countStages(stages: Record<string, number>, names: string[]) {
  return names.reduce((sum, name) => sum + (stages[name] || 0), 0);
}

function cost(spend: number | null, count: number) {
  return spend && count ? spend / count : null;
}

function sgtDateString(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(dateString: string, days: number) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}
