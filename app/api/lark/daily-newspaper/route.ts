import { NextRequest, NextResponse } from "next/server";
import { createDailyNewspaperReport } from "../../../lib/daily-newspaper-report";

export async function GET(request: NextRequest) {
  const secret = process.env.SALES_BRAIN_CRON_SECRET;
  const receivedSecret = request.nextUrl.searchParams.get("secret");

  if (secret && receivedSecret !== secret) {
    return NextResponse.json({ error: "Invalid cron secret." }, { status: 401 });
  }

  try {
    const previewOnly = request.nextUrl.searchParams.get("preview") === "true";
    const sendParam = request.nextUrl.searchParams.get("send");
    const result = await createDailyNewspaperReport({
      previewOnly,
      sendToChat: previewOnly ? sendParam === "true" : sendParam !== "false",
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create daily newspaper report.",
      },
      { status: 500 },
    );
  }
}
