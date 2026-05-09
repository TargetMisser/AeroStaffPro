## 2024-05-24 - Accessibility on Icon-only Buttons
**Learning:** Icon-only buttons (like a generic 'X' close button) on React Native often miss critical accessibility props because the visual icon lacks semantic text context for screen readers. Furthermore, touch targets can be small.
**Action:** Always add `accessible={true}`, `accessibilityRole="button"`, a localized `accessibilityLabel` (via the translation context), and an appropriate `hitSlop` to ensure both screen reader support and better physical touch interactions for these components.
