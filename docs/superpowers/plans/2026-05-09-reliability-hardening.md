# Reliability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add release, flight, notification, and repo-maintenance guardrails without changing the app's successful current behavior.

**Architecture:** Add focused utility modules for flight normalization/cache behavior and notification scheduling safety. Add Node-based scripts for smoke/release/branch auditing, then wire them into package scripts and CI.

**Tech Stack:** React Native, Expo, TypeScript, AsyncStorage, Expo Notifications, Node.js scripts, GitHub Actions.

---

### Task 1: Test Guards

**Files:**
- Create: `scripts/test-flight-helpers.cjs`
- Create: `scripts/smoke-test.cjs`

- [ ] Write tests that assert flight helper behavior and repo wiring.
- [ ] Run them before implementation and confirm they fail because helpers/scripts are missing.
- [ ] Keep tests dependency-light so they can run in GitHub Actions.

### Task 2: Flight Adapter And Cache

**Files:**
- Create: `src/utils/flightScheduleAdapter.ts`
- Create: `src/utils/flightScreenCache.ts`
- Modify: `src/utils/flightTimes.ts`
- Modify: `src/screens/FlightScreen.tsx`
- Modify: `src/widgets/widgetTaskHandler.tsx`

- [ ] Centralize best-time lookup, stable flight keys, merge, prune, and chronological sorting.
- [ ] Preserve the current FR24-like object shape for UI compatibility.
- [ ] Use best available time for operational filtering while keeping display behavior unchanged.

### Task 3: Notification Safety

**Files:**
- Modify: `src/utils/notificationDiagnostics.ts`
- Modify: `src/utils/autoNotifications.ts`
- Modify: `src/screens/FlightScreen.tsx`
- Modify: `src/screens/SettingsScreen.tsx`
- Modify: `src/i18n/translations.ts`

- [ ] Add a scheduler queue for notification scheduling/cancellation.
- [ ] Add duplicate cleanup by dedupe key.
- [ ] Include pending request details in the settings debug panel.

### Task 4: Release And GitHub Hygiene

**Files:**
- Create: `scripts/release-check.cjs`
- Create: `scripts/bump-version.cjs`
- Create: `scripts/github-branch-audit.cjs`
- Modify: `scripts/release-apk.sh`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] Add a release consistency check.
- [ ] Add a version bump helper.
- [ ] Add a branch audit dry-run only.
- [ ] Run smoke checks in CI and before local release APK builds.

### Task 5: Verification

**Files:**
- No new files.

- [ ] Run `npm run test:flight-helpers`.
- [ ] Run `npm run test:smoke`.
- [ ] Run `npm run release:check`.
- [ ] Run `npm run typecheck`.
- [ ] Run `git diff --check`.
