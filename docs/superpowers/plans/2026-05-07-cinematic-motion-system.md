# Cinematic Motion System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first cinematic motion slice for AeroStaff Pro: operations-board list motion, tactile press feedback, and one cockpit-style flight progress accent.

**Architecture:** Add shared motion utilities first, then consume them from focused motion components. Keep screen logic intact: wrappers enhance interaction and visuals without changing flight data, navigation, notification, or provider behavior.

**Tech Stack:** React Native `Animated`, `Easing`, `AccessibilityInfo`, `Pressable`, `expo-haptics`, existing Expo/React Native project structure.

---

## File Structure

- Create `src/utils/motion.ts`: central motion tokens, reduced-motion hook, haptic helper, and stagger helper.
- Create `src/components/motion/TactilePressable.tsx`: reusable press-depth wrapper for buttons/cards.
- Create `src/components/motion/BoardReveal.tsx`: reusable staggered reveal wrapper.
- Create `src/components/motion/CockpitFlightProgress.tsx`: compact cockpit/runway indicator for arrival progress.
- Modify `src/components/AppTabBar.tsx`: use tactile press and operations scan rail.
- Modify `src/components/DrawerMenu.tsx`: use shared motion tokens and heavier panel spring.
- Modify `src/screens/FlightScreen.tsx`: add card reveal, tactile card press, haptic pin/unpin, and cockpit progress accent.
- Modify `src/screens/HomeScreen.tsx`: apply board reveal to top home cards and pinned flight if low-risk after FlightScreen is stable.

## Scope Notes

The first pass should not rework navigation, flight fetching, settings, provider APIs, or release workflow. If any animation breaks accessibility or core interactions, remove the animation and keep the behavior.

---

### Task 1: Shared Motion Utilities

**Files:**
- Create: `src/utils/motion.ts`

- [ ] **Step 1: Create motion tokens and helpers**

Create `src/utils/motion.ts` with this content:

```ts
import { AccessibilityInfo, Easing, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';

export const motionDurations = {
  instant: 90,
  quick: 150,
  normal: 240,
  board: 320,
  panel: 420,
} as const;

export const motionEasing = {
  board: Easing.out(Easing.cubic),
  scan: Easing.inOut(Easing.quad),
  exit: Easing.in(Easing.cubic),
} as const;

export const motionSpring = {
  tactile: {
    damping: 16,
    stiffness: 260,
    mass: 0.72,
  },
  panel: {
    damping: 26,
    stiffness: 190,
    mass: 1.08,
  },
  gentle: {
    damping: 20,
    stiffness: 180,
    mass: 0.9,
  },
} as const;

export type MotionHaptic = 'selection' | 'light' | 'medium' | 'success';

export function getStaggerDelay(index: number, baseDelay = 42, maxDelay = 260): number {
  return Math.min(index * baseDelay, maxDelay);
}

export function useReducedMotionPreference(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => {
        if (mounted) setReducedMotion(value);
      })
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}

export async function triggerMotionHaptic(kind: MotionHaptic = 'selection'): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    if (kind === 'selection') {
      await Haptics.selectionAsync();
      return;
    }
    if (kind === 'success') {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    await Haptics.impactAsync(
      kind === 'medium'
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light,
    );
  } catch {}
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS. If it fails because `AccessibilityInfo.addEventListener` returns a different subscription shape, change cleanup to:

```ts
return () => {
  mounted = false;
  if ('remove' in subscription) subscription.remove();
};
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/motion.ts
git commit -m "feat: add shared motion utilities"
```

---

### Task 2: Tactile Pressable Wrapper

**Files:**
- Create: `src/components/motion/TactilePressable.tsx`
- Modify consumers in Tasks 4, 6, and 8 only after this task passes.

- [ ] **Step 1: Create `TactilePressable`**

Create `src/components/motion/TactilePressable.tsx`:

```tsx
import React, { useCallback, useRef } from 'react';
import {
  Animated,
  type GestureResponderEvent,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { motionDurations, motionSpring, triggerMotionHaptic, type MotionHaptic, useReducedMotionPreference } from '../../utils/motion';

type TactilePressableProps = PressableProps & {
  children: React.ReactNode;
  animatedStyle?: StyleProp<ViewStyle>;
  depth?: number;
  pressedScale?: number;
  haptic?: MotionHaptic | false;
};

export default function TactilePressable({
  children,
  animatedStyle,
  depth = 4,
  pressedScale = 0.975,
  haptic = false,
  onPress,
  onPressIn,
  onPressOut,
  disabled,
  ...props
}: TactilePressableProps) {
  const reducedMotion = useReducedMotionPreference();
  const press = useRef(new Animated.Value(0)).current;

  const animateTo = useCallback((value: number) => {
    if (reducedMotion) {
      Animated.timing(press, {
        toValue: value,
        duration: motionDurations.instant,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.spring(press, {
      toValue: value,
      ...motionSpring.tactile,
      useNativeDriver: true,
    }).start();
  }, [press, reducedMotion]);

  const handlePressIn = useCallback((event: GestureResponderEvent) => {
    if (!disabled) animateTo(1);
    onPressIn?.(event);
  }, [animateTo, disabled, onPressIn]);

  const handlePressOut = useCallback((event: GestureResponderEvent) => {
    animateTo(0);
    onPressOut?.(event);
  }, [animateTo, onPressOut]);

  const handlePress = useCallback((event: GestureResponderEvent) => {
    if (haptic) triggerMotionHaptic(haptic).catch(() => {});
    onPress?.(event);
  }, [haptic, onPress]);

  const translateY = press.interpolate({
    inputRange: [0, 1],
    outputRange: [0, reducedMotion ? Math.min(depth, 1) : depth],
  });
  const scale = press.interpolate({
    inputRange: [0, 1],
    outputRange: [1, reducedMotion ? 0.995 : pressedScale],
  });

  return (
    <Pressable
      {...props}
      disabled={disabled}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View style={[animatedStyle, { transform: [{ translateY }, { scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/motion/TactilePressable.tsx
git commit -m "feat: add tactile pressable motion wrapper"
```

---

### Task 3: Board Reveal Wrapper

**Files:**
- Create: `src/components/motion/BoardReveal.tsx`

- [ ] **Step 1: Create `BoardReveal`**

Create `src/components/motion/BoardReveal.tsx`:

```tsx
import React, { useEffect, useRef } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';
import { getStaggerDelay, motionDurations, motionEasing, useReducedMotionPreference } from '../../utils/motion';

type BoardRevealProps = {
  children: React.ReactNode;
  index?: number;
  enabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export default function BoardReveal({
  children,
  index = 0,
  enabled = true,
  style,
}: BoardRevealProps) {
  const reducedMotion = useReducedMotionPreference();
  const progress = useRef(new Animated.Value(enabled ? 0 : 1)).current;

  useEffect(() => {
    if (!enabled) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: reducedMotion ? motionDurations.quick : motionDurations.board,
      delay: reducedMotion ? 0 : getStaggerDelay(index),
      easing: motionEasing.board,
      useNativeDriver: true,
    }).start();
  }, [enabled, index, progress, reducedMotion]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [reducedMotion ? 4 : 18, 0],
  });

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{ translateY }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/motion/BoardReveal.tsx
git commit -m "feat: add board reveal motion wrapper"
```

---

### Task 4: App Tab Bar Tactile And Scan Motion

**Files:**
- Modify: `src/components/AppTabBar.tsx`

- [ ] **Step 1: Import the tactile wrapper and motion tokens**

Change imports at the top:

```tsx
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import FrostedSurface from './FrostedSurface';
import TactilePressable from './motion/TactilePressable';
import { motionDurations } from '../utils/motion';
```

- [ ] **Step 2: Replace `TouchableOpacity` in `AppTab`**

Replace the return wrapper in `AppTab`:

```tsx
return (
  <TactilePressable
    onPress={onPress}
    animatedStyle={styles.tab}
    depth={3}
    pressedScale={0.94}
    haptic="selection"
    accessibilityRole="button"
  >
    <Animated.View style={{ transform: [{ scale }, { translateY }], alignItems: 'center' }}>
      <MaterialIcons name={icon} size={22} color={focused ? activeColor : inactiveColor} />
    </Animated.View>
    <Animated.Text
      style={[
        styles.label,
        { color: focused ? activeColor : inactiveColor, opacity, transform: [{ translateY }] },
        focused && { fontWeight: '700' },
      ]}
    >
      {label}
    </Animated.Text>
    {focused && <View style={[styles.indicator, { backgroundColor: activeColor }]} />}
  </TactilePressable>
);
```

- [ ] **Step 3: Add scan animation to `OperationsTab`**

Inside `OperationsTab`, before return, add:

```tsx
const scan = useRef(new Animated.Value(0)).current;

useEffect(() => {
  if (!focused) {
    scan.stopAnimation();
    scan.setValue(0);
    return;
  }

  const loop = Animated.loop(
    Animated.sequence([
      Animated.timing(scan, {
        toValue: 1,
        duration: 1300,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(scan, {
        toValue: 0,
        duration: motionDurations.quick,
        useNativeDriver: true,
      }),
    ]),
  );
  loop.start();
  return () => loop.stop();
}, [focused, scan]);

const scanTranslateX = scan.interpolate({
  inputRange: [0, 1],
  outputRange: [-52, 86],
});
```

- [ ] **Step 4: Replace `TouchableOpacity` in `OperationsTab`**

Replace the current `TouchableOpacity` wrapper:

```tsx
return (
  <TactilePressable
    onPress={onPress}
    animatedStyle={[styles.opsTab, focused && styles.opsTabActive]}
    depth={5}
    pressedScale={0.955}
    haptic="selection"
    accessibilityRole="button"
  >
    {focused && (
      <Animated.View
        pointerEvents="none"
        style={[
          styles.opsScan,
          {
            backgroundColor: activeColor,
            transform: [{ translateX: scanTranslateX }],
          },
        ]}
      />
    )}
    <View style={[styles.opsIndexPill, focused && { backgroundColor: 'rgba(45,212,191,0.18)', borderColor: activeColor }]}>
      <Text style={[styles.opsIndex, { color: focused ? activeColor : inactiveColor }]}>
        {String(index + 1).padStart(2, '0')}
      </Text>
    </View>
    <View style={styles.opsIconBlock}>
      <MaterialIcons name={icon} size={20} color={focused ? activeColor : inactiveColor} />
      <Text
        numberOfLines={1}
        style={[styles.opsLabel, { color: focused ? activeColor : inactiveColor }]}
      >
        {label.toUpperCase()}
      </Text>
    </View>
    {focused && <View style={[styles.opsActiveRail, { backgroundColor: activeColor }]} />}
  </TactilePressable>
);
```

- [ ] **Step 5: Add `opsScan` style**

Add this style:

```tsx
opsScan: {
  position: 'absolute',
  top: 0,
  bottom: 0,
  width: 38,
  opacity: 0.16,
  transform: [{ skewX: '-18deg' }],
},
```

- [ ] **Step 6: Run typecheck and smoke export**

Run:

```bash
npm run typecheck
npx expo export --platform android --output-dir "$env:TEMP\aerostaff-motion-tab-test"
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/AppTabBar.tsx
git commit -m "feat: add tactile tab bar motion"
```

---

### Task 5: Drawer Heavy Panel Motion

**Files:**
- Modify: `src/components/DrawerMenu.tsx`

- [ ] **Step 1: Import shared motion tokens**

Change imports:

```tsx
import {
  Animated, Modal, StyleSheet, TouchableOpacity, View,
} from 'react-native';
import { Easing } from 'react-native';
import { motionDurations, motionEasing, motionSpring } from '../utils/motion';
```

- [ ] **Step 2: Update open animation**

Replace the open `Animated.parallel` block with:

```tsx
Animated.parallel([
  Animated.spring(slideAnim, {
    toValue: 0,
    ...motionSpring.panel,
    useNativeDriver: true,
  }),
  Animated.timing(fadeAnim, {
    toValue: 1,
    duration: motionDurations.normal,
    easing: motionEasing.board,
    useNativeDriver: true,
  }),
]).start();
```

- [ ] **Step 3: Update close animation**

Replace the close `Animated.parallel` block with:

```tsx
Animated.parallel([
  Animated.timing(slideAnim, {
    toValue: -DRAWER_WIDTH,
    duration: motionDurations.normal,
    easing: motionEasing.exit,
    useNativeDriver: true,
  }),
  Animated.timing(fadeAnim, {
    toValue: 0,
    duration: motionDurations.quick,
    easing: Easing.out(Easing.quad),
    useNativeDriver: true,
  }),
]).start(({ finished }) => { if (finished) setMounted(false); });
```

- [ ] **Step 4: Keep transform-based rendering**

Ensure the drawer wrapper still uses:

```tsx
<Animated.View style={[styles.drawerWrapper, { transform: [{ translateX: slideAnim }] }]}>
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/DrawerMenu.tsx
git commit -m "feat: add heavy drawer panel motion"
```

---

### Task 6: Flight Card Tactile Press And Swipe Haptics

**Files:**
- Modify: `src/screens/FlightScreen.tsx`

- [ ] **Step 1: Add imports**

Add imports near existing imports:

```tsx
import TactilePressable from '../components/motion/TactilePressable';
import BoardReveal from '../components/motion/BoardReveal';
import { triggerMotionHaptic } from '../utils/motion';
```

- [ ] **Step 2: Add `index` prop to `FlightRowProps`**

Update `FlightRowProps`:

```ts
interface FlightRowProps {
  item: any;
  index: number;
  activeTab: 'arrivals' | 'departures';
  userShift: { start: number; end: number } | null;
  pinnedFlightId: string | null;
  onPin: (item: any) => void;
  onUnpin: () => void;
  inboundArrivals: Record<string, number>;
  colors: ThemeColors;
  isOperations: boolean;
  s: ReturnType<typeof makeStyles>;
  smPool: StaffMonitorFlight[];
  locale: string;
  t: (key: TranslationKey) => string;
}
```

Update the function signature:

```ts
function FlightRowComponent({ item, index, activeTab, userShift, pinnedFlightId, onPin, onUnpin, inboundArrivals, colors, isOperations, s, smPool, locale, t }: FlightRowProps) {
```

- [ ] **Step 3: Add haptic to swipe toggle**

In `SwipeableFlightCardComponent`, inside the committed swipe timing callback, change:

```ts
onToggleRef.current();
animateBack();
```

to:

```ts
triggerMotionHaptic(isPinned ? 'light' : 'medium').catch(() => {});
onToggleRef.current();
animateBack();
```

- [ ] **Step 4: Replace flight card touchable with `TactilePressable`**

Replace:

```tsx
<TouchableOpacity
  style={[s.card, isPinned && s.cardPinned, { marginBottom: 0 }, isOperations && { borderLeftColor: color }]}
  activeOpacity={0.88}
  onPress={() => { openFlightradar24Flight(flightNumber).catch(() => {}); }}
  accessibilityRole="link"
  accessibilityLabel={`Apri ${flightNumber} su Flightradar24`}
>
```

with:

```tsx
<TactilePressable
  animatedStyle={[s.card, isPinned && s.cardPinned, { marginBottom: 0 }, isOperations && { borderLeftColor: color }]}
  depth={isOperations ? 6 : 4}
  pressedScale={0.982}
  haptic={false}
  onPress={() => { openFlightradar24Flight(flightNumber).catch(() => {}); }}
  accessibilityRole="link"
  accessibilityLabel={`Apri ${flightNumber} su Flightradar24`}
>
```

Replace the matching closing `</TouchableOpacity>` with:

```tsx
</TactilePressable>
```

- [ ] **Step 5: Wrap row output in `BoardReveal`**

Wrap the existing `SwipeableFlightCard` return in `BoardReveal`.

Add this line immediately before `<SwipeableFlightCard`:

```tsx
<BoardReveal index={index} enabled={isOperations}>
```

Add this line immediately after `</SwipeableFlightCard>`:

```tsx
</BoardReveal>
```

Do not alter the body of the card in this step beyond the wrapper placement. The final `return` still returns one React node, now the `BoardReveal` wrapper.

- [ ] **Step 6: Pass index from FlatList**

Change `renderFlight`:

```tsx
const renderFlight = useCallback(({ item, index }: { item: any; index: number }) => (
  <FlightRow
    item={item}
    index={index}
    activeTab={activeTab}
    userShift={userShift}
    pinnedFlightId={pinnedFlightId}
    onPin={pinFlight}
    onUnpin={unpinFlight}
    inboundArrivals={inboundArrivals}
    colors={colors}
    isOperations={isOperations}
    s={s}
    smPool={activeTab === 'departures' ? staffMonitorDeps : staffMonitorArrs}
    locale={locale}
    t={t}
  />
), [activeTab, userShift, s, pinnedFlightId, pinFlight, unpinFlight, inboundArrivals, colors, isOperations, staffMonitorDeps, staffMonitorArrs, locale, t]);
```

- [ ] **Step 7: Run typecheck and export**

Run:

```bash
npm run typecheck
npx expo export --platform android --output-dir "$env:TEMP\aerostaff-motion-flight-card-test"
```

Expected: both commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/screens/FlightScreen.tsx
git commit -m "feat: add cinematic flight card motion"
```

---

### Task 7: Cockpit Flight Progress Accent

**Files:**
- Create: `src/components/motion/CockpitFlightProgress.tsx`
- Modify: `src/screens/FlightScreen.tsx`

- [ ] **Step 1: Create cockpit progress component**

Create `src/components/motion/CockpitFlightProgress.tsx`:

```tsx
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { motionDurations, motionEasing, useReducedMotionPreference } from '../../utils/motion';

type CockpitFlightProgressProps = {
  progress: number;
  startLabel: string;
  endLabel: string;
  departureColor: string;
  arrivalColor: string;
  planeColor: string;
  isOperations: boolean;
};

export default function CockpitFlightProgress({
  progress,
  startLabel,
  endLabel,
  departureColor,
  arrivalColor,
  planeColor,
  isOperations,
}: CockpitFlightProgressProps) {
  const reducedMotion = useReducedMotionPreference();
  const reveal = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const clamped = Math.max(0, Math.min(1, progress));

  useEffect(() => {
    Animated.timing(reveal, {
      toValue: 1,
      duration: reducedMotion ? motionDurations.quick : motionDurations.board,
      easing: motionEasing.board,
      useNativeDriver: true,
    }).start();
  }, [reducedMotion, reveal]);

  useEffect(() => {
    if (reducedMotion || !isOperations) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, {
          toValue: 1,
          duration: 1800,
          easing: motionEasing.scan,
          useNativeDriver: true,
        }),
        Animated.timing(sweep, {
          toValue: 0,
          duration: motionDurations.quick,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isOperations, reducedMotion, sweep]);

  const translateY = reveal.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0],
  });
  const sweepTranslateX = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-80, 260],
  });

  return (
    <Animated.View style={[styles.wrap, isOperations && styles.wrapOperations, { opacity: reveal, transform: [{ translateY }] }]}>
      <View style={styles.metaRow}>
        <View style={styles.endpoint}>
          <MaterialIcons name="flight-takeoff" size={14} color={departureColor} />
          <Text style={styles.time}>{startLabel}</Text>
        </View>
        <View style={styles.endpoint}>
          <MaterialIcons name="flight-land" size={14} color={arrivalColor} />
          <Text style={[styles.time, { color: arrivalColor }]}>{endLabel}</Text>
        </View>
      </View>
      <View style={styles.trackWrap}>
        {isOperations && (
          <Animated.View
            pointerEvents="none"
            style={[styles.sweep, { transform: [{ translateX: sweepTranslateX }, { skewX: '-18deg' }] }]}
          />
        )}
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, clamped * 100))}%`, backgroundColor: arrivalColor }]} />
        </View>
        <View style={[styles.planeWrap, { left: `${Math.max(4, Math.min(96, clamped * 100))}%` }]}>
          <View style={styles.planeBadge}>
            <MaterialIcons name="flight" size={14} color={planeColor} style={styles.planeIcon} />
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
  },
  wrapOperations: {
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.18)',
    borderRadius: 14,
    padding: 10,
    backgroundColor: 'rgba(2,8,12,0.30)',
    overflow: 'hidden',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  endpoint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  time: {
    fontSize: 11,
    fontWeight: '800',
    color: '#EAF4F4',
    fontVariant: ['tabular-nums'],
  },
  trackWrap: {
    position: 'relative',
    justifyContent: 'center',
    height: 30,
    overflow: 'hidden',
  },
  sweep: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    width: 58,
    opacity: 0.18,
    backgroundColor: '#99F6E4',
    borderRadius: 999,
  },
  track: {
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(141,163,173,0.24)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
  planeWrap: {
    position: 'absolute',
    top: 1,
    marginLeft: -11,
  },
  planeBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#071414',
    borderWidth: 1.5,
    borderColor: 'rgba(45,212,191,0.30)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  planeIcon: {
    transform: [{ rotate: '90deg' }],
  },
});
```

- [ ] **Step 2: Import cockpit component in FlightScreen**

Add:

```tsx
import CockpitFlightProgress from '../components/motion/CockpitFlightProgress';
```

- [ ] **Step 3: Replace existing arrival progress block**

Replace the current `arrivalProgress && (` block in `FlightRowComponent` with:

```tsx
{arrivalProgress && (
  <CockpitFlightProgress
    progress={arrivalProgress.progress}
    startLabel={fmtTs(arrivalProgress.startTs)}
    endLabel={fmtTs(arrivalProgress.endTs)}
    departureColor={arrivalProgress.departureColor}
    arrivalColor={arrivalProgress.arrivalColor}
    planeColor={arrivalProgress.planeColor}
    isOperations={isOperations}
  />
)}
```

- [ ] **Step 4: Remove unused old progress styles if TypeScript reports no references**

If `rg "arrivalProgress" src/screens/FlightScreen.tsx` shows these styles are unused, remove:

```ts
arrivalProgressSection
arrivalProgressMetaRow
arrivalProgressEndpoint
arrivalProgressTime
arrivalProgressTrackWrap
arrivalProgressTrack
arrivalProgressFill
arrivalProgressPlaneWrap
arrivalProgressPlaneBadge
arrivalProgressPlaneIcon
```

- [ ] **Step 5: Run typecheck and export**

Run:

```bash
npm run typecheck
npx expo export --platform android --output-dir "$env:TEMP\aerostaff-motion-cockpit-test"
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/motion/CockpitFlightProgress.tsx src/screens/FlightScreen.tsx
git commit -m "feat: add cockpit flight progress motion"
```

---

### Task 8: Home Screen Board Reveals

**Files:**
- Modify: `src/screens/HomeScreen.tsx`

- [ ] **Step 1: Import `BoardReveal`**

Add:

```tsx
import BoardReveal from '../components/motion/BoardReveal';
```

- [ ] **Step 2: Wrap top-row cards**

Replace the existing top row block with:

```tsx
<View style={s.topRow}>
  <BoardReveal index={0} enabled={isOperations} style={{ flex: 1 }}>
    <View style={s.weatherCard}>
      {weather ? (
        <>
          <MaterialCommunityIcons
            name={weather.iconName as keyof typeof MaterialCommunityIcons.glyphMap}
            size={28}
            color={colors.primaryDark}
            style={s.weatherIcon}
          />
          <Text style={s.weatherTemp}>{weather.temp}°</Text>
          <Text style={s.weatherDesc}>{t('homeWeatherLocal')} • {weather.text}</Text>
        </>
      ) : (
        <ActivityIndicator color={colors.primary} />
      )}
    </View>
  </BoardReveal>
  <BoardReveal index={1} enabled={isOperations}>
    <View style={s.dateCard}>
      <Text style={s.dateToday}>{t('homeToday')}</Text>
      <Text style={s.dateNum}>{today.getDate()}</Text>
      <Text style={s.dateMonth}>{months[today.getMonth()]}</Text>
    </View>
  </BoardReveal>
</View>
```

- [ ] **Step 3: Wrap pinned flight and shift card**

Change pinned flight:

```tsx
{pinnedFlight && (
  <BoardReveal index={2} enabled={isOperations}>
    <PinnedFlightCard item={pinnedFlight} colors={colors} isOperations={isOperations} />
  </BoardReveal>
)}
```

Wrap the shift card:

```tsx
<BoardReveal index={pinnedFlight ? 3 : 2} enabled={isOperations}>
  <View style={s.shiftCard}>
    {loadingShift ? (
      <ActivityIndicator color={colors.primary} />
    ) : isWork ? (
      <>
        <View style={s.shiftStrip} />
        <View style={{ flex: 1 }}>
          <View style={s.shiftBadgeRow}>
            <View style={s.inProgressBadge}>
              <Text style={s.inProgressText}>{isNextShift ? t('homeNextShiftBadge') : t('homeInProgress')}</Text>
            </View>
          </View>
          <Text style={s.shiftTitle}>{isNextShift ? t('homeNextShift') : t('homeShiftWork')}</Text>
          <Text style={s.shiftTime}>
            {new Date(shiftEvent.startDate).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit'})} – {new Date(shiftEvent.endDate).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit'})}
          </Text>
        </View>
      </>
    ) : isRest ? (
      <View style={s.restRow}>
        <View style={s.restIconWrap}>
          <MaterialIcons name="hotel" size={22} color="#10b981" />
        </View>
        <Text style={s.restText}>{t('homeRestDay')}</Text>
      </View>
    ) : (
      <Text style={s.emptyShift}>{t('homeNoShift')}</Text>
    )}
  </View>
</BoardReveal>
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/HomeScreen.tsx
git commit -m "feat: add home board reveal motion"
```

---

### Task 9: Final Verification And Release Readiness

**Files:**
- No required code changes.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run typecheck
npx expo export --platform android --output-dir "$env:TEMP\aerostaff-motion-final-export"
```

Expected: both commands exit 0.

- [ ] **Step 2: Inspect git status**

Run:

```bash
git status --short --branch
```

Expected: clean branch with all task commits present.

- [ ] **Step 3: Manual Android smoke check**

Run the app on emulator or device and verify:

- Operations theme tab bar press depresses and returns.
- Drawer opens like a heavier panel and closes cleanly.
- Flight list cards enter with stagger on first load.
- Flight card press still opens Flightradar24.
- Swipe pin/unpin still works.
- Arrival progress still shows correct start/end times.
- Reduced visual noise: no infinite animation dominates the screen.

- [ ] **Step 4: Release only if requested**

If the user requests release, bump the app version patch and use the GitHub Actions release pipeline. Do not create a release from a failing local build.
