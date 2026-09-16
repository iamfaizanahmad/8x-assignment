import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
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
  error: text("error"),
  source: text("source").$type<"upload" | "seed">().notNull().default("upload"),
  chapters: jsonb("chapters").$type<Chapter[]>().notNull().default([]),
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

export const summaries = pgTable(
  "summaries",
  {
    id: serial("id").primaryKey(),
    meetingId: text("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    template: text("template").$type<TemplateId>().notNull(),
    content: jsonb("content").$type<SummaryContent>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("summaries_meeting_template_idx").on(t.meetingId, t.template)],
);

export const actionItems = pgTable("action_items", {
  id: serial("id").primaryKey(),
  meetingId: text("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  owner: text("owner"),
  timestampMs: integer("timestamp_ms"),
  done: boolean("done").notNull().default(false),
});

export const highlights = pgTable("highlights", {
  id: serial("id").primaryKey(),
  meetingId: text("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  note: text("note"),
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
