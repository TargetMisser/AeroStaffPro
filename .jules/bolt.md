## 2024-04-13 - Missing React.memo for FlatList Items
**Learning:** The React Native FlatList components in this codebase frequently render unmemoized inline items (like `ContactRow`, `PasswordRow`, etc.), causing unnecessary re-renders of the entire list when individual state changes.
**Action:** Always wrap long list item components in `React.memo()` to prevent cascading re-renders and improve FlatList scrolling performance.
## 2026-05-08 - Optimized FlatList Rendering in FlightScreen
**Learning:** Setting windowSize on long lists in React Native reduces memory footprint significantly without disrupting virtualization.
**Action:** Next time when encountering a large list inside a performance critical screen, tune FlatList props like windowSize and maxToRenderPerBatch if not already done.
