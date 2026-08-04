# Railway deployment

This app can run on Railway as a long-running web service.

## Required variables

Add these variables to the Railway service before the first deploy:

```env
MONDAY_API_TOKEN=
MONDAY_SALES_BOARD_ID=5029402147
LARK_APP_ID=
LARK_APP_SECRET=
LARK_VERIFICATION_TOKEN=
LARK_SALES_PULSE_CHAT_ID=oc_9a1f9cd3a58c8a005350a0f6851b9a66
LARK_SALES_REPORT_EDITOR_EMAILS=roge@nas.io,alex@nas.io,lesha@nasdaily.com
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra
OPENAI_REASONING_EFFORT=medium
SALES_BRAIN_CRON_SECRET=
SALES_BRAIN_ENABLE_SCHEDULER=true
SALES_BRAIN_ENABLE_REPORT_SCHEDULER=true
SALES_BRAIN_REPORT_DAYS=tuesday,thursday
SALES_BRAIN_REPORT_HOUR=14
SALES_BRAIN_ENABLE_12H_PULSE=true
SALES_BRAIN_MEMORY_DIR=/data/sales-brain
```

`LARK_SALES_PULSE_CHAT_ID` is the destination for the Tuesday/Thursday executive report and the Monday-Saturday 9 AM/9 PM pulse. The Monday 9 AM pulse covers Saturday 9 PM through Monday 9 AM because Sunday has no send.

## Sales Brain memory

Sales Brain stores the latest full monday snapshot plus crawl/change logs on disk.

For Railway production, add a persistent volume and mount it at:

```text
/data
```

Then keep:

```env
SALES_BRAIN_MEMORY_DIR=/data/sales-brain
SALES_BRAIN_ENABLE_SCHEDULER=true
```

The internal scheduler starts from the healthcheck and crawls monday every 10 minutes. You can also trigger a protected crawl manually:

```text
POST https://YOUR_RAILWAY_DOMAIN/api/memory/crawl
Authorization: Bearer SALES_BRAIN_CRON_SECRET
```

Read the current retained memory:

```text
GET https://YOUR_RAILWAY_DOMAIN/api/memory/latest
```

## Commands

Railway reads `railway.json`:

- Build: `npm run build`
- Start: `npm run start -- --port ${PORT:-3000} --hostname 0.0.0.0`

After Railway gives you a public domain, update Lark Events & Callbacks to:

```text
https://YOUR_RAILWAY_DOMAIN/api/lark/events
```

Keep the existing Sites URL active until the Railway callback verifies and the bot replies successfully.
