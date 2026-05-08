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
  const timeStyle = isOperations ? styles.timeOperations : styles.timeDefault;

  useEffect(() => {
    Animated.timing(reveal, {
      toValue: 1,
      duration: reducedMotion ? motionDurations.quick : motionDurations.board,
      easing: motionEasing.board,
      useNativeDriver: true,
    }).start();
  }, [reducedMotion, reveal]);

  useEffect(() => {
    if (reducedMotion || !isOperations) {
      sweep.stopAnimation();
      sweep.setValue(0);
      return;
    }

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
          <Text style={timeStyle}>{startLabel}</Text>
        </View>
        <View style={styles.endpoint}>
          <MaterialIcons name="flight-land" size={14} color={arrivalColor} />
          <Text style={[timeStyle, { color: arrivalColor }]}>{endLabel}</Text>
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
  timeDefault: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
    fontVariant: ['tabular-nums'],
  },
  timeOperations: {
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
