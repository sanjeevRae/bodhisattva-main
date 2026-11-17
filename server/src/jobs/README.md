# jobs/ — scheduled CLI entry points (ARCHITECTURE.md §11)

Outbox worker (email queue drain) and cleanup jobs (sessions, OTPs,
rate-limit windows, media orphan scan). All jobs are idempotent, runnable
by hand, and safe under overlapping cron execution. Implemented in
Phase 2/7 — this folder is a Phase 1 stub.
