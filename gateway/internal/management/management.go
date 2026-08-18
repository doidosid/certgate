// Package management is the internal HTTP client the Gateway uses to call
// the Management API's internal endpoints (docs/api-spec.md §7 "Gateway용
// Management API").
package management

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"tech.certgate/gateway/internal/event"
	"tech.certgate/gateway/internal/policy"
)

// AccessContext mirrors docs/api-spec.md §7 "Access Context".
type AccessContext struct {
	CertificateID     string        `json:"certificateId"`
	SerialNumber      string        `json:"serialNumber"`
	CertificateStatus string        `json:"certificateStatus"`
	DeviceID          string        `json:"deviceId"`
	DeviceKey         string        `json:"deviceKey"`
	DeviceStatus      string        `json:"deviceStatus"`
	RoleName          string        `json:"roleName"`
	Rules             []policy.Rule `json:"rules"`
}

// BatchResult is the Security Event Batch response (docs/api-spec.md §7).
type BatchResult struct {
	AcceptedCount  int `json:"acceptedCount"`
	DuplicateCount int `json:"duplicateCount"`
}

// APIError mirrors the Management API's error response
// (docs/api-spec.md "오류 응답").
type APIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	TraceID string `json:"traceId"`
}

func (e APIError) Error() string {
	return fmt.Sprintf("management: %s: %s (traceId=%s)", e.Code, e.Message, e.TraceID)
}

// Client calls the Management API's internal Gateway endpoints, authenticated
// with the shared Gateway Service Token (docs/security-design.md §8).
type Client struct {
	BaseURL      string
	ServiceToken string
	HTTPClient   *http.Client
}

// NewClient builds a Client for baseURL (e.g. http://management-api:8080).
func NewClient(baseURL, serviceToken string) *Client {
	return &Client{
		BaseURL:      strings.TrimRight(baseURL, "/"),
		ServiceToken: serviceToken,
		HTTPClient:   &http.Client{Timeout: 5 * time.Second},
	}
}

// GetAccessContext fetches the Access Context for a Client Certificate's
// serial number.
func (c *Client) GetAccessContext(ctx context.Context, serialNumber string) (AccessContext, error) {
	path := "/internal/access-context?serialNumber=" + url.QueryEscape(serialNumber)
	var resp AccessContext
	if err := c.do(ctx, http.MethodGet, path, nil, http.StatusOK, &resp); err != nil {
		return AccessContext{}, err
	}
	return resp, nil
}

// PostSecurityEvents submits a Security Event batch. The Management API
// accepts or rejects the whole batch atomically (docs/api-spec.md §7).
func (c *Client) PostSecurityEvents(ctx context.Context, events []event.Event) (BatchResult, error) {
	body, err := json.Marshal(struct {
		Events []event.Event `json:"events"`
	}{Events: events})
	if err != nil {
		return BatchResult{}, fmt.Errorf("management: encode security events: %w", err)
	}

	var resp BatchResult
	if err := c.do(ctx, http.MethodPost, "/internal/security-events/batch", body, http.StatusOK, &resp); err != nil {
		return BatchResult{}, err
	}
	return resp, nil
}

func (c *Client) do(ctx context.Context, method, path string, body []byte, wantStatus int, out any) error {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, reader)
	if err != nil {
		return fmt.Errorf("management: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.ServiceToken)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("management: request %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("management: read response: %w", err)
	}

	if resp.StatusCode != wantStatus {
		var apiErr APIError
		if jsonErr := json.Unmarshal(respBody, &apiErr); jsonErr == nil && apiErr.Code != "" {
			return apiErr
		}
		return fmt.Errorf("management: %s %s: unexpected status %d", method, path, resp.StatusCode)
	}

	if out != nil {
		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("management: decode response: %w", err)
		}
	}
	return nil
}
