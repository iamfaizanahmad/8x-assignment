import type { MeetingDetail } from "@/lib/queries";

export type Speaker = MeetingDetail["speakers"][number];
export type Segment = MeetingDetail["segments"][number];
export type Highlight = MeetingDetail["highlights"][number];
export type ActionItem = MeetingDetail["actionItems"][number];
export type Chapter = MeetingDetail["meeting"]["chapters"][number];
