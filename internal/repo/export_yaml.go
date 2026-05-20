package repo

import (
	"encoding/json"
	"time"

	"gopkg.in/yaml.v3"
)

type scheduleExportYAML struct {
	ExportedAt string              `yaml:"exported_at"`
	Range      scheduleExportRange `yaml:"range"`
	RowCount   int                 `yaml:"row_count"`
	Rows       []scheduleYAMLRow   `yaml:"rows"`
}

type scheduleExportRange struct {
	From string `yaml:"from"`
	To   string `yaml:"to"`
}

type scheduleYAMLRow struct {
	TsDate     string         `yaml:"ts_date"`
	DayIndex   int            `yaml:"day_index"`
	Slot       string         `yaml:"slot"`
	ShiftIndex int            `yaml:"shift_index"`
	ShiftStart string         `yaml:"shift_start"`
	ShiftEnd   string         `yaml:"shift_end"`
	SoldierID  string         `yaml:"soldier_id"`
	Meta       map[string]any `yaml:"meta,omitempty"`
}

// ScheduleRowsToYAML builds a YAML export from schedule duty rows.
func ScheduleRowsToYAML(rows []ScheduleDutyRow, from, to time.Time) ([]byte, error) {
	doc := scheduleExportYAML{
		ExportedAt: time.Now().UTC().Format(time.RFC3339),
		Range: scheduleExportRange{
			From: from.Format("2006-01-02"),
			To:   to.Format("2006-01-02"),
		},
		RowCount: len(rows),
	}
	for _, r := range rows {
		var meta map[string]any
		if len(r.Meta) > 0 {
			_ = json.Unmarshal(r.Meta, &meta)
		}
		doc.Rows = append(doc.Rows, scheduleYAMLRow{
			TsDate:     r.TsDate.Format("2006-01-02"),
			DayIndex:   r.DayIndex,
			Slot:       r.Slot,
			ShiftIndex: r.ShiftIndex,
			ShiftStart: r.ShiftStart,
			ShiftEnd:   r.ShiftEnd,
			SoldierID:  r.SoldierID,
			Meta:       meta,
		})
	}
	return yaml.Marshal(doc)
}
