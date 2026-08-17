// Package enrollment submits CSRs with a short-lived Enrollment Token, polls
// approval status, and retrieves the issued certificate and CA chain.
package enrollment

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const defaultPollInterval = 2 * time.Second

// Result is the certificate material returned once a CSR is approved.
type Result struct {
	CertificatePEM []byte
	CAChainPEM     []byte
	SerialNumber   string
	NotAfter       time.Time
}

// Client submits and tracks a single Device's certificate request against
// the Management API's Enrollment endpoints.
type Client struct {
	BaseURL      string
	Token        string
	HTTPClient   *http.Client
	PollInterval time.Duration
}

// NewClient builds a Client for baseURL (e.g. http://management-api:8080)
// authenticating with the Device's Enrollment Token.
func NewClient(baseURL, token string) *Client {
	return &Client{
		BaseURL:      strings.TrimRight(baseURL, "/"),
		Token:        token,
		HTTPClient:   &http.Client{Timeout: 10 * time.Second},
		PollInterval: defaultPollInterval,
	}
}

// apiError mirrors the Management API's error response
// (docs/api-spec.md "오류 응답").
type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	TraceID string `json:"traceId"`
}

func (e apiError) Error() string {
	return fmt.Sprintf("enrollment: %s: %s (traceId=%s)", e.Code, e.Message, e.TraceID)
}

type statusResponse struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

type certificateResponse struct {
	CertificatePEM string    `json:"certificatePem"`
	CAChainPEM     string    `json:"caChainPem"`
	SerialNumber   string    `json:"serialNumber"`
	NotAfter       time.Time `json:"notAfter"`
}

// Enroll submits csrPEM, waits for administrator approval, and returns the
// issued certificate and CA chain. It blocks until approved, rejected, or
// ctx is done.
func (c *Client) Enroll(ctx context.Context, csrPEM []byte) (Result, error) {
	id, err := c.submit(ctx, csrPEM)
	if err != nil {
		return Result{}, err
	}
	if err := c.waitForApproval(ctx, id); err != nil {
		return Result{}, err
	}
	return c.fetchCertificate(ctx, id)
}

func (c *Client) submit(ctx context.Context, csrPEM []byte) (string, error) {
	body, err := json.Marshal(struct {
		CSRPEM string `json:"csrPem"`
	}{CSRPEM: string(csrPEM)})
	if err != nil {
		return "", fmt.Errorf("enrollment: encode csr: %w", err)
	}

	var resp statusResponse
	if err := c.do(ctx, http.MethodPost, "/enrollments/certificate-requests", body, http.StatusAccepted, &resp); err != nil {
		return "", err
	}
	return resp.ID, nil
}

func (c *Client) waitForApproval(ctx context.Context, id string) error {
	path := "/enrollments/certificate-requests/" + id
	for {
		var resp statusResponse
		if err := c.do(ctx, http.MethodGet, path, nil, http.StatusOK, &resp); err != nil {
			return err
		}

		switch resp.Status {
		case "APPROVED":
			return nil
		case "REJECTED":
			return fmt.Errorf("enrollment: certificate request %s was rejected", id)
		case "PENDING":
			// keep waiting
		default:
			return fmt.Errorf("enrollment: unexpected status %q for request %s", resp.Status, id)
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(c.PollInterval):
		}
	}
}

func (c *Client) fetchCertificate(ctx context.Context, id string) (Result, error) {
	var resp certificateResponse
	path := "/enrollments/certificate-requests/" + id + "/certificate"
	if err := c.do(ctx, http.MethodGet, path, nil, http.StatusOK, &resp); err != nil {
		return Result{}, err
	}

	return Result{
		CertificatePEM: []byte(resp.CertificatePEM),
		CAChainPEM:     []byte(resp.CAChainPEM),
		SerialNumber:   resp.SerialNumber,
		NotAfter:       resp.NotAfter,
	}, nil
}

func (c *Client) do(ctx context.Context, method, path string, body []byte, wantStatus int, out any) error {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+"/api/v1"+path, reader)
	if err != nil {
		return fmt.Errorf("enrollment: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("enrollment: request %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("enrollment: read response: %w", err)
	}

	if resp.StatusCode != wantStatus {
		var apiErr apiError
		if jsonErr := json.Unmarshal(respBody, &apiErr); jsonErr == nil && apiErr.Code != "" {
			return apiErr
		}
		return fmt.Errorf("enrollment: %s %s: unexpected status %d", method, path, resp.StatusCode)
	}

	if out != nil {
		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("enrollment: decode response: %w", err)
		}
	}
	return nil
}
