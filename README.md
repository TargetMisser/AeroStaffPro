# AeroStaff Pro

AeroStaff Pro is a React Native app for airport shift work. It keeps the things that usually end up scattered across calendars, screenshots, notes, staff tools, and flight boards in one place.

## What It Does

- Tracks shifts with month and week views.
- Imports shift rosters from files and screenshots.
- Shows same-day and next-day flight activity for the selected airport.
- Supports flight data providers such as AirLabs and Flightradar24 through user-provided API keys.
- Opens flights in Flightradar24 when the installed app can handle the route.
- Provides Android widgets and a Wear OS companion for quick shift and flight information.
- Stores operational notes, contacts, manuals, passwords, and useful links.
- Includes notification controls for flight and shift reminders.

## Development Note

This is not an AI app. AeroStaff Pro does not include a chatbot, language model, AI decision-making, or AI features for end users.

Claude and Codex are used as development tools for planning, implementation, debugging, refactoring, documentation, and release work. They help build the project, but they are not part of the shipped app experience.

## Tech Stack

- Expo SDK 54
- React Native 0.81
- React 19
- TypeScript
- Android native code
- Wear OS module
- Android widget support

## Requirements

- Node.js 20 recommended
- npm
- Android Studio with the Android SDK
- Java 17 or newer

## Getting Started

```bash
git clone https://github.com/TargetMisser/AeroStaffPro.git
cd AeroStaffPro
npm ci
npm run start
```

Run on Android:

```bash
npm run android
```

Run the web preview:

```bash
npm run web
```

Run Storybook:

```bash
npm run storybook
```

## Useful Commands

```bash
npm run typecheck
npm test
npm run test:smoke
npm run release:check
npm run github:branches:audit
```

## Releases

APK files are published in [GitHub Releases](https://github.com/TargetMisser/AeroStaffPro/releases).

Latest stable release: **v2.6.55**

To install the Android app:

1. Open the Releases page.
2. Download `AeroStaffPro-vX.X.X.apk`.
3. Install it on the Android device. You may need to allow installs from unknown sources.
4. If using Wear OS, keep the phone and watch paired so the companion module can be installed.

## Local Android Release Build

Set the signing environment variables first:

```powershell
$env:RELEASE_STORE_FILE="C:\path\to\release.keystore"
$env:RELEASE_STORE_PASSWORD="your-keystore-password"
$env:RELEASE_KEY_ALIAS="your-key-alias"
$env:RELEASE_KEY_PASSWORD="your-key-password"
```

Then build:

```powershell
cd android
.\gradlew.bat assembleRelease
```

The APK is generated at:

```text
android/app/build/outputs/apk/release/app-release.apk
```

The GitHub Actions release workflow expects these repository secrets:

```text
KEYSTORE_BASE64
KEYSTORE_PASSWORD
KEY_ALIAS
KEY_PASSWORD
```

## Repository Notes

- `main` is the public stable branch.
- Feature and experiment branches should be short-lived.
- Local logs, keystores, downloaded APKs, and temporary files should not be committed.
- API keys are configured by the user inside the app or through local environment setup, not stored in the repository.
- Release APKs live in GitHub Releases, not in git.
