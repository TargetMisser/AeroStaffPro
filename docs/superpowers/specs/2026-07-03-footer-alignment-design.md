# Footer Alignment Fix Design

## Problem

The regular app footer measures the full tab row, including its horizontal padding, and divides that width into four selector slots. The tab buttons themselves are laid out inside the padded content width. These two coordinate systems differ, so the moving selector drifts from `-10 px` on Home to `+9 px` on TravelDoc on the Android QA emulator.

The selected tab also renders two orange rails: the wide `detentGlow` inside the moving selector and the narrow per-tab `indicator`. Their different positions make the drift more visible.

## Decision

Keep the moving translucent selector and the existing icon/label lift. Compute its geometry from the usable row width after subtracting horizontal padding, center it inside each real tab slot, and keep only the narrow per-tab orange indicator.

This preserves the existing tactile/cinematic navigation language while removing the conflicting visual layer.

## Implementation

- Add a pure tab-layout helper that returns usable width, slot width, selector width, selector base offset, and selector translation for an index.
- Use the helper in `AppTabBar` for the regular footer variant.
- Remove `detentGlow` and its rendered view.
- Leave the operations footer variant unchanged.

## Verification

- Add a regression test covering all four selector centers and narrow-width behavior.
- Confirm the regression test fails against the current calculation before implementing the fix.
- Run the full test suite and TypeScript.
- Build/install the release APK on `Medium_Phone_API_36.1`.
- Capture Home, Turni, Voli, and TravelDoc footer screenshots and verify the selector center matches each selected tab.
- Publish and verify patch release `v2.7.31`.

## Non-Goals

- No footer color, typography, icon, height, or animation-duration redesign.
- No changes to the operations footer.
- No unrelated navigation refactor.
