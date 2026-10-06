package tech.certgate.securityevent;

/**
 * {@code expiredCount}: Events that arrived already past
 * SECURITY_EVENT_RETENTION_DAYS and were not stored.
 */
public record SecurityEventBatchResponse(int acceptedCount, int duplicateCount, int expiredCount) {
}
