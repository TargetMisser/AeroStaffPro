import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  Animated, Modal, StyleSheet, TouchableOpacity, View,
} from 'react-native';
import { useAppTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { APP_VERSION } from '../utils/updateChecker';
import {
  motionDurations,
  motionEasing,
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
    { id: 'PrintableCalendar', icon: 'print', label: t('drawerPrintableCalendarTitle'), sublabel: t('drawerPrintableCalendarSub') },
    { id: 'Settings',  icon: 'settings',   label: t('drawerSettingsTitle'),  sublabel: t('drawerSettingsSub') },
  ];
  const styles = useMemo(() => makeStyles(surfaceVariant), [surfaceVariant]);
  const reducedMotion = useReducedMotionPreference();
  const panelProgress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    panelProgress.stopAnimation();
    if (reducedMotion) {
      panelProgress.setValue(visible ? 1 : 0);
      setMounted(visible);
      return;
    }
    if (visible) setMounted(true);
    const animation = Animated.timing(panelProgress, {
      toValue: visible ? 1 : 0,
      duration: visible ? motionDurations.panel : motionDurations.quick,
      easing: visible ? motionEasing.board : motionEasing.exit,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => { if (finished && !visible) setMounted(false); });
    return () => animation.stop();
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
            { transform: [{ translateX: panelTranslateX }] },
          ]}
        >
          <DrawerMenuPanel
            colors={colors}
            items={ITEMS}
            versionLabel={`AeroStaff Pro · v${APP_VERSION}`}
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
  const shadow = surfaceVariant === 'operations' ? '#000000' : '#172B3A';

  return StyleSheet.create({
    root: { flex: 1 },
    overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,20,30,0.48)' },
    drawerWrapper: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: DRAWER_WIDTH,
      height: '100%',
      overflow: 'hidden',
      shadowColor: shadow,
      shadowOffset: { width: 6, height: 0 },
      shadowOpacity: 0.12,
      shadowRadius: 24,
      elevation: 20,
    },
  });
}
