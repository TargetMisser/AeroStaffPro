# Footer Alignment Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the cinematic footer selector centered on every tab, remove its duplicate orange rail, and publish a verified `v2.7.31` APK.

**Architecture:** Move regular-tab geometry into a pure TypeScript helper so centering can be verified without rendering React Native. `AppTabBar` consumes the helper while the operations variant remains unchanged.

**Tech Stack:** React Native `Animated`, TypeScript, Node regression scripts, Android emulator QA, GitHub Actions release automation.

---

### Task 1: Add the failing footer regression

**Files:**
- Create: `scripts/test-tab-bar-layout.cjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create a Node test that first asserts `AppTabBar.tsx` uses `computeRegularTabLayout` and no longer renders `styles.detentGlow`. After those regression guards, transpile `src/utils/tabBarLayout.ts` and assert that selector and tab centers are identical for indices 0–3 at a 990 px track width.

- [ ] **Step 2: Register the test**

Add `"test:tab-bar-layout": "node scripts/test-tab-bar-layout.cjs"` and include it in the root `npm test` chain.

- [ ] **Step 3: Run the test to verify RED**

Run:

```powershell
npm run test:tab-bar-layout
```

Expected: FAIL with `AppTabBar should use shared regular-tab geometry`.

### Task 2: Correct regular footer geometry

**Files:**
- Create: `src/utils/tabBarLayout.ts`
- Modify: `src/components/AppTabBar.tsx`
- Test: `scripts/test-tab-bar-layout.cjs`

- [ ] **Step 1: Add the pure geometry helper**

Implement:

```ts
export function computeRegularTabLayout(
  trackWidth: number,
  tabCount: number,
  horizontalPadding = 5,
  selectorInset = 5,
) {
  const safeTabCount = Math.max(1, Math.floor(tabCount));
  const usableWidth = Math.max(0, trackWidth - horizontalPadding * 2);
  const slotWidth = usableWidth / safeTabCount;
  const selectorWidth = Math.max(0, Math.min(slotWidth, Math.max(52, slotWidth - selectorInset * 2)));
  const selectorLeft = horizontalPadding + (slotWidth - selectorWidth) / 2;
  return {
    usableWidth,
    slotWidth,
    selectorWidth,
    selectorLeft,
    translateXForIndex: (index: number) => Math.max(0, Math.min(safeTabCount - 1, index)) * slotWidth,
  };
}
```

- [ ] **Step 2: Wire the helper into `AppTabBar`**

Use `selectorWidth` for the moving selector width, `selectorLeft` for its base left position, and `translateXForIndex(index)` for interpolation output values. Remove the `detentGlow` child and style; keep the narrow per-tab `indicator`.

- [ ] **Step 3: Run the focused test to verify GREEN**

Run:

```powershell
npm run test:tab-bar-layout
```

Expected: `Tab bar layout tests passed.`

- [ ] **Step 4: Commit the fix**

```powershell
git add package.json scripts/test-tab-bar-layout.cjs src/utils/tabBarLayout.ts src/components/AppTabBar.tsx
git commit -m "fix: align footer selector with tab slots"
```

### Task 3: Verify and release

**Files:**
- Modify through release automation: `package.json`, `package-lock.json`, `app.json`, `android/app/build.gradle`, `README.md`, `src/utils/updateChecker.ts`

- [ ] **Step 1: Run local verification**

```powershell
npm test
npm run typecheck
npm run release:check
```

Expected: all commands exit 0.

- [ ] **Step 2: Publish the patch release**

```powershell
npm run release:quick -- 2.7.31
```

Expected: signed `v2.7.31` release verified and copied to Downloads.

- [ ] **Step 3: Align `main` without a duplicate APK build**

Fast-forward `main` through an empty `[skip ci]` sync commit so the release tag remains on the exact source commit and the push workflow does not overwrite the APK.

- [ ] **Step 4: Run emulator QA**

```powershell
npm run qa:emulator -- --install-release v2.7.31
```

Capture all four selected tabs, compare selector and selected-button centers from UI dumps, and require zero offset.

- [ ] **Step 5: Restore the user branch**

Switch back to `codex/design-lab-storybook` and confirm its two local commits plus `output/` and `tmp/` remain untouched.
