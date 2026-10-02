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
// backendURL. The inbound request must already carry the identity headers
// SetTrustedHeaders put there.
//
// It uses Rewrite rather than a Director: ReverseProxy drops every header the
// request's Connection header names, and with a Director it does so after the
// Director runs, so a Device sending "Connection: X-CertGate-Device-Key"
// would strip the Gateway's verified identity on the way to the Backend.
// Rewrite runs after that removal, so the identity headers are copied from
// the inbound request here, where nothing later can drop them. Rewrite also
// starts from no forwarding headers, so X-Forwarded-For is the address the
// Gateway accepted, not one the Device claimed.
func NewReverseProxy(backendURL *url.URL) *httputil.ReverseProxy {
	return &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(backendURL)
			pr.Out.Host = pr.In.Host
			pr.SetXForwarded()
			for _, name := range []string{HeaderDeviceKey, HeaderRole} {
				if value := pr.In.Header.Get(name); value != "" {
					pr.Out.Header.Set(name, value)
				} else {
					pr.Out.Header.Del(name)
				}
			}
		},
	}
}
