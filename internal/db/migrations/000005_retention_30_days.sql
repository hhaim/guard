-- Keep the latest 30 calendar days (inclusive of today); drop older daily partitions.
-- Superseded by 000006_partition_blocks_40d.sql (40-day blocks).

CREATE OR REPLACE FUNCTION guard_ensure_partitions(
    retention_days int DEFAULT 30,
    future_days int DEFAULT 7
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    d date;
    start_day date;
    end_day date;
BEGIN
    IF retention_days < 1 THEN
        RAISE EXCEPTION 'retention_days must be >= 1';
    END IF;
    IF future_days < 0 THEN
        RAISE EXCEPTION 'future_days must be >= 0';
    END IF;
    -- Oldest day to retain: today - (retention_days - 1).
    start_day := current_date - retention_days + 1;
    end_day := current_date + future_days;
    d := start_day;
    WHILE d <= end_day LOOP
        PERFORM guard_ensure_audit_partition(d);
        PERFORM guard_ensure_schedule_partition(d);
        d := d + 1;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION guard_drop_old_partitions(retention_days int DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    cutoff date := current_date - retention_days;
    r record;
    dropped int := 0;
    part_day date;
BEGIN
    IF retention_days < 1 THEN
        RAISE EXCEPTION 'retention_days must be >= 1';
    END IF;

    FOR r IN
        SELECT c.relname AS part_name
        FROM pg_inherits i
        JOIN pg_class p ON p.oid = i.inhparent
        JOIN pg_class c ON c.oid = i.inhrelid
        WHERE p.relname = 'audit'
          AND c.relname ~ '^audit_[0-9]{8}$'
    LOOP
        part_day := to_date(substring(r.part_name from '([0-9]{8})$'), 'YYYYMMDD');
        IF part_day <= cutoff THEN
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
          AND c.relname ~ '^schedule_[0-9]{8}$'
    LOOP
        part_day := to_date(substring(r.part_name from '([0-9]{8})$'), 'YYYYMMDD');
        IF part_day <= cutoff THEN
            EXECUTE format('DROP TABLE %I', r.part_name);
            dropped := dropped + 1;
        END IF;
    END LOOP;

    RETURN dropped;
END;
$$;

CREATE OR REPLACE FUNCTION guard_retention_maintain(
    retention_days int DEFAULT 30,
    future_days int DEFAULT 7
)
RETURNS integer
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM guard_ensure_partitions(retention_days, future_days);
    RETURN guard_drop_old_partitions(retention_days);
END;
$$;

SELECT guard_retention_maintain(30, 7);
