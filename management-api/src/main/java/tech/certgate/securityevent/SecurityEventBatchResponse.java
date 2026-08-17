package tech.certgate.securityevent;

public record SecurityEventBatchResponse(int acceptedCount, int duplicateCount) {
}
