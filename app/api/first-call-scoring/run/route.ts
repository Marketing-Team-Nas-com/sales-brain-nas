import { NextRequest, NextResponse } from "next/server";
import { runFirstCallScoring } from "../../../lib/first-call-scoring/run";

export async function POST(request: NextRequest) {
  const secret = process.env.FIRST_CALL_SCORING_CRON_SECRET || process.env.SALES_BRAIN_CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Invalid cron secret." }, { status: 401 });
  try { return NextResponse.json(await runFirstCallScoring()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to run first-call scoring." }, { status: 502 }); }
}
