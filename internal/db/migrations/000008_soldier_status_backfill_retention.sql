-- Backfill legacy cfg.soldiers.state into hot status rows; strip state from roster JSON.
-- Extend partition DROP to soldier_status_entry (only when fully compacted).

DO $backfill$
DECLARE
    rec record;
    mapped text;
    cutover timestamptz := now() AT TIME ZONE 'UTC';
BEGIN
    FOR rec IN
        SELECT elem->>'id' AS sid, lower(trim(coalesce(elem->>'state', 'base'))) AS st
        FROM cfg,
             jsonb_array_elements(value->'soldiers') AS elem
        WHERE key = 'soldiers'
          AND elem->>'id' IS NOT NULL
          AND trim(elem->>'id') <> ''
    LOOP
        IF rec.st IS NULL OR rec.st = '' OR rec.st = 'base' THEN
            CONTINUE;
        END IF;
        mapped := CASE rec.st
            WHEN 'leave' THEN 'away'
            WHEN 'training' THEN 'training'
            WHEN 'sick' THEN 'sick'
            WHEN 'other' THEN 'other'
            WHEN 'away' THEN 'away'
            WHEN 'outing' THEN 'outing'
            ELSE 'other'
        END;
        IF EXISTS (
            SELECT 1
            FROM soldier_status_entry
            WHERE soldier_id = rec.sid
              AND note = 'migrated from cfg.soldiers.state'
        ) THEN
            CONTINUE;
        END IF;
        PERFORM guard_ensure_soldier_status_block(guard_partition_block_start(cutover::date));
        INSERT INTO soldier_status_entry (soldier_id, start_at, end_at, status, note, actor)
        VALUES (rec.sid, cutover, NULL, mapped, 'migrated from cfg.soldiers.state', 'migration');
    END LOOP;

    UPDATE cfg
    SET value = jsonb_set(
            value,
            '{soldiers}',
            COALESCE(
                (
                    SELECT jsonb_agg(elem - 'state')
                    FROM jsonb_array_elements(value->'soldiers') AS elem
                ),
                '[]'::jsonb
            )
        ),
        version = version + 1,
        updated_at = now()
    WHERE key = 'soldiers'
      AND value ? 'soldiers';
END;
$backfill$;

CREATE OR REPLACE FUNCTION guard_drop_old_partitions(retention_days int DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    oldest_keep date;
    block_days int := guard_partition_days();
    r record;
    dropped int := 0;
    block_start date;
    block_end date;
    range_from timestamptz;
    range_to timestamptz;
    uncompacted bigint;
BEGIN
    IF retention_days < 1 THEN
        RAISE EXCEPTION 'retention_days must be >= 1';
    END IF;

    oldest_keep := current_date - retention_days + 1;

    FOR r IN
        SELECT c.relname AS part_name
        FROM pg_inherits i
        JOIN pg_class p ON p.oid = i.inhparent
        JOIN pg_class c ON c.oid = i.inhrelid
        WHERE p.relname = 'audit'
          AND c.relname ~ '^audit_b[0-9]{8}$'
    LOOP
        block_start := to_date(substring(r.part_name from 'b([0-9]{8})$'), 'YYYYMMDD');
        block_end := block_start + block_days;
        IF block_end <= oldest_keep THEN
            EXECUTE format('DROP TABLE %I', r.part_name);
            dropped := dropped + 1;
        END IF;
    END LOOP;

    FOR r IN
        SELECT c.relname AS part_name
        FROM pg_inherits i
        JOIN pg_class p ON p.oid = i.inhparent
        JOIN pg_class c ON c.oid = i.inhrelid
        WHERE p.relname = 'schedule'
          AND c.relname ~ '^schedule_b[0-9]{8}$'
    LOOP
        block_start := to_date(substring(r.part_name from 'b([0-9]{8})$'), 'YYYYMMDD');
        block_end := block_start + block_days;
        IF block_end <= oldest_keep THEN
            EXECUTE format('DROP TABLE %I', r.part_name);
            dropped := dropped + 1;
        END IF;
    END LOOP;

    FOR r IN
        SELECT c.relname AS part_name
        FROM pg_inherits i
        JOIN pg_class p ON p.oid = i.inhparent
        JOIN pg_class c ON c.oid = i.inhrelid
        WHERE p.relname = 'soldier_status_entry'
          AND c.relname ~ '^soldier_status_entry_b[0-9]{8}$'
    LOOP
        block_start := to_date(substring(r.part_name from 'b([0-9]{8})$'), 'YYYYMMDD');
        block_end := block_start + block_days;
        IF block_end <= oldest_keep THEN
            range_from := block_start::timestamptz;
            range_to := guard_partition_block_end(block_start)::timestamptz;
            SELECT count(*) INTO uncompacted
            FROM soldier_status_entry
            WHERE compacted_at IS NULL
              AND start_at >= range_from
              AND start_at < range_to;
            IF uncompacted > 0 THEN
                CONTINUE;
            END IF;
            EXECUTE format('DROP TABLE %I', r.part_name);
            dropped := dropped + 1;
        END IF;
    END LOOP;

    RETURN dropped;
END;
$$;
