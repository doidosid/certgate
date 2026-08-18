// Package event builds the Security Event records the Gateway generates for
// each access decision (docs/api-spec.md §7 "Security Event Batch",
// docs/data-model.md "SecurityEvent").
package event

import (
	"time"

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

const typeAccess = "ACCESS"

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
		HTTPMethod:        p.HTTPMethod,
		RequestPath:       p.RequestPath,
		Decision:          decisionFor(p.ReasonCode),
		ReasonCode:        p.ReasonCode,
		ClientIP:          p.ClientIP,
		LatencyMs:         p.LatencyMs,
		TraceID:           p.TraceID,
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
