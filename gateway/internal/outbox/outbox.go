// Package outbox persists Security Events to a local SQLite WAL-mode
// database and batches delivery to the Management API with backoff retry.
package outbox
