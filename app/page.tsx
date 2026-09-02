const daily = {
  spend: 2628,
  totalLeads: 45,
  agentFitLeads: 6,
  agentFitCpa: 438,
  callActivity: 10,
  callCpa: 263,
  salesQualified: 0,
  inReview: 0,
  bookedMeetings: 7,
  noShows: 2,
  cancelled: 1,
  blanks: 35,
};

const rolling = {
  period: "Aug 27-Sep 2, 2026",
  spend: 9008,
  totalLeads: 130,
  agentFitLeads: 23,
  agentFitCpa: 392,
  callActivity: 39,
  callCpa: 231,
  salesQualified: 10,
  inReview: 2,
  noShows: 11,
  notQualified: 2,
  rescheduled: 2,
  cancelled: 2,
  pending: 10,
  projectedSqls: 14,
  projectedQualifiedCpa: 644,
  conversionRate: 37,
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function money(value: number) {
  return currency.format(value);
}

export default function Home() {
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
              <p>Sep 2, 2026 SGT</p>
            </div>
          </div>

          <div className="grid gap-5 py-6 md:grid-cols-[1.4fr_0.8fr] md:items-end">
            <div>
              <p className="font-serif text-sm uppercase tracking-[0.18em] text-[#6b6254]">
                Front Page Read
              </p>
              <h2 className="mt-3 max-w-4xl font-serif text-4xl font-semibold leading-tight md:text-6xl">
                The machine is booking calls, but today is still a watch day.
              </h2>
            </div>
            <p className="border-l-4 border-[#171717] pl-4 text-lg leading-8 text-[#352f27]">
              Daily quality is not yet visible because qualified outcomes lag. The right CEO
              read is to watch Agent-Fit CPA and call CPA today, then judge qualified CPA on
              the rolling week. Today is down on volume and up on CPA versus yesterday.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[0.95fr_1.25fr]">
        <article className="border-y-2 border-[#171717] py-5">
          <p className="font-serif text-sm uppercase tracking-[0.2em] text-[#6b6254]">
            Today
          </p>
          <h2 className="mt-2 font-serif text-4xl font-semibold">Daily CEO Read</h2>
          <p className="mt-4 text-lg leading-8">
            Today is decent on booking motion, but expensive on Agent-Fit. The funnel has
            not had enough time to show qualified outcomes, so qualified CPA is not
            meaningful yet.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-px bg-[#171717]">
            <Stat label="Spend" value={money(daily.spend)} delta="Down 10% vs yesterday" tone="good" />
            <Stat label="Total leads" value={`${daily.totalLeads}`} delta="Down 21%" tone="bad" />
            <Stat label="Agent-Fit leads" value={`${daily.agentFitLeads}`} delta="Down 40%" tone="bad" />
            <Stat label="CPA per Agent-Fit" value={money(daily.agentFitCpa)} delta="Up 50%" tone="bad" />
            <Stat label="Call activity" value={`${daily.callActivity}`} delta="Down 38%" tone="bad" />
            <Stat label="CPA per call" value={money(daily.callCpa)} delta="Up 44%" tone="bad" />
          </div>

          <div className="mt-6 border-t border-[#171717] pt-5">
            <h3 className="font-serif text-2xl font-semibold">Stage Snapshot</h3>
            <div className="mt-4 space-y-3 text-base">
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
            <p className="mt-2 text-xl leading-8">
              Today is weaker than yesterday: less volume, fewer Agent-Fit leads, and higher
              CPAs. Tomorrow&apos;s outcomes
              will tell us whether this is timing lag or quality dropping.
            </p>
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
              {rolling.period}
            </p>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-px bg-[#171717] md:grid-cols-4">
            <Stat label="Spend" value={money(rolling.spend)} delta="Up 56% vs prior 7 days" tone="neutral" />
            <Stat label="Agent-Fit leads" value={`${rolling.agentFitLeads}`} delta="Up 44%" tone="good" />
            <Stat label="Agent-Fit CPA" value={money(rolling.agentFitCpa)} delta="Up 9%" tone="bad" />
            <Stat label="Projected SQL CPA" value={`~${money(644)}`} delta="Down 11%" tone="good" />
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-[1fr_0.9fr]">
            <div>
              <h3 className="font-serif text-2xl font-semibold">The Math</h3>
              <p className="mt-3 text-lg leading-8">
                We are not counting In Review as SQL. Resolved conversion includes
                no-shows and reschedules, and excludes only pending calls.
              </p>
              <div className="mt-5 space-y-3 text-base">
                <Line label="Sales Qualified" value={rolling.salesQualified} />
                <Line label="In Review, not counted as SQL" value={rolling.inReview} />
                <Line label="No-shows" value={rolling.noShows} />
                <Line label="Not Qualified" value={rolling.notQualified} />
                <Line label="Rescheduled" value={rolling.rescheduled} />
                <Line label="Cancelled" value={rolling.cancelled} />
                <Line label="Pending calls" value={rolling.pending} />
              </div>
            </div>

            <div className="border-l-0 border-[#171717] pt-1 md:border-l md:pl-6">
              <p className="font-serif text-sm uppercase tracking-[0.18em] text-[#6b6254]">
                Projection
              </p>
              <p className="mt-3 font-serif text-5xl font-semibold">
                {rolling.conversionRate}%
              </p>
              <p className="mt-2 text-base leading-7">
                SQL rate excluding In Review, including no-shows and reschedules.
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
                  Cost per projected qualified lead, improved from ~{money(720)} in the prior
                  7-day period.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-7 border-t-2 border-[#171717] pt-5">
            <h3 className="font-serif text-2xl font-semibold">CEO Takeaway</h3>
            <p className="mt-3 text-lg leading-8">
              The rolling week is stronger than the prior week on volume and projected
              qualified CPA. Spend is up, but Agent-Fit volume is up too, and projected SQL
              CPA improved from about <b>{money(720)}</b> to <b>{money(644)}</b>. Keep spend
              steady, fix show rate, and let the pending calls resolve before scaling harder.
            </p>
          </div>
        </article>
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  delta,
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
      {delta ? <p className={`mt-2 text-sm font-medium ${toneClass}`}>{delta}</p> : null}
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
