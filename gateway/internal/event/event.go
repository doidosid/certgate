// Package event builds the Security Event records the Gateway generates for
// each access decision (docs/api-spec.md §7 "Security Event Batch",
// docs/data-model.md "SecurityEvent").
package event

import (
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Reason Codes the Gateway assigns to its own access decisions
// (docs/api-spec.md §10). CERTIFICATE_REQUIRED and INVALID_CERTIFICATE that
// fail at the TLS handshake itself are not modeled here: handshake failures
// are logged, not turned into Security Events (docs/security-design.md §5).
const (
	ReasonRequestAllowed      = "REQUEST_ALLOWED"
	ReasonAccessDenied        = "ACCESS_DENIED"
	ReasonDeviceDisabled      = "DEVICE_DISABLED"
	ReasonDeviceNotRegistered = "DEVICE_NOT_REGISTERED"
	ReasonCertificateRevoked  = "CERTIFICATE_REVOKED"
	ReasonCertificateExpired  = "CERTIFICATE_EXPIRED"
	ReasonInvalidCertificate  = "INVALID_CERTIFICATE"
	ReasonInternalError       = "INTERNAL_ERROR"
)

// Reason Codes for the Gateway's own health, not for a Device request
// (docs/api-spec.md §10). The Gateway is the only component that can see its
// local Outbox, so it is the Producer for both (docs/security-design.md §9).
const (
	ReasonEventOutboxBacklog   = "EVENT_OUTBOX_BACKLOG"
	ReasonEventDeliveryDelayed = "EVENT_DELIVERY_DELAYED"
)

// Decision values (docs/data-model.md "SecurityEvent").
const (
	DecisionAllowed = "ALLOWED"
	DecisionDenied  = "DENIED"
	DecisionError   = "ERROR"
)

// Severity values (docs/data-model.md "SecurityEvent").
const (
	SeverityInfo     = "INFO"
	SeverityWarning  = "WARNING"
	SeverityCritical = "CRITICAL"
)

// Event types (docs/data-model.md "SecurityEvent": ACCESS, TLS, SYSTEM, PKI).
const (
	typeAccess = "ACCESS"
	typeSystem = "SYSTEM"
)

// Event is one Security Event Batch entry (docs/api-spec.md §7).
type Event struct {
	ID                string    `json:"id"`
	OccurredAt        time.Time `json:"occurredAt"`
	Type              string    `json:"type"`
	Severity          string    `json:"severity"`
	DeviceID          string    `json:"deviceId,omitempty"`
	CertificateSerial string    `json:"certificateSerial,omitempty"`
	HTTPMethod        string    `json:"httpMethod,omitempty"`
	RequestPath       string    `json:"requestPath,omitempty"`
	Decision          string    `json:"decision"`
	ReasonCode        string    `json:"reasonCode"`
	ClientIP          string    `json:"clientIp,omitempty"`
	LatencyMs         int       `json:"latencyMs,omitempty"`
	TraceID           string    `json:"traceId"`
}

// Column widths the Management API stores HTTPMethod and RequestPath in
// (V7__create_security_event.sql: http_method VARCHAR(10), request_path
// VARCHAR(255)). Postgres counts VARCHAR length in characters.
const (
	maxHTTPMethodLength  = 10
	maxRequestPathLength = 255
)

// Params carries the fields needed to record one access decision.
type Params struct {
	Now               time.Time
	DeviceID          string
	CertificateSerial string
	HTTPMethod        string
	RequestPath       string
	ReasonCode        string
	ClientIP          string
	LatencyMs         int
	TraceID           string
}

// New builds an ACCESS Security Event from one Gateway decision. The event
// id is Gateway-generated (docs/data-model.md: "Gateway가 생성").
func New(p Params) Event {
	return Event{
		ID:                uuid.NewString(),
		OccurredAt:        p.Now,
		Type:              typeAccess,
		Severity:          severityFor(p.ReasonCode),
		DeviceID:          p.DeviceID,
		CertificateSerial: p.CertificateSerial,
		HTTPMethod:        fitColumn(p.HTTPMethod, maxHTTPMethodLength),
		RequestPath:       fitColumn(p.RequestPath, maxRequestPathLength),
		Decision:          decisionFor(p.ReasonCode),
		ReasonCode:        p.ReasonCode,
		ClientIP:          p.ClientIP,
		LatencyMs:         p.LatencyMs,
		TraceID:           p.TraceID,
	}
}

// SystemParams carries the fields needed to record one Gateway self-observation.
type SystemParams struct {
	Now        time.Time
	ReasonCode string
	TraceID    string
}

// NewSystem builds a SYSTEM Security Event describing the Gateway's own state
// rather than a Device request, so it carries no Device, Certificate, method,
// path, or Client IP. Both conditions it is used for — Outbox backlog and
// delivery delay — are listed as CRITICAL in docs/security-design.md §9, and
// the Producer decides severity at creation time, so severity is fixed here
// instead of being derived from the Reason Code. The decision is ERROR because
// the Event reports a degraded Gateway, not an access verdict
// (docs/data-model.md "SecurityEvent": decision is ALLOWED, DENIED, or ERROR).
func NewSystem(p SystemParams) Event {
	return Event{
		ID:         uuid.NewString(),
		OccurredAt: p.Now,
		Type:       typeSystem,
		Severity:   SeverityCritical,
		Decision:   DecisionError,
		ReasonCode: p.ReasonCode,
		TraceID:    p.TraceID,
	}
}

// severityFor maps a Reason Code to its Security Event severity.
// CERTIFICATE_REVOKED is CRITICAL (docs/security-design.md §9: "폐기 인증서
// 접속"); every other denial/error is WARNING; REQUEST_ALLOWED is INFO.
func severityFor(reasonCode string) string {
	switch reasonCode {
	case ReasonRequestAllowed:
		return SeverityInfo
	case ReasonCertificateRevoked:
		return SeverityCritical
	default:
		return SeverityWarning
	}
}

// decisionFor maps a Reason Code to its Security Event decision
// (docs/data-model.md: ALLOWED, DENIED, ERROR).
func decisionFor(reasonCode string) string {
	switch reasonCode {
	case ReasonRequestAllowed:
		return DecisionAllowed
	case ReasonInternalError:
		return DecisionError
	default:
		return DecisionDenied
	}
}

// Sanitize fits the request-derived fields of evt to the Management API's
// storage columns. The Management API accepts or rejects a batch as a whole
// (docs/api-spec.md §7), so one event Postgres cannot store would fail every
// batch it rides in and, being oldest, keep the Outbox from draining. New
// already applies it; the Outbox Sender applies it again so events enqueued
// before New did are still deliverable.
func Sanitize(evt Event) Event {
	evt.HTTPMethod = fitColumn(evt.HTTPMethod, maxHTTPMethodLength)
	evt.RequestPath = fitColumn(evt.RequestPath, maxRequestPathLength)
	return evt
}

// fitColumn makes s storable in a Postgres VARCHAR(maxChars) text column:
// invalid UTF-8 and NUL, which Postgres rejects in text, become U+FFFD, and
// the result is cut to maxChars characters on a character boundary.
func fitColumn(s string, maxChars int) string {
	s = strings.ToValidUTF8(s, "\uFFFD")
	s = strings.ReplaceAll(s, "\x00", "\uFFFD")
	if utf8.RuneCountInString(s) <= maxChars {
		return s
	}
	return string([]rune(s)[:maxChars])
}
