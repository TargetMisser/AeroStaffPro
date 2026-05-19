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

By default this bumps the patch version. It updates the README stable version, requires a clean worktree, runs release checks, runs the full test suite, runs TypeScript, commits the version bump, pushes the branch, triggers the GitHub APK release workflow, waits for it, then verifies the published APK.

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

## Build On The Local Windows Runner

The default release still uses GitHub-hosted Linux. To build on the configured local PC runner instead:

```bash
npm run release:quick -- --local-runner
```

The local runner workflow expects a self-hosted Windows x64 runner with the custom label `aerostaff`, plus the Android SDK components already installed:

```text
platforms/android-37 or platforms/android-37.0
build-tools/37.0.0
ndk/27.1.12297006
cmake/3.22.1
```

Initial runner setup from this PC:

```powershell
npm run runner:setup -- -Start
```

The helper defaults to `C:\gha` with work folder `_w` to keep native Android/CMake paths short enough for Windows.

For a persistent runner after reboot, run PowerShell as Administrator and use:

```powershell
npm run runner:setup -- -InstallService
```

Keep using GitHub-hosted release builds if the local runner is offline or queued.

To smoke test the Windows runner without publishing a release:

```powershell
gh workflow run build-release-windows.yml --ref codex/design-lab-storybook -f ref=$(git rev-parse HEAD) -f version_override=v2.7.6 -f publish_release=false
```
