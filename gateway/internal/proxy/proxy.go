// Package proxy strips externally supplied identity headers, injects
// Gateway-generated trusted headers, and forwards allowed requests to the
// Backend Service (docs/security-design.md §7).
package proxy

import (
	"net/http"
	"net/http/httputil"
	"net/url"
)

// Identity headers a Device could try to spoof; the Gateway always strips
// them from the inbound request before evaluating or forwarding it
// (docs/security-design.md §7).
const (
	HeaderDeviceKey = "X-CertGate-Device-Key"
	HeaderRole      = "X-CertGate-Role"
)

// StripIdentityHeaders removes any externally supplied identity headers so a
// Device cannot claim an identity by header.
func StripIdentityHeaders(header http.Header) {
	header.Del(HeaderDeviceKey)
	header.Del(HeaderRole)
}

// SetTrustedHeaders sets the Gateway-verified identity headers derived from
// the Client Certificate's SAN URI, replacing anything the Device sent.
func SetTrustedHeaders(header http.Header, deviceKey, roleName string) {
	header.Set(HeaderDeviceKey, deviceKey)
	header.Set(HeaderRole, roleName)
}

// NewReverseProxy builds a Reverse Proxy that forwards allowed requests to
// backendURL.
func NewReverseProxy(backendURL *url.URL) *httputil.ReverseProxy {
	return httputil.NewSingleHostReverseProxy(backendURL)
}
