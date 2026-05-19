# AeroStaff Pro Agent Playbook

Read this first in every Codex/agent session. It exists to avoid rediscovering the same workflow.

## Session Startup

1. Work from `C:\Users\turni\Documents\Progetti Antigravity\FlightWorkApp-flight-fix` unless the user explicitly says otherwise.
2. Run `git status --short --branch` before editing.
3. Do not modify or clean `C:\Users\turni\Documents\Progetti Antigravity\FlightWorkApp` unless explicitly asked; it may contain user edits on an old branch.
4. Prefer the branch `codex/design-lab-storybook` for ongoing work.
5. Read this file and `docs/release-automation.md` before release/APK work.

## Default Work Loop

For bugs and product fixes:

1. Reproduce or trace the data flow first. Do not guess.
2. Add or update a small regression test when possible.
3. Make the smallest fix that addresses the root cause.
4. Run the relevant checks.
5. Commit and push when the user asked for implementation or when the fix should persist on GitHub.
6. Do not release unless the user says release, APK, pubblica, or similar.

Useful checks:

```bash
npm test
npm run typecheck
npm run release:check
```

For flight-provider bugs, start with:

```bash
npm run test:flight-helpers
```

## Release Flow

When the user says to release, use the automated flow:

```bash
npm run release:quick
```

This bumps patch version, runs release checks, runs the full test suite, runs TypeScript, commits, pushes, triggers the GitHub APK release workflow, waits for it, downloads/verifies the APK, and copies it to Downloads.

Before release work, run:

```bash
npm run dev:doctor
```

To verify an existing GitHub release APK:

```bash
npm run release:verify -- vX.Y.Z
```

To verify and install on a connected emulator/device:

```bash
npm run release:verify -- vX.Y.Z --install
```

Full release docs: `docs/release-automation.md`.

If the local Windows runner is configured and the user wants the faster PC build, use:

```bash
npm run release:quick -- --local-runner
```

The local runner must be a GitHub self-hosted Windows x64 runner with the custom label `aerostaff`. Initial setup helper:

```powershell
npm run runner:setup -- -Start
```

## Emulator QA Flow

Use this when the user asks to debug with the emulator, inspect UI regressions, or verify an APK in a realistic Android runtime:

```bash
npm run qa:emulator
```

Useful variants:

```bash
npm run qa:emulator -- --install-release v2.6.66
npm run qa:emulator -- --install-apk C:\path\to\AeroStaffPro.apk
```

What the script does:

1. Starts `Medium_Phone_API_36.1` headlessly when no ADB device is connected.
2. Optionally installs a GitHub release or local APK.
3. Launches `com.aerostaffpro.app`, accepts the calendar permission prompt if shown, opens Home and Voli.
4. Saves screenshots, UI dumps, and filtered logcat under `tmp/emulator-qa`.
5. Fails with exit code `2` when it detects inverted visible time ranges such as `22:48 – 21:10`.

When fixing emulator-discovered UI issues, capture the failing evidence first, add a focused regression test where possible, then rerun the relevant checks before committing.

## APK Signing And Install Failures

- Release APKs must come from GitHub Actions because the valid release signing key is stored in GitHub secrets.
- Do not trust locally named release/debug keystores for publishing unless the user explicitly verifies them.
- If Android refuses to update even with install permissions enabled, compare APK signing certificates first.
- If the in-app updater cached a bad APK for a version, publish a new patch version so the app downloads a fresh asset.

## Flight Provider Notes

- Provider mode `auto` should not stop at thin live data. FR24 API live positions are useful overlays, not a complete airport schedule.
- StaffMonitor PSA is the best operational fallback for Pisa day-of data.
- AeroDataBox is preferred for schedule coverage, especially today/tomorrow.
- AirLabs burns quota quickly; keep it late in automatic fallback order unless the user asks otherwise.
- Keep provider keys user-configurable in-app; never hardcode keys.
- When debugging missing flights, inspect provider diagnostics and counts for today/tomorrow before changing UI code.

## Common Commands

```bash
npm run dev:doctor
npm run test:flight-helpers
npm test
npm run typecheck
npm run release:check
npm run release:verify -- vX.Y.Z --no-copy
npm run qa:emulator
npm run github:branches:audit
```

## GitHub And Branch Hygiene

- Keep feature/experiment branches short-lived.
- Do not delete or reset branches with user work unless explicitly asked.
- When asked for GitHub cleanup, audit first with `npm run github:branches:audit`.
- Never commit local logs, keystores, downloaded APKs, API keys, or temp files.

## Product Notes

- App name is `AeroStaff Pro`; remove old `FlightWork App` naming when found.
- The shipped app is not an AI app. Claude/Codex are development tools only.
- The user prefers practical Italian updates, concise summaries, GitHub Releases APKs, and quick iteration.
- Use warm, direct language. Keep final answers short unless the user asks for depth.
