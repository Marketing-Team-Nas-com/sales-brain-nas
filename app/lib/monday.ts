const MONDAY_API_URL = "https://api.monday.com/v2";

export type SalesDeal = {
  id: string;
  boardId?: string;
  boardName?: string;
  createdAt: string;
  dateAdded: string;
  account: string;
  group?: string;
  owner: string;
  stage: string;
  qualification: string;
  initialOutreach: string;
  callStage: string;
  nextStepsStatus: string;
  finalVerdict: string;
  firstMeetingDate: string;
  latestMeetingDate: string;
  lastFollowUpDate: string;
  value: number;
  closeDate: string;
  health: "Green" | "Yellow" | "Red";
  nextStep: string;
  lastActivityDays: number;
  probability: number;
  budget: string;
  email: string;
  firstName: string;
  lastName: string;
  country: string;
  eventPlace: string;
  jobTitle: string;
  website: string;
  phone: string;
  lookingFor: string;
  agentNotes: string;
  status: string;
  followUp: string;
  salesCallNotes: string;
  source: string;
  mondayUrl: string;
};

type MondayRequest = {
  query: string;
  variables?: Record<string, unknown>;
};

// Transient server errors keep the original policy (3 attempts, 500ms then 1s).
// Rate-limit / complexity errors get more patience with exponential backoff,
// because the shared monday token can be exhausted by other services too.
const TRANSIENT_MAX_ATTEMPTS = 3;
const TRANSIENT_BASE_DELAY_MS = 500;
const RATE_LIMIT_MAX_ATTEMPTS = 4;
const RATE_LIMIT_BASE_DELAY_MS = 2_000;
const RATE_LIMIT_MAX_DELAY_MS = 30_000;

type MondayGraphQLError = {
  message: string;
  extensions?: {
    code?: string;
    retry_in_seconds?: number;
    status_code?: number;
  };
};

export type MondayErrorKind = "rate_limit" | "transient" | "fatal";

export function classifyMondayError({
  status,
  message = "",
  code = "",
}: {
  status?: number;
  message?: string;
  code?: string;
}): MondayErrorKind {
  const text = `${code} ${message}`;

  // A daily cap will not reset within any sensible backoff window.
  if (/daily_limit_exceeded|daily limit/i.test(text)) return "fatal";
  // A single query that is too expensive will fail the same way every time.
  if (/maxcomplexityexceeded|exceeds max complexity/i.test(text)) return "fatal";

  if (
    status === 429 ||
    /complexity|rate.?limit|too many requests|max.?concurrency|concurrency limit|minute limit/i.test(text)
  ) {
    return "rate_limit";
  }

  if (
    (status !== undefined && status >= 500) ||
    /internal server error|timeout|fetch failed|temporarily/i.test(text)
  ) {
    return "transient";
  }

  return "fatal";
}

// Seconds monday asks us to wait, from extensions.retry_in_seconds, the
// Retry-After header, or a "reset in N seconds" complexity message.
export function mondayRetryHintSeconds({
  retryInSeconds,
  retryAfterHeader,
  message = "",
}: {
  retryInSeconds?: number;
  retryAfterHeader?: string | null;
  message?: string;
}) {
  if (typeof retryInSeconds === "number" && Number.isFinite(retryInSeconds) && retryInSeconds > 0) {
    return retryInSeconds;
  }

  const header = Number(retryAfterHeader);
  if (retryAfterHeader && Number.isFinite(header) && header > 0) return header;

  const reset = message.match(/reset in (\d+(?:\.\d+)?) seconds?/i)?.[1];
  if (reset) return Number(reset);

  return undefined;
}

export function mondayRetryDelayMs({
  kind,
  attempt,
  hintSeconds,
  jitterMs = Math.floor(Math.random() * 250),
}: {
  kind: Exclude<MondayErrorKind, "fatal">;
  attempt: number;
  hintSeconds?: number;
  jitterMs?: number;
}) {
  if (kind === "transient") {
    return TRANSIENT_BASE_DELAY_MS * 2 ** (attempt - 1);
  }

  const backoff = RATE_LIMIT_BASE_DELAY_MS * 2 ** (attempt - 1);
  const hint = hintSeconds ? hintSeconds * 1000 : 0;
  return Math.min(RATE_LIMIT_MAX_DELAY_MS, Math.max(backoff, hint)) + jitterMs;
}

class MondayRequestError extends Error {
  readonly kind: MondayErrorKind;
  readonly hintSeconds?: number;

  constructor(message: string, kind: MondayErrorKind, hintSeconds?: number) {
    super(message);
    this.kind = kind;
    this.hintSeconds = hintSeconds;
  }
}

export async function mondayRequest<T>(
  { query, variables }: MondayRequest,
  { sleep: wait = sleep }: { sleep?: (ms: number) => Promise<unknown> } = {},
): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN;

  if (!token) {
    throw new Error("MONDAY_API_TOKEN is not configured.");
  }

  for (let attempt = 1; ; attempt += 1) {
    let error: MondayRequestError;

    try {
      return await sendMondayRequest<T>(token, { query, variables });
    } catch (caught) {
      error =
        caught instanceof MondayRequestError
          ? caught
          : new MondayRequestError(
              caught instanceof Error ? caught.message : "monday API request failed.",
              classifyMondayError({
                message: caught instanceof Error ? caught.message : "",
              }),
            );
    }

    const maxAttempts =
      error.kind === "rate_limit"
        ? RATE_LIMIT_MAX_ATTEMPTS
        : error.kind === "transient"
          ? TRANSIENT_MAX_ATTEMPTS
          : 1;

    if (error.kind === "fatal" || attempt >= maxAttempts) {
      throw new Error(error.message);
    }

    const delay = mondayRetryDelayMs({ kind: error.kind, attempt, hintSeconds: error.hintSeconds });
    if (error.kind === "rate_limit") {
      console.warn(
        `monday rate limit hit (attempt ${attempt}/${maxAttempts}); retrying in ${Math.round(delay / 1000)}s: ${error.message}`,
      );
    }
    await wait(delay);
  }
}

async function sendMondayRequest<T>(token: string, { query, variables }: MondayRequest) {
  const response = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      "API-Version": "2026-04",
    },
    body: JSON.stringify({ query, variables }),
  });

  const raw = await response.text();
  let payload: {
    data?: T;
    errors?: MondayGraphQLError[];
    error_message?: string;
    error_code?: string;
  } = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {}

  if (!response.ok || payload.errors?.length || payload.error_message) {
    const firstError = payload.errors?.[0];
    const message =
      firstError?.message ||
      payload.error_message ||
      (response.ok ? "monday API request failed." : `monday API request failed (HTTP ${response.status}).`);
    const code = firstError?.extensions?.code || payload.error_code || "";

    throw new MondayRequestError(
      message,
      classifyMondayError({ status: response.status, message, code }),
      mondayRetryHintSeconds({
        retryInSeconds: firstError?.extensions?.retry_in_seconds,
        retryAfterHeader: response.headers.get("retry-after"),
        message,
      }),
    );
  }

  if (!payload.data) {
    throw new MondayRequestError("monday API returned no data.", "fatal");
  }

  return payload.data;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getBoardSnapshot(boardId: string) {
  const data = await mondayRequest<{
    boards: Array<{
      id: string;
      name: string;
      columns: Array<{ id: string; title: string; type: string; settings_str?: string }>;
      calculatedColumns: Array<{ id: string; title: string; type: string; settings_str?: string }>;
      items_page: {
        cursor?: string;
        items: MondayItem[];
      };
    }>;
  }>({
    query: `
      query SalesBoard($boardId: ID!) {
        boards(ids: [$boardId]) {
          id
          name
          columns {
            id
            title
            type
            settings_str
          }
          calculatedColumns: columns(capabilities: [CALCULATED]) {
            id
            title
            type
            settings_str
          }
          items_page(limit: 500) {
            cursor
            items {
              id
              name
              created_at
              group { id title }
              column_values(capabilities: [CALCULATED]) {
                id
                text
                value
                type
                ... on BatteryValue {
                  battery_value {
                    key
                    count
                  }
                }
              }
            }
          }
        }
      }
    `,
    variables: { boardId },
  });

  const board = data.boards[0];

  if (board?.items_page.cursor) {
    let cursor = board.items_page.cursor;

    while (cursor) {
      const page = await getNextItemsPage(cursor);
      board.items_page.items = board.items_page.items.concat(page.items);
      cursor = page.cursor;
    }
  }

  if (board) {
    board.columns = mergeColumns(board.columns, board.calculatedColumns);
  }

  return {
    board,
    deals: board ? normalizeDeals(board) : [],
  };
}

async function getNextItemsPage(cursor: string) {
  const data = await mondayRequest<{
    next_items_page: {
      cursor?: string;
      items: MondayItem[];
    };
  }>({
    query: `
      query NextSalesBoardItems($cursor: String!) {
        next_items_page(cursor: $cursor, limit: 500) {
          cursor
          items {
            id
            name
            created_at
            group { id title }
              column_values(capabilities: [CALCULATED]) {
                id
                text
                value
                type
                ... on BatteryValue {
                  battery_value {
                    key
                    count
                  }
                }
              }
          }
        }
      }
    `,
    variables: { cursor },
  });

  return data.next_items_page;
}

function mergeColumns(
  columns: Array<{ id: string; title: string; type: string; settings_str?: string }>,
  calculatedColumns: Array<{ id: string; title: string; type: string; settings_str?: string }>,
) {
  return [...columns, ...calculatedColumns].filter(
    (column, index, allColumns) =>
      allColumns.findIndex((candidate) => candidate.id === column.id) === index,
  );
}

type MondayItem = {
  id: string;
  name: string;
  created_at?: string;
  group?: { id: string; title: string };
  column_values: Array<{
    id: string;
    text?: string | null;
    value?: string | null;
    type: string;
    battery_value?: Array<{ key: string; count: number }> | null;
  }>;
};

const columns = {
  owner: "multiple_person_mm546gv2",
  source: "color_mm4p2xwk",
  qualification: "color_mm4jxst5",
  outreach: "color_mm4jtmcv",
  callStage: "color_mm4j8pct",
  nextStepsStatus: "color_mm524pr",
  finalVerdict: "color_mm594jh8",
  probability: "color_mm52bm3k",
  firstMeeting: "date_mm4trd3h",
  latestMeeting: "date_mm58yark",
  lastFollowUpDate: "date_mm59agw5",
  firstName: "text_mm4jed5h",
  lastName: "text_mm4j6g5p",
  email: "email_mm4jfc4f",
  jobTitle: "text_mm4jzwhg",
  country: "text_mm4jqhbd",
  budget: "text_mm4jzveb",
  lookingFor: "long_text_mm4j7ftq",
  notes: "long_text_mm4jt916",
  status: "text_mm52m79k",
  followUp: "text_mm52trjk",
  salesCallNotes: "text_mm57vcg1",
  added: "date_mm4tf2tz",
};

function normalizeDeals(board: {
  id: string;
  name?: string;
  columns: Array<{ id: string; title: string; type: string; settings_str?: string }>;
  items_page: { items: MondayItem[] };
}) {
  const columnLabels = new Map(
    board.columns.map((column) => [column.id, parseStatusLabels(column.settings_str)]),
  );
  const columnIdsByTitle = new Map(
    board.columns.map((column) => [normalizeColumnTitle(column.title), column.id]),
  );

  return board.items_page.items.map((item) => {
    const valueFor = (columnId: string) => {
      const column = item.column_values.find((value) => value.id === columnId);
      if (!column) return "";

      const text = column.text?.trim();
      if (text) return text;

      const labels = columnLabels.get(columnId) || {};
      if (column.battery_value?.length) {
        return column.battery_value
          .map((value) => labels[String(value.key)] || value.key)
          .filter(Boolean)
          .join(", ");
      }

      if (column.value) {
        try {
          const parsed = JSON.parse(column.value) as {
            date?: string;
            index?: string | number;
            text?: string;
            url?: string;
          };
          if (parsed.date) return parsed.date;
          if (parsed.text) return parsed.text;
          if (parsed.url) return parsed.url;
          if (parsed.index !== undefined) return labels[String(parsed.index)] || "";
        } catch {}
      }

      return "";
    };
    const valueForTitle = (...titles: string[]) =>
      firstPresent(titles.map((title) => valueFor(columnIdsByTitle.get(normalizeColumnTitle(title)) || ""))) ||
      "";

    const notes = valueFor(columns.notes);
    const inferredVerdict = verdictFromNotes(notes);
    const qualification =
      firstPresent([
        valueFor(columns.qualification),
        valueForTitle("Nas.com Qualified", "Qualification"),
      ]) || "";
    const initialOutreach =
      firstPresent([
        valueFor(columns.outreach),
        valueForTitle("Initial Outreach", "How Heard", "Source"),
      ]) || "";
    const callStage =
      firstPresent([
        valueFor(columns.callStage),
        valueForTitle("Call Stage", "After Dinner Status", "Attendance"),
      ]) || "";
    const nextStepsStatus =
      firstPresent([valueFor(columns.nextStepsStatus), valueForTitle("Next Steps")]) || "";
    const finalVerdict =
      firstPresent([valueFor(columns.finalVerdict), valueForTitle("Final Verdict")]) || "";
    const firstMeetingDate =
      firstPresent([valueFor(columns.firstMeeting), valueForTitle("1st Meeting Date", "Event Date")]) ||
      "";
    const latestMeetingDate =
      firstPresent([valueFor(columns.latestMeeting), valueForTitle("Latest Meeting Date")]) || "";
    const lastFollowUpDate =
      firstPresent([valueFor(columns.lastFollowUpDate), valueForTitle("Last follow up")]) || "";
    const dateAdded =
      firstPresent([valueFor(columns.added), valueForTitle("Date Added")]) ||
      item.created_at?.slice(0, 10) ||
      "";
    const owner =
      firstPresent([valueFor(columns.owner), valueForTitle("Assigned To", "Owner")]) || "Unassigned";
    const eventPlace = valueForTitle("Event Place", "Dinner Place", "Dinner Location") || "";
    const firstName = firstPresent([valueFor(columns.firstName), valueForTitle("First Name")]) || "";
    const lastName = firstPresent([valueFor(columns.lastName), valueForTitle("Last Name")]) || "";
    const website = firstPresent([valueFor(columns.website), valueForTitle("Website")]) || "";
    const phone = firstPresent([valueFor(columns.phone), valueForTitle("Phone")]) || "";
    const lookingFor =
      firstPresent([valueFor(columns.lookingFor), valueForTitle("AI Concern", "Looking For")]) || "";
    const cmoNotes = valueForTitle("Lead Notes / Intel");
    const status = firstPresent([valueFor(columns.status), valueForTitle("Status")]) || "";
    const followUp = firstPresent([valueFor(columns.followUp), valueForTitle("Hand Off")]) || "";
    const salesCallNotes =
      firstPresent([valueFor(columns.salesCallNotes), cmoNotes, valueForTitle("Sales Call Notes")]) ||
      "";
    const stage =
      firstPresent([
        finalVerdict,
        inferredVerdict,
        nextStepsStatus,
        callStage,
        initialOutreach,
        qualification,
        valueFor(columns.source),
        item.group?.title,
      ]) || "Unstaged";

    const lastActivityDate =
      firstPresent([
        lastFollowUpDate,
        latestMeetingDate,
        firstMeetingDate,
        dateAdded,
      ]) || "";

    const budget = firstPresent([valueFor(columns.budget), valueForTitle("Budget")]) || "";
    const probability = probabilityFrom({
      probability: firstPresent([
        valueFor(columns.probability),
        valueForTitle("Probability of Closing"),
      ]) || "",
      finalVerdict,
      qualification,
      budget,
      notes: firstPresent([notes, cmoNotes]) || "",
    });
    const lastActivityDays = daysSince(lastActivityDate);

    return {
      id: item.id,
      boardId: board.id,
      boardName: board.name,
      createdAt: item.created_at || "",
      dateAdded,
      account: item.name,
      group: item.group?.title || "Unknown",
      owner,
      stage,
      qualification,
      initialOutreach,
      callStage,
      nextStepsStatus,
      finalVerdict,
      firstMeetingDate,
      latestMeetingDate,
      lastFollowUpDate,
      value: estimatedBudgetValue(budget),
      closeDate:
        firstPresent([
          latestMeetingDate,
          firstMeetingDate,
          dateAdded,
        ]) || "No date",
      health: healthFor({
        finalVerdict: finalVerdict || inferredVerdict,
        qualification,
        lastActivityDays,
        probability,
      }),
      nextStep:
        firstPresent([
          valueFor(columns.followUp),
          valueFor(columns.nextStepsStatus),
          firstSentence(valueFor(columns.lookingFor)),
          firstSentence(notes),
        ]) || "Add next step",
      lastActivityDays,
      probability,
      budget: budget || "Unknown",
      email: firstPresent([valueFor(columns.email), valueForTitle("Email", "E-mail", "Contact Email")]) || "",
      firstName,
      lastName,
      country: firstPresent([valueFor(columns.country), countryFromEventPlace(eventPlace)]) || "",
      eventPlace,
      jobTitle: firstPresent([valueFor(columns.jobTitle), valueForTitle("Job Title", "Title")]) || "",
      website,
      phone,
      lookingFor,
      agentNotes: firstPresent([notes, cmoNotes]) || "",
      status,
      followUp,
      salesCallNotes,
      source:
        firstPresent([
          valueFor(columns.source),
          valueForTitle("Inbound / Outbound", "Source"),
          item.group?.title,
        ]) || "Unknown",
      mondayUrl: `https://nas-io.monday.com/boards/${board.id}/pulses/${item.id}`,
    } satisfies SalesDeal;
  });
}

function parseStatusLabels(settings?: string) {
  try {
    return (JSON.parse(settings || "{}").labels || {}) as Record<string, string>;
  } catch {
    return {};
  }
}

function normalizeColumnTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function firstPresent(values: Array<string | undefined | null>) {
  return values.find((value) => value && value.trim())?.trim();
}

function firstSentence(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.split(/(?<=[.!?])\s+/)[0]?.slice(0, 160) ?? "";
}

function verdictFromNotes(notes: string) {
  const text = notes.trim().toLowerCase();

  if (text.startsWith("not fit") || text.includes("\nnot fit")) return "Not Fit";
  if (text.startsWith("fit") || text.includes("\nfit")) return "Fit";
  if (text.startsWith("review") || text.includes("\nreview")) return "Review";

  return "";
}

function countryFromEventPlace(eventPlace: string) {
  const normalized = eventPlace.toLowerCase();

  if (normalized.includes("singapore")) return "Singapore";
  if (normalized.includes("tel aviv")) return "Israel";
  if (normalized.includes("miami")) return "United States";

  return "";
}

function estimatedBudgetValue(budget: string) {
  const normalized = budget.toLowerCase();

  if (!normalized) return 0;
  if (normalized.includes("less than") || normalized.includes("<")) return 5000;
  const amounts = [...normalized.matchAll(/(\d+(?:[.,]\d+)?)\s*(k|m|mm|million)?\b/g)].map(
    (match) => {
      const amount = Number(match[1].replace(",", "."));
      const unit = match[2] || "k";

      if (unit === "m" || unit === "mm" || unit === "million") {
        return amount * 1_000_000;
      }

      return amount * 1_000;
    },
  );

  if (amounts.length >= 2) {
    return Math.round((amounts[0] + amounts[1]) / 2);
  }

  if (amounts.length === 1) {
    return Math.round(amounts[0]);
  }

  return 0;
}

function probabilityFrom({
  probability,
  finalVerdict,
  qualification,
  budget,
  notes,
}: {
  probability: string;
  finalVerdict: string;
  qualification: string;
  budget: string;
  notes: string;
}) {
  const explicit = probability.match(/\d+/)?.[0];
  if (explicit) return Number(explicit);

  const text = `${finalVerdict} ${qualification} ${notes}`.toLowerCase();
  let score = 35;

  if (text.includes("not fit")) score = 8;
  else if (text.includes("fit")) score = 68;
  else if (text.includes("review")) score = 42;
  else if (text.includes("qualified")) score = 55;

  if (budget.includes("100") || budget.includes("300")) score += 8;
  if (budget.toLowerCase().includes("less than")) score -= 18;

  return Math.max(1, Math.min(95, score));
}

function daysSince(dateValue: string) {
  if (!dateValue) return -1;

  const parsed = Date.parse(dateValue);
  if (Number.isNaN(parsed)) return -1;

  const diff = Date.now() - parsed;
  return Math.max(0, Math.floor(diff / 86_400_000));
}

function healthFor({
  finalVerdict,
  qualification,
  lastActivityDays,
  probability,
}: {
  finalVerdict: string;
  qualification: string;
  lastActivityDays: number;
  probability: number;
}) {
  const text = `${finalVerdict} ${qualification}`.toLowerCase();

  if (text.includes("not fit") || probability < 20 || lastActivityDays >= 21) {
    return "Red";
  }

  if (text.includes("review") || probability < 50 || lastActivityDays >= 7) {
    return "Yellow";
  }

  return "Green";
}

export async function changeDealColumns({
  boardId,
  itemId,
  columnValues,
}: {
  boardId: string;
  itemId: string;
  columnValues: Record<string, unknown>;
}) {
  return mondayRequest({
    query: `
      mutation ChangeDeal($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
        change_multiple_column_values(
          board_id: $boardId,
          item_id: $itemId,
          column_values: $columnValues
        ) {
          id
        }
      }
    `,
    variables: {
      boardId,
      itemId,
      columnValues: JSON.stringify(columnValues),
    },
  });
}

export async function getBoardColumnIdByTitle(boardId: string, title: string) {
  const data = await mondayRequest<{
    boards: Array<{
      columns: Array<{ id: string; title: string }>;
    }>;
  }>({
    query: `
      query BoardColumns($boardId: ID!) {
        boards(ids: [$boardId]) {
          columns {
            id
            title
          }
        }
      }
    `,
    variables: { boardId },
  });

  const normalizedTitle = normalizeColumnTitle(title);
  return (
    data.boards[0]?.columns.find((column) => normalizeColumnTitle(column.title) === normalizedTitle)
      ?.id || ""
  );
}

export async function createDealUpdate({
  itemId,
  body,
}: {
  itemId: string;
  body: string;
}) {
  return mondayRequest({
    query: `
      mutation CreateDealUpdate($itemId: ID!, $body: String!) {
        create_update(item_id: $itemId, body: $body) {
          id
        }
      }
    `,
    variables: { itemId, body },
  });
}
