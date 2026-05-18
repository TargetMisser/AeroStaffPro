import { version } from '../../package.json';
import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  Animated, Modal, StyleSheet, TouchableOpacity, View,
} from 'react-native';
import { useAppTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import {
  motionDurations,
  motionEasing,
  motionRecipeDurations,
  motionRecipeSprings,
  useReducedMotionPreference,
} from '../utils/motion';
import DrawerMenuPanel, {
  DRAWER_WIDTH,
  type DrawerItem,
  type DrawerMenuSurfaceVariant,
} from './DrawerMenuPanel';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  surfaceVariant?: DrawerMenuSurfaceVariant;
}

export default function DrawerMenu({ visible, onClose, onSelect, surfaceVariant = 'app' }: Props) {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const ITEMS: DrawerItem[] = [
    { id: 'Notepad',   icon: 'edit-note',  label: t('drawerNotepadTitle'),  sublabel: t('drawerNotepadSub') },
    { id: 'Phonebook', icon: 'contacts',   label: t('drawerPhonebookTitle'), sublabel: t('drawerPhonebookSub') },
    { id: 'Passwords', icon: 'lock',       label: t('drawerPasswordTitle'),  sublabel: t('drawerPasswordSub') },
    { id: 'Manuals',   icon: 'menu-book',  label: t('drawerManualsTitle'),   sublabel: 'Easyjet, Wizz, Ryanair…' },
    { id: 'ArionInbox', icon: 'inbox',      label: t('drawerArionTitle'),     sublabel: t('drawerArionSub') },
    { id: 'Settings',  icon: 'settings',   label: t('drawerSettingsTitle'),  sublabel: t('drawerSettingsSub') },
    ...(__DEV__ ? [{ id: 'DesignLab', icon: 'auto-awesome' as const, label: 'Design Lab', sublabel: 'Direzioni visuali dev-only' }] : []),
  ];
  const styles = useMemo(() => makeStyles(surfaceVariant), [surfaceVariant]);
  const reducedMotion = useReducedMotionPreference();
  const panelProgress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (reducedMotion) {
        Animated.timing(panelProgress, {
          toValue: 1,
          duration: motionDurations.instant,
          easing: motionEasing.board,
          useNativeDriver: true,
        }).start();
        return;
      }

      Animated.spring(panelProgress, {
        toValue: 1,
        ...motionRecipeSprings.panel,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(panelProgress, {
        toValue: 0,
        duration: reducedMotion ? motionDurations.instant : motionRecipeDurations.instrument,
        easing: motionEasing.exit,
        useNativeDriver: true,
      }).start(({ finished }) => { if (finished) setMounted(false); });
    }
  }, [panelProgress, reducedMotion, visible]);

  if (!mounted && !visible) return null;

  const overlayOpacity = panelProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const panelTranslateX = panelProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-DRAWER_WIDTH, 0],
  });
  const panelScale = panelProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [reducedMotion ? 1 : 0.965, 1],
  });

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Overlay */}
        <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />
        </Animated.View>

        {/* Drawer */}
        <Animated.View
          style={[
            styles.drawerWrapper,
            { transform: [{ translateX: panelTranslateX }, { scale: panelScale }] },
          ]}
        >
          <DrawerMenuPanel
            colors={colors}
            items={ITEMS}
            versionLabel={`AeroStaff Pro · v${version}`}
            surfaceVariant={surfaceVariant}
            onClose={onClose}
            onSelect={onSelect}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

function makeStyles(surfaceVariant: DrawerMenuSurfaceVariant) {
  const warmShadow = surfaceVariant === 'operations' ? '#14B8A6' : '#F97316';

  return StyleSheet.create({
    root: { flex: 1 },
    overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,5,0,0.55)' },
    drawerWrapper: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: DRAWER_WIDTH,
      height: '100%',
      overflow: 'hidden',
      // Subtle warm glow shadow
      shadowColor: warmShadow,
      shadowOffset: { width: 6, height: 0 },
      shadowOpacity: 0.12,
      shadowRadius: 24,
      elevation: 20,
    },
  });
}
