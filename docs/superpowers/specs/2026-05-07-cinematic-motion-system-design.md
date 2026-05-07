# AeroStaff Pro Cinematic Motion System Design

## Decision

Use a cinematic hybrid motion language for AeroStaff Pro:

- 50% Operations Board: the default feel for data, refreshes, state changes, lists, and flight updates.
- 30% Tactile Desk: touch interactions should feel physical, weighted, and responsive.
- 20% Cockpit Glass: aviation-style instruments appear only in high-value moments such as timelines, estimated times, pinned flights, and widgets.

The app should feel like an operational aviation tool, not a generic animated mobile UI.

## Goals

- Make key interactions more visual and skeuomorphic without sacrificing readability.
- Give touch targets physical feedback: press depth, spring return, and subtle haptics.
- Make flight data feel alive: board-style refresh, staggered list entry, scanning highlights, and status pulses.
- Use cockpit accents sparingly for memorable utility, especially estimated-vs-scheduled flight information.
- Keep performance safe on Android release builds and respect reduced-motion preferences.

## Non-Goals

- Do not add decorative animation to every element.
- Do not make navigation slower just to show transitions.
- Do not introduce heavy dependencies unless built-in React Native animation primitives are insufficient.
- Do not rework the visual theme palette in this pass.

## Motion Roles

### Operations Board

This is the base layer. It applies to screens and data-heavy surfaces.

Use it for:

- Flight list entry and refresh.
- Loading and empty states.
- Status badges, source badges, and scheduled notification counters.
- Airline cards and StaffMonitor data changes.
- Calendar or shift state transitions when data changes.

Motion style:

- Staggered reveals.
- Scanning light sweep.
- Split-flap inspired value changes where practical.
- Short alert pulses for operational urgency.
- Mostly linear/precise timing with restrained overshoot.

### Tactile Desk

This is the touch layer. It applies when the user physically interacts with the app.

Use it for:

- App tab bar.
- Drawer open and close.
- Pressable cards and settings rows.
- Flight pin/unpin swipe.
- Primary buttons and segmented controls.

Motion style:

- Press down by a few pixels with slight scale reduction.
- Spring return with weight.
- Optional haptics on committed actions, not on every hover-like press.
- Drawer should feel like a heavy panel, not a flat sheet.

### Cockpit Glass

This is the accent layer. It should be rare and useful.

Use it for:

- Flight progress and estimated time indicators.
- Pinned flight card.
- Shift timeline.
- Widget state if supported cleanly.
- High-signal diagnostics or provider health states.

Motion style:

- Gauge needles.
- Radar or runway progress sweeps.
- Small parallax/tilt only where it reads clearly.
- Instrument-like motion that communicates state.

## First Implementation Slice

The first implementation should focus where the user will feel the change immediately:

1. Shared motion utilities.
2. Tactile press wrapper for reusable physical feedback.
3. Tab bar and drawer motion polish.
4. Flight card entry, press, swipe, and pinned state polish.
5. Cockpit accent for flight progress or pinned flight, not both initially unless the first is simple.

This keeps scope bounded while proving the cinematic direction.

## Proposed Components And Utilities

### Motion Tokens

Create a small shared module, for example `src/utils/motion.ts`, with:

- Duration tokens: quick, normal, slow.
- Spring presets: tactile, panel, gentle.
- Easing helpers: board, exit, scan.
- Reduced-motion helper.
- Optional haptic helper that no-ops when unavailable.

### Tactile Pressable

Create a reusable wrapper, for example `src/components/motion/TactilePressable.tsx`.

Responsibilities:

- Animate scale and translateY on press in/out.
- Trigger haptic feedback on committed press when configured.
- Accept children and normal press props.
- Use native driver for transform/opacity.
- Respect reduced motion by reducing transform distance and disabling decorative bounce.

### Board Reveal

Create a lightweight wrapper or hook for list/card reveal.

Responsibilities:

- Fade and translate cards in with stagger.
- Use stable delays based on item index.
- Avoid re-running full entry animations on every refresh unless data materially changes.

### Cockpit Indicator

Create a compact component only after choosing the first target surface.

Candidate first target:

- Flight arrival progress: replace or enhance the current progress bar with a subtle runway/gauge hybrid.

Alternative first target:

- Pinned flight card: add an instrument-style status block.

## Screen Behavior

### App Tab Bar

- Active tab springs up with stronger tactile return.
- Pressed tab depresses before selection.
- Operations theme can add a short teal scan under the selected tab.
- Keep labels readable and avoid continuous looping.

### Drawer

- Open with heavier spring and slight overshoot.
- Overlay fades in quickly.
- Menu rows can enter with a small stagger.
- Closing should be quick and decisive.

### Flight Screen

- On initial load, flight cards enter in a board-like stagger.
- Pull-to-refresh can show a scan pass or source badge pulse.
- Pressing a card should depress it before opening Flightradar24.
- Pin/unpin swipe should keep the existing swipe affordance but add stronger tactile depth and haptic feedback.
- Operational badges can pulse only when close to action windows; existing pulse behavior should be reused, not duplicated.

### Home Screen

- Weather/date/shift cards can reveal with small stagger.
- Current shift card can use tactile depth on manual edit/open interactions when available.
- Pinned flight card should inherit flight card tactile behavior.

## Accessibility And Performance

- Respect reduced-motion preferences where React Native exposes them; otherwise centralize a future-ready setting.
- Use `useNativeDriver: true` whenever animating transform or opacity.
- Avoid animating layout-heavy properties in long lists.
- Avoid continuous loops except for small, meaningful indicators.
- Keep haptics sparse: selection, pin/unpin, important toggles.
- Verify on Android release build, not only Expo/Metro preview.

## Testing And Verification

Minimum verification for the first implementation:

- `npm run typecheck`
- `npx expo export --platform android --output-dir <temp-dir>`
- Manual check on Android emulator or device:
  - Tab bar press and navigation.
  - Drawer open/close.
  - Flight list initial load and refresh.
  - Card press opens Flightradar24.
  - Pin/unpin swipe still works.
  - Operations theme remains readable.

If a release is requested after implementation, use the existing GitHub Actions release pipeline.

## Risks

- Too many loops could make the app feel noisy.
- Staggered list animation could rerun too often if tied to unstable keys.
- Press wrappers can accidentally swallow accessibility or navigation props if not implemented carefully.
- Haptics can become annoying if used for every small touch.
- Cockpit gauges can feel gimmicky unless tied to real state.

## Open Implementation Choice

For the first code pass, use built-in React Native `Animated` and `expo-haptics`.

Only consider adding a dedicated animation library if a concrete requirement cannot be met with the current stack.
