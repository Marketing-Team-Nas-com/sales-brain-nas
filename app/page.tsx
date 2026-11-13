import { getMarketingScorecard, type ScorecardRange } from "./lib/marketing-scorecard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function money(value: number | null) {
  return Number.isFinite(value) ? currency.format(value as number) : "N/A";
}

function whole(value: number | null) {
  return Number.isFinite(value) ? Math.round(value as number).toLocaleString("en-US") : "N/A";
}

function percent(value: number | null) {
  return Number.isFinite(value) ? `${Math.round((value as number) * 100)}%` : "N/A";
}

export default async function Home() {
  try {
    const scorecard = await getMarketingScorecard();
    return <ScorecardPage scorecard={scorecard} />;
  } catch (error) {
    return <UnavailablePage message={error instanceof Error ? error.message : "Live data unavailable."} />;
  }
}

function ScorecardPage({
  scorecard,
}: {
  scorecard: Awaited<ReturnType<typeof getMarketingScorecard>>;
}) {
  const { today, daily, previousDaily, rolling, previousRolling } = scorecard;

  return (
    <main className="min-h-screen bg-[#f4f0e8] text-[#171717]">
      <section className="border-b-4 border-[#171717] bg-[#fbf8f0] px-5 py-5">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-3 border-b border-[#171717] pb-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-serif text-sm uppercase tracking-[0.26em] text-[#6b6254]">
                Nas B2B Marketing Desk
              </p>
              <h1 className="mt-2 font-serif text-5xl font-semibold leading-none tracking-normal md:text-7xl">
                The Growth Ledger
              </h1>
            </div>
            <div className="font-serif text-sm uppercase tracking-[0.18em] text-[#3f392f] md:text-right">
              <p>Daily CEO Edition</p>
              <p>{formatDisplayDate(today)} SGT</p>
            </div>
          </div>

          <div className="grid gap-5 py-6 md:grid-cols-[1.4fr_0.8fr] md:items-end">
            <div>
              <p className="font-serif text-sm uppercase tracking-[0.18em] text-[#6b6254]">
                Front Page Read
              </p>
              <h2 className="mt-3 max-w-4xl font-serif text-4xl font-semibold leading-tight md:text-6xl">
                {frontPageHeadline(daily, rolling)}
              </h2>
            </div>
            <p className="border-l-4 border-[#171717] pl-4 text-lg leading-8 text-[#352f27]">
              {frontPageRead(daily, previousDaily, rolling, previousRolling)}
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[0.95fr_1.25fr]">
        <article className="border-y-2 border-[#171717] py-5">
          <p className="font-serif text-sm uppercase tracking-[0.2em] text-[#6b6254]">
            Today So Far
          </p>
          <h2 className="mt-2 font-serif text-4xl font-semibold">Daily CEO Read</h2>
          <p className="mt-2 font-serif text-sm uppercase tracking-[0.14em] text-[#6b6254]">
            {formatShortRange(daily.from, daily.to)} vs {formatShortRange(previousDaily.from, previousDaily.to)}
          </p>
          <p className="mt-4 text-lg leading-8">
            This is the live read from the dashboard and sheet. Qualified outcomes can lag
            the day&apos;s lead flow, so the daily view is best for CPA movement and call
            activity, while qualified CPA should be judged on the rolling week.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-px bg-[#171717]">
            <Stat
              label="Spend"
              value={money(daily.spend)}
              delta={delta(daily.spend, previousDaily.spend, "vs yesterday")}
              tone={deltaTone(daily.spend, previousDaily.spend, true)}
            />
            <Stat
              label="Total leads"
              value={whole(daily.totalLeads)}
              delta={delta(daily.totalLeads, previousDaily.totalLeads, "vs yesterday")}
              tone={deltaTone(daily.totalLeads, previousDaily.totalLeads, false)}
            />
            <Stat
              label="Agent-Fit leads"
              value={whole(daily.agentFitLeads)}
              delta={delta(daily.agentFitLeads, previousDaily.agentFitLeads, "vs yesterday")}
              tone={deltaTone(daily.agentFitLeads, previousDaily.agentFitLeads, false)}
            />
            <Stat
              label="CPA per Agent-Fit"
              value={money(daily.agentFitCpa)}
              delta={delta(daily.agentFitCpa, previousDaily.agentFitCpa, "vs yesterday")}
              tone={deltaTone(daily.agentFitCpa, previousDaily.agentFitCpa, true)}
            />
            <Stat
              label="Call activity"
              value={whole(daily.callActivity)}
              delta={delta(daily.callActivity, previousDaily.callActivity, "vs yesterday")}
              tone={deltaTone(daily.callActivity, previousDaily.callActivity, false)}
            />
            <Stat
              label="CPA per call"
              value={money(daily.callCpa)}
              delta={delta(daily.callCpa, previousDaily.callCpa, "vs yesterday")}
              tone={deltaTone(daily.callCpa, previousDaily.callCpa, true)}
            />
          </div>

          <div className="mt-6 border-t border-[#171717] pt-5">
            <h3 className="font-serif text-2xl font-semibold">Stage Snapshot</h3>
            <div className="mt-4 space-y-3 text-base">
              <Line label="Sales Qualified" value={daily.salesQualified} />
              <Line label="Call Stage Pending (formerly In Review), not counted as SQL" value={daily.callStagePending} />
              <Line label="Booked meetings" value={daily.bookedMeetings} />
              <Line label="No-shows" value={daily.noShows} />
              <Line label="Cancelled" value={daily.cancelled} />
              <Line label="Not yet staged" value={daily.blanks} />
            </div>
          </div>

          <div className="mt-6 bg-[#171717] p-5 text-[#fbf8f0]">
            <p className="font-serif text-sm uppercase tracking-[0.18em] text-[#d7cdbb]">
              One-line read
            </p>
            <p className="mt-2 text-xl leading-8">{dailyOneLine(daily, previousDaily)}</p>
          </div>
        </article>

        <article className="border-y-2 border-[#171717] py-5">
          <div className="flex flex-col gap-2 border-b border-[#171717] pb-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-serif text-sm uppercase tracking-[0.2em] text-[#6b6254]">
                Rolling 7 Days
              </p>
              <h2 className="mt-2 font-serif text-4xl font-semibold">Quality Scorecard</h2>
            </div>
            <p className="font-serif text-sm uppercase tracking-[0.14em] text-[#6b6254]">
              {formatShortRange(rolling.from, rolling.to)}
            </p>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-px bg-[#171717] md:grid-cols-4">
            <Stat
              label="Spend"
              value={money(rolling.spend)}
              delta={delta(rolling.spend, previousRolling.spend, "vs prior 7 days")}
              tone="neutral"
            />
            <Stat
              label="Agent-Fit leads"
              value={whole(rolling.agentFitLeads)}
              delta={delta(rolling.agentFitLeads, previousRolling.agentFitLeads, "vs prior 7 days")}
              tone={deltaTone(rolling.agentFitLeads, previousRolling.agentFitLeads, false)}
            />
            <Stat
              label="Agent-Fit CPA"
              value={money(rolling.agentFitCpa)}
              delta={delta(rolling.agentFitCpa, previousRolling.agentFitCpa, "vs prior 7 days")}
              tone={deltaTone(rolling.agentFitCpa, previousRolling.agentFitCpa, true)}
            />
            <Stat
              label="Projected SQL CPA"
              value={`~${money(rolling.projectedQualifiedCpa)}`}
              delta={delta(rolling.projectedQualifiedCpa, previousRolling.projectedQualifiedCpa, "vs prior 7 days")}
              tone={deltaTone(rolling.projectedQualifiedCpa, previousRolling.projectedQualifiedCpa, true)}
            />
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-[1fr_0.9fr]">
            <div>
              <h3 className="font-serif text-2xl font-semibold">The Math</h3>
              <p className="mt-3 text-lg leading-8">
                We are not counting Call Stage Pending (formerly In Review) as SQL. Resolved
                conversion includes no-shows, reschedules, and cancellations, and excludes only
                booked meetings not held yet.
              </p>
              <div className="mt-5 space-y-3 text-base">
                <Line label="Sales Qualified" value={rolling.salesQualified} />
                <Line label="Call Stage Pending (formerly In Review), not counted as SQL" value={rolling.callStagePending} />
                <Line label="No-shows" value={rolling.noShows} />
                <Line label="Not Qualified" value={rolling.notQualified} />
                <Line label="Rescheduled" value={rolling.rescheduled} />
                <Line label="Cancelled" value={rolling.cancelled} />
                <Line label="Booked meetings, not held yet" value={rolling.bookedMeetings} />
              </div>
            </div>

            <div className="border-l-0 border-[#171717] pt-1 md:border-l md:pl-6">
              <p className="font-serif text-sm uppercase tracking-[0.18em] text-[#6b6254]">
                Projection
              </p>
              <p className="mt-3 font-serif text-5xl font-semibold">
                {percent(rolling.sqlRate)}
              </p>
              <p className="mt-2 text-base leading-7">
                SQL rate excluding Call Stage Pending (formerly In Review), including no-shows, reschedules, and cancellations.
              </p>

              <div className="mt-6 border-t border-[#171717] pt-5">
                <p className="font-serif text-5xl font-semibold">~{rolling.projectedSqls}</p>
                <p className="mt-2 text-base leading-7">Projected Sales Qualified leads</p>
              </div>

              <div className="mt-6 border-t border-[#171717] pt-5">
                <p className="font-serif text-5xl font-semibold">
                  ~{money(rolling.projectedQualifiedCpa)}
                </p>
                <p className="mt-2 text-base leading-7">
                  Cost per projected qualified lead, compared with ~
                  {money(previousRolling.projectedQualifiedCpa)} in the prior 7-day period.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-7 border-t-2 border-[#171717] pt-5">
            <h3 className="font-serif text-2xl font-semibold">CEO Takeaway</h3>
            <p className="mt-3 text-lg leading-8">{rollingTakeaway(rolling, previousRolling)}</p>
          </div>
        </article>
      </section>
    </main>
  );
}

function UnavailablePage({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-[#f4f0e8] px-5 py-12 text-[#171717]">
      <section className="mx-auto max-w-3xl border-y-2 border-[#171717] py-8">
        <p className="font-serif text-sm uppercase tracking-[0.26em] text-[#6b6254]">
          Nas B2B Marketing Desk
        </p>
        <h1 className="mt-3 font-serif text-5xl font-semibold">The Growth Ledger</h1>
        <p className="mt-6 text-xl leading-8">
          Live data is not available right now, so I am not showing stale numbers.
        </p>
        <p className="mt-4 border-l-4 border-[#171717] pl-4 text-base text-[#6b6254]">{message}</p>
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  delta: deltaText,
  tone = "neutral",
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: "good" | "bad" | "neutral";
}) {
  const toneClass = {
    good: "text-[#23633d]",
    bad: "text-[#9a2f2f]",
    neutral: "text-[#6b6254]",
  }[tone];

  return (
    <div className="bg-[#fbf8f0] p-4">
      <p className="font-serif text-xs uppercase tracking-[0.18em] text-[#6b6254]">{label}</p>
      <p className="mt-2 font-serif text-3xl font-semibold">{value}</p>
      {deltaText ? <p className={`mt-2 text-sm font-medium ${toneClass}`}>{deltaText}</p> : null}
    </div>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[#cfc5b3] pb-2">
      <span>{label}</span>
      <span className="font-serif text-2xl font-semibold">{value}</span>
    </div>
  );
}

function delta(current: number | null, previous: number | null, suffix: string) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return "";
  const change = ((current as number) - (previous as number)) / (previous as number);
  const rounded = Math.round(Math.abs(change) * 100);
  if (rounded === 0) return `Flat ${suffix}`;
  return `${change > 0 ? "Up" : "Down"} ${rounded}% ${suffix}`;
}

function deltaTone(current: number | null, previous: number | null, lowerIsBetter: boolean) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return "neutral";
  const change = ((current as number) - (previous as number)) / (previous as number);
  if (Math.round(Math.abs(change) * 100) === 0) return "neutral";
  const isGood = lowerIsBetter ? change < 0 : change > 0;
  return isGood ? "good" : "bad";
}

function frontPageHeadline(daily: ScorecardRange, rolling: ScorecardRange) {
  if (rolling.projectedQualifiedCpa && rolling.projectedQualifiedCpa <= 700) {
    return "The weekly funnel is still holding, but daily quality needs watching.";
  }
  if (daily.agentFitLeads === 0) {
    return "Today is a light quality day, and the funnel needs attention.";
  }
  return "The machine is producing signal, but the next calls decide the story.";
}

function frontPageRead(
  daily: ScorecardRange,
  previousDaily: ScorecardRange,
  rolling: ScorecardRange,
  previousRolling: ScorecardRange,
) {
  const dailyFitDelta = delta(daily.agentFitCpa, previousDaily.agentFitCpa, "vs yesterday");
  const rollingCpaDelta = delta(
    rolling.projectedQualifiedCpa,
    previousRolling.projectedQualifiedCpa,
    "vs prior 7 days",
  );
  return `Daily Agent-Fit CPA is ${money(daily.agentFitCpa)}${dailyFitDelta ? `, ${dailyFitDelta.toLowerCase()}` : ""}. Rolling projected qualified CPA is ~${money(rolling.projectedQualifiedCpa)}${rollingCpaDelta ? `, ${rollingCpaDelta.toLowerCase()}` : ""}.`;
}

function dailyOneLine(daily: ScorecardRange, previousDaily: ScorecardRange) {
  const fitTone = deltaTone(daily.agentFitCpa, previousDaily.agentFitCpa, true);
  if (fitTone === "bad") {
    return "Today is more expensive than yesterday on Agent-Fit CPA. Watch whether this is tracking lag or traffic quality softening.";
  }
  if (fitTone === "good") {
    return "Today is improving on Agent-Fit CPA. Keep watching whether the cheaper fit volume turns into qualified calls.";
  }
  return "Today is broadly flat. The rolling week remains the better read for qualified lead economics.";
}

function rollingTakeaway(rolling: ScorecardRange, previousRolling: ScorecardRange) {
  const cpaTone = deltaTone(rolling.projectedQualifiedCpa, previousRolling.projectedQualifiedCpa, true);
  if (cpaTone === "good") {
    return `The rolling week is improving on projected qualified CPA, moving from about ${money(previousRolling.projectedQualifiedCpa)} to ${money(rolling.projectedQualifiedCpa)}. Keep spend steady, reduce no-shows, and let booked meetings get held before scaling harder.`;
  }
  if (cpaTone === "bad") {
    return `The rolling week is getting more expensive on projected qualified CPA, moving from about ${money(previousRolling.projectedQualifiedCpa)} to ${money(rolling.projectedQualifiedCpa)}. Check Agent-Fit quality, show rate, and whether spend is drifting into weaker traffic.`;
  }
  return `The rolling week is broadly stable at about ${money(rolling.projectedQualifiedCpa)} per projected qualified lead. The next unlock is still show rate and sales-qualified conversion.`;
}

function formatDisplayDate(dateString: string) {
  return new Date(`${dateString}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatShortRange(from: string, to: string) {
  return `${formatShortDate(from)}-${formatShortDate(to)}`;
}

function formatShortDate(dateString: string) {
  return new Date(`${dateString}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}
