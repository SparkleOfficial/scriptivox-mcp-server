export function getPricingText(): string {
  return `Scriptivox Pricing
==================================================

PLANS
-----

FREE — $0/month
  - 3 transcriptions per day
  - 30 minute max file length
  - Standard processing speed
  - AI chat with 3,000 AI credits a day (Fast model)
  - Meeting bot: 30 minutes a month, up to 10 minutes per meeting
  - All export formats (TXT, SRT, VTT, JSON)
  - 119 language support

PRO — $20/month ($10/month billed yearly)
  - Unlimited transcriptions
  - 10 hour max file length
  - 5 GB file size limit
  - AI chat with the Best and Fast models
  - 500,000 AI credits a month (yearly billing gives the whole year's 6,000,000 at the start)
  - Priority processing
  - Meeting bot: 10 hours a month (20 hours a month on yearly billing), up to 2 hours per meeting
  - Speaker diarization
  - Word-level timestamps

TEAM — $19/user/month ($15/user/month billed yearly)
  - Everything in Pro
  - Centralized billing
  - Team member management
  - Owner & admin controls
  - Starts at 2 seats; add or remove seats any time
  - Priority support

LIFETIME — one payment, while available (personal accounts only)
  Lifetime Starter — $59: 300 transcription minutes a month, files up to 5 hours, 5 GB storage
  Lifetime Plus    — $89: 600 transcription minutes a month, files up to 10 hours, 10 GB storage
  Lifetime Growth  — $149: 1,200 transcription minutes a month, files up to 10 hours, 20 GB storage
  Lifetime Max     — $199: 2,400 transcription minutes a month, files up to 10 hours, 40 GB storage
    These four: AI chat with 3,000 AI credits a day (Fast model); meeting bot
    30 minutes a month, up to 10 minutes per meeting.
  Pro Lifetime     — $499: everything in Pro with unlimited transcription, 100 GB storage,
    500,000 AI credits a month and 10 hours of meetings a month (up to 2 hours per meeting)
  Transcription minutes refill every month. Current prices and availability:
  https://www.scriptivox.com/pricing?tab=lifetime

The developer API below is open to every account, Free included, and is billed
separately: a web plan grants no API credit.

API PRICING
-----------
  $0.20 per hour of audio (pay-as-you-go)
  Billed per second
  Minimum deposit: $5.00 (~25 hours of audio)

  Cost examples:
    30 seconds  → $0.002
    5 minutes   → $0.017
    30 minutes  → $0.10
    1 hour      → $0.20
    10 hours    → $2.00

  Limits:
    Min audio duration: 1 second
    Max audio duration: 10 hours
    Max file size:      5 GB

SIGN UP
-------
  Web app:       https://scriptivox.com
  API docs:      https://scriptivox.com/docs/api-reference
  Dashboard:     https://platform.scriptivox.com
  Status page:   https://status.scriptivox.com`;
}
