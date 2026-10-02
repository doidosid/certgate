package client

// State is a Device Agent's current runtime phase. It is logged on every
// transition so an operator can tell a one-off blip from a Device stuck in
// a permanent failure without needing a log line per attempt.
//
// This is intentionally just a handful of string constants, not a
// state-machine framework with transition tables — the project's scale
// doesn't call for one. cmd/device-agent logs STARTING, ENROLLING, and
// STOPPING directly at the points those phases happen; Client.Run reports
// RUNNING, RETRYING, AUTH_FAILED, and REENROLL_REQUIRED as heartbeats
// succeed or fail.
type State string

const (
	StateStarting         State = "STARTING"
	StateEnrolling        State = "ENROLLING"
	StateRunning          State = "RUNNING"
	StateRetrying         State = "RETRYING"
	StateAuthFailed       State = "AUTH_FAILED"
	StateReenrollRequired State = "REENROLL_REQUIRED"
	StateStopping         State = "STOPPING"
)
