import { sql } from "drizzle-orm";
import {
  boolean,
  primaryKey,
  uniqueIndex,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  vector,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

export type MeetingStatus = "uploaded" | "transcribing" | "summarizing" | "ready" | "failed";
export type TemplateId = "general" | "sales" | "one_on_one" | "standup" | "project_sync";

export type Chapter = { title: string; startMs: number };
export type SummaryContent = {
  overview: string;
  sections: { heading: string; bullets: { text: string; timestampMs?: number }[] }[];
};

export const meetings = pgTable("meetings", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  durationS: integer("duration_s").notNull().default(0),
  mediaKey: text("media_key"),
  mediaType: text("media_type"),
  status: text("status").$type<MeetingStatus>().notNull().default("uploaded"),
  statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }).notNull().defaultNow(),
  error: text("error"),
  source: text("source").$type<"upload" | "seed">().notNull().default("upload"),
  chapters: jsonb("chapters").$type<Chapter[]>().notNull().default([]),
  calendarEventId: text("calendar_event_id"),
  attendees: jsonb("attendees").$type<string[]>().notNull().default([]),
  /** Salted hash of the uploader's IP, only for per-visitor rate limiting. */
  uploaderHash: text("uploader_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const speakers = pgTable(
  "speakers",
  {
    id: serial("id").primaryKey(),
    meetingId: text("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    displayName: text("display_name"),
    talkTimeS: integer("talk_time_s").notNull().default(0),
  },
  (t) => [index("speakers_meeting_idx").on(t.meetingId)],
);

export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    id: serial("id").primaryKey(),
    meetingId: text("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    speakerId: integer("speaker_id").references(() => speakers.id, { onDelete: "set null" }),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    text: text("text").notNull(),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('english', text)`),
  },
  (t) => [
    index("segments_meeting_idx").on(t.meetingId, t.startMs),
    index("segments_tsv_idx").using("gin", t.tsv),
  ],
);

/**
 * Retrieval units for library-wide Ask AI (hybrid RAG): a window of consecutive transcript lines.
 * `content` is what was embedded and keyword-indexed; prompts re-render the time range from transcript_segments
 * so speaker renames show up without re-embedding. `embedding` is NULL until Voyage has embedded it.
 */
export const transcriptChunks = pgTable(
  "transcript_chunks",
  {
    id: serial("id").primaryKey(),
    meetingId: text("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    /** Start of the first line and end of the last line in the window. */
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('english', content)`),
  },
  (t) => [
    index("chunks_meeting_idx").on(t.meetingId, t.startMs),
    index("chunks_tsv_idx").using("gin", t.tsv),
    index("chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const summaries = pgTable(
  "summaries",
  {
    id: serial("id").primaryKey(),
    meetingId: text("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    template: text("template").$type<TemplateId>().notNull(),
    content: jsonb("content").$type<SummaryContent>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("summaries_meeting_template_uq").on(t.meetingId, t.template)],
);

export const actionItems = pgTable("action_items", {
  id: serial("id").primaryKey(),
  meetingId: text("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  /** Name as the model wrote it at extraction time. Display uses ownerSpeakerId so renames apply. */
  owner: text("owner"),
  ownerSpeakerId: integer("owner_speaker_id").references(() => speakers.id, { onDelete: "set null" }),
  /** The transcript line where the commitment was made. */
  segmentId: integer("segment_id").references(() => transcriptSegments.id, { onDelete: "set null" }),
  timestampMs: integer("timestamp_ms"),
  dueDate: date("due_date"),
  /** Verbatim wording the due date was resolved from, e.g. "before Friday". */
  duePhrase: text("due_phrase"),
  done: boolean("done").notNull().default(false),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [index("action_items_done_idx").on(t.done)]);

export const highlights = pgTable("highlights", {
  id: serial("id").primaryKey(),
  meetingId: text("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  note: text("note"),
  /** Seeded showcase highlights can't be edited or deleted by visitors. */
  locked: boolean("locked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shareLinks = pgTable("share_links", {
  slug: text("slug").primaryKey(),
  meetingId: text("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"meeting" | "clip">().notNull(),
  startMs: integer("start_ms"),
  endMs: integer("end_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AutoJoinRule = "all" | "hosted" | "none";

/** One Google Calendar per browser session (the demo has no user accounts). Tokens are AES-GCM encrypted. */
export const calendarConnections = pgTable("calendar_connections", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  provider: text("provider").$type<"google">().notNull().default("google"),
  email: text("email").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  autoJoinRule: text("auto_join_rule").$type<AutoJoinRule>().notNull().default("all"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const calendarEventOverrides = pgTable(
  "calendar_event_overrides",
  {
    connectionId: integer("connection_id")
      .notNull()
      .references(() => calendarConnections.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    record: boolean("record").notNull(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.eventId] })],
);

/** Every "Ask" question: rate limiting per visitor, and identical questions over unchanged context reuse the answer. */
export const askLog = pgTable(
  "ask_log",
  {
    id: serial("id").primaryKey(),
    visitorHash: text("visitor_hash").notNull(),
    meetingId: text("meeting_id"),
    cacheKey: text("cache_key").notNull(),
    question: text("question").notNull(),
    answer: text("answer"),
    inputTokens: integer("input_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ask_log_cache_key_idx").on(t.cacheKey), index("ask_log_created_idx").on(t.createdAt)],
);
