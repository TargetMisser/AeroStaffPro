#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK_PATH="$ROOT_DIR/android/app/build/outputs/apk/release/app-release.apk"
WEAR_APK_PATH="$ROOT_DIR/android/wear/build/outputs/apk/release/wear-release.apk"

npm run release:check
npm run test:smoke
npm run typecheck
"$ROOT_DIR/scripts/check-env.sh"

pushd "$ROOT_DIR/android" >/dev/null
./gradlew clean :app:assembleRelease :wear:assembleRelease
popd >/dev/null

if [[ -f "$APK_PATH" ]]; then
  echo "[release-apk] APK telefono generato: $APK_PATH"
else
  echo "[release-apk] Build completata ma APK telefono non trovato in: $APK_PATH"
  exit 1
fi

if [[ -f "$WEAR_APK_PATH" ]]; then
  echo "[release-apk] APK Wear generato: $WEAR_APK_PATH"
else
  echo "[release-apk] Build completata ma APK Wear non trovato in: $WEAR_APK_PATH"
  exit 1
fi
