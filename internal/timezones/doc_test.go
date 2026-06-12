package timezones

import (
	"encoding/json"
	"testing"
)

func TestParseDoc_empty(t *testing.T) {
	d, err := ParseDoc([]byte(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Zones) != 0 {
		t.Fatalf("zones: %v", d.Zones)
	}
}

func TestParseDoc_valid(t *testing.T) {
	raw := `{"zones":[{"id":"a","label":"HQ","iana":"UTC"}]}`
	d, err := ParseDoc([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Zones) != 1 || d.Zones[0].IANA != "UTC" {
		t.Fatalf("%+v", d)
	}
	_, err = d.ToJSON()
	if err != nil {
		t.Fatal(err)
	}
}

func TestParseDoc_invalidIANA(t *testing.T) {
	raw := `{"zones":[{"id":"a","label":"x","iana":"Not/A/Zone"}]}`
	_, err := ParseDoc([]byte(raw))
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestDocToJSON_rejectEmptyID(t *testing.T) {
	d := &Doc{Zones: []Zone{{ID: "", Label: "x", IANA: "UTC"}}}
	_, err := d.ToJSON()
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestParseDoc_unknownFieldIgnored(t *testing.T) {
	raw := `{"zones":[{"id":"a","label":"x","iana":"UTC"}],"extra":1}`
	d, err := ParseDoc([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(d)
	if string(b) == "" {
		t.Fatal("marshal")
	}
}
