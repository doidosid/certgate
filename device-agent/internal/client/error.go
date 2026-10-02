package client

import "fmt"

// FailureKind classifies why a Heartbeat attempt failed, so Run can decide
// whether to keep retrying or stop the loop entirely.
type FailureKind int

const (
	// FailureTemporary covers connection errors, timeouts, and 5xx
	// responses: the Gateway or network is expected to recover on its own,
	// so Run keeps retrying with backoff. This is also the conservative
	// default for any response this package doesn't specifically recognize
	// — never stop heartbeating on an ambiguous signal.
	FailureTemporary FailureKind = iota
	// FailurePermanent covers a 401/403 whose reasonCode (if present) is
	// not one that a new certificate would fix — e.g. DEVICE_DISABLED,
	// ACCESS_DENIED. Some other operator action is needed, so Run stops.
	FailurePermanent
	// FailureReenrollRequired covers a 401/403 CERTIFICATE_REVOKED or
	// CERTIFICATE_EXPIRED reasonCode, or a certificate this Client has
	// locally determined is already expired: the Device needs a new
	// certificate before it can heartbeat again. Run stops here too — see
	// cmd/device-agent/main.go for where automatic re-enrollment would hook
	// in (not implemented; out of scope for this change).
	FailureReenrollRequired
)

// reenrollReasonCodes are the Gateway reasonCodes (docs/api-spec.md §10)
// that specifically mean "this certificate is no longer usable," as
// opposed to other 401/403 reasons (e.g. DEVICE_DISABLED, ACCESS_DENIED)
// that issuing a new certificate would not fix.
var reenrollReasonCodes = map[string]bool{
	"CERTIFICATE_REVOKED": true,
	"CERTIFICATE_EXPIRED": true,
}

// knownAuthReasonCodes are the full set of Gateway reasonCodes
// (docs/api-spec.md §10) that can appear on a denied request. An empty or
// otherwise unrecognized code on a 401/403 does not belong to this set and
// is classified FailureTemporary instead of FailurePermanent — see the
// comment at its use in client.go.
var knownAuthReasonCodes = map[string]bool{
	"CERTIFICATE_REVOKED":   true,
	"CERTIFICATE_EXPIRED":   true,
	"ACCESS_DENIED":         true,
	"DEVICE_DISABLED":       true,
	"DEVICE_NOT_REGISTERED": true,
	"INVALID_CERTIFICATE":   true,
}

// HeartbeatError classifies a failed Heartbeat attempt. Status is 0 when no
// HTTP response was received at all (connection/TLS failure). ReasonCode is
// the Gateway's own reasonCode (docs/api-spec.md §10) when the response
// body carried one and was successfully decoded — the raw response body
// itself is never captured here or logged anywhere.
type HeartbeatError struct {
	Kind       FailureKind
	Status     int
	ReasonCode string
	cause      error
}

func (e *HeartbeatError) Error() string {
	switch {
	case e.ReasonCode != "":
		return fmt.Sprintf("client: heartbeat: status %d, reasonCode %s", e.Status, e.ReasonCode)
	case e.Status != 0:
		return fmt.Sprintf("client: heartbeat: unexpected status %d", e.Status)
	default:
		return fmt.Sprintf("client: heartbeat: %v", e.cause)
	}
}

func (e *HeartbeatError) Unwrap() error { return e.cause }
