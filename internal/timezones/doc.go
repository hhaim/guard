// Package timezones defines the cfg document shape for key "time_zones".
package timezones

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// CfgKey is the cfg row key storing the time zone list.
const CfgKey = "time_zones"

// Zone is one named IANA time zone entry.
type Zone struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	IANA  string `json:"iana"`
}

// Doc is the JSON value stored under CfgKey.
type Doc struct {
	UpdateTS string `json:"update_ts,omitempty"`
	Zones    []Zone `json:"zones"`
}

// ParseDoc unmarshals and validates zone entries (IANA names must load).
func ParseDoc(raw []byte) (*Doc, error) {
	s := strings.TrimSpace(string(raw))
	if s == "" || s == "null" {
		return &Doc{Zones: []Zone{}}, nil
	}
	var d Doc
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, err
	}
	if d.Zones == nil {
		d.Zones = []Zone{}
	}
	for i := range d.Zones {
		if err := validateZone(&d.Zones[i]); err != nil {
			return nil, fmt.Errorf("zones[%d]: %w", i, err)
		}
	}
	return &d, nil
}

func validateZone(z *Zone) error {
	if strings.TrimSpace(z.ID) == "" {
		return errors.New("missing id")
	}
	if _, err := time.LoadLocation(strings.TrimSpace(z.IANA)); err != nil {
		return fmt.Errorf("invalid iana %q: %w", z.IANA, err)
	}
	return nil
}

// ToJSON returns canonical JSON for persistence (sorted keys not required).
func (d *Doc) ToJSON() (json.RawMessage, error) {
	if d.Zones == nil {
		d.Zones = []Zone{}
	}
	for i := range d.Zones {
		if err := validateZone(&d.Zones[i]); err != nil {
			return nil, err
		}
	}
	b, err := json.Marshal(d)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(b), nil
}
