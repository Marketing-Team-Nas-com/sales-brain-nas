import { NextRequest, NextResponse } from "next/server";
import { sendLarkTextReport } from "../../../lib/lark";
import {
  appendSalesContextNote,
  getLatestSalesMemory,
  type SalesContextNote,
} from "../../../lib/sales-memory";
import type { SalesDeal } from "../../../lib/monday";

type InboundEmailPayload = {
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  text?: string;
  html?: string;
  date?: string;
  messageId?: string;
  headers?: Record<string, string>;
};

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.SALES_BRAIN_EMAIL_SECRET;

  if (!expectedSecret) {
    return NextResponse.json(
      { error: "SALES_BRAIN_EMAIL_SECRET is not configured." },
      { status: 500 },
    );
  }

  const receivedSecret =
    request.headers.get("x-sales-brain-email-secret") ||
    request.nextUrl.searchParams.get("secret");

  if (receivedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Invalid email webhook secret." }, { status: 401 });
  }

  const email = await parseInboundEmail(request);

  if (!email.from && !email.subject && !email.text && !email.html) {
    return NextResponse.json({ error: "No email content received." }, { status: 400 });
  }

  const body = normalizeWhitespace(email.text || stripHtml(email.html || ""));
  const rawText = [
    `From: ${email.from || "unknown"}`,
    `To: ${email.to || ""}`,
    `Cc: ${email.cc || ""}`,
    `Subject: ${email.subject || "(no subject)"}`,
    "",
    body,
  ].join("\n");
  const memory = await getLatestSalesMemory();
  const deal = findEmailDealMatch(email, body, memory?.deals || []);
  const note = formatEmailMemoryNote(email, body, deal);
  const saved = await appendSalesContextNote({
    threadId: `email:${email.messageId || `${email.from || "unknown"}:${Date.now()}`}`,
    source: "email",
    rawText,
    note,
    ...(deal
      ? {
          account: deal.account,
          itemId: deal.id,
          email: deal.email,
        }
      : {}),
  });

  await notifyEmailMonitor({ email, note: saved, deal });

  return NextResponse.json({
    ok: true,
    matched: deal
      ? {
          account: deal.account,
          email: deal.email,
          itemId: deal.id,
        }
      : null,
  });
}

async function parseInboundEmail(request: NextRequest): Promise<InboundEmailPayload> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return normalizeEmailPayload((await request.json()) as Record<string, unknown>);
  }

  if (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    const formData = await request.formData();
    return normalizeEmailPayload(Object.fromEntries(formData.entries()));
  }

  return {
    text: await request.text(),
  };
}

function normalizeEmailPayload(raw: Record<string, unknown>): InboundEmailPayload {
  const stringFor = (...keys: string[]) => {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }

    return "";
  };

  return {
    from: stringFor("from", "sender", "From"),
    to: stringFor("to", "recipient", "To"),
    cc: stringFor("cc", "Cc"),
    subject: stringFor("subject", "Subject"),
    text: stringFor("text", "body-plain", "stripped-text", "plain", "TextBody"),
    html: stringFor("html", "body-html", "HtmlBody"),
    date: stringFor("date", "Date"),
    messageId: stringFor("messageId", "message-id", "Message-Id", "MessageID"),
  };
}

function findEmailDealMatch(
  email: InboundEmailPayload,
  body: string,
  deals: SalesDeal[],
) {
  const emailAddresses = extractEmailAddresses([email.from, email.to, email.cc, body].join(" "));
  const domains = emailAddresses.map(emailDomain).filter(Boolean);
  const searchableText = normalizeSearch([email.subject, body].join(" "));

  const emailMatch = deals.find((deal) =>
    deal.email ? emailAddresses.includes(deal.email.toLowerCase()) : false,
  );

  if (emailMatch) return emailMatch;

  const accountMatch = deals
    .map((deal) => {
      const account = normalizeSearch(deal.account);
      const domain = emailDomain(deal.email) || domainFromWebsite(deal.website);
      let score = 0;

      if (account.length >= 4 && searchableText.includes(account)) score += 4;
      if (domain && domains.includes(domain)) score += 3;
      if (domain && searchableText.includes(domain.replace(/\..+$/, ""))) score += 2;

      return { deal, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  return accountMatch?.deal || null;
}

function formatEmailMemoryNote(
  email: InboundEmailPayload,
  body: string,
  deal: SalesDeal | null,
) {
  const preview = normalizeWhitespace(body).slice(0, 1200);
  const matched = deal ? `Matched CRM record: ${deal.account}${deal.email ? ` (${deal.email})` : ""}` : "No CRM record matched yet";

  return [
    `Email received: ${email.subject || "(no subject)"}`,
    `From: ${email.from || "unknown"}`,
    email.date ? `Date: ${email.date}` : "",
    matched,
    "",
    preview,
  ]
    .filter(Boolean)
    .join("\n");
}

async function notifyEmailMonitor({
  email,
  note,
  deal,
}: {
  email: InboundEmailPayload;
  note: SalesContextNote;
  deal: SalesDeal | null;
}) {
  const monitorChatId =
    process.env.LARK_EMAIL_MONITOR_CHAT_ID ||
    process.env.LARK_DM_MONITOR_CHAT_ID ||
    process.env.LARK_SALES_REPORT_CHAT_ID ||
    process.env.LARK_SALES_CHAT_ID;

  if (!monitorChatId) return;

  try {
    await sendLarkTextReport({
      chatId: monitorChatId,
      text: [
        "Harry email memory",
        `From: ${email.from || "unknown"}`,
        `Subject: ${email.subject || "(no subject)"}`,
        deal ? `Matched: ${deal.account}${deal.email ? ` (${deal.email})` : ""}` : "Matched: none yet",
        "",
        truncateForLark(note.note),
      ].join("\n"),
    });
  } catch (error) {
    console.error("Unable to send Harry email monitor notification", error);
  }
}

function extractEmailAddresses(text: string) {
  return [...text.toLowerCase().matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g)].map(
    (match) => match[0],
  );
}

function emailDomain(email: string) {
  return email.includes("@") ? email.split("@").pop()?.toLowerCase() || "" : "";
}

function domainFromWebsite(website: string) {
  const match = website.toLowerCase().match(/(?:https?:\/\/)?(?:www\.)?([^/\s]+)/);
  return match?.[1] || "";
}

function stripHtml(html: string) {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function normalizeWhitespace(text: string) {
  return text.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeSearch(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function truncateForLark(text: string) {
  return text.length > 1500 ? `${text.slice(0, 1497)}...` : text;
}
