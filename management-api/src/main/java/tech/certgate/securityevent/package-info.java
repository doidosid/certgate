/**
 * Security Event ingestion from the Gateway Outbox, and Console-facing
 * search/detail. CRITICAL is judged by whichever Producer creates the Event
 * (the Gateway sets it before sending a batch here) — this package validates
 * the stored severity is one of INFO/WARNING/CRITICAL and relays it as-is,
 * it does not re-judge it (docs/architecture.md, docs/security-design.md §9).
 * SSE delivery itself lives in the {@code dashboard} package.
 */
package tech.certgate.securityevent;
