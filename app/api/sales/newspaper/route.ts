import { NextRequest, NextResponse } from "next/server";
import { readSavedDailyNewspaperHtml } from "../../../lib/daily-newspaper-report";

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date") || undefined;
  const report = await readSavedDailyNewspaperHtml(date);

  if (!report) {
    return NextResponse.json(
      {
        error: "No Sales Brain newspaper has been generated for that date yet.",
      },
      { status: 404 },
    );
  }

  return new NextResponse(report.html, {
    headers: {
      "Cache-Control": "public, max-age=60",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
