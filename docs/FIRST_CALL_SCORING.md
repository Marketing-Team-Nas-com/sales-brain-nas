# Nas Force First Call Scoring

This feature scores completed original first sales meetings from their Gemini notes, posts the review to Lark, and creates a matching audit update on the Monday item.

## Non-negotiable scoring rules

- Score only the original first meeting. Follow-ups, demos, and proposal reviews are excluded.
- Gemini first-call notes are the sole scoring evidence.
- Monday pipeline stage, later qualification, follow-up activity, later notes, and eventual progression never influence the score.
- The score measures how the salesperson uncovered, deepened, connected, and advanced the opportunity.
- Category scores are whole numbers. The overall score is their equal-weight average to one decimal.
- Missing information limits a category only when it creates a meaningful commercial gap.
- A proposal review is preferred, but a clear stakeholder follow-up with an action, owner, and timing can also score strongly.

## Categories and verdicts

The five categories are Discovery, Qualification, Pitch, Buying Process, and Next-Step Execution.

- Below 4.5: Weak
- 4.5–6.4: Mixed
- 6.5–7.9: Good
- 8.0–10: Strong

## Workflow

1. Load the Monday sales board.
2. Accept only records whose first-meeting date exists and whose call stage confirms a completed meeting: `Sales Qualified`, `Not Qualified`, or `In Review`.
3. Exclude `Booked a Meeting`, `Cancelled`, `No Show`, and `Rescheduled`.
4. Read pasted Gemini notes or export the linked Google Doc.
5. If notes are missing or inaccessible, post one deduplicated alert and tag the assigned agent when their Lark ID is configured.
6. Generate a structured AI score.
7. Post the detailed review to Lark and a condensed audit update to Monday.
8. Use Monday item ID and the `[First Call QA — AI Scoring]` marker to prevent duplicates.

## Configuration

Copy `.env.example` to the deployment environment and configure:

- `MONDAY_API_TOKEN` and `MONDAY_SALES_BOARD_ID`
- `LARK_APP_ID` and `LARK_APP_SECRET`
- `OPENAI_API_KEY`
- `FIRST_CALL_SCORING_LARK_CHAT_ID`
- `FIRST_CALL_SCORING_LARK_OWNER_IDS`, a JSON object mapping salesperson names to Lark open IDs
- `FIRST_CALL_SCORING_CRON_SECRET`
- Optional model and reasoning overrides

Never commit a real `.env` file or credentials.

## Running

For a manual run:

```bash
npm run first-call-scoring:run
```

For automation, make an authenticated `POST` request to `/api/first-call-scoring/run`:

```bash
curl -X POST https://YOUR_DEPLOYMENT/api/first-call-scoring/run \
  -H "Authorization: Bearer $FIRST_CALL_SCORING_CRON_SECRET"
```

Configure Railway, GitHub Actions, or another scheduler to invoke this endpoint. The endpoint is safe to retry because publishing is deduplicated using Monday updates.

This repository includes `.github/workflows/first-call-scoring.yml`, which runs hourly at minute 15 and can also be triggered manually. Add these encrypted GitHub Actions secrets before enabling it:

- `FIRST_CALL_SCORING_URL`: the deployed application origin, without a trailing slash
- `FIRST_CALL_SCORING_CRON_SECRET`: the same secret configured in the deployment

## Important operational limitation

Linked Gemini Google Docs must be readable by the deployed service. If they are private, configure the document-sharing workflow so the integration has access; otherwise the agent will post an access alert rather than score the call.
