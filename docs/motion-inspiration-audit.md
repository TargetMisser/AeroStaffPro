# Motion Inspiration Audit

Research date: 2026-05-18

Scope: Cinematic Operations motion for AeroStaff Pro. Reanimated and Gesture Handler are allowed for prototypes. Skia and Lottie remain inspiration only until a later cost/benefit pass proves they are worth the native weight.

## Direction

- Cockpit and operations-board feel: detents, panels, rails, instrument feedback, technical loading.
- Motion must clarify state, source freshness, navigation, and hierarchy.
- Avoid playful bounce, confetti, decorative loaders, and slow choreography.
- Respect reduced-motion preferences through the shared tokens in `src/utils/motion.ts`.

## Inspiration Matrix

| Inspiration | AeroStaff use | Technical cost | Risk | Decision |
| --- | --- | --- | --- | --- |
| [React Native Reanimated layout animations](https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/entering-exiting-animations/) | Page transitions, flight-card state changes, drawer staging, live update flashes | Medium: new runtime dependency and worklets config | Android build/runtime regressions if plugin config drifts | Use in Storybook/Design Lab first, then migrate one surface at a time |
| [React Native Gesture Handler setup](https://docs.swmansion.com/react-native-gesture-handler/docs/fundamentals/installation/) | Footer swipe, drawer reveal, press feedback, future card gestures | Low/medium: root wrapper and gesture primitives | Gesture conflicts if added broadly without isolation | Enable at root, prototype locally |
| [React Native Skia animations](https://shopify.github.io/react-native-skia/docs/animations/animations/) | Shader-like scanlines, radar sweep, glass depth, gradient instrumentation | High: native dependency plus new rendering model | Bundle size, maintenance, debugging cost | Inspiration only for now |
| [enzomanuelmangano/demos](https://github.com/enzomanuelmangano/demos) | Reference for gesture-driven, tactile RN motion and shader vocabulary | Medium/high if copied structurally | License/maintenance risk and over-complexity | Use as visual research only, no wholesale code |
| [gorhom/react-native-animated-tabbar](https://github.com/gorhom/react-native-animated-tabbar) | Physical footer indicator, morphing tab state, icon/label rhythm | Medium if adopted as dependency, low if custom | Dependency may not match current app shell | Implement custom footer-nav prototype |
| [lottie-react-native](https://github.com/lottie-react-native/lottie-react-native) | Future empty states or branded loader illustration | Medium: animation asset pipeline and native dependency | Easy to become decorative/noisy | Defer; no dependency in this phase |
| [Material Motion](https://m1.material.io/motion/material-motion.html) | Fast, clear state changes that communicate spatial hierarchy | Low | Generic Material feel if followed literally | Use principles, not visual style |
| [Material Duration and Easing](https://m1.material.io/motion/duration-easing.html) | 150-400 ms timing windows, fast exits, clear entrances | Low | Too mechanical if every transition uses same curve | Centralize as recipe tokens |
| [Apple HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | Motion as orientation and feedback, optional and non-distracting | Low | iOS-first assumptions may not fit Android | Use principle: purposeful, optional motion |

## Prototype Patterns

- `footer-nav`: bottom navigation indicator behaves like a physical detent, not a color-only active state.
- `drawer-reveal`: drawer content reveals with depth and restrained stagger; menu should be usable immediately.
- `flight-card-live-update`: changed times/status enter as instrument readings with a short flash and no list jump.
- `cache-loading`: refresh uses a scanline/shimmer over existing stale data instead of hiding the list.
- `press-feedback`: card, menu, chip, and button taps share one tactile scale/depth language.
- `editorial-empty-state`: empty/error states explain the operational state with minimal motion and clear copy.

## Implementation Guardrails

- Keep provider/business logic untouched in this phase.
- Keep Reanimated usage inside Design Lab and Storybook prototypes until manually validated.
- Do not add Skia or Lottie in this pass.
- Do not copy external code; reimplement only the interaction idea.
- If Android build instability appears, keep the shared visual tokens and fall back to existing `Animated` components.
