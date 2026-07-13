-- Rewrite persisted S3/CDN image URLs to the drawing-authorized file route.
-- Safe to run repeatedly. Take a database backup before applying in production.
BEGIN;

WITH normalized AS (
  SELECT
    drawing.id,
    jsonb_object_agg(
      entry.key,
      CASE
        WHEN s3_file."drawingId" IS NOT NULL THEN jsonb_set(
          entry.value,
          '{dataURL}',
          to_jsonb('/api/files/' || drawing.id || '/' || entry.key),
          true
        )
        ELSE entry.value
      END
    ) AS files
  FROM "Drawing" AS drawing
  CROSS JOIN LATERAL jsonb_each(
    COALESCE(NULLIF(drawing.files, ''), '{}')::jsonb
  ) AS entry
  LEFT JOIN "S3File" AS s3_file
    ON s3_file."drawingId" = drawing.id
   AND s3_file."fileId" = entry.key
  GROUP BY drawing.id
)
UPDATE "Drawing" AS drawing
SET files = normalized.files::text
FROM normalized
WHERE drawing.id = normalized.id
  AND COALESCE(NULLIF(drawing.files, ''), '{}')::jsonb IS DISTINCT FROM normalized.files;

COMMIT;
