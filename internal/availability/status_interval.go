package availability

import "time"

// OpenIntervalEnd is used when comparing open-ended status rows (end_at IS NULL).
func OpenIntervalEnd() time.Time {
	return time.Date(9999, 12, 31, 23, 59, 59, 0, time.UTC)
}

// EntryRangeEnd returns the exclusive end for overlap checks.
func EntryRangeEnd(end *time.Time) time.Time {
	if end != nil {
		return end.UTC()
	}
	return OpenIntervalEnd()
}

// EntriesOverlap reports whether two status intervals intersect (half-open).
func EntriesOverlap(a0 time.Time, aEnd *time.Time, b0 time.Time, bEnd *time.Time) bool {
	return Overlaps(a0.UTC(), EntryRangeEnd(aEnd), b0.UTC(), EntryRangeEnd(bEnd))
}
