package auth

import "testing"

func TestAuthorizeReadonly(t *testing.T) {
	if !Authorize("readonly", "GET", "/api/me") {
		t.Fatal("me")
	}
	if !Authorize("readonly", "GET", "/api/plan/context") {
		t.Fatal("plan")
	}
	if !Authorize("readonly", "GET", "/api/reports/schedule") {
		t.Fatal("reports")
	}
	if !Authorize("readonly", "GET", "/api/cfg/soldiers") {
		t.Fatal("soldiers")
	}
	if !Authorize("readonly", "GET", "/api/cfg/slots") {
		t.Fatal("slots")
	}
	if !Authorize("readonly", "GET", "/api/soldiers/status") {
		t.Fatal("soldiers status list")
	}
	if Authorize("readonly", "POST", "/api/soldiers/status") {
		t.Fatal("deny post soldiers status")
	}
	if Authorize("readonly", "PUT", "/api/cfg/soldiers") {
		t.Fatal("deny put cfg")
	}
	if Authorize("readonly", "POST", "/api/plan/generate") {
		t.Fatal("deny post plan")
	}
	if Authorize("readonly", "GET", "/api/admin/invites") {
		t.Fatal("deny admin")
	}
}

func TestAuthorizeAdmin(t *testing.T) {
	if !Authorize("admin", "DELETE", "/api/cfg/soldiers") {
		t.Fatal("admin all")
	}
}
