import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  NativeSyntheticEvent,
  NativeScrollEvent,
  TouchableOpacity,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SPACING, RADIUS } from '../theme/spacing';

const ITEM_H = 42;
const VISIBLE = 5;
const PAD = ITEM_H * 2; // 2 invisible items top & bottom

interface WheelColumnProps {
  items: string[];
  defaultIndex: number;
  onChange: (index: number) => void;
  accentColor: string;
  textColor: string;
  mutedColor: string;
  bgColor: string;
  borderColor: string;
}

const WheelColumn: React.FC<WheelColumnProps> = ({
  items, defaultIndex, onChange,
  accentColor, textColor, mutedColor, bgColor, borderColor,
}) => {
  const scrollRef = useRef<ScrollView>(null);
  const lastIndex = useRef(defaultIndex);
  const [selectedIndex, setSelectedIndex] = useState(defaultIndex);

  const clampIndex = useCallback((index: number) => (
    Math.min(Math.max(index, 0), items.length - 1)
  ), [items.length]);

  const scrollToIndex = useCallback((index: number, animated: boolean) => {
    scrollRef.current?.scrollTo({ y: index * ITEM_H, animated });
  }, []);

  const settleIndex = useCallback((nextIndex: number, animated: boolean) => {
    const idx = clampIndex(nextIndex);
    const changed = idx !== lastIndex.current;
    lastIndex.current = idx;
    setSelectedIndex(idx);
    scrollToIndex(idx, animated);
    if (changed) {
      onChange(idx);
    }
  }, [clampIndex, onChange, scrollToIndex]);

  const commitIndex = useCallback((nextIndex: number, animated: boolean) => {
    settleIndex(nextIndex, animated);
  }, [settleIndex]);

  useEffect(() => {
    const nextIndex = clampIndex(defaultIndex);
    lastIndex.current = nextIndex;
    setSelectedIndex(nextIndex);
    const timer = setTimeout(() => {
      scrollToIndex(nextIndex, false);
    }, 30);
    return () => clearTimeout(timer);
  }, [clampIndex, defaultIndex, scrollToIndex]);

  const previewFromScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = clampIndex(Math.round(e.nativeEvent.contentOffset.y / ITEM_H));
    setSelectedIndex(idx);
  }, [clampIndex]);

  const syncFromScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = clampIndex(Math.round(e.nativeEvent.contentOffset.y / ITEM_H));
    settleIndex(idx, true);
  }, [clampIndex, settleIndex]);

  return (
    <View style={{ width: 60, height: ITEM_H * VISIBLE, position: 'relative' }}>
      {/* Selection highlight */}
      <View
        pointerEvents="none"
        style={[
          styles.selectionRect,
          { top: PAD, borderColor: accentColor, backgroundColor: accentColor + '22' },
        ]}
      />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        disableIntervalMomentum
        decelerationRate={0.992}
        scrollEventThrottle={16}
        nestedScrollEnabled
        directionalLockEnabled
        overScrollMode="never"
        bounces={false}
        alwaysBounceVertical={false}
        onScroll={previewFromScroll}
        onMomentumScrollEnd={syncFromScroll}
        onScrollEndDrag={syncFromScroll}
        contentContainerStyle={{ paddingVertical: PAD }}
        style={{ flex: 1 }}
      >
        {items.map((label, i) => (
          <TouchableOpacity
            key={i}
            activeOpacity={0.85}
            style={styles.itemContainer}
            onPress={() => { commitIndex(i, true); }}
          >
            <Text
              style={[
                styles.itemText,
                i === selectedIndex
                  ? { color: textColor, fontWeight: '800' }
                  : { color: mutedColor },
              ]}
            >
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {/* Top fade */}
      <LinearGradient
        colors={[bgColor, bgColor + 'CC', bgColor + '00']}
        style={[styles.fade, styles.fadeTop]}
        pointerEvents="none"
      />
      {/* Bottom fade */}
      <LinearGradient
        colors={[bgColor + '00', bgColor + 'CC', bgColor]}
        style={[styles.fade, styles.fadeBottom]}
        pointerEvents="none"
      />
    </View>
  );
};

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

interface TimeCarouselPickerProps {
  hour: number;
  minute: number;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
  accentColor: string;
  textColor: string;
  mutedColor: string;
  bgColor: string;
  borderColor: string;
}

const TimeCarouselPicker: React.FC<TimeCarouselPickerProps> = ({
  hour, minute,
  onHourChange, onMinuteChange,
  accentColor, textColor, mutedColor, bgColor, borderColor,
}) => (
  <View style={[styles.container, { backgroundColor: bgColor, borderColor }]}>
    <WheelColumn
      items={HOURS}
      defaultIndex={hour}
      onChange={onHourChange}
      accentColor={accentColor}
      textColor={textColor}
      mutedColor={mutedColor}
      bgColor={bgColor}
      borderColor={borderColor}
    />
    <Text style={[styles.colon, { color: accentColor }]}>:</Text>
    <WheelColumn
      items={MINUTES}
      defaultIndex={minute}
      onChange={onMinuteChange}
      accentColor={accentColor}
      textColor={textColor}
      mutedColor={mutedColor}
      bgColor={bgColor}
      borderColor={borderColor}
    />
  </View>
);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: SPACING.sm,
    marginVertical: 2,
  },
  selectionRect: {
    position: 'absolute',
    left: 3,
    right: 3,
    height: ITEM_H,
    borderRadius: RADIUS.sm,
    borderWidth: 1.5,
    zIndex: 1,
  },
  itemContainer: {
    height: ITEM_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: {
    fontSize: 22,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  colon: {
    fontSize: 24,
    fontWeight: '700',
    marginHorizontal: SPACING.xs,
    marginBottom: 1,
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: PAD,
    zIndex: 2,
    pointerEvents: 'none',
  },
  fadeTop: { top: 0 },
  fadeBottom: { bottom: 0 },
});

export default TimeCarouselPicker;
