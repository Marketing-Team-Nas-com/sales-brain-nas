import { NextRequest, NextResponse } from "next/server";
import {
  changeDealColumns,
  createDealUpdate,
  getBoardColumnIdByTitle,
  getBoardSnapshot,
  type SalesDeal,
} from "../../../lib/monday";
import { replyToLarkMessage, sendLarkTextReport } from "../../../lib/lark";
import { answerSalesQuestion } from "../../../lib/sales-brain";
import {
  appendConversationMemory,
  appendSalesContextNote,
  clearPendingMondayAction,
  crawlSalesMemory,
  getConversationMemory,
  getConfiguredSalesBoardIds,
  getLatestSalesMemory,
  getPendingMondayAction,
  getSalesContextNotes,
  registerLarkMessageDelivery,
  setPendingMondayAction,
  type ConversationMessage,
  type PendingMondayAction,
} from "../../../lib/sales-memory";

type LarkEventPayload = {
  challenge?: string;
  token?: string;
  type?: string;
  header?: {
    event_type?: string;
    token?: string;
  };
  event?: {
    sender?: {
      sender_id?: {
        open_id?: string;
        union_id?: string;
        user_id?: string;
      };
      sender_type?: string;
      tenant_key?: string;
    };
    message?: {
      message_id?: string;
      root_id?: string;
      parent_id?: string;
      chat_id?: string;
      message_type?: string;
      content?: string;
      chat_type?: string;
      mentions?: Array<{
        key?: string;
        name?: string;
        id?: {
          open_id?: string;
          union_id?: string;
          user_id?: string;
        };
      }>;
    };
  };
};

const FINAL_VERDICT_COLUMN_ID = "color_mm594jh8";
const CALL_STAGE_COLUMN_ID = "color_mm4j8pct";
const NEXT_STEPS_COLUMN_ID = "color_mm524pr";
const LAST_FOLLOW_UP_COLUMN_ID = "date_mm59agw5";
const CMO_DINNER_BOARD_ID = "5030120019";
const CMO_DINNER_FINAL_VERDICT_COLUMN_ID = "color_mm5grmg3";
const CMO_DINNER_AFTER_DINNER_STATUS_COLUMN_ID = "color_mm5gctyq";

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as LarkEventPayload;
  const expectedToken = process.env.LARK_VERIFICATION_TOKEN;
  const receivedToken = payload.token || payload.header?.token;

  if (!expectedToken) {
    return NextResponse.json(
      { error: "LARK_VERIFICATION_TOKEN is not configured." },
      { status: 500 },
    );
  }

  if (receivedToken !== expectedToken) {
    return NextResponse.json({ error: "Invalid Lark verification token." }, { status: 401 });
  }

  if (payload.challenge) {
    return NextResponse.json({ challenge: payload.challenge });
  }

  const eventType = payload.header?.event_type || payload.type;

  if (eventType !== "im.message.receive_v1") {
    return NextResponse.json({ ok: true, ignored: eventType ?? "unknown" });
  }

  const message = payload.event?.message;
  const messageId = message?.message_id;

  if (!messageId || !isSupportedMessageType(message?.message_type)) {
    return NextResponse.json({ ok: true, ignored: "non-text-message" });
  }

  const isFirstDelivery = await registerLarkMessageDelivery(messageId);

  if (!isFirstDelivery) {
    return NextResponse.json({ ok: true, ignored: "duplicate-message" });
  }

  const question = parseTextContent(message.content);
  const threadId = conversationThreadId(message);
  const actionThreadIds = pendingActionThreadIds(message);

  if (!(await shouldAnswerLarkMessage({ message, question, actionThreadIds }))) {
    await maybeHandlePassiveGroupInsight({
      question,
      message,
      sender: payload.event?.sender,
    });

    return NextResponse.json({ ok: true, ignored: "group-message-without-mention" });
  }

  const conversation = await getConversationMemory(threadId);
  const chatIdAnswer = maybeHandleChatIdQuestion(question, message);

  if (chatIdAnswer) {
    await sendLarkAnswer({ message, messageId, answer: chatIdAnswer });
    await appendConversationMemory({
      threadId,
      userMessage: question,
      assistantMessage: chatIdAnswer,
    });

    return NextResponse.json({ ok: true });
  }

  const generalAnswer = maybeHandleGeneralHarryMessage(question);

  if (generalAnswer) {
    await sendLarkAnswer({ message, messageId, answer: generalAnswer });
    await appendConversationMemory({
      threadId,
      userMessage: question,
      assistantMessage: generalAnswer,
    });

    if (isDirectMessage(message)) {
      await notifyDmMonitor({
        message,
        sender: payload.event?.sender,
        question,
        answer: generalAnswer,
      });
    }

    return NextResponse.json({ ok: true });
  }

  const emailMemoryAnswer = await maybeHandleEmailMemoryQuestion(question);

  if (emailMemoryAnswer) {
    await sendLarkAnswer({ message, messageId, answer: emailMemoryAnswer });
    await appendConversationMemory({
      threadId,
      userMessage: question,
      assistantMessage: emailMemoryAnswer,
    });

    if (isDirectMessage(message)) {
      await notifyDmMonitor({
        message,
        sender: payload.event?.sender,
        question,
        answer: emailMemoryAnswer,
      });
    }

    return NextResponse.json({ ok: true });
  }

  await maybeSendWorkingAcknowledgement({ question, message, messageId });

  void handleSalesAnswerInBackground({
    question,
    message,
    messageId,
    sender: payload.event?.sender,
    threadId,
    actionThreadIds,
    conversation,
  });

  return NextResponse.json({ ok: true, queued: true });
}

async function handleSalesAnswerInBackground({
  question,
  message,
  messageId,
  sender,
  threadId,
  actionThreadIds,
  conversation,
}: {
  question: string;
  message: NonNullable<LarkEventPayload["event"]>["message"];
  messageId: string;
  sender?: NonNullable<LarkEventPayload["event"]>["sender"];
  threadId: string;
  actionThreadIds: string[];
  conversation: ConversationMessage[];
}) {
  try {
    const boardData = await loadSalesBoardDeals(question);
    const contextNotes = await getSalesContextNotes();
    const answer =
      (await maybeHandleMondayWrite({
        question,
        threadId,
        actionThreadIds,
        boardId: boardData.boardId,
        deals: boardData.deals,
        conversation,
      })) ||
      (await maybeHandleSalesMemoryCapture({
        question,
        threadId,
        actionThreadIds,
        boardId: boardData.boardId,
        deals: boardData.deals,
      })) ||
      (await answerSalesQuestion({
        question,
        deals: boardData.deals,
        conversation,
        contextNotes,
      }));

    await sendLarkAnswer({ message, messageId, answer });

    await appendConversationMemory({
      threadId,
      userMessage: question,
      assistantMessage: answer,
    });

    if (isDirectMessage(message)) {
      await notifyDmMonitor({
        message,
        sender,
        question,
        answer,
      });
    }
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "I hit an unknown error while pulling the CRM.";
    const answer = `I hit a snag pulling that from Monday: ${messageText}`;

    console.error("Unable to complete Harry sales answer", error);

    try {
      await sendLarkAnswer({ message, messageId, answer });
    } catch (sendError) {
      console.error("Unable to send Harry sales answer failure", sendError);
    }
  }
}

async function maybeSendWorkingAcknowledgement({
  question,
  message,
  messageId,
}: {
  question: string;
  message: NonNullable<LarkEventPayload["event"]>["message"];
  messageId: string;
}) {
  const answer = workingAcknowledgementFor(question, messageId);

  if (!answer) return;

  try {
    await sendLarkAnswer({ message, messageId, answer });
  } catch (error) {
    console.error("Unable to send Harry working acknowledgement", error);
  }
}

function workingAcknowledgementFor(question: string, messageId: string) {
  const normalized = question.toLowerCase().replace(/[^\w\s$+.-]/g, " ").replace(/\s+/g, " ").trim();

  if (!normalized) return "";

  if (/^(yes|yep|yeah|confirm|confirmed|please do|do it|ok do it|go ahead)\b/.test(normalized)) {
    return "";
  }

  if (/\b(move|update|change|set|put|make|mark|add|write|post|comment|note)\b/.test(normalized)) {
    return pickWorkingLine(messageId, [
      "Got it - checking the exact Monday record before I touch anything.",
      "On it - matching the CRM record first, because we do not update vibes.",
      "Copy that - finding the right Monday row before making a move.",
    ]);
  }

  if (/\b(report|summary|ceo|pipeline|snapshot|insight|analysis|analyze)\b/.test(normalized)) {
    return pickWorkingLine(messageId, [
      "On it - pulling the pipeline together so this does not become spreadsheet soup.",
      "Give me a sec - I’m turning the CRM chaos into something readable.",
      "I’m on it - checking the data and making it CEO-clean.",
    ]);
  }

  if (
    /\b(crm|monday|lead|leads|call|calls|meeting|meetings|sales qualified|qualified|budget|inbound|outbound|cmo dinner|no show|cancelled|rescheduled|website|country)\b/.test(
      normalized,
    ) ||
    /\b(how many|count|list|show|which|who|where|when|from|between|since|today|tomorrow|this week|last week|last 7 days)\b/.test(
      normalized,
    )
  ) {
    return pickWorkingLine(messageId, [
      "On it, darling - pulling the CRM now.",
      "Give me one stylish second - checking Monday for you.",
      "I’m on it - pulling the live CRM so we don’t hallucinate with confidence.",
      "Checking now - numbers first, drama later.",
    ]);
  }

  return "";
}

function pickWorkingLine(messageId: string, lines: string[]) {
  const hash = [...messageId].reduce((total, char) => total + char.charCodeAt(0), 0);
  return lines[hash % lines.length];
}

async function sendLarkAnswer({
  message,
  messageId,
  answer,
}: {
  message: NonNullable<LarkEventPayload["event"]>["message"];
  messageId: string;
  answer: string;
}) {
  if (isGroupChat(message.chat_type)) {
    await replyToLarkMessage({
      messageId,
      text: answer,
      replyInThread: true,
    });
  } else if (message.chat_id) {
    await sendLarkTextReport({
      chatId: message.chat_id,
      text: answer,
    });
  } else {
    await replyToLarkMessage({
      messageId,
      text: answer,
      replyInThread: false,
    });
  }
}

function parseTextContent(content?: string) {
  if (!content) return "";

  try {
    const parsed = JSON.parse(content) as unknown;
    return removeBotMentions(extractTextFromLarkContent(parsed));
  } catch {
    return removeBotMentions(content);
  }
}

function isSupportedMessageType(messageType?: string) {
  return messageType === "text" || messageType === "post";
}

function extractTextFromLarkContent(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    return value.map(extractTextFromLarkContent).filter(Boolean).join(" ");
  }

  if (typeof value !== "object") return "";

  const record = value as Record<string, unknown>;

  if (typeof record.text === "string") return record.text;
  if (typeof record.user_name === "string") return `@${record.user_name}`;
  if (typeof record.name === "string") return `@${record.name}`;
  if (typeof record.title === "string" && record.content) {
    return [record.title, extractTextFromLarkContent(record.content)].filter(Boolean).join(" ");
  }

  return extractTextFromLarkContent(record.content);
}

async function shouldAnswerLarkMessage({
  message,
  question,
  actionThreadIds,
}: {
  message: NonNullable<LarkEventPayload["event"]>["message"];
  question: string;
  actionThreadIds: string[];
}) {
  if (!isGroupChat(message?.chat_type)) return true;

  if (isBotMentioned(message)) return true;

  if (!isConfirmation(question)) return false;

  const pendingAction = await getFirstPendingMondayAction(actionThreadIds);
  return Boolean(pendingAction);
}

function isGroupChat(chatType?: string) {
  const normalized = chatType?.toLowerCase() ?? "";
  return normalized.includes("group") || normalized === "chat";
}

function isDirectMessage(message: NonNullable<LarkEventPayload["event"]>["message"]) {
  const normalized = message?.chat_type?.toLowerCase() ?? "";
  return ["p2p", "private", "direct", "single"].some((type) => normalized.includes(type));
}

function isBotMentioned(message: NonNullable<LarkEventPayload["event"]>["message"]) {
  const mentions = message?.mentions ?? [];

  if (
    mentions.some((mention) => {
      const label = `${mention.name ?? ""} ${mention.key ?? ""}`.toLowerCase();
      return label.includes("harry") || label.includes("sales agent");
    })
  ) {
    return true;
  }

  const rawContent = message?.content ?? "";
  return /<at\b/i.test(rawContent) && /\b(harry|sales agent)\b/i.test(rawContent);
}

function removeBotMentions(text: string) {
  return text
    .replace(/<at\b[^>]*>.*?<\/at>/gi, " ")
    .replace(/@\s*Harry the sales agent\b/gi, " ")
    .replace(/@\s*Harry\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function conversationThreadId(message: NonNullable<LarkEventPayload["event"]>["message"]) {
  // Group chats need thread-scoped memory so replies continue the specific CRM action.
  if (isGroupChat(message?.chat_type)) {
    return (
      message?.root_id ||
      message?.parent_id ||
      message?.message_id ||
      message?.chat_id ||
      "lark-default-thread"
    );
  }

  // Direct messages should behave like one ongoing chat.
  return (
    message?.chat_id ||
    message?.root_id ||
    message?.parent_id ||
    message?.message_id ||
    "lark-default-thread"
  );
}

function pendingActionThreadIds(message: NonNullable<LarkEventPayload["event"]>["message"]) {
  const ids = [
    conversationThreadId(message),
    message?.root_id,
    message?.parent_id,
    message?.message_id,
    message?.chat_id ? `chat:${message.chat_id}:latest` : "",
  ];

  return [...new Set(ids.filter(Boolean) as string[])];
}

async function notifyDmMonitor({
  message,
  sender,
  question,
  answer,
}: {
  message: NonNullable<LarkEventPayload["event"]>["message"];
  sender?: NonNullable<LarkEventPayload["event"]>["sender"];
  question: string;
  answer: string;
}) {
  const monitorChatId =
    process.env.LARK_DM_MONITOR_CHAT_ID ||
    process.env.LARK_SALES_REPORT_CHAT_ID ||
    process.env.LARK_SALES_CHAT_ID;

  if (!monitorChatId || monitorChatId === message?.chat_id) return;

  const senderId =
    sender?.sender_id?.user_id ||
    sender?.sender_id?.open_id ||
    sender?.sender_id?.union_id ||
    "unknown sender";

  try {
    await sendLarkTextReport({
      chatId: monitorChatId,
      text: [
        "Harry DM monitor",
        `From: ${senderId}`,
        `Question: ${truncateForMonitor(question)}`,
        `Harry: ${truncateForMonitor(answer)}`,
      ].join("\n"),
    });
  } catch (error) {
    console.error("Unable to send Harry DM monitor notification", error);
  }
}

function truncateForMonitor(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 1200 ? `${normalized.slice(0, 1197)}...` : normalized;
}

function maybeHandleGeneralHarryMessage(question: string) {
  const normalized = question.toLowerCase().replace(/[^\w\s']/g, " ").replace(/\s+/g, " ").trim();

  if (!normalized) return "";

  if (
    /^(hi|hello|hey|yo|gm|good morning|good afternoon|good evening)\b/.test(normalized) ||
    /\b(are you here|you here|u here|are you alive|you alive|can you hear me|test|ping)\b/.test(
      normalized,
    )
  ) {
    return "Yep, I’m here.";
  }

  if (/^(thanks|thank you|ty|thx|cool|great|perfect|ok thanks|got it)\b/.test(normalized)) {
    return "Got it.";
  }

  if (/\b(what can you do|help|commands|how do i use you)\b/.test(normalized)) {
    return "I can answer live CRM questions from monday, find lead updates, summarize calls, save sales context, and update monday after you confirm.";
  }

  return "";
}

function maybeHandleChatIdQuestion(
  question: string,
  message: NonNullable<LarkEventPayload["event"]>["message"],
) {
  const normalized = question.toLowerCase().replace(/[^\w\s']/g, " ").replace(/\s+/g, " ").trim();

  if (
    !/\b(chat id|chat_id|group id|conversation id|this chat id|this group id|what is this chat)\b/.test(
      normalized,
    )
  ) {
    return "";
  }

  if (!message.chat_id) {
    return "I can’t see a chat id on this message.";
  }

  return [
    "This chat’s Lark ID is:",
    message.chat_id,
    "",
    "Use that as LARK_DAILY_SUMMARY_CHAT_ID in Railway for the nightly Sales Brain newspaper.",
  ].join("\n");
}

async function maybeHandleEmailMemoryQuestion(question: string) {
  const normalized = question.toLowerCase().replace(/[^\w\s']/g, " ").replace(/\s+/g, " ").trim();

  if (!/\b(email|emails|mail|inbox)\b/.test(normalized)) return "";
  if (!/\b(latest|recent|last|received|came in|come in|summarize|summary|what was)\b/.test(normalized)) {
    return "";
  }

  const notes = (await getSalesContextNotes(120)).filter((note) => note.source === "email");

  if (!notes.length) {
    return "I do not have any emails in Sales Brain yet. If Zapier says the webhook worked, send me the Step 2 Data out and I’ll trace it.";
  }

  const requestedText = normalized
    .replace(/\b(latest|recent|last|received|came in|come in|summarize|summary|what was|email|emails|mail|inbox|you|your|the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const emailNotes = requestedText
    ? notes
        .map((note) => ({
          note,
          score: scoreEmailNoteForQuestion(note, requestedText),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((item) => item.note)
    : notes;

  const latest = emailNotes[emailNotes.length - 1] || notes[notes.length - 1];
  const lines = latest.note.split("\n").filter(Boolean);
  const subject = lines.find((line) => line.toLowerCase().startsWith("email received:")) || "";
  const from = lines.find((line) => line.toLowerCase().startsWith("from:")) || "";
  const date = lines.find((line) => line.toLowerCase().startsWith("date:")) || "";
  const matched = lines.find((line) => line.toLowerCase().includes("crm record")) || "";
  const preview = lines
    .filter((line) => line !== subject && line !== from && line !== date && line !== matched)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);

  return [
    "Latest email I have in Sales Brain:",
    subject.replace(/^Email received:\s*/i, "Subject: "),
    from,
    date,
    matched,
    preview ? `Preview: ${preview}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function scoreEmailNoteForQuestion(note: SalesContextNote, requestedText: string) {
  const searchable = [note.note, note.rawText, note.account, note.email].filter(Boolean).join(" ").toLowerCase();
  return requestedText
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .reduce((score, token) => score + (searchable.includes(token) ? 1 : 0), 0);
}

async function maybeHandlePassiveGroupInsight({
  question,
  message,
  sender,
}: {
  question: string;
  message: NonNullable<LarkEventPayload["event"]>["message"];
  sender?: NonNullable<LarkEventPayload["event"]>["sender"];
}) {
  if (!isGroupChat(message?.chat_type) || isBotMentioned(message)) return;
  if (!isPassiveSalesInsight(question)) return;

  const threadId = conversationThreadId(message);
  const note = extractSalesMemoryNote(question) || question;
  const memory = await getLatestSalesMemory();
  const matches = memory?.deals.length
    ? findDealMatches({ question, conversation: [], deals: memory.deals }).slice(0, 2)
    : [];
  const deal = matches.length === 1 ? matches[0] : null;

  await appendSalesContextNote({
    threadId,
    source: "lark-passive",
    rawText: question,
    note,
    ...(deal
      ? {
          account: deal.account,
          itemId: deal.id,
          email: deal.email,
        }
      : {}),
  });

  await notifyPassiveGroupInsight({
    message,
    sender,
    question,
    deal,
    hadMultipleMatches: matches.length > 1,
  });
}

async function notifyPassiveGroupInsight({
  message,
  sender,
  question,
  deal,
  hadMultipleMatches,
}: {
  message: NonNullable<LarkEventPayload["event"]>["message"];
  sender?: NonNullable<LarkEventPayload["event"]>["sender"];
  question: string;
  deal: SalesDeal | null;
  hadMultipleMatches: boolean;
}) {
  const monitorChatId =
    process.env.LARK_DM_MONITOR_CHAT_ID ||
    process.env.LARK_SALES_REPORT_CHAT_ID ||
    process.env.LARK_SALES_CHAT_ID;

  if (!monitorChatId || monitorChatId === message?.chat_id) return;

  const senderId =
    sender?.sender_id?.user_id ||
    sender?.sender_id?.open_id ||
    sender?.sender_id?.union_id ||
    "unknown sender";
  const matchText = deal
    ? `Matched CRM record: ${formatSelectedDeal(deal)}`
    : hadMultipleMatches
      ? "Matched CRM record: multiple possible records"
      : "Matched CRM record: not confidently matched";

  try {
    await sendLarkTextReport({
      chatId: monitorChatId,
      text: [
        "Harry passive sales insight",
        `From: ${senderId}`,
        `Chat: ${message?.chat_id || "unknown chat"}`,
        matchText,
        `Message: ${truncateForMonitor(question)}`,
      ].join("\n"),
    });
  } catch (error) {
    console.error("Unable to send Harry passive insight notification", error);
  }
}

function isPassiveSalesInsight(question: string) {
  const normalized = question.toLowerCase();

  if (!normalized.trim()) return false;
  if (/\b(how many|count|list|show|tell me|give me|what is|what's|which|who|where|when)\b/.test(normalized)) {
    return false;
  }

  const hasSalesSubject =
    /\b(lead|client|customer|prospect|deal|crm|monday|proposal|pricing|budget|decision maker|objection|next step|follow[- ]?up|agreement|signed|signature|closed|lost|meeting|call|sales qualified|no\s*show|cancelled|canceled|rescheduled|demo|proof[- ]of[- ]value|working session)\b/.test(
      normalized,
    );
  const hasHighSignalOutcome =
    /\b(good|great|positive|bad|strong|hot|interested|qualified|not qualified|not a fit|fit|second|2nd|another|booked|scheduled|completed|signed|won|lost|agreed|approved|rejected|concern|concerns|objection|pricing|budget|proposal|follow[- ]?up|nuseir|join|involve|who should|shall i|should i|demo|proof[- ]of[- ]value|working session)\b/.test(
      normalized,
    );
  const hasCompanyClue =
    /(?:https?:\/\/|www\.|\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b)/i.test(question) ||
    /\b(company|co\.|inc|llc|ltd|group|clinic|agency|studio|shop|labs?|capital|partners?)\b/.test(
      normalized,
    );

  return (hasSalesSubject && hasHighSignalOutcome) || (hasCompanyClue && hasHighSignalOutcome);
}

async function loadSalesBoardDeals(question = "") {
  const boardIds = getConfiguredSalesBoardIds();

  if (!boardIds.length) {
    throw new Error("Sales Brain is missing MONDAY_SALES_BOARD_IDS, so I cannot read the CRM yet.");
  }

  if (shouldReadLiveMondayData(question)) {
    const liveBoardIds = liveBoardIdsForQuestion(question, boardIds);
    const snapshots = await Promise.all(liveBoardIds.map((boardId) => getBoardSnapshot(boardId)));
    return {
      boardId: liveBoardIds[0],
      deals: snapshots.flatMap((snapshot) => snapshot.deals),
    };
  }

  const memory = await getLatestSalesMemory();

  if (memory?.deals.length && memory.deals.some((deal) => deal.group)) {
    refreshSalesMemoryInBackground({ question, generatedAt: memory.generatedAt, boardIds });
    return { boardId: boardIds[0], deals: memory.deals };
  }

  const snapshots = await Promise.all(boardIds.map((boardId) => getBoardSnapshot(boardId)));
  return {
    boardId: boardIds[0],
    deals: snapshots.flatMap((snapshot) => snapshot.deals),
  };
}

function liveBoardIdsForQuestion(question: string, boardIds: string[]) {
  if (asksAboutCmoDinnerBoard(question)) return [CMO_DINNER_BOARD_ID];

  return boardIds.slice(0, 1);
}

function asksAboutCmoDinnerBoard(question: string) {
  return /\b(cmo board|cmo dinner|dinner leads?|miami dinner|singapore dinner|tel aviv|israel dinner)\b/i.test(
    question,
  );
}

function shouldReadLiveMondayData(question: string) {
  const normalized = question.toLowerCase();

  if (/\b(look at|check|pull|read|from|in)\b.{0,40}\b(crm|monday)\b/.test(normalized)) {
    return true;
  }

  if (asksForQualitativeSalesMemory(normalized)) {
    return false;
  }

  return Boolean(normalized.trim());
}

function asksForQualitativeSalesMemory(normalized: string) {
  const asksForAnalysis =
    /\b(analy[sz]e|analysis|insight|insights|takeaway|takeaways|why|reason|reasons|recommend|recommendation|strategy|ceo report|report)\b/.test(
      normalized,
    );
  const asksForSpecificData =
    /\b(how many|count|rate|number|total|list|show|which|who|where|when|from|between|since|today|tomorrow|this week|last week)\b/.test(
      normalized,
    );
  const explicitlyAsksForLiveCrm = /\b(look at|check|pull|read|from|in)\b.{0,40}\b(crm|monday)\b/.test(
    normalized,
  );

  return asksForAnalysis && !asksForSpecificData && !explicitlyAsksForLiveCrm;
}

function refreshSalesMemoryInBackground({
  question,
  generatedAt,
  boardIds,
}: {
  question: string;
  generatedAt?: string;
  boardIds: string[];
}) {
  if (!shouldUseFreshSalesData(question) || !isStaleSalesMemory(generatedAt)) return;

  void crawlSalesMemory(boardIds).catch((error) => {
    console.error("Unable to refresh Sales Brain memory in the background", error);
  });
}

function shouldUseFreshSalesData(question: string) {
  const normalized = question.toLowerCase();
  return (
    /\b(how many|count|rate|number|total)\b/.test(normalized) ||
    /\b(call|calls|meeting|meetings|no\s*show|cancelled|canceled|rescheduled|1m|1\s*m|\$1m)\b/.test(
      normalized,
    ) ||
    /\b(from|since|between|today|yesterday|this week|last week)\b/.test(normalized)
  );
}

function isStaleSalesMemory(generatedAt?: string) {
  if (!generatedAt) return true;

  const generatedTime = Date.parse(generatedAt);
  if (Number.isNaN(generatedTime)) return true;

  return Date.now() - generatedTime > 2 * 60 * 1000;
}

async function maybeHandleMondayWrite({
  question,
  threadId,
  actionThreadIds,
  boardId,
  deals,
  conversation,
}: {
  question: string;
  threadId: string;
  actionThreadIds: string[];
  boardId: string;
  deals: SalesDeal[];
  conversation: ConversationMessage[];
}) {
  if (isConfirmation(question)) {
    const action =
      (await getFirstPendingMondayAction(actionThreadIds)) ||
      (await recoverPendingMondayAction({ conversation, boardId, deals }));

    if (!action) {
      return "";
    }

    if (action.disambiguation) {
      return "I still need the exact record before I update Monday - send the email, company name, or Monday link for the one you mean.";
    }

    return executePendingMondayAction({ threadIds: actionThreadIds, action });
  }

  const resolvedDisambiguation = await maybeResolvePendingDisambiguation({
    question,
    actionThreadIds,
    deals,
  });

  if (resolvedDisambiguation) {
    if (hasApprovalLanguage(question)) {
      return executePendingMondayAction({ threadIds: actionThreadIds, action: resolvedDisambiguation });
    }

    await setPendingMondayActionForIds(actionThreadIds, resolvedDisambiguation);
    const email = resolvedDisambiguation.email ? ` (${resolvedDisambiguation.email})` : "";
    return `Got it - I selected ${resolvedDisambiguation.account}${email}. Reply yes to confirm, and I'll ${confirmationTextForAction(resolvedDisambiguation)}.`;
  }

  const bulkFollowUpNoteIntent = bulkFollowUpThreadNoteIntent(question, deals);

  if (bulkFollowUpNoteIntent) {
    const { followUpDate, matchedDeals, unresolvedNames } = bulkFollowUpNoteIntent;

    if (unresolvedNames.length) {
      await clearPendingMondayActionForIds(actionThreadIds);
      return `I can do this, but I need cleaner names for: ${unresolvedNames.join(", ")}.`;
    }

    const action = {
      id: `${Date.now()}-bulk-follow-up-note`,
      createdAt: new Date().toISOString(),
      boardId,
      itemId: "",
      account: `${matchedDeals.length} matching records`,
      email: "",
      description: `set Last follow up date to ${followUpDate} on ${matchedDeals.length} records`,
      bulkActions: await Promise.all(
        matchedDeals.map(async (deal) => ({
          boardId: deal.boardId || boardId,
          itemId: deal.id,
          account: deal.account,
          email: deal.email,
          description: `set Last follow up date to ${followUpDate}`,
          columnValues: {
            [await lastFollowUpColumnIdFor(deal)]: { date: followUpDate },
          },
          createUpdate: false,
        })),
      ),
    } satisfies PendingMondayAction;

    if (hasApprovalLanguage(question)) {
      return executePendingMondayAction({ threadIds: actionThreadIds, action });
    }

    await setPendingMondayActionForIds(actionThreadIds, action);

    return `Got it - I found ${matchedDeals.map(formatSelectedDeal).join("; ")}. Reply yes to confirm, and I'll set Last follow up date to ${followUpDate} for all ${matchedDeals.length} records.`;
  }

  const updateIntent = mondayUpdateIntent(question, conversation);

  if (!updateIntent) {

    const threadNoteIntent = mondayThreadNoteIntent(question);

    if (!threadNoteIntent) {
      return "";
    }

    const matches = findDealMatches({ question, conversation, deals }).slice(0, 5);

    if (!matches.length) {
      await clearPendingMondayAction(threadId);
      return "";
    }

    if (matches.length > 1) {
      await setPendingMondayActionForIds(actionThreadIds, {
        id: `${Date.now()}-disambiguation`,
        createdAt: new Date().toISOString(),
        boardId,
        itemId: "",
        account: "multiple matching records",
        email: "",
        description: "waiting for the exact monday record",
        disambiguation: {
          candidateItemIds: matches.map((deal) => deal.id),
          threadNote: threadNoteIntent.note,
        },
      });
      const names = matches.map(formatDealOption).join("; ");
      return `I found multiple matching records: ${names}. Which one should I update?`;
    }

    const deal = matches[0];
    const action = {
      id: `${Date.now()}-${deal.id}`,
      createdAt: new Date().toISOString(),
      boardId: deal.boardId || boardId,
      itemId: deal.id,
      account: deal.account,
      email: deal.email,
      description: "added a monday thread note",
      updateBody: `Sales Brain note from Lark:\n\n${threadNoteIntent.note}`,
    } satisfies PendingMondayAction;

    if (hasApprovalLanguage(question)) {
      return executePendingMondayAction({ threadIds: actionThreadIds, action });
    }

    await setPendingMondayActionForIds(actionThreadIds, action);

    return `I found ${formatSelectedDeal(deal)}. Reply yes to confirm, and I'll add this note to the monday thread: "${threadNoteIntent.note}".`;
  }

  const matches = findDealMatches({ question, conversation, deals }).slice(0, 5);

  if (!matches.length) {
    await clearPendingMondayAction(threadId);
    return "";
  }

  if (matches.length > 1) {
    await setPendingMondayActionForIds(actionThreadIds, {
      id: `${Date.now()}-disambiguation`,
      createdAt: new Date().toISOString(),
      boardId,
      itemId: "",
      account: "multiple matching records",
      email: "",
      description: updateIntent.description,
      disambiguation: {
        candidateItemIds: matches.map((deal) => deal.id),
        updateKind: updateIntent.kind,
        updateBody: updateBodyForIntent(updateIntent, question),
      },
    });
    const names = matches.map(formatDealOption).join("; ");
    return `I found multiple matching records: ${names}. Which one should I update?`;
  }

  const deal = matches[0];
  const updateBody = updateBodyForIntent(updateIntent, question);
  const action = {
    id: `${Date.now()}-${deal.id}`,
    createdAt: new Date().toISOString(),
    boardId: deal.boardId || boardId,
    itemId: deal.id,
    account: deal.account,
    email: deal.email,
    description: updateIntent.description,
    columnValues: await columnValuesForUpdateIntent(updateIntent, deal),
    ...(updateBody ? { updateBody } : {}),
  } satisfies PendingMondayAction;

  if (hasApprovalLanguage(question)) {
    return executePendingMondayAction({ threadIds: actionThreadIds, action });
  }

  await setPendingMondayActionForIds(actionThreadIds, action);

  const currentStage = [deal.callStage, deal.nextStepsStatus, deal.finalVerdict]
    .filter((value) => value && value !== "5")
    .join(", ");
  const stageText = currentStage ? ` It is currently at ${currentStage}.` : "";

  return `I found ${formatSelectedDeal(deal)}.${stageText} Reply yes to confirm, and I'll ${updateIntent.confirmationText}.`;
}

async function executePendingMondayAction({
  threadIds,
  action,
}: {
  threadIds: string[];
  action: PendingMondayAction;
}) {
  if (action.bulkActions?.length) {
    for (const bulkAction of action.bulkActions) {
      if (bulkAction.columnValues && Object.keys(bulkAction.columnValues).length) {
        await changeDealColumns({
          boardId: bulkAction.boardId,
          itemId: bulkAction.itemId,
          columnValues: bulkAction.columnValues,
        });
      }

      if (bulkAction.createUpdate !== false) {
        await createDealUpdate({
          itemId: bulkAction.itemId,
          body:
            bulkAction.updateBody ||
            `Sales Brain updated ${bulkAction.description} after explicit Lark approval.`,
        });
      }
    }

    await clearPendingMondayActionForIds(threadIds);

    return `Done - I updated ${action.bulkActions.length} Monday records: ${action.bulkActions
      .map((bulkAction) => bulkAction.account)
      .join(", ")}.`;
  }

  if (action.columnValues && Object.keys(action.columnValues).length) {
    await changeDealColumns({
      boardId: action.boardId,
      itemId: action.itemId,
      columnValues: action.columnValues,
    });
  }

  await createDealUpdate({
    itemId: action.itemId,
    body:
      action.updateBody ||
      `Sales Brain updated ${action.description} after explicit Lark approval.`,
  });

  await clearPendingMondayActionForIds(threadIds);

  const email = action.email ? ` (${action.email})` : "";
  return `Done - I updated ${action.account}${email} in monday: ${action.description}.`;
}

async function getFirstPendingMondayAction(threadIds: string[]) {
  for (const threadId of threadIds) {
    const action = await getPendingMondayAction(threadId);
    if (action && !isStalePendingMondayAction(action)) return action;
  }

  return null;
}

async function setPendingMondayActionForIds(threadIds: string[], action: PendingMondayAction) {
  await Promise.all(threadIds.map((threadId) => setPendingMondayAction(threadId, action)));
}

async function clearPendingMondayActionForIds(threadIds: string[]) {
  await Promise.all(threadIds.map((threadId) => clearPendingMondayAction(threadId)));
}

function isStalePendingMondayAction(action: PendingMondayAction) {
  const createdTime = Date.parse(action.createdAt);
  if (Number.isNaN(createdTime)) return true;

  return Date.now() - createdTime > 30 * 60 * 1000;
}

async function maybeResolvePendingDisambiguation({
  question,
  actionThreadIds,
  deals,
}: {
  question: string;
  actionThreadIds: string[];
  deals: SalesDeal[];
}) {
  const pending = await getFirstPendingMondayAction(actionThreadIds);
  const disambiguation = pending?.disambiguation;

  if (!pending || !disambiguation) return null;

  const candidateDeals = deals.filter((deal) => disambiguation.candidateItemIds.includes(deal.id));
  const selectedDeal = selectCandidateDeal(question, candidateDeals);

  if (!selectedDeal) return null;

  const action = {
    id: `${Date.now()}-${selectedDeal.id}`,
    createdAt: new Date().toISOString(),
    boardId: selectedDeal.boardId || pending.boardId,
    itemId: selectedDeal.id,
    account: selectedDeal.account,
    email: selectedDeal.email,
    description: disambiguation.threadNote
      ? "added a monday thread note"
      : descriptionForUpdateKind(disambiguation.updateKind),
    ...(disambiguation.threadNote
      ? { updateBody: `Sales Brain note from Lark:\n\n${disambiguation.threadNote}` }
      : {
          columnValues: await columnValuesForUpdateKind(disambiguation.updateKind, selectedDeal),
          ...(disambiguation.updateBody ? { updateBody: disambiguation.updateBody } : {}),
        }),
  } satisfies PendingMondayAction;

  return action;
}

function selectCandidateDeal(question: string, candidates: SalesDeal[]) {
  const questionEmails = [...question.matchAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g)].map(
    (match) => normalizeSearch(match[0]),
  );

  if (questionEmails.length) {
    const emailMatches = candidates.filter((deal) =>
      questionEmails.includes(normalizeSearch(deal.email)),
    );
    if (emailMatches.length === 1) return emailMatches[0];
  }

  const ranked = findDealMatches({ question, conversation: [], deals: candidates });
  return ranked.length === 1 ? ranked[0] : null;
}

function descriptionForUpdateKind(kind?: PendingMondayAction["disambiguation"]["updateKind"]) {
  if (kind === "lost") return "moved Final verdict to Lost";
  if (kind === "signed-stage") return "moved Final verdict to Signed";
  if (kind === "agreement-stage") return "moved Final verdict to Agreement Stage";
  if (kind === "meeting-booked") return "moved Call Stage to Meeting Booked";
  if (kind === "sales-qualified") return "moved Call Stage to Sales Qualified";
  if (kind === "sales-qualified-proposal") {
    return "moved Call Stage to Sales Qualified and Next Steps to Proposal Stage";
  }
  if (kind === "proposal-done") return "moved Next Steps to Proposal Done";
  if (kind === "cmo-proposal-stage") return "moved CMO Dinner Next Steps to Proposal Stage";
  if (kind === "proposal-stage") return "moved Next Steps to Proposal Stage";
  return "updated monday";
}

function confirmationTextForAction(action: PendingMondayAction) {
  if (action.description === "added a monday thread note") return "add that note to the monday thread";
  if (action.description.startsWith("moved ")) return action.description.replace(/^moved /, "move ");
  return action.description;
}

async function columnValuesForUpdateKind(
  kind: PendingMondayAction["disambiguation"]["updateKind"],
  deal: SalesDeal,
) {
  if (kind === "meeting-booked") {
    return {
      [callStageColumnIdFor(deal)]: {
        label: isCmoDinnerDeal(deal) ? "Meeting Booked" : "Booked a Meeting",
      },
    };
  }

  if (kind === "sales-qualified") {
    return {
      [callStageColumnIdFor(deal)]: {
        label: "Sales Qualified",
      },
    };
  }

  if (kind === "sales-qualified-proposal") {
    return {
      [callStageColumnIdFor(deal)]: {
        label: isCmoDinnerDeal(deal) ? "Sales Qualified" : "Sales Qualified",
      },
      [await nextStepsColumnIdFor(deal)]: {
        label: "Proposal Stage",
      },
    };
  }

  if (kind === "proposal-stage" || kind === "cmo-proposal-stage" || kind === "proposal-done") {
    return {
      [await nextStepsColumnIdFor(deal)]: {
        label: kind === "proposal-done" ? "Proposal Done" : "Proposal Stage",
      },
    };
  }

  return {
    [finalVerdictColumnIdFor(deal)]: {
      label: kind === "lost" ? "Lost" : kind === "signed-stage" ? "Signed" : "Agreement Stage",
    },
  };
}

async function recoverPendingMondayAction({
  conversation,
  boardId,
  deals,
}: {
  conversation: ConversationMessage[];
  boardId: string;
  deals: SalesDeal[];
}) {
  const latestUpdateRequest = [...conversation]
    .reverse()
    .filter((message) => message.role === "user")
    .map((message) => message.text)
    .find((message) => mondayUpdateIntent(message, []));

  if (!latestUpdateRequest) return null;

  const updateIntent = mondayUpdateIntent(latestUpdateRequest, []);
  if (!updateIntent) return null;

  const matches = findDealMatches({
    question: latestUpdateRequest,
    conversation,
    deals,
  }).slice(0, 2);

  if (matches.length !== 1) return null;

  const deal = matches[0];

  return {
    id: `${Date.now()}-${deal.id}`,
    createdAt: new Date().toISOString(),
    boardId: deal.boardId || boardId,
    itemId: deal.id,
    account: deal.account,
    email: deal.email,
    description: updateIntent.description,
    columnValues: await columnValuesForUpdateIntent(updateIntent, deal),
    ...(updateBodyForIntent(updateIntent, latestUpdateRequest)
      ? { updateBody: updateBodyForIntent(updateIntent, latestUpdateRequest) }
      : {}),
  } satisfies PendingMondayAction;
}

async function maybeHandleSalesMemoryCapture({
  question,
  threadId,
  actionThreadIds,
  boardId,
  deals,
}: {
  question: string;
  threadId: string;
  actionThreadIds: string[];
  boardId: string;
  deals: SalesDeal[];
}) {
  if (isReadOnlySalesQuestion(question.toLowerCase())) return "";
  if (!isSalesMemoryCaptureIntent(question)) return "";

  const matches = findDealMatches({ question, conversation: [], deals }).slice(0, 5);
  const note = extractSalesMemoryNote(question);

  if (!matches.length) {
    await appendSalesContextNote({
      threadId,
      source: "lark",
      rawText: question,
      note,
    });

    return "Got it - I saved this in Sales Brain memory, but I could not confidently match it to a monday lead yet. Add the company name or email if you want me to attach it to a CRM record.";
  }

  if (matches.length > 1) {
    const names = matches.map(formatDealOption).join("; ");
    return `I found multiple possible CRM records for this note: ${names}. Which one should I attach it to?`;
  }

  const deal = matches[0];
  const saved = await appendSalesContextNote({
    threadId,
    source: "lark",
    rawText: question,
    note,
    account: deal.account,
    itemId: deal.id,
    email: deal.email,
  });

  await setPendingMondayActionForIds(actionThreadIds, {
    id: saved.id,
    createdAt: saved.createdAt,
    boardId: deal.boardId || boardId,
    itemId: deal.id,
    account: deal.account,
    email: deal.email,
    description: "added Sales Brain context note to monday",
    updateBody: `Sales Brain context from Lark:\n\n${note}`,
  });

  const email = deal.email ? ` (${deal.email})` : "";
  return `Got it - I saved this to Sales Brain memory for ${deal.account}${email}. Reply yes if you also want me to add it as a monday update.`;
}

function isConfirmation(question: string) {
  const normalized = question.trim().toLowerCase();
  const words = normalized.split(/\s+/).filter(Boolean);

  if (!normalized || words.length > 12) return false;
  if (/\b(no|nope|not|don't|dont|stop|cancel|wait)\b/.test(normalized)) return false;
  if (/\b(can you|could you)\s+(?:please\s+)?action\b/.test(normalized)) return true;
  if (/\b(?:please\s+)?(?:action|execute|run|make the change|do the update)\b/.test(normalized)) {
    return true;
  }

  if (/\b(can you|how many|what|which|who|list|show|tell|give)\b/.test(normalized)) {
    return false;
  }

  return hasApprovalLanguage(normalized);
}

function hasApprovalLanguage(question: string) {
  return /\b(yes|yep|yeah|confirm|confirmed|approved|approve|do it|go ahead|ok|okay|please do it|pls do it|action this|action it|execute this|run it)\b/i.test(
    question,
  );
}

function isSalesMemoryCaptureIntent(question: string) {
  const normalized = question.toLowerCase();
  const hasMemoryVerb =
    /\b(remember|note|memorize|save|store|context|add to sales brain|add to crm|update crm|crm note|sales note)\b/.test(
      normalized,
    );
  const hasSalesSubject =
    /\b(lead|client|customer|deal|sales|crm|monday|proposal|pricing|budget|decision maker|objection|next step|follow up|agreement|close|closing|meeting|call)\b/.test(
      normalized,
    );
  const hasMeetingOutcome =
    /\b(had|has|went|was|is|booked|scheduled|completed)\b/.test(normalized) &&
    /\b(good|great|positive|bad|second|2nd|next|follow[- ]?up|another|booked|scheduled)\b/.test(
      normalized,
    ) &&
    /\b(meeting|call)\b/.test(normalized);

  return (hasMemoryVerb && hasSalesSubject) || hasMeetingOutcome;
}

function extractSalesMemoryNote(question: string) {
  return question
    .replace(
      /^\s*(remember|note|memorize|save|store|context|add to sales brain|add to crm|update crm|crm note|sales note)\s*(this|that|for)?\s*[:,-]?\s*/i,
      "",
    )
    .trim();
}

function mondayUpdateIntent(
  question: string,
  conversation: ConversationMessage[],
) {
  const normalized = question.toLowerCase();

  if (isReadOnlySalesQuestion(normalized)) {
    return null;
  }

  if (maybeHandleGeneralHarryMessage(question)) {
    return null;
  }

  const recentUserText = conversation
    .filter((message) => message.role === "user")
    .slice(-3)
    .map((message) => message.text)
    .join(" ")
    .toLowerCase();

  const combined = `${recentUserText} ${normalized}`;
  const currentMentionsAgreement = normalized.includes("agreement");
  const contextMentionsAgreement = combined.includes("agreement");
  const currentMentionsSigned = /\b(signed|sign(?:ed|ature)?|closed won|won)\b/.test(normalized);
  const contextMentionsSigned = /\b(signed|sign(?:ed|ature)?|closed won|won)\b/.test(combined);
  const currentMentionsLost = /\blost\b/.test(normalized);
  const contextMentionsLost = /\blost\b/.test(combined);
  const currentMentionsMeetingBooked =
    /\b(meeting\s+booked|booked\s+(?:a\s+)?meeting)\b/.test(normalized);
  const contextMentionsMeetingBooked =
    /\b(meeting\s+booked|booked\s+(?:a\s+)?meeting)\b/.test(combined);
  const currentMentionsSalesQualified =
    /\b(sales\s+qualified|qualified|sql)\b/.test(normalized);
  const contextMentionsSalesQualified =
    /\b(sales\s+qualified|qualified|sql)\b/.test(combined);
  const currentMentionsProposalNextStep =
    /\b(proposal\s+stage|send\s+(?:a\s+)?proposal|proposal)\b/.test(normalized);
  const contextMentionsProposalNextStep =
    /\b(proposal\s+stage|send\s+(?:a\s+)?proposal|proposal)\b/.test(combined);
  const currentMentionsCmoBoard = asksAboutCmoDinnerBoard(question);
  const contextMentionsCmoBoard = asksAboutCmoDinnerBoard(combined);
  const currentMentionsProposalDone =
    /\b(proposal\s+done|proposal\s+sent|sent\s+(?:the\s+)?proposal)\b/.test(normalized);
  const contextMentionsProposalDone =
    /\b(proposal\s+done|proposal\s+sent|sent\s+(?:the\s+)?proposal)\b/.test(combined);
  const currentMessageHasUpdateVerb = /\b(move|update|change|set|put|make)\b/.test(normalized);
  const recentMessageHadUpdateVerb = /\b(move|update|change|set|put|make)\b/.test(recentUserText);
  const currentSearchTokens = searchTokens(normalized);
  const currentMessageHasEmail = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(question);
  const currentMessageLooksLikeSelection =
    currentSearchTokens.length > 0 &&
    (currentMessageHasEmail || !isCasualSelectionTokenOnly(currentSearchTokens));
  const currentMessageLooksShort = currentSearchTokens.length <= 3;
  const isUpdate =
    currentMessageHasUpdateVerb ||
    (recentMessageHadUpdateVerb && currentMessageLooksLikeSelection && currentMessageLooksShort);

  if (!isUpdate) return null;

  if (
    currentMentionsProposalDone ||
    (contextMentionsProposalDone && currentMessageLooksLikeSelection)
  ) {
    return {
      kind: "proposal-done",
      description: "moved Next Steps to Proposal Done",
      confirmationText: "move Next Steps to Proposal Done in monday",
    };
  }

  if (
    (currentMentionsCmoBoard || contextMentionsCmoBoard) &&
    (currentMentionsProposalNextStep ||
      (contextMentionsProposalNextStep && currentMessageLooksLikeSelection))
  ) {
    return {
      kind: "cmo-proposal-stage",
      description: "moved CMO Dinner Next Steps to Proposal Stage",
      confirmationText: "move CMO Dinner Next Steps to Proposal Stage in monday",
    };
  }

  if (
    (currentMentionsSalesQualified && currentMentionsProposalNextStep) ||
    (contextMentionsSalesQualified && contextMentionsProposalNextStep && currentMessageLooksLikeSelection)
  ) {
    return {
      kind: "sales-qualified-proposal",
      description: "moved Call Stage to Sales Qualified and Next Steps to Proposal Stage",
      confirmationText:
        "move Call Stage to Sales Qualified and Next Steps to Proposal Stage in monday",
    };
  }

  if (currentMentionsSalesQualified || (contextMentionsSalesQualified && currentMessageLooksLikeSelection)) {
    return {
      kind: "sales-qualified",
      description: "moved Call Stage to Sales Qualified",
      confirmationText: "move Call Stage to Sales Qualified in monday",
    };
  }

  if (currentMentionsProposalNextStep || (contextMentionsProposalNextStep && currentMessageLooksLikeSelection)) {
    return {
      kind: "proposal-stage",
      description: "moved Next Steps to Proposal Stage",
      confirmationText: "move Next Steps to Proposal Stage in monday",
    };
  }

  if (currentMentionsLost || (!currentMentionsAgreement && !currentMentionsMeetingBooked && !currentMentionsSigned && contextMentionsLost)) {
    return {
      kind: "lost",
      description: "moved Final verdict to Lost",
      confirmationText: "move Final verdict to Lost in monday",
    };
  }

  if (currentMentionsSigned || (!currentMentionsAgreement && !currentMentionsMeetingBooked && contextMentionsSigned)) {
    return {
      kind: "signed-stage",
      description: "moved Final verdict to Signed",
      confirmationText: "move Final verdict to Signed in monday",
    };
  }

  if (currentMentionsAgreement || (!currentMentionsMeetingBooked && !currentMentionsSigned && contextMentionsAgreement)) {
    return {
      kind: "agreement-stage",
      description: "moved Final verdict to Agreement Stage",
      confirmationText: "move Final verdict to Agreement Stage in monday",
    };
  }

  if (currentMentionsMeetingBooked || contextMentionsMeetingBooked) {
    return {
      kind: "meeting-booked",
      description: "moved Call Stage to Meeting Booked",
      confirmationText: "move Call Stage to Meeting Booked in monday",
    };
  }

  return null;
}

function isCasualSelectionTokenOnly(tokens: string[]) {
  const casualTokens = new Set([
    "here",
    "there",
    "hello",
    "hey",
    "thanks",
    "thank",
    "cool",
    "great",
    "perfect",
    "test",
    "ping",
    "alive",
    "hear",
  ]);

  return tokens.every((token) => casualTokens.has(token));
}

function mondayThreadNoteIntent(question: string) {
  const normalized = question.toLowerCase();

  if (
    !/\b(comment|note|update)\b/.test(normalized) ||
    !/\b(thread|monday|crm)\b/.test(normalized)
  ) {
    return null;
  }

  const note = extractMondayThreadNote(question);

  if (!note) return null;

  return { note };
}

function bulkFollowUpThreadNoteIntent(question: string, deals: SalesDeal[]) {
  const normalized = question.toLowerCase();

  if (
    !/\b(note|record|remember|save|add)\b/.test(normalized) ||
    !/\b(followed\s+up|follow[- ]?up|follow\s+up)\b/.test(normalized)
  ) {
    return null;
  }

  const names = extractBulkFollowUpNames(question);
  if (names.length < 2) return null;

  const matchedDeals: SalesDeal[] = [];
  const unresolvedNames: string[] = [];
  const seenIds = new Set<string>();

  for (const name of names) {
    const match = findSingleDealForBulkName(name, deals);

    if (!match || seenIds.has(match.id)) {
      unresolvedNames.push(name);
      continue;
    }

    matchedDeals.push(match);
    seenIds.add(match.id);
  }

  if (!matchedDeals.length) return null;

  return {
    followUpDate: todayInSingapore(),
    matchedDeals,
    unresolvedNames,
  };
}

function extractBulkFollowUpNames(question: string) {
  const match = question.match(/\b(?:followed\s+up|follow[- ]?up|follow\s+up)\s+(?:with\s+|on\s+)?(.+)$/i);
  const rawNames = match?.[1]?.trim() || "";

  return rawNames
    .replace(/[.?!]+$/g, "")
    .split(/\s*,\s*|\s+\band\b\s+/i)
    .map((name) => name.trim())
    .map((name) => name.replace(/^(?:for|with|on)\s+/i, "").trim())
    .filter((name) => searchTokens(name).length > 0);
}

function findSingleDealForBulkName(name: string, deals: SalesDeal[]) {
  const normalizedName = normalizeSearch(name);
  const exactAccountMatches = deals.filter((deal) => normalizeSearch(deal.account) === normalizedName);

  if (exactAccountMatches.length === 1) return exactAccountMatches[0];

  const strongAccountMatches = deals.filter((deal) => {
    const account = normalizeSearch(deal.account);
    return (
      normalizedName.length >= 4 &&
      account.length >= 4 &&
      (account.includes(normalizedName) || normalizedName.includes(account))
    );
  });

  if (strongAccountMatches.length === 1) return strongAccountMatches[0];

  const fuzzyAccountMatches = deals.filter((deal) => {
    const account = normalizedCompanyCore(deal.account);
    const target = normalizedCompanyCore(name);

    return target.length >= 6 && account.length >= 6 && editDistance(account, target) <= 2;
  });

  if (fuzzyAccountMatches.length === 1) return fuzzyAccountMatches[0];

  const ranked = findDealMatches({ question: name, conversation: [], deals }).slice(0, 2);
  return ranked.length === 1 ? ranked[0] : null;
}

function normalizedCompanyCore(value: string) {
  return normalizeSearch(value)
    .replace(/^www/, "")
    .replace(/(?:com|co|io|ai|org|net)$/g, "");
}

function editDistance(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, index) => [index]);

  for (let column = 1; column <= b.length; column += 1) {
    rows[0][column] = column;
  }

  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      rows[row][column] =
        a[row - 1] === b[column - 1]
          ? rows[row - 1][column - 1]
          : 1 +
            Math.min(
              rows[row - 1][column - 1],
              rows[row - 1][column],
              rows[row][column - 1],
            );
    }
  }

  return rows[a.length][b.length];
}

async function columnValuesForUpdateIntent(
  updateIntent: NonNullable<ReturnType<typeof mondayUpdateIntent>>,
  deal: SalesDeal,
) {
  if (updateIntent.kind === "meeting-booked") {
    return {
      [callStageColumnIdFor(deal)]: {
        label: isCmoDinnerDeal(deal) ? "Meeting Booked" : "Booked a Meeting",
      },
    };
  }

  if (updateIntent.kind === "sales-qualified") {
    return {
      [callStageColumnIdFor(deal)]: {
        label: "Sales Qualified",
      },
    };
  }

  if (updateIntent.kind === "sales-qualified-proposal") {
    return {
      [callStageColumnIdFor(deal)]: {
        label: "Sales Qualified",
      },
      [await nextStepsColumnIdFor(deal)]: {
        label: "Proposal Stage",
      },
    };
  }

  if (
    updateIntent.kind === "proposal-stage" ||
    updateIntent.kind === "cmo-proposal-stage" ||
    updateIntent.kind === "proposal-done"
  ) {
    return {
      [await nextStepsColumnIdFor(deal)]: {
        label: updateIntent.kind === "proposal-done" ? "Proposal Done" : "Proposal Stage",
      },
    };
  }

  return {
    [finalVerdictColumnIdFor(deal)]: {
      label:
        updateIntent.kind === "lost"
          ? "Lost"
          : updateIntent.kind === "signed-stage"
            ? "Signed"
            : "Agreement Stage",
    },
  };
}

function updateBodyForIntent(
  updateIntent: NonNullable<ReturnType<typeof mondayUpdateIntent>>,
  question: string,
) {
  const note = extractMondayUpdateNote(question);

  if (!note) return "";

  return `Sales Brain update: ${updateIntent.description}.\n\nNote from Lark:\n${note}`;
}

function extractMondayUpdateNote(question: string) {
  const match = question.match(/\b(?:notes?|thread)\s*:\s*(.+)$/i);
  return match?.[1]?.trim() || "";
}

function extractMondayThreadNote(question: string) {
  const explicit = question.match(/\b(?:notes?|comment|thread)\s*:\s*(.+)$/i);
  if (explicit?.[1]?.trim()) return explicit[1].trim();

  const natural = question.match(
    /\b(?:put|add|post|write|leave)\s+(?:a\s+)?(?:comment|note|update)\s+(?:in|on|to)\s+(?:the\s+)?(?:monday\s+|crm\s+)?thread\s+(?:that\s+)?(.+)$/i,
  );
  if (natural?.[1]?.trim()) return natural[1].trim();

  const trailing = question.match(/\b(?:comment|note|update)\s+(?:that\s+)?(.+)$/i);
  return trailing?.[1]?.trim() || "";
}

function callStageColumnIdFor(deal: SalesDeal) {
  return isCmoDinnerDeal(deal) ? CMO_DINNER_AFTER_DINNER_STATUS_COLUMN_ID : CALL_STAGE_COLUMN_ID;
}

async function nextStepsColumnIdFor(deal: SalesDeal) {
  if (!isCmoDinnerDeal(deal)) return NEXT_STEPS_COLUMN_ID;

  const boardId = deal.boardId || CMO_DINNER_BOARD_ID;
  return (await getBoardColumnIdByTitle(boardId, "Next Steps")) || NEXT_STEPS_COLUMN_ID;
}

async function lastFollowUpColumnIdFor(deal: SalesDeal) {
  if (!isCmoDinnerDeal(deal)) return LAST_FOLLOW_UP_COLUMN_ID;

  const boardId = deal.boardId || CMO_DINNER_BOARD_ID;
  return (
    (await getBoardColumnIdByTitle(boardId, "Last follow up")) ||
    (await getBoardColumnIdByTitle(boardId, "Last Follow Up")) ||
    LAST_FOLLOW_UP_COLUMN_ID
  );
}

function finalVerdictColumnIdFor(deal: SalesDeal) {
  return isCmoDinnerDeal(deal) ? CMO_DINNER_FINAL_VERDICT_COLUMN_ID : FINAL_VERDICT_COLUMN_ID;
}

function isCmoDinnerDeal(deal: SalesDeal) {
  return deal.boardId === CMO_DINNER_BOARD_ID || (deal.boardName || "").toLowerCase().includes("cmo dinner");
}

function isReadOnlySalesQuestion(normalized: string) {
  const asksForAnswer =
    /\b(how many|what|which|who|where|when|why|list|show|tell|give|get|report|count|summary|update on)\b/.test(
      normalized,
    );
  const asksAboutSales =
    /\b(lead|leads|sql|qualified|inbound|outbound|call|calls|meeting|meetings|pipeline|crm|sales)\b/.test(
      normalized,
    );

  return asksForAnswer && asksAboutSales;
}

function findDealMatches({
  question,
  conversation,
  deals,
}: {
  question: string;
  conversation: ConversationMessage[];
  deals: SalesDeal[];
}) {
  const recentUserMessages = conversation
    .filter((message) => message.role === "user")
    .slice(-3)
    .map((message) => message.text);
  const directTokens = searchTokens(question);
  const contextTokens = searchTokens([...recentUserMessages, question].join(" "));
  const tokens = directTokens.length ? directTokens : contextTokens;
  const boardHint = boardContextHint([...recentUserMessages, question].join(" "));
  const candidateDeals = boardHint
    ? deals.filter((deal) => dealMatchesBoardHint(deal, boardHint))
    : deals;

  if (!tokens.length) return [];
  if (boardHint && !candidateDeals.length) return [];

  const ranked = candidateDeals
    .map((deal) => {
      const directScore = relevanceScore(deal, tokens);
      const contextBonus = directScore > 0 ? relevanceScore(deal, contextTokens) * 0.25 : 0;
      const boardBonus =
        boardHint && dealMatchesBoardHint(deal, boardHint) && directScore > 0 ? 40 : 0;

      return {
        deal,
        score: directScore + contextBonus + boardBonus,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const exactNameMatch = singleExactNameMatch(ranked, question);
  if (exactNameMatch) return [exactNameMatch.deal];

  const exactAccountMatch = singleStrongAccountMatch(ranked, tokens);
  if (exactAccountMatch) return [exactAccountMatch.deal];

  const confidentMatch = confidentSingleMatch(ranked);
  if (confidentMatch) return [confidentMatch.deal];

  return ranked.map((item) => item.deal);
}

function singleExactNameMatch(ranked: Array<{ deal: SalesDeal; score: number }>, question: string) {
  const normalizedQuestion = normalizeSearch(question);
  const matches = ranked.filter(({ deal }) => {
    const account = normalizeSearch(deal.account);
    const contact = normalizeSearch(`${deal.firstName}${deal.lastName}`);

    return (
      (account.length >= 4 && normalizedQuestion.includes(account)) ||
      (contact.length >= 4 && normalizedQuestion.includes(contact))
    );
  });

  return matches.length === 1 ? matches[0] : null;
}

function singleStrongAccountMatch(
  ranked: Array<{ deal: SalesDeal; score: number }>,
  tokens: string[],
) {
  const matches = ranked.filter(({ deal }) => {
    const account = normalizeSearch(deal.account);

    return tokens.some(
      (token) =>
        account === token ||
        (token.length >= 4 && account.includes(token)) ||
        (token.length >= 4 && token.includes(account) && account.length >= 4),
    );
  });

  return matches.length === 1 ? matches[0] : null;
}

function confidentSingleMatch(ranked: Array<{ deal: SalesDeal; score: number }>) {
  const [top, second] = ranked;

  if (!top) return null;
  if (!second) return top.score >= 80 ? top : null;

  const scoreGap = top.score - second.score;

  if (top.score >= 180 && scoreGap >= 80) return top;
  if (top.score >= 280 && scoreGap >= 40 && isCmoDinnerDeal(top.deal)) return top;

  return null;
}

function relevanceScore(deal: SalesDeal, tokens: string[]) {
  const account = normalizeSearch(deal.account);
  const email = normalizeSearch(deal.email);
  const firstName = normalizeSearch(deal.firstName);
  const lastName = normalizeSearch(deal.lastName);
  const website = normalizeSearch(deal.website);
  const phone = normalizeSearch(deal.phone);
  const boardName = normalizeSearch(deal.boardName || "");
  const searchable = `${account} ${email} ${firstName} ${lastName} ${website} ${phone} ${boardName}`;
  let score = 0;
  let matchedAccount = false;
  let matchedExactAccount = false;
  let matchedFirstName = false;

  for (const token of tokens) {
    if (phone && (phone.includes(token) || token.includes(phone))) score += 120;
    if (email && email.includes(token)) score += 80;
    if (firstName && firstName === token) {
      score += 70;
      matchedFirstName = true;
    }
    if (lastName && lastName === token) score += 70;
    if (account && account === token) {
      score += 100;
      matchedAccount = true;
      matchedExactAccount = true;
    } else if (account && (account.includes(token) || token.includes(account))) {
      score += 40;
      matchedAccount = true;
    }
    if (boardName && boardName.includes(token)) score += 8;
    else if (searchable.includes(token)) score += 12;
  }

  if (matchedExactAccount && matchedFirstName) score += 150;
  else if (matchedAccount && matchedFirstName) score += 20;

  return score;
}

function boardContextHint(text: string) {
  const normalized = text.toLowerCase();

  if (/\b(cmo|dinner)\b/.test(normalized)) return "cmo-dinner";
  return "";
}

function dealMatchesBoardHint(deal: SalesDeal, hint: string) {
  if (hint === "cmo-dinner") {
    return deal.boardId === CMO_DINNER_BOARD_ID || (deal.boardName || "").toLowerCase().includes("cmo dinner");
  }

  return false;
}

function searchTokens(text: string) {
  const stopWords = new Set([
    "agreement",
    "action",
    "add",
    "booked",
    "board",
    "called",
    "cmo",
    "comment",
    "confirm",
    "company",
    "crm",
    "dinner",
    "from",
    "good",
    "great",
    "lead",
    "meeting",
    "monday",
    "move",
    "make",
    "no",
    "note",
    "notes",
    "one",
    "please",
    "put",
    "reply",
    "stage",
    "status",
    "that",
    "thread",
    "update",
    "website",
    "with",
    "yes",
  ]);

  return [
    ...new Set(
      text
        .split(/[^a-zA-Z0-9@._-]+/)
        .map((token) => normalizeSearch(token))
        .filter((token) => token.length >= 3 && !stopWords.has(token)),
    ),
  ];
}

function normalizeSearch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function todayInSingapore() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatDealOption(deal: SalesDeal) {
  const email = deal.email ? `, ${deal.email}` : "";
  const status = [deal.callStage, deal.nextStepsStatus, deal.finalVerdict]
    .filter((value) => value && value !== "5")
    .join(", ");

  return `${deal.account}${email}${status ? ` (${status})` : ""}`;
}

function formatSelectedDeal(deal: SalesDeal) {
  const contact = [deal.firstName, deal.lastName].filter(Boolean).join(" ");
  const email = deal.email ? `, ${deal.email}` : "";
  const contactText = contact ? ` (${contact}${email})` : email ? ` (${deal.email})` : "";

  return `${deal.account}${contactText}`;
}
