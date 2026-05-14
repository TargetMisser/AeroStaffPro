# AeroStaff Pro Agent Notes

This file is the short-term project memory for Codex/agent sessions. Read it before doing repo work.

## Working Directory

- Prefer the clean worktree at `C:\Users\turni\Documents\Progetti Antigravity\FlightWorkApp-flight-fix`.
- The older local folder `C:\Users\turni\Documents\Progetti Antigravity\FlightWorkApp` may contain user edits and an outdated branch. Do not modify or clean it unless the user explicitly asks.
- Current main working branch is usually `codex/design-lab-storybook`.

## Release Flow

- For the normal release flow, run:

```bash
npm run release:quick
```

- This bumps patch version, runs release checks, runs the full test suite, runs TypeScript, commits, pushes, starts the GitHub APK release workflow, waits for it, downloads/verifies the APK, and copies it to Downloads.
- Use `npm run dev:doctor` before release work to check branch, dirty files, GitHub auth, Android tools, and ADB.
- Use `npm run release:verify -- vX.Y.Z` to verify an existing GitHub release APK.
- Use `npm run release:verify -- vX.Y.Z --install` to verify and install on a connected Android emulator/device.
- Full release automation docs live in `docs/release-automation.md`.

## APK Signing

- Release APKs must come from GitHub Actions because the valid release signing key is stored in GitHub secrets.
- Do not trust locally named release/debug keystores for publishing unless the user explicitly verifies them.
- If Android refuses to update even with install permissions enabled, compare APK signing certificates first.

## Verification Defaults

Before claiming release or tooling work is complete, run the relevant checks:

```bash
npm test
npm run release:check
npm run typecheck
```

For APK releases, also run:

```bash
npm run release:verify -- vX.Y.Z --no-copy
```

## Product Notes

- App name is `AeroStaff Pro`; avoid old `FlightWork App` naming.
- The app itself is not an AI app. Claude/Codex are development tools only.
- Keep API keys, keystores, logs, downloaded APKs, and local temp files out of git.
- Flight data providers are user-configurable in-app. Avoid hardcoding provider keys.
- The user prefers quick practical releases, APKs on GitHub Releases, and concise Italian summaries.
