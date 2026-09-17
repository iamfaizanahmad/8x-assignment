# Minutes: an AI meeting notetaker (Fathom rebuild)

A rebuild of [fathom.video](https://fathom.video) for the 8x assignment: recordings go in, and searchable,
shareable intelligence comes out.

> **The one thing to know:** the recording bot is simulated. Everything after capture is real and runs on real audio:
> transcription, speakers, summaries, templates, action items, highlights, search, Ask AI, sharing and Google
> Calendar sync. You get a meeting in by uploading its recording (or attaching it to a calendar event).
> [Why that trade-off](#what-i-cut-and-why).

---

## Try this first

1. Open **Overview & Scrutiny Education Business Panel**, a real one-hour public council meeting with 12 speakers.
   This is the case the brief says matters.
2. Skim the **Summary**, then switch **templates** (General, Sales, 1:1, Standup, Project sync).
3. Open **Ask AI** and ask *"What concerns did councillors raise about the school closure?"*. Click a timestamp in
   the answer to jump to that moment.
4. In **Transcript**, drag-select a few lines. Use **Highlight**, or **Share clip**, then open the link in a private
   window.
5. Search for *"consultation"* from the header, or ask a question across every meeting from the search page.
6. On **Calendar**, connect your own Google Calendar. It's read-only and private to your browser.

---

## What's built

### Capture and processing
- **Upload** audio or video (up to 90 min / 2 GB). The browser uploads straight to a **private S3 bucket** with a
  presigned URL, so there are no server body limits and the progress bar is real.
- **Pipeline:** Deepgram Nova-3 transcription with speaker diarization, then **one** Claude call returns the title,
  chapters, General summary and action items. An hour-long call processes in about 2 minutes.
- **Robust states:** a live progress checklist, Retry for runs that failed or timed out, and slow uploads shown as
  "still uploading" (never "failed").
- **`npm run import -- <file>`** imports large recordings from the terminal: multipart upload, the full pipeline, and
  every template generated ahead of time.

### The meeting page
- **Player synced to the transcript:** the active line follows playback, and clicking any line, summary bullet,
  action item or chapter seeks there. Keyboard: `Space`, `←`/`→`, `H`.
- **Timeline** with chapter segments, **one lane per speaker** and highlight markers. Click anywhere to seek.
- **Summary** with **5 templates**. Each is generated on first use and stored, so it's never paid for twice. Every
  bullet cites its timestamp. Copy as Markdown.
- **Action items** grouped by owner, with checkboxes.
- **Highlights:** press `H` (the last 15 s), use the Highlight button on a line, or select transcript text for an
  exact range. They appear on the timeline and in their own tab, with notes and the quoted transcript.
- **Ask AI** about the meeting: streamed answers with clickable timestamp citations and follow-up questions.

### Built for the 8-person, one-hour call
- **Chapters** named after who spoke and the topic, so an hour is navigable without scrubbing.
- **Talk-time bars**, a **speaker filter** and **in-meeting transcript search** on a virtualized list.
- **Speaker names:** diarization only produces "Speaker 1…12". **Suggest names** has Claude find self-introductions
  and people addressed by name. Each suggestion comes with its evidence quote, a play link and a confidence level,
  and nothing is applied until you accept it. You can also rename by hand.
- **Fixing diarization:** move a line to another speaker or a new one, and split a line two people spoke. Then
  **Update notes** regenerates the summary with the corrected names.

### Across meetings
- **Full-text search** (Postgres `tsvector`) with speaker, timestamp and highlighted snippet. Results open the meeting
  at that moment. Supports `"phrases"`, `-exclude` and `or`.
- **Ask AI across all meetings** ("When did we decide the launch date?"), with citations that link to the exact
  meeting and moment. Questions typed into search offer "Ask AI instead".

### Sharing
- **Share a meeting or a clip** as a public link that needs no sign-in, for someone who wasn't on the call.
- **Clip pages only receive what the link grants.** The transcript is trimmed to the range on the server, with no
  summary, no chapters and no summary in link previews. Playback stops at the clip's end.

### Calendar
- **Real Google Calendar sync** (OAuth, read-only). It shows your next 14 days, detects Zoom, Meet and Teams links
  wherever the invite puts them, and skips all-day, cancelled and declined events.
- **Auto-join rule** (all meetings with a link, only ones I host, or none) plus a per-meeting toggle, saved in the
  database.
- **Attach recording** to a past event: the meeting takes the event's title and time, and invitee names help Claude
  identify speakers.
- **Privacy:** the connection is tied to the visitor's browser (an httpOnly cookie) and tokens are AES-256-GCM
  encrypted, so nobody else on the public link sees your calendar. Invitee names never reach the browser.

---

## What I cut, and why

I had 24 hours, so I spent them on what happens *after* a recording exists. That's where a notetaker earns its
place, and it's what the brief asks you to "live with".

| Cut | Why | What's there instead |
|---|---|---|
| **Recording bot that joins Zoom/Meet/Teams** | Bots are infrastructure, not product: a vendor or a fleet of headless browsers, webhooks, admission flows and per-platform quirks. The brief explicitly allows stubbing it. I'd use [Recall.ai](https://www.recall.ai) (about $0.50/hr) and feed its recording into the same pipeline. | Upload, a terminal import, or attaching a recording to a calendar event. The auto-join rules and toggles are real and ready to drive a bot. |
| **Accounts, teams, permissions** | Reviewers must be able to open the link without signing in. | A single public workspace. Calendar connections are private per browser, and the API has a guard for read-only sample meetings. |
| **Rendered clip videos** | FFmpeg rendering is slow and costly on serverless. | Clips are time ranges on the original recording (the player stops at the end, and the transcript is trimmed server-side). A determined viewer could seek outside the range. |
| **Outlook / Microsoft calendar** | A second OAuth provider adds time without new product insight. | Google Calendar only. |
| **CRM sync, Slack or email follow-ups, integrations** | Distribution features that need the core loop working first. | Copy summary as Markdown. |
| **Live in-call highlights** | They need the bot or a desktop app. | Highlights made during playback. |
| **Custom templates, multi-language** | Nice-to-have. | 5 built-in templates, English. |

---

## How it works

```
Browser ── presigned PUT ──▶ S3 (private)
   │
   └─ POST /process ─▶ Vercel function (after())
                          ├─ signed GET URL ─▶ Deepgram Nova-3 (diarized utterances)
                          ├─ segments + speakers ─▶ Neon Postgres (tsvector + GIN index)
                          └─ one Claude tool call ─▶ title · chapters · summary · action items
Viewers ─▶ server-rendered pages sign short-lived media URLs; everything else is read from Postgres
```

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 15 (App Router), TypeScript, Tailwind | Server components for data, route handlers for the API, one deploy |
| Hosting | Vercel | Fastest route to a live link; `after()` runs processing after the response |
| Database | Neon Postgres + Drizzle | Serverless and scales to zero without pausing (unlike Supabase's free tier); full-text search built in |
| Media | AWS S3, private bucket, presigned URLs | Direct browser uploads of large files; nothing publicly listable |
| Transcription | Deepgram Nova-3 | Diarization and utterance timestamps in one call, fast on hour-long audio |
| AI | Claude Haiku 4.5 (configurable via `LLM_MODEL`) | Structured tool output for notes and templates, streaming for Ask AI, low cost |

**Keeping AI costs predictable** (a public link with no login needs this):
- One Claude call per meeting. Each template is generated on first use and then served from the database (a unique
  index keeps a single copy).
- Ask AI keeps the transcript in a **cached prompt block** (follow-ups are about 90% cheaper) and replays **identical
  questions from the database** for free. Speaker suggestions are also stored per transcript.
- Guards run **before** any paid call:
  - the meeting must exist and be processed, with a transcript
  - long recordings are rejected using the duration the browser reads before uploading
  - the file must exist in S3 before Deepgram is called
- Hourly limits per visitor (salted IP hash) and globally, for uploads and AI requests. `UPLOADS_ENABLED=false` is a
  kill switch.
- Rough costs: **about $0.30 per hour of meeting** (mostly Deepgram), and **$0.001–0.03 per question**.

---

## Data in the demo

- **Overview & Scrutiny Education Business Panel:** a public local-council scrutiny meeting recording, 60 min, 12 speakers.
- **Bramham House Redevelopment Planning Application:** a short public local-news segment with 3 speakers.
- **Test:** my own short (82 s) test call. It was recorded from a laptop mic, so the other person's voice was
  too quiet for diarization, which is a good showcase for the manual speaker fixes.
- **Acme Onboarding Launch Sync:** a synthetic two-voice test call (macOS text-to-speech) I used to build the pipeline.

---

## Running it locally

```bash
npm install
cp .env.example .env.local     # fill in the values below
npm run db:push                # create tables in Neon
npm run dev
```

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | Neon project connection string |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET` | Private S3 bucket (Block Public Access on) with CORS allowing `PUT`/`GET`/`HEAD`; an IAM user limited to `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on `arn:aws:s3:::<bucket>/*` |
| `DEEPGRAM_API_KEY` | console.deepgram.com |
| `ANTHROPIC_API_KEY`, `LLM_MODEL` | console.anthropic.com; defaults to `claude-haiku-4-5` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client (Web). Enable the Calendar API, add scopes `openid`, `email` and `calendar.events.readonly`, and set the redirect URI to `<origin>/api/calendar/google/callback` |
| `TOKEN_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `UPLOADS_ENABLED` | `true` or `false` |

Import a recording from the terminal:

```bash
npm run import -- ~/Recordings/weekly-sync.mp4 --title "Weekly sync" --date 2026-09-15T15:00
```

Google shows an "unverified app" screen, because the demo hasn't been through Google's review. Choose
**Advanced → Go to Minutes**.

---

## Known limitations

- Diarization works best when the recording is taken from inside the call (Zoom, Meet or Teams recording). A laptop
  mic picking up the other side can merge speakers; the in-app speaker tools exist for exactly this.
- Clip links protect the transcript and summary, but not the media file itself (a time range, not a rendered cut).
- There's no login, so anyone with the link can add highlights, edit speakers or delete uploaded meetings.
- AI answers and name suggestions come from Claude Haiku. Citations make them checkable, but they can still be wrong.

## Code map

```
src/lib/pipeline/      deepgram.ts · ai.ts (notes, templates, speaker names) · index.ts (orchestration, caching)
src/lib/ask.ts         Ask AI context building + streaming
src/lib/calendar/      Google OAuth, event mapping, token encryption, browser session
src/lib/storage.ts     presigned S3 URLs
src/app/api/           uploads, process, summaries, ask, segments, speakers, highlights, share, calendar
src/components/meeting player, timeline, transcript, summary, action items, highlights, speakers, share
scripts/               import-recording.ts
```
