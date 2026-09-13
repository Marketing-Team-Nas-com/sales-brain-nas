import { NextRequest, NextResponse } from "next/server";
import { createExecutiveSalesPulseReport } from "../../../lib/executive-sales-pulse-report";

type ReportRequest = {
  chatId?: string;
  sendToChat?: boolean;
};

export async function POST(request: NextRequest) {
  const expected = process.env.SALES_BRAIN_CRON_SECRET;
  const provided = request.headers.get("authorization");
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Invalid cron secret." }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as ReportRequest;

  try {
    const result = await createExecutiveSalesPulseReport({
      chatId: body.chatId,
      sendToChat: body.sendToChat !== false,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to create twice-weekly sales report.",
      },
      { status: 502 },
    );
  }
}
