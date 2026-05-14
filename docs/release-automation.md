# Release Automation

Use these scripts from the repository root.

## Quick Checks

```bash
npm run dev:doctor
```

Prints the current branch, dirty files, app version metadata, GitHub auth state, Android build-tools paths, and connected ADB devices. It does not modify files.

## Verify An Existing Release

```bash
npm run release:verify -- v2.6.63
```

Downloads the APK from GitHub Releases, checks package metadata with `aapt`, verifies the signing certificate with `apksigner`, and copies the APK to `Downloads`.

To also install the verified APK on a connected device or emulator:

```bash
npm run release:verify -- v2.6.63 --install
```

## Do The Usual Release Flow

```bash
npm run release:quick
```

By default this bumps the patch version. It requires a clean worktree, runs release checks, runs the full test suite, runs TypeScript, commits the version bump, pushes the branch, triggers the GitHub APK release workflow, waits for it, then verifies the published APK.

Other version bumps:

```bash
npm run release:quick -- minor
npm run release:quick -- major
npm run release:quick -- 2.7.0
```

Install after release verification:

```bash
npm run release:quick -- --install
```
