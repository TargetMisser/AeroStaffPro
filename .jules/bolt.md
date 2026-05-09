## 2024-04-13 - Missing React.memo for FlatList Items
**Learning:** The React Native FlatList components in this codebase frequently render unmemoized inline items (like `ContactRow`, `PasswordRow`, etc.), causing unnecessary re-renders of the entire list when individual state changes.
**Action:** Always wrap long list item components in `React.memo()` to prevent cascading re-renders and improve FlatList scrolling performance.
## 2026-05-09 - Memoizing renderItem in FlatLists

**Learning:** When using `React.memo` to optimize `FlatList` items (like `PasswordRow` in `PasswordScreen.tsx`), if the `renderItem` function is defined inline and passes inline callbacks (`onEdit={() => openEdit(item)}`), a new function reference is created on every render. This completely breaks the shallow equality check of `React.memo` and forces re-renders.
**Action:** Always extract `renderItem` using `useCallback` and ensure the callbacks passed to memoized item components expect the item's parameters (like ID or the item itself) instead of using inline arrow functions. Also, tune `windowSize={5}` to reduce the memory footprint.
