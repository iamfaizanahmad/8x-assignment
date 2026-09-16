# CAPTURE-TEST.md

Proof that automatic prompt/response capture is installed and firing on its own.

## 1. Tool and model

| | |
|---|---|
| **Tool** | Claude Code CLI v2.1.234 (macOS, zsh) |
| **Model** | `claude-opus-5` — single model, it both plans and executes |
| **Planning vs execution** | No split. Opus 5 plans and executes in the same session. If a subagent on a different model is ever used mid-build, the `model:` field on each entry makes the switch visible in the log. |
| **Automatic mechanism available?** | Yes. Claude Code has a hooks system (`UserPromptSubmit`, `Stop`, `PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd`, …) configured in `.claude/settings.json`. Hooks are shell commands the harness runs itself and receive a JSON payload on stdin. No manual logging is used anywhere in this repo. |

## 2. Mechanism and config

- **Config changed:** `.claude/settings.json` (committed, repo-scoped — it applies to any Claude Code session started in this directory, not just the session that created it).
- **Events wired:** `UserPromptSubmit` → writes the `PROMPT` entry. `Stop` (end of turn) → writes the `RESPONSE` entry.
- **Script:** `.claude/hooks/agent_log.py` (committed).
  - `UserPromptSubmit` receives `{session_id, transcript_path, cwd, prompt}` on stdin. The prompt is written **verbatim** from the `prompt` field — no truncation, no cleanup.
  - `Stop` receives `{session_id, transcript_path, …}`. The script reads the session transcript JSONL and extracts **only the trailing assistant text blocks** of that turn.
  - Excluded by construction: `thinking` blocks, `tool_use` blocks, `tool_result` carriers, any assistant text emitted *before* a tool call (preamble narration), and all `isSidechain: true` subagent traffic. Any text collected so far is discarded whenever a `tool_use` block is seen, so what lands in the log is the final answer only.
  - Entry bodies are strictly append-only. The only bytes ever rewritten are the generated frontmatter counters (`total_exchanges`, `last_prompt_time`) and the first-turn `model: unknown` backfill described in §5.
  - The script never raises into the harness: all failures go to `.claude/hooks/state/errors.log` and it exits 0, so a logging bug can never block a session.
- **`.gitignore`:** `.agent-logs/` is **not** ignored — it is committed and ships with the repo. Only `.claude/hooks/state/` (per-session counters) is ignored.

## 3. Where the canaries landed

- Session A: `.agent-logs/2026-09-16_11-18-21_b68003c7-e24f-4216-8421-4c7e18307f9c.md`
- Session B: `.agent-logs/2026-09-16_11-18-30_ce0ce856-3bd6-4328-b032-ea61daa2a5b9.md`

Two separate processes, each launched fresh with `claude -p` from the repo root, each producing its own session file. The hook is installed, not session-local.

## 4. Both canary entries, raw

Session A (`b68003c7`), pasted verbatim from the log file:

```
[LOG_ENTRY type=PROMPT num=1 session=b68003c7]
timestamp: 2026-09-16T11:18:21.852Z
model: claude-opus-5

CAPTURE TEST — 8x assignment, Faizan Ahmad


[LOG_ENTRY type=RESPONSE num=1 session=b68003c7]
timestamp: 2026-09-16T11:18:29.630Z
model: claude-opus-5

Got your "CAPTURE TEST — 8x assignment, Faizan Ahmad" message. It sounds like you're checking that this session is being recorded. The repo is a fresh git repo on `main` with no commits yet. The only files are untracked: `.agent-logs/`, `.claude/` and `.gitignore`.

What do you want to work on for the assignment?
```

Session B (`ce0ce856`), pasted verbatim:

```
[LOG_ENTRY type=PROMPT num=1 session=ce0ce856]
timestamp: 2026-09-16T11:18:30.866Z
model: claude-opus-5

CAPTURE TEST 2 — second session, 8x assignment, Faizan Ahmad


[LOG_ENTRY type=RESPONSE num=1 session=ce0ce856]
timestamp: 2026-09-16T11:18:34.698Z
model: claude-opus-5

Got it, this is capture test 2, the second session for Faizan Ahmad's 8x assignment. I'm ready to go.

Right now the repo is on `main` with no commits yet. The only things in it are three untracked items: `.agent-logs/`, `.claude/` and `.gitignore`. What do you want to work on?
```

### Extra check — multi-turn and tool-output exclusion

Session B was then resumed for a second turn that deliberately forced a tool call, to prove numbering increments across a session and that tool output does not leak into the log:

```
[LOG_ENTRY type=PROMPT num=2 session=ce0ce856]
timestamp: 2026-09-16T11:18:53.128Z
model: claude-opus-5

Run 'echo CANARY_TOOL_OUTPUT_SHOULD_NOT_APPEAR' with Bash and tell me only the word you saw.


[LOG_ENTRY type=RESPONSE num=2 session=ce0ce856]
timestamp: 2026-09-16T11:19:00.826Z
model: claude-opus-5

CANARY_TOOL_OUTPUT_SHOULD_NOT_APPEAR
```

The Bash call, its arguments and its raw stdout appear nowhere in the file — the string is present only in the prompt I typed and in the final answer, which is exactly what was asked for.

## 5. What did not work first time

**Attempt 1 — Stop hook fired before the transcript was flushed.**
The first canary pair landed with the prompt captured correctly but the response body reading
`(no final text response captured for this turn)` and `model: unknown`. Cause: the `Stop` hook runs
~100ms *before* Claude Code flushes the final assistant message to the session JSONL, so the script
read a transcript that ended at the last tool call. Verified by re-running the parser against the
same transcript after the session exited — it extracted the response correctly, which isolated it to
a timing race rather than a parsing bug. Fixed by polling the transcript in the `Stop` handler for up
to 8 seconds until trailing assistant text appears (hook timeout is 15s).

**The two broken canary files are deliberately left in the repo**, un-edited, as evidence:

- `.agent-logs/2026-09-16_11-16-51_2953821a-27bc-46fe-af53-f4010a37637e.md`
- `.agent-logs/2026-09-16_11-17-01_7b4cfad9-905c-44e9-b008-f3cd037ad455.md`

**Attempt 2 — `model: unknown` on the first prompt of a session.**
`UserPromptSubmit` does not carry a model id in its payload, and on turn 1 of a fresh session the
transcript has no assistant message to read one from yet. Two fixes: the model lookup also reads the
`attachment` entries of type `model` that Claude Code writes (`identity.modelId`), and the `Stop`
handler backfills that turn's `model: unknown` header line once the model is known. The backfill
touches only a generated header line that literally reads `unknown`, never prompt or response text.

**Before burning real sessions**, the script was exercised against a hand-written synthetic
transcript containing a thinking block, a preamble text block, a tool call, a tool result and a
sidechain (subagent) message, to confirm none of them reach the log and that a duplicate `Stop`
is idempotent. That dry run is what caught the need for the tool-call reset in the extractor.

## 6. Known limitation

Claude Code reads hook config at session start, so hooks must be loaded by a session **rooted in this
repo** (`cd 8x-assignment && claude`). A session started in a parent directory does not pick up this
repo's `.claude/settings.json`. All assignment work is done from the repo root for this reason.
