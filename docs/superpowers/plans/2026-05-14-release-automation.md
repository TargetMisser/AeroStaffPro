# Release Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable scripts for AeroStaff Pro's frequent release and APK verification workflow.

**Architecture:** Keep the automation as small Node CLI scripts under `scripts/`, reusing the existing `bump-version`, `release:check`, `test:smoke`, and `typecheck` commands. The scripts shell out to the existing GitHub CLI, Android build-tools, Git, npm, and ADB rather than replacing those tools.

**Tech Stack:** Node.js CommonJS scripts, npm scripts, GitHub CLI, Android SDK build-tools, ADB.

---

### Task 1: Release Tooling Smoke Test

**Files:**
- Create: `scripts/test-release-tooling.cjs`
- Modify: `package.json`

- [ ] **Step 1: Add a test script that describes the desired CLI surface**

Create `scripts/test-release-tooling.cjs` with assertions that `package.json` exposes `release:quick`, `release:verify`, and `dev:doctor`, and that each backing script supports `--help`.

- [ ] **Step 2: Run the test and verify it fails before implementation**

Run: `node scripts/test-release-tooling.cjs`

Expected: FAIL because the new npm scripts and backing files do not exist yet.

### Task 2: Shared CLI Helpers

**Files:**
- Create: `scripts/release-tools.cjs`

- [ ] **Step 1: Add helper functions for command execution, JSON reads, version reads, tool checks, APK path handling, and Android build-tools discovery**

The helpers should keep command output readable and throw clear errors when a required command or file is missing.

### Task 3: Doctor Script

**Files:**
- Create: `scripts/dev-doctor.cjs`

- [ ] **Step 1: Implement `npm run dev:doctor`**

The script should print branch status, version metadata, GitHub auth state, Android build-tools availability, ADB device state, and local dirty files without mutating the repo.

### Task 4: Release Verification Script

**Files:**
- Create: `scripts/release-verify.cjs`

- [ ] **Step 1: Implement `npm run release:verify -- vX.Y.Z`**

The script should download the GitHub release APK into a temp folder, validate package/version metadata with `aapt`, print signing certificate data with `apksigner`, copy the APK to `Downloads`, and optionally install it with `--install`.

### Task 5: Quick Release Script

**Files:**
- Create: `scripts/release-quick.cjs`

- [ ] **Step 1: Implement `npm run release:quick`**

The script should require a clean worktree, bump the patch version by default, run release checks, the full npm test suite, commit and push the version bump, trigger the GitHub release workflow, wait for completion, and call `release-verify` for the new tag.

### Task 6: Wire Commands And Verify

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add npm scripts**

Add `release:quick`, `release:verify`, `dev:doctor`, and `test:release-tooling`.

- [ ] **Step 2: Run verification**

Run: `node scripts/test-release-tooling.cjs`, `npm run release:check`, `npm test`, and `npm run typecheck`.
