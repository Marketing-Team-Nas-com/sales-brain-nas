import { NextRequest, NextResponse } from "next/server";
import { createDailyNewspaperReport } from "../../../lib/daily-newspaper-report";

export async function GET(request: NextRequest) {
  const secret = process.env.SALES_BRAIN_CRON_SECRET;
  const receivedSecret = request.nextUrl.searchParams.get("secret");

  if (secret && receivedSecret !== secret) {
    return NextResponse.json({ error: "Invalid cron secret." }, { status: 401 });
  }

  try {
    const format = request.nextUrl.searchParams.get("format");
    const publish = request.nextUrl.searchParams.get("publish") === "true";
    const previewOnly = request.nextUrl.searchParams.get("preview") === "true" || !publish;
    const sendParam = request.nextUrl.searchParams.get("send");
    const result = await createDailyNewspaperReport({
      previewOnly,
      createLarkDoc: publish,
      sendToChat: publish && sendParam !== "false",
    });

    if (format === "html" && typeof result.html === "string") {
      return new NextResponse(result.html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    }

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
