-- Open items: completion time, owner as a speaker reference, source transcript line, anchored due dates.
-- Idempotent: safe to run again; backfills only touch rows that are still NULL.

ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_speaker_id integer REFERENCES speakers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS segment_id integer REFERENCES transcript_segments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS due_phrase text;

CREATE INDEX IF NOT EXISTS action_items_done_idx ON action_items (done);

-- Owner: the free-text name must match exactly one of that meeting's speakers (current name or label).
-- Anything else ("School/Diocese", "Daniel / Diocese") stays NULL and shows as Unassigned rather than a guess.
UPDATE action_items a
SET owner_speaker_id = m.speaker_id
FROM (
  SELECT a2.id, min(s.id) AS speaker_id
  FROM action_items a2
  JOIN speakers s
    ON s.meeting_id = a2.meeting_id
   AND (lower(trim(s.display_name)) = lower(trim(a2.owner)) OR lower(s.label) = lower(trim(a2.owner)))
  WHERE a2.owner_speaker_id IS NULL AND a2.owner IS NOT NULL
  GROUP BY a2.id
  HAVING count(DISTINCT s.id) = 1
) m
WHERE a.id = m.id;

-- Source line: the model cites the "[m:ss]" of a transcript line, i.e. the line's start rounded down to the second.
-- Take the line with that exact rendered timestamp (the owner's line first if two share a second),
-- else the nearest line before it. Mirrors resolveSegment() in src/lib/pipeline/index.ts.
UPDATE action_items a
SET segment_id = x.segment_id, timestamp_ms = x.start_ms
FROM (
  SELECT a2.id, seg.id AS segment_id, seg.start_ms
  FROM action_items a2
  CROSS JOIN LATERAL (
    SELECT t.id, t.start_ms
    FROM transcript_segments t
    WHERE t.meeting_id = a2.meeting_id AND (t.start_ms / 1000) * 1000 <= a2.timestamp_ms
    ORDER BY (t.start_ms / 1000) * 1000 DESC, (t.speaker_id IS NOT DISTINCT FROM a2.owner_speaker_id) DESC, t.start_ms
    LIMIT 1
  ) seg
  WHERE a2.segment_id IS NULL AND a2.timestamp_ms IS NOT NULL
) x
WHERE a.id = x.id;
