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
  period: "Aug 26-Sep 1, 2026",
  spend: 8954,
  totalLeads: 140,
  agentFitLeads: 25,
  agentFitCpa: 358,
  callActivity: 34,
  callCpa: 263,
  salesQualified: 11,
  inReview: 3,
  noShows: 14,
  notQualified: 2,
  rescheduled: 3,
  pending: 10,
  projectedSqls: 15,
  projectedQualifiedCpa: 597,
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
              the rolling week.
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
            <Stat label="Spend" value={money(daily.spend)} />
            <Stat label="Total leads" value={`${daily.totalLeads}`} />
            <Stat label="Agent-Fit leads" value={`${daily.agentFitLeads}`} />
            <Stat label="CPA per Agent-Fit" value={money(daily.agentFitCpa)} />
            <Stat label="Call activity" value={`${daily.callActivity}`} />
            <Stat label="CPA per call" value={money(daily.callCpa)} />
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
              Booked-call volume is okay, Agent-Fit CPA is high, and tomorrow&apos;s outcomes
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
            <Stat label="Spend" value={money(rolling.spend)} />
            <Stat label="Agent-Fit leads" value={`${rolling.agentFitLeads}`} />
            <Stat label="Agent-Fit CPA" value={money(rolling.agentFitCpa)} />
            <Stat label="Projected SQL CPA" value={`~${money(600)}`} strong />
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
                  Cost per projected qualified lead, rounded to ~{money(600)}.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-7 border-t-2 border-[#171717] pt-5">
            <h3 className="font-serif text-2xl font-semibold">CEO Takeaway</h3>
            <p className="mt-3 text-lg leading-8">
              This is a productive but slightly expensive week. The projected qualified
              CPA is around <b>{money(600)}</b>, which is workable for B2B, but the no-show
              leak is still too high. Keep spend steady, fix show rate, and let the
              pending calls resolve before scaling harder.
            </p>
          </div>
        </article>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="bg-[#fbf8f0] p-4">
      <p className="font-serif text-xs uppercase tracking-[0.18em] text-[#6b6254]">{label}</p>
      <p className="mt-2 font-serif text-3xl font-semibold">{value}</p>
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
