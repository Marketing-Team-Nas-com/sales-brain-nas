export type MondayItemUpdate = {
  id: string;
  body: string;
  created_at: string;
  creator?: {
    id: string;
    name: string;
  } | null;
};

export type QuestionnaireField =
  | "decisionMaker"
  | "revenueAtLeast5m"
  | "marketingSpendAtLeast500k"
  | "interestedInNextStage"
  | "worthPursuing";

export type SalesPulseQuestionnaire = Record<QuestionnaireField, boolean | null>;

export type SalesPulseUpdateClassification =
  | "structured_questionnaire"
  | "salesperson_note"
  | "unrelated_or_system_comment";

export type ParsedSalesPulseUpdate = {
  classification: SalesPulseUpdateClassification;
  updateId: string;
  authorId: string;
  authorName: string;
  timestamp: string;
  body: string;
  googleDocsUrl: string;
  googleDocsDocumentId: string;
  questionnaire: SalesPulseQuestionnaire;
  conflicts: QuestionnaireField[];
  verdict: string;
  notes: string;
};

const QUESTIONS: Array<{
  field: QuestionnaireField;
  pattern: RegExp;
}> = [
  {
    field: "decisionMaker",
    pattern: /am\s+i\s+talking\s+to\s+the\s+key\s+decision[-\s]?maker\s*\??/i,
  },
  {
    field: "revenueAtLeast5m",
    pattern: /is\s+the\s+person\s*\/?\s*company\s+at\s+least\s+\$?\s*5\s*m\s+in\s+revenue\s*\??/i,
  },
  {
    field: "marketingSpendAtLeast500k",
    pattern: /are\s+they\s+spending\s+at\s+least\s+\$?\s*500\s*k\s+in\s+marketing\s*\??/i,
  },
  {
    field: "interestedInNextStage",
    pattern: /are\s+they\s+interested\s+in\s+continuing\s+to\s+the\s+next\s+stage\s*\??/i,
  },
  {
    field: "worthPursuing",
    pattern: /does\s+the\s+salesperson\s+think\s+they\s+are\s+worth\s+pursuing\s*\??/i,
  },
];

const EMPTY_QUESTIONNAIRE: SalesPulseQuestionnaire = {
  decisionMaker: null,
  revenueAtLeast5m: null,
  marketingSpendAtLeast500k: null,
  interestedInNextStage: null,
  worthPursuing: null,
};

export function parseSalesPulseUpdate(
  update: MondayItemUpdate,
): ParsedSalesPulseUpdate {
  const text = plainText(update.body);
  const fields = parseFields(text);
  const sections = questionnaireSections(text);
  const questionnaire = { ...EMPTY_QUESTIONNAIRE };
  const conflicts: QuestionnaireField[] = [];

  for (const { field, answer } of sections) {
    const interpreted = interpretAnswer(answer);
    questionnaire[field] = interpreted.value;
    if (interpreted.conflict) conflicts.push(field);
  }

  const googleDocsUrl = findGoogleDocsUrl(text);
  const notes = fieldValue(fields, [
    "salesperson note",
    "salesperson notes",
    "notes",
    "call notes",
    "post-call notes",
  ]);

  return {
    classification: classifyUpdate({
      hasQuestionnaire: sections.length > 0,
      notes,
      text,
      authorName: update.creator?.name || "",
    }),
    updateId: update.id,
    authorId: update.creator?.id || "",
    authorName: update.creator?.name || "",
    timestamp: update.created_at,
    body: update.body,
    googleDocsUrl,
    googleDocsDocumentId: googleDocsDocumentId(googleDocsUrl),
    questionnaire,
    conflicts,
    verdict: fieldValue(fields, ["verdict", "final verdict"]),
    notes,
  };
}

export function preserveAndParseMondayUpdates(updates: MondayItemUpdate[] = []) {
  const mondayUpdates = updates.map((update) => ({
    ...update,
    creator: update.creator ? { ...update.creator } : update.creator,
  }));

  return {
    mondayUpdates,
    salesPulseUpdates: mondayUpdates.map(parseSalesPulseUpdate),
  };
}

function questionnaireSections(text: string) {
  const matches = QUESTIONS.map((question) => {
    const match = question.pattern.exec(text);
    return {
      ...question,
      index: match?.index ?? -1,
      length: match?.[0].length ?? 0,
    };
  })
    .filter(({ index }) => index >= 0)
    .sort((left, right) => left.index - right.index);

  const matchesWithPrefixes = matches.map((match, index) => {
    const previousEnd =
      index > 0 ? matches[index - 1].index + matches[index - 1].length : 0;
    const beforeQuestion = text.slice(previousEnd, match.index);
    const prefix = beforeQuestion.match(/[✅☑✔❌✖\uFE0F\s\d.)-]*$/u)?.[0] || "";
    return {
      ...match,
      prefix,
      prefixStart: match.index - prefix.length,
    };
  });

  return matchesWithPrefixes.map((match, index) => {
    const start = match.index + match.length;
    const end = matchesWithPrefixes[index + 1]?.prefixStart ?? text.length;
    return {
      field: match.field,
      answer: `${match.prefix} ${text
        .slice(start, end)
        .split(/\b(?:final )?verdict\s*:|\b(?:salesperson |call |post-call )?notes?\s*:|https?:\/\//i)[0]
        .replace(/^[\s:–—-]+/, "")
        .trim()}`.trim(),
    };
  });
}

function interpretAnswer(answer: string) {
  const emojiValues = new Set<boolean>();
  const textValues = new Set<boolean>();

  if (/✅|☑(?:️)?|✔(?:️)?/u.test(answer)) emojiValues.add(true);
  if (/❌|✖(?:️)?/u.test(answer)) emojiValues.add(false);
  if (/\b(?:yes|y|true)\b/i.test(answer)) textValues.add(true);
  if (/\b(?:no|n|false)\b/i.test(answer)) textValues.add(false);

  const emoji = singleValue(emojiValues);
  const written = singleValue(textValues);
  const conflict =
    emoji !== null && written !== null && emoji !== written;

  if (conflict) return { value: null, conflict: true };

  const allValues = new Set([...emojiValues, ...textValues]);
  return {
    value: singleValue(allValues),
    conflict: false,
  };
}

function singleValue(values: Set<boolean>) {
  return values.size === 1 ? [...values][0] : null;
}

function classifyUpdate({
  hasQuestionnaire,
  notes,
  text,
  authorName,
}: {
  hasQuestionnaire: boolean;
  notes: string;
  text: string;
  authorName: string;
}): SalesPulseUpdateClassification {
  if (hasQuestionnaire) return "structured_questionnaire";
  if (notes && !isSystemComment(text, authorName)) return "salesperson_note";
  return "unrelated_or_system_comment";
}

function isSystemComment(text: string, authorName: string) {
  return (
    /\b(?:system|automation|integration|bot)\b/i.test(authorName) ||
    /\b(?:automatically|automation|changed (?:the )?.+ from|moved this item|created by integration)\b/i.test(
      text,
    )
  );
}

function parseFields(text: string) {
  const fields = new Map<string, string>();
  let currentLabel = "";

  for (const line of text.split("\n")) {
    const cleaned = line.replace(/^[-*•]\s*/, "").trim();
    if (!cleaned) continue;

    const match = cleaned.match(/^(.+?):\s*(.*)$/);
    if (match) {
      currentLabel = normalizeLabel(match[1]);
      fields.set(currentLabel, match[2].trim());
      continue;
    }

    if (currentLabel && !QUESTIONS.some(({ pattern }) => pattern.test(cleaned))) {
      fields.set(currentLabel, `${fields.get(currentLabel) || ""}\n${cleaned}`.trim());
    }
  }

  return fields;
}

function plainText(body: string) {
  return decodeHtml(
    body
      .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtml(value: string) {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, key: string) => {
    if (key.startsWith("#x")) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    return entities[key.toLowerCase()] ?? entity;
  });
}

function normalizeLabel(value: string) {
  return value
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function fieldValue(fields: Map<string, string>, aliases: string[]) {
  for (const alias of aliases) {
    const value = fields.get(alias);
    if (value) return value;
  }
  return "";
}

function findGoogleDocsUrl(value: string) {
  return (
    value.match(
      /https?:\/\/docs\.google\.com\/(?:document\/d\/|open\?id=)[^\s<>"')]+/i,
    )?.[0] || ""
  );
}

function googleDocsDocumentId(url: string) {
  if (!url) return "";

  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== "docs.google.com") return "";
    return (
      parsed.pathname.match(/^\/document\/d\/([^/]+)/)?.[1] ||
      parsed.searchParams.get("id") ||
      ""
    );
  } catch {
    return "";
  }
}
