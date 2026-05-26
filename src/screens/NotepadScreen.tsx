import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, TextInput, Text, StyleSheet, TouchableOpacity, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppTheme, type ThemeColors } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';

const STORAGE_KEY = 'aerostaff_notepad_v1';

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    toolbar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 12,
      backgroundColor: c.card,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { fontSize: 17, fontWeight: '700', color: c.primaryDark },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    iconBtn: { padding: 8, borderRadius: 10 },
    saveBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: c.primary, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 8,
    },
    // Dims the entire save button (background + icon + label) when content is
    // already saved — intentional: the full-button fade signals an inactive state.
    saveBtnDim: { opacity: 0.55 },
    saveTxt: { color: '#fff', fontWeight: '600', fontSize: 13 },
    statusBar: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 16, paddingVertical: 6,
      backgroundColor: c.bg,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    dot: { width: 7, height: 7, borderRadius: 4 },
    statusTxt: { fontSize: 11, color: c.textSub, flex: 1 },
    charCount:  { fontSize: 11, color: c.textMuted },
    input: {
      flex: 1, padding: 18,
      fontSize: 15, color: c.text,
      lineHeight: 24,
    },
  });
}

export default function NotepadScreen() {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(true);
  const [charCount, setCharCount] = useState(0);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(val => {
      if (val) {
        setText(val);
        setCharCount(val.length);
      }
    });
  }, []);

  const handleChange = useCallback((v: string) => {
    setText(v);
    setCharCount(v.length);
    setSaved(false);
  }, []);

  const save = useCallback(async () => {
    await AsyncStorage.setItem(STORAGE_KEY, text);
    setSaved(true);
  }, [text]);

  const clear = useCallback(() => {
    Alert.alert(
      t('notepadClearTitle'),
      t('notepadClearMsg'),
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: t('notepadClearConfirm'),
          style: 'destructive',
          onPress: () => {
            setText('');
            setCharCount(0);
            setSaved(false);
          },
        },
      ],
    );
  }, []);

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
    >
      {/* Toolbar */}
      <View style={s.toolbar}>
        <View style={s.titleRow}>
          <MaterialIcons name="edit-note" size={22} color={colors.primary} />
          <Text style={s.title}>{t('notepadTitle')}</Text>
        </View>
        <View style={s.actions}>
          <TouchableOpacity
            onPress={clear}
            style={s.iconBtn}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={t('notepadClearTitle')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="delete-outline" size={22} color="#EF4444" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={save}
            style={[s.saveBtn, saved && s.saveBtnDim]}
          >
            <MaterialIcons name="save" size={18} color="#fff" />
            <Text style={s.saveTxt}>{saved ? t('notepadSaved') : t('notepadSave')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Status bar */}
      <View style={s.statusBar}>
        <View style={[s.dot, { backgroundColor: saved ? '#22C55E' : '#F59E0B' }]} />
        <Text style={s.statusTxt}>
          {saved ? 'Salvato' : t('notepadUnsaved')}
        </Text>
        <Text style={s.charCount}>{charCount} {t('notepadChars')}</Text>
      </View>

      {/* Text input */}
      <TextInput
        style={s.input}
        multiline
        value={text}
        onChangeText={handleChange}
        placeholder={'Scrivi qui le tue note...\n\nUsa questo blocco note per:\n• Annotazioni di turno\n• Promemoria procedure\n• Note personali'}
        placeholderTextColor={colors.textSub}
        textAlignVertical="top"
        autoCorrect={false}
        autoCapitalize="sentences"
      />
    </KeyboardAvoidingView>
  );
}
