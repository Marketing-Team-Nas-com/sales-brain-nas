import { NextRequest, NextResponse } from "next/server";
import { create12HourSalesPulse } from "../../../lib/sales-pulse-12h-report";

export async function POST(request: NextRequest) {
  const expected = process.env.SALES_BRAIN_CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Invalid cron secret." }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    chatId?: string;
    scheduledAt?: string;
    sendToChat?: boolean;
  };
  try {
    return NextResponse.json(await create12HourSalesPulse({
      chatId: body.chatId,
      scheduledAt: body.scheduledAt,
      sendToChat: body.sendToChat !== false,
    }));
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to create Sales Pulse.",
    }, { status: 502 });
  }
}
