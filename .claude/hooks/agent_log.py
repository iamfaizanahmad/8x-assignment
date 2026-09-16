#!/usr/bin/env python3
"""Append-only agent capture for Claude Code.

Wired to two hook events in .claude/settings.json:
  UserPromptSubmit -> writes a [LOG_ENTRY type=PROMPT]  entry
  Stop             -> writes a [LOG_ENTRY type=RESPONSE] entry

Captures ONLY the verbatim prompt and the final assistant text of that turn.
Thinking blocks, tool calls, tool results, intermediate narration and subagent
(sidechain) traffic are all excluded by construction.

Never raises into the hook: any failure is written to .claude/hooks/state/errors.log
and the hook exits 0 so it can never block a session.
"""
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

AUTHOR = os.environ.get("AGENT_LOG_AUTHOR", "faizann-ahmad")
PROJECT = os.environ.get("AGENT_LOG_PROJECT", "8x-assignment")


def repo_root():
    d = os.environ.get("CLAUDE_PROJECT_DIR")
    if d and os.path.isdir(d):
        return d
    # Fall back to the script's own location (.claude/hooks/agent_log.py)
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


ROOT = repo_root()
LOG_DIR = os.path.join(ROOT, ".agent-logs")
STATE_DIR = os.path.join(ROOT, ".claude", "hooks", "state")


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
        f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"


def log_error(msg):
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(os.path.join(STATE_DIR, "errors.log"), "a") as fh:
            fh.write(f"{now_iso()} {msg}\n")
    except Exception:
        pass


def state_path(session_id):
    return os.path.join(STATE_DIR, f"{session_id}.json")


def load_state(session_id):
    try:
        with open(state_path(session_id)) as fh:
            return json.load(fh)
    except Exception:
        return None


def save_state(session_id, state):
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = state_path(session_id) + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(state, fh)
    os.replace(tmp, state_path(session_id))


def read_transcript(path):
    entries = []
    if not path or not os.path.exists(path):
        return entries
    with open(path, errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except Exception:
                continue
    return entries


def is_real_user_prompt(entry):
    """A human-typed turn, not a tool_result carrier and not a subagent message."""
    if entry.get("type") != "user" or entry.get("isSidechain"):
        return False
    content = (entry.get("message") or {}).get("content")
    if isinstance(content, str):
        return content.strip() != ""
    if isinstance(content, list):
        return any(b.get("type") == "text" for b in content if isinstance(b, dict))
    return False


def final_response(entries):
    """Trailing assistant text of the last turn: text blocks emitted after the
    last tool call. Returns (text, model, timestamp)."""
    start = 0
    for i, e in enumerate(entries):
        if is_real_user_prompt(e):
            start = i
    chunks, model, ts = [], None, None
    for e in entries[start + 1:]:
        if e.get("type") != "assistant" or e.get("isSidechain"):
            continue
        for block in (e.get("message") or {}).get("content") or []:
            if not isinstance(block, dict):
                continue
            kind = block.get("type")
            if kind == "tool_use":
                chunks = []          # anything before a tool call was not final
            elif kind == "text":
                text = block.get("text") or ""
                if text.strip():
                    chunks.append(text)
                    model = (e.get("message") or {}).get("model") or model
                    ts = e.get("timestamp") or ts
    return "\n".join(chunks).strip(), model, ts


def latest_model(entries):
    for e in reversed(entries):
        if e.get("type") == "assistant" and not e.get("isSidechain"):
            m = (e.get("message") or {}).get("model")
            if m and m != "<synthetic>":
                return m
        att = e.get("attachment") or {}
        if att.get("type") == "model":
            m = (att.get("identity") or {}).get("modelId")
            if m:
                return m
    return None


def backfill_prompt_model(state, num, model):
    """On the first turn of a session the model id is not yet in the transcript
    when UserPromptSubmit fires, so that PROMPT header is written as `unknown`.
    Once the turn's model is known, fill that one header line in. Only a
    generated `model: unknown` line is ever touched; prompt text is untouched."""
    if not model:
        return
    path = os.path.join(LOG_DIR, state["filename"])
    if not os.path.exists(path):
        return
    with open(path, errors="replace") as fh:
        content = fh.read()
    marker = f"[LOG_ENTRY type=PROMPT num={num} session={state['session_id'][:8]}]"
    idx = content.find(marker)
    if idx == -1:
        return
    head, tail = content[:idx], content[idx:]
    tail, n = re.subn(r"^model: unknown$", f"model: {model}", tail,
                      count=1, flags=re.M)
    if n:
        with open(path, "w") as fh:
            fh.write(head + tail)


def render_header(state):
    return (
        "---\n"
        f"session_id: {state['session_id']}\n"
        f"date: {state['date']}\n"
        f"author: {AUTHOR}\n"
        f"model: {state.get('model') or 'unknown'}\n"
        "tool: claude-code\n"
        f"project: {PROJECT}\n"
        f"total_exchanges: {state['exchanges']}\n"
        f"first_prompt_time: {state['first_prompt_time']}\n"
        f"last_prompt_time: {state['last_prompt_time']}\n"
        "---\n\n"
        f"# Session Log - {state['date']}\n\n"
        f"Session: `{state['session_id'][:8]}` | Project: `{PROJECT}` | "
        f"Author: `{AUTHOR}`\n\n---\n"
    )


HEADER_RE = re.compile(r"\A---\n.*?\n---\n\n# Session Log.*?\n\n---\n", re.S)


def write_entry(state, kind, num, timestamp, model, body):
    """Append one entry, then refresh the frontmatter counters in place.

    Only the generated frontmatter block is ever rewritten; entry bodies are
    strictly append-only and never touched again.
    """
    os.makedirs(LOG_DIR, exist_ok=True)
    path = os.path.join(LOG_DIR, state["filename"])
    entry = (
        f"\n[LOG_ENTRY type={kind} num={num} session={state['session_id'][:8]}]\n"
        f"timestamp: {timestamp}\n"
        f"model: {model or 'unknown'}\n\n"
        f"{body.rstrip()}\n\n"
    )
    existing = ""
    if os.path.exists(path):
        with open(path, errors="replace") as fh:
            existing = fh.read()
    if not existing:
        existing = render_header(state)
    else:
        existing = HEADER_RE.sub(render_header(state), existing, count=1)
    with open(path, "w") as fh:
        fh.write(existing + entry)


def handle_prompt(payload):
    session_id = payload.get("session_id") or "unknown-session"
    prompt = payload.get("prompt")
    if prompt is None or not str(prompt).strip():
        return
    entries = read_transcript(payload.get("transcript_path"))
    model = latest_model(entries)
    ts = now_iso()
    state = load_state(session_id)
    if state is None:
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M-%S")
        state = {
            "session_id": session_id,
            "filename": f"{stamp}_{session_id}.md",
            "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "num": 0,
            "exchanges": 0,
            "first_prompt_time": ts,
            "last_prompt_time": ts,
            "model": model,
            "pending": None,
        }
    state["num"] += 1
    state["exchanges"] = state["num"]
    state["last_prompt_time"] = ts
    if model:
        state["model"] = model
    state["pending"] = state["num"]
    write_entry(state, "PROMPT", state["num"], ts, state.get("model"), str(prompt))
    save_state(session_id, state)


def handle_stop(payload):
    session_id = payload.get("session_id") or "unknown-session"
    state = load_state(session_id)
    if not state or not state.get("pending"):
        return  # nothing awaiting a response (e.g. duplicate Stop)
    # The transcript is flushed asynchronously: at Stop time the final assistant
    # message is typically ~100ms from being written. Poll briefly for it.
    path = payload.get("transcript_path")
    text, model, ts = "", None, None
    deadline = time.monotonic() + 8.0
    while True:
        text, model, ts = final_response(read_transcript(path))
        if text or time.monotonic() > deadline:
            break
        time.sleep(0.2)
    if not text:
        text = "(no final text response captured for this turn)"
    model = model or state.get("model")
    if model:
        state["model"] = model
    backfill_prompt_model(state, state["pending"], model)
    write_entry(state, "RESPONSE", state["pending"], ts or now_iso(), model, text)
    state["pending"] = None
    save_state(session_id, state)


def main():
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except Exception as exc:
        log_error(f"bad stdin: {exc}")
        return
    try:
        event = payload.get("hook_event_name")
        if event == "UserPromptSubmit":
            handle_prompt(payload)
        elif event in ("Stop", "SessionEnd"):
            handle_stop(payload)
    except Exception as exc:
        import traceback
        log_error(f"{payload.get('hook_event_name')}: {exc}\n{traceback.format_exc()}")


if __name__ == "__main__":
    main()
