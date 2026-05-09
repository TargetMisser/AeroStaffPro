# Reliability Hardening Design

## Goal

Make AeroStaff Pro safer to release and easier to debug when flight data, notifications, widgets, or theme animation behavior misbehave.

## Scope

This tranche covers six safe improvements:

- Smoke checks that run before CI/release.
- Release validation scripts that catch version and workflow mistakes before tagging.
- A shared flight schedule adapter for stable keys, best-time lookup, chronological sorting, and cache pruning.
- Notification scheduling serialization and duplicate cleanup.
- Richer notification diagnostics in settings.
- A GitHub branch audit dry-run, with no remote deletion.

## Architecture

Flight providers can continue returning FR24-like objects, but consumers should use a small adapter instead of re-implementing timestamp, cache key, and sorting logic. Notification schedulers should go through one in-memory scheduler queue so startup scheduling, flight-tab refresh scheduling, and pinned-flight scheduling do not cancel and re-create notifications at the same time. Release hygiene should live in scripts so CI, local builds, and GitHub Actions share the same checks.

## Safety Decisions

- Remote branch cleanup is report-only. Deleting remote branches remains a manual approval step.
- Notification dedupe cancels only AeroStaff scheduled notifications with identical dedupe keys, keeping the first request.
- Flight caches keep older valid data only as fallback and prune by best known time.
- UI changes stay minimal; this hardening pass is not a visual redesign.

## Verification

- `npm run test:flight-helpers`
- `npm run test:smoke`
- `npm run release:check`
- `npm run typecheck`
- `git diff --check`
