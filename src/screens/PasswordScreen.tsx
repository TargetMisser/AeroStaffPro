import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppTheme, type ThemeColors } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';

const PASSWORDS_KEY   = 'aerostaff_passwords_v1';
const PIN_KEY         = 'aerostaff_pin_v1';
const PIN_ENABLED_KEY = 'aerostaff_pin_enabled_v1';

// ── Secure helpers — all sensitive data goes through the OS keychain ──────────
async function getSecurePin(): Promise<string | null> {
  try {
    const secure = await SecureStore.getItemAsync(PIN_KEY);
    if (secure) return secure;
  } catch {}
  try {
    const legacy = await AsyncStorage.getItem(PIN_KEY);
    if (legacy) {
      await SecureStore.setItemAsync(PIN_KEY, legacy);
      await AsyncStorage.setItem(PIN_KEY, '***MASKED***');
      await AsyncStorage.removeItem(PIN_KEY);
      return legacy;
    }
  } catch {}
  return null;
}
async function setSecurePin(pin: string): Promise<void> {
  await SecureStore.setItemAsync(PIN_KEY, pin);
}
async function deleteSecurePin(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_KEY).catch(() => {});
  await AsyncStorage.setItem(PIN_KEY, '***MASKED***').catch(() => {});
  await AsyncStorage.removeItem(PIN_KEY).catch(() => {});
}

// Passwords are stored encrypted in SecureStore.
// On first access we migrate any legacy plaintext AsyncStorage data.
async function loadPasswords(): Promise<PasswordEntry[]> {
  try {
    const secure = await SecureStore.getItemAsync(PASSWORDS_KEY);
    if (secure) return JSON.parse(secure);
  } catch {}
  // Migration: if data exists only in AsyncStorage, move it to SecureStore
  try {
    const legacy = await AsyncStorage.getItem(PASSWORDS_KEY);
    if (legacy) {
      const parsed: PasswordEntry[] = JSON.parse(legacy);
      await SecureStore.setItemAsync(PASSWORDS_KEY, legacy);
      await AsyncStorage.setItem(PASSWORDS_KEY, '***MASKED***');
      await AsyncStorage.removeItem(PASSWORDS_KEY);
      return parsed;
    }
  } catch {}
  return [];
}
async function savePasswords(entries: PasswordEntry[]): Promise<void> {
  await SecureStore.setItemAsync(PASSWORDS_KEY, JSON.stringify(entries));
}

type PasswordEntry = {
  id: string;
  name: string;
  username: string;
  password: string;
  notes: string;
};

type ModalState = {
  visible: boolean;
  editingId: string | null;
  name: string;
  username: string;
  password: string;
  notes: string;
};

const EMPTY_MODAL: ModalState = {
  visible: false, editingId: null,
  name: '', username: '', password: '', notes: '',
};

// ─── PIN Overlay ─────────────────────────────────────────────────────────────
function PinOverlay({ onUnlock, onCancel, title }: { onUnlock: (pin: string) => void; onCancel?: () => void; title: string }) {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const s = useMemo(() => makePinStyles(colors), [colors]);
  const [digits, setDigits] = useState('');

  const press = (d: string) => {
    const next = (digits + d).slice(0, 4);
    setDigits(next);
    if (next.length === 4) {
      setTimeout(() => { onUnlock(next); setDigits(''); }, 100);
    }
  };
  const del = () => setDigits(d => d.slice(0, -1));

  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

  return (
    <View style={s.overlay}>
      <View style={s.box}>
        <MaterialIcons name="lock" size={32} color={colors.primary} style={{ marginBottom: 12 }} />
        <Text style={s.title}>{title}</Text>
        <View style={s.dots}>
          {[0,1,2,3].map(i => (
            <View key={i} style={[s.dot, digits.length > i && s.dotFilled]} />
          ))}
        </View>
        <View style={s.grid}>
          {keys.map((k, i) => (
            k === '' ? <View key={i} style={s.keyEmpty} /> :
            k === '⌫' ? (
              <TouchableOpacity key={i} style={s.key} onPress={del} activeOpacity={0.7}>
                <MaterialIcons name="backspace" size={20} color={colors.text} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity key={i} style={s.key} onPress={() => press(k)} activeOpacity={0.7}>
                <Text style={s.keyText}>{k}</Text>
              </TouchableOpacity>
            )
          ))}
        </View>
        {onCancel && (
          <TouchableOpacity onPress={onCancel} style={{ marginTop: 16 }}>
            <Text style={{ color: colors.textSub, fontSize: 14 }}>Annulla</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Password Row ─────────────────────────────────────────────────────────────
function PasswordRowComponent({ item, onEdit, onDelete }: { item: PasswordEntry; onEdit: () => void; onDelete: () => void }) {
  const { colors } = useAppTheme();
  const s = useMemo(() => makeRowStyles(colors), [colors]);
  const [revealed, setRevealed] = useState(false);

  return (
    <View style={s.card}>
      <View style={s.cardLeft}>
        <Text style={s.name}>{item.name}</Text>
        {item.username ? <Text style={s.username}>{item.username}</Text> : null}
        <View style={s.pwRow}>
          <Text style={s.pw}>{revealed ? item.password : '••••••••'}</Text>
          <TouchableOpacity onPress={() => setRevealed(r => !r)} style={s.eyeBtn}>
            <MaterialIcons name={revealed ? 'visibility-off' : 'visibility'} size={16} color={colors.textSub} />
          </TouchableOpacity>
        </View>
        {item.notes ? <Text style={s.notes}>{item.notes}</Text> : null}
      </View>
      <View style={s.actions}>
        <TouchableOpacity style={s.editBtn} onPress={onEdit}>
          <MaterialIcons name="edit" size={17} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity style={s.delBtn} onPress={onDelete}>
          <MaterialIcons name="delete-outline" size={17} color="#EF4444" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Performance optimization: memoize flatlist item to prevent unnecessary re-renders
const PasswordRow = React.memo(PasswordRowComponent);

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function PasswordScreen() {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const [entries, setEntries]       = useState<PasswordEntry[]>([]);
  const [modal, setModal]           = useState<ModalState>(EMPTY_MODAL);
  const [showPw, setShowPw]         = useState(false);
  const [pinEnabled, setPinEnabled] = useState(false);
  const [pinMode, setPinMode]       = useState<'unlock' | 'setup' | null>(null);

  // Load on mount
  useEffect(() => {
    (async () => {
      const loaded = await loadPasswords();
      setEntries(loaded);
      const enabled = await AsyncStorage.getItem(PIN_ENABLED_KEY);
      const isEnabled = enabled === 'true';
      setPinEnabled(isEnabled);
      if (isEnabled) setPinMode('unlock');
    })();
  }, []);

  const persist = useCallback(async (next: PasswordEntry[]) => {
    setEntries(next);
    await savePasswords(next);
  }, []);

  // PIN toggle
  const togglePin = useCallback(async () => {
    if (pinEnabled) {
      Alert.alert(t('pinDisableTitle'), t('pinDisableMsg'), [
        { text: 'Annulla', style: 'cancel' },
        { text: t('pinDisableBtn'), style: 'destructive', onPress: async () => {
          try {
            setPinEnabled(false);
            await AsyncStorage.setItem(PIN_ENABLED_KEY, 'false');
            await deleteSecurePin();
          } catch (e) { if (__DEV__) console.error('[pin] disable error', e); }
        }},
      ]);
    } else {
      setPinMode('setup');
    }
  }, [pinEnabled]);

  const handlePinSetup = useCallback(async (pin: string) => {
    try {
      await setSecurePin(pin);
      await AsyncStorage.setItem(PIN_ENABLED_KEY, 'true');
      setPinEnabled(true);
      setPinMode(null);
      Alert.alert(t('pinSetTitle'), t('pinSetMsg'));
    } catch (e) {
      if (__DEV__) console.error('[pin] setup error', e);
      Alert.alert('Errore', t('pinErrMsg'));
    }
  }, []);

  const handlePinUnlock = useCallback(async (pin: string) => {
    try {
      const stored = await getSecurePin();
      if (pin === stored) {
        setPinMode(null);
      } else {
        Alert.alert(t('pinWrong'), t('pinWrongMsg'));
      }
    } catch (e) {
      if (__DEV__) console.error('[pin] unlock error', e);
      Alert.alert('Errore', t('pinVerifyErr'));
    }
  }, []);

  // CRUD
  const openAdd = () => setModal({ ...EMPTY_MODAL, visible: true });

  const openEdit = useCallback((item: PasswordEntry) => {
    setModal({ visible: true, editingId: item.id, name: item.name, username: item.username, password: item.password, notes: item.notes });
  }, []);

  const saveModal = useCallback(async () => {
    if (!modal.name.trim()) { Alert.alert('Errore', t('passwordErrName')); return; }
    if (!modal.password.trim()) { Alert.alert('Errore', t('passwordErrPw')); return; }
    let next: PasswordEntry[];
    if (modal.editingId) {
      next = entries.map(e => e.id === modal.editingId
        ? { ...e, name: modal.name.trim(), username: modal.username.trim(), password: modal.password.trim(), notes: modal.notes.trim() }
        : e);
    } else {
      const entry: PasswordEntry = {
        id: Date.now().toString(),
        name: modal.name.trim(),
        username: modal.username.trim(),
        password: modal.password.trim(),
        notes: modal.notes.trim(),
      };
      next = [...entries, entry];
    }
    await persist(next);
    setModal(EMPTY_MODAL);
    setShowPw(false);
  }, [modal, entries, persist]);

  const deleteEntry = useCallback((id: string) => {
    Alert.alert(t('passwordDeleteTitle'), t('passwordDeleteMsg'), [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Elimina', style: 'destructive', onPress: async () => {
        await persist(entries.filter(e => e.id !== id));
      }},
    ]);
  }, [entries, persist]);

  // PIN overlays (setup and unlock)
  if (pinMode === 'unlock') {
    return <PinOverlay title="Inserisci PIN" onUnlock={handlePinUnlock} />;
  }
  if (pinMode === 'setup') {
    return <PinOverlay title="Imposta PIN (4 cifre)" onUnlock={handlePinSetup} onCancel={() => setPinMode(null)} />;
  }

  return (
    <View style={s.root}>
      {/* Toolbar */}
      <View style={s.toolbar}>
        <View style={s.titleRow}>
          <MaterialIcons name="lock" size={22} color={colors.primary} />
          <Text style={s.title}>{t('passwordTitle')}</Text>
        </View>
        <View style={s.toolbarActions}>
          <TouchableOpacity
            onPress={togglePin}
            style={[s.iconBtn, pinEnabled && s.iconBtnActive]}
            accessible
            accessibilityLabel={pinEnabled ? 'Disattiva protezione PIN' : 'Attiva protezione PIN'}
            accessibilityRole="button"
          >
            <MaterialIcons name={pinEnabled ? 'lock' : 'lock-open'} size={20} color={pinEnabled ? '#fff' : colors.textSub} />
          </TouchableOpacity>
          <TouchableOpacity onPress={openAdd} style={s.addBtn}>
            <MaterialIcons name="add" size={20} color="#fff" />
            <Text style={s.addBtnTxt}>{t('passwordAdd')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* List */}
      <FlatList
        data={entries}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <PasswordRow
            item={item}
            onEdit={() => openEdit(item)}
            onDelete={() => deleteEntry(item.id)}
          />
        )}
        contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
        ListEmptyComponent={
          <View style={s.empty}>
            <MaterialIcons name="lock-open" size={48} color={colors.border} />
            <Text style={s.emptyTxt}>{t('passwordEmptyTxt')}</Text>
            <Text style={s.emptySubTxt}>{t('passwordEmptySubTxt')}</Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Add / Edit modal */}
      <Modal visible={modal.visible} animationType="slide" transparent statusBarTranslucent onRequestClose={() => { setModal(EMPTY_MODAL); setShowPw(false); }}>
        <KeyboardAvoidingView
          style={s.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
        >
          <ScrollView contentContainerStyle={s.modalScrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={s.modalBox}>
            <Text style={s.modalTitle}>{modal.editingId ? t('passwordModalEdit') : t('passwordModalNew')}</Text>

            <Text style={s.label}>{t('passwordNameLabel')}</Text>
            <TextInput style={s.input} value={modal.name} onChangeText={v => setModal(m => ({ ...m, name: v }))} placeholder={t('passwordNamePh')} placeholderTextColor={colors.textMuted} />

            <Text style={s.label}>{t('passwordUsernameLabel')}</Text>
            <TextInput style={s.input} value={modal.username} onChangeText={v => setModal(m => ({ ...m, username: v }))} placeholder={t('passwordUsernamePh')} placeholderTextColor={colors.textMuted} autoCapitalize="none" keyboardType="email-address" />

            <Text style={s.label}>{t('passwordPwLabel')}</Text>
            <View style={s.pwInputRow}>
              <TextInput
                style={[s.input, { flex: 1, marginBottom: 0 }]}
                value={modal.password}
                onChangeText={v => setModal(m => ({ ...m, password: v }))}
                placeholder="••••••••"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showPw}
                autoCapitalize="none"
              />
              <TouchableOpacity onPress={() => setShowPw(p => !p)} style={s.eyeModal}>
                <MaterialIcons name={showPw ? 'visibility-off' : 'visibility'} size={20} color={colors.textSub} />
              </TouchableOpacity>
            </View>

            <Text style={[s.label, { marginTop: 12 }]}>{t('passwordNotesLabel')}</Text>
            <TextInput style={[s.input, s.inputMulti]} value={modal.notes} onChangeText={v => setModal(m => ({ ...m, notes: v }))} placeholder="es. scade ogni 90 giorni…" placeholderTextColor={colors.textMuted} multiline numberOfLines={3} textAlignVertical="top" />

            <View style={s.modalBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => { setModal(EMPTY_MODAL); setShowPw(false); }}>
                <Text style={s.cancelTxt}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={saveModal}>
                <Text style={s.saveTxt}>Salva</Text>
              </TouchableOpacity>
            </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function makePinStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: c.bg, justifyContent: 'center', alignItems: 'center' },
    box:     { alignItems: 'center', padding: 32, width: '100%', maxWidth: 320 },
    title:   { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 24 },
    dots:    { flexDirection: 'row', gap: 16, marginBottom: 32 },
    dot:     { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: c.primary, backgroundColor: 'transparent' },
    dotFilled: { backgroundColor: c.primary },
    grid:    { flexDirection: 'row', flexWrap: 'wrap', width: 240, justifyContent: 'center', gap: 12 },
    key:     { width: 64, height: 64, borderRadius: 32, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, justifyContent: 'center', alignItems: 'center' },
    keyEmpty:{ width: 64, height: 64 },
    keyText: { fontSize: 22, fontWeight: '600', color: c.text },
  });
}

function makeRowStyles(c: ThemeColors) {
  return StyleSheet.create({
    card:    { backgroundColor: c.card, borderRadius: 16, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderColor: c.glassBorder, shadowColor: c.primary, shadowOpacity: c.isDark ? 0 : 0.08, shadowRadius: 8, elevation: c.isDark ? 0 : 3 },
    cardLeft:{ flex: 1 },
    name:    { fontSize: 15, fontWeight: '700', color: c.primaryDark, marginBottom: 2 },
    username:{ fontSize: 12, color: c.textSub, marginBottom: 4 },
    pwRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
    pw:      { fontSize: 13, color: c.text, letterSpacing: 1 },
    eyeBtn:  { padding: 2 },
    notes:   { fontSize: 11, color: c.textMuted, fontStyle: 'italic', marginTop: 4 },
    actions: { flexDirection: 'column', gap: 6, marginLeft: 8 },
    editBtn: { width: 32, height: 32, borderRadius: 9, backgroundColor: c.primaryLight, justifyContent: 'center', alignItems: 'center' },
    delBtn:  { width: 32, height: 32, borderRadius: 9, backgroundColor: '#FEF2F2', justifyContent: 'center', alignItems: 'center' },
  });
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    root:         { flex: 1, backgroundColor: c.bg },
    toolbar:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.border },
    titleRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title:        { fontSize: 17, fontWeight: '700', color: c.primaryDark },
    toolbarActions:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
    iconBtn:      { width: 36, height: 36, borderRadius: 10, backgroundColor: c.cardSecondary, justifyContent: 'center', alignItems: 'center' },
    iconBtnActive:{ backgroundColor: c.primary },
    addBtn:       { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    addBtnTxt:    { color: '#fff', fontWeight: '600', fontSize: 13 },
    empty:        { alignItems: 'center', marginTop: 80, gap: 8 },
    emptyTxt:     { fontSize: 16, fontWeight: '600', color: c.textSub },
    emptySubTxt:  { fontSize: 13, color: c.textMuted },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalScrollContent: { flexGrow: 1, justifyContent: 'flex-end' },
    modalBox:     { backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24, maxHeight: '92%' },
    modalTitle:   { fontSize: 18, fontWeight: '700', color: c.primaryDark, marginBottom: 20 },
    label:        { fontSize: 12, fontWeight: '600', color: c.textSub, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
    input:        { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: c.text, marginBottom: 14 },
    inputMulti:   { height: 80, paddingTop: 10 },
    pwInputRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
    eyeModal:     { padding: 10 },
    modalBtns:    { flexDirection: 'row', gap: 10, marginTop: 8 },
    cancelBtn:    { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: c.bg, alignItems: 'center', borderWidth: 1, borderColor: c.border },
    cancelTxt:    { fontSize: 15, fontWeight: '600', color: c.textSub },
    saveBtn:      { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: c.primary, alignItems: 'center' },
    saveTxt:      { fontSize: 15, fontWeight: '700', color: '#fff' },
  });
}
