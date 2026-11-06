-- Non-destructive prerequisite for idempotent Whole Turkey Fresh/Frozen upserts.
-- This migration intentionally fails rather than deleting or changing existing rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.turkey_weekly
    WHERE week_start IS NULL
       OR week_end IS NULL
       OR condition IS NULL
  ) THEN
    RAISE EXCEPTION
      'turkey_weekly has null identity values; review those rows before adding uniqueness.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.turkey_weekly
    GROUP BY week_start, week_end, condition
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'turkey_weekly has duplicate (week_start, week_end, condition) keys; review rows before adding uniqueness.';
  END IF;
END
$$;

CREATE UNIQUE INDEX turkey_weekly_week_start_week_end_condition_key
  ON public.turkey_weekly (week_start, week_end, condition);
