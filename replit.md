# AeroStaff Pro

## Overview

AeroStaff Pro is an Expo / React Native application designed for airport
operations work. It bundles shift planning, flight
activity views, quick-reference manuals, contacts/passwords/notes, and
companion phone + Wear OS support.

The repository is primarily targeted at Android (with a Wear OS module) but
also supports running the UI in a web browser via React Native Web for
preview / development purposes.

## Stack

- Expo SDK 54
- React Native 0.81
- React 19
- TypeScript ~5.9
- React Native Web (for web preview)
- Android native module + Wear OS module (in `android/`)

## Project Layout

- `App.tsx` — Root component with theme, language, airport providers and tabs.
- `index.ts` — Registers the root component and Android widget task handler.
- `app.json` — Expo configuration (icons, plugins, Android widget, etc.).
- `src/`
  - `components/` — Reusable UI (`DrawerMenu`, `GlassCard`, ...).
  - `context/` — Theme / Language / Airport providers.
  - `hooks/`, `i18n/`, `utils/`, `modules/`, `widgets/` — App support code.
  - `screens/` — Top-level screens (Home, Calendar, Flights, ...).
- `plugins/withWearDataSender.js` — Custom Expo config plugin.
- `android/` — Native Android project (incl. Wear OS module).
- `assets/` — Icons, splash, widget preview.

## Replit Environment Setup

### Workflow

The Replit workflow `Start application` runs:

```
npx expo start --web --port 5000 --host lan
```

This boots the Metro bundler and serves the web build on port `5000`, which
is the only port routed to the Replit web preview iframe.

Web-specific dependencies are installed:

- `react-native-web`
- `react-dom`
- `@expo/metro-runtime`

### Web Preview Notes

Because the app is primarily a native React Native application, several
modules behave only partially on the web (e.g. `expo-notifications`,
`expo-haptics`, native widgets, secure storage, calendar and document
picker). The web preview is intended for layout / UI work — for full
functionality, build and run the Android app.

### Deployment

Deployment is configured as a static site:

- Build: `npx expo export --platform web`
- Public directory: `dist`

This produces a static export of the React Native Web bundle that can be
served by Replit's static hosting.

## Useful Scripts

- `npm run start` — Start the Expo dev server.
- `npm run web` — Start the Expo web dev server.
- `npm run android` — Run on a connected Android device / emulator.
- `npm run typecheck` — TypeScript type-check (no emit).

## Recent Changes

- 2026-04-24: Initial Replit import. Added React Native Web dependencies,
  configured the `Start application` workflow on port 5000, and set up
  static deployment via `expo export`.
