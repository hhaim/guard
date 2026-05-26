package repo

import (
	"encoding/json"
	"time"

	"gopkg.in/yaml.v3"

	"guard/internal/model"
)

type scheduleExportYAML struct {
	ExportedAt string              `yaml:"exported_at"`
	Range      scheduleExportRange `yaml:"range"`
	Plan       model.PlanDoc       `yaml:"plan"`
}

type scheduleExportRange struct {
	From string `yaml:"from"`
	To   string `yaml:"to"`
}

// PlanDocToYAML exports a merged plan document for a date range.
func PlanDocToYAML(doc model.PlanDoc, from, to time.Time) ([]byte, error) {
	export := scheduleExportYAML{
		ExportedAt: time.Now().UTC().Format(time.RFC3339),
		Range: scheduleExportRange{
			From: from.Format("2006-01-02"),
			To:   to.Format("2006-01-02"),
		},
		Plan: doc,
	}
	return yaml.Marshal(export)
}

// PlanDocFromYAML parses an exported plan document (optional wrapper with plan key).
func PlanDocFromYAML(data []byte) (model.PlanDoc, error) {
	var wrap struct {
		Plan model.PlanDoc `yaml:"plan"`
	}
	if err := yaml.Unmarshal(data, &wrap); err == nil && wrap.Plan.AnchorDate != "" {
		return wrap.Plan, nil
	}
	var doc model.PlanDoc
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return model.PlanDoc{}, err
	}
	return doc, nil
}

// PlanDocToJSON marshals a plan for API responses.
func PlanDocToJSON(doc model.PlanDoc) (json.RawMessage, error) {
	return json.Marshal(doc)
}
