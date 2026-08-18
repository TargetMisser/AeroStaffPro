import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAppTheme, type ThemeColors } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { RADIUS, SPACING } from '../theme/spacing';
import { TYPE, WEIGHT } from '../theme/typography';
import {
  HANDOVER_CHECKLIST,
  HANDOVER_STORAGE_KEY,
  buildHandoverSummary,
  createHandoverEntry,
  parseHandoverEntries,
  type HandoverEntry,
  type HandoverScope,
} from '../utils/handover';

const STORAGE_KEY = 'aerostaff_notepad_v1';
const PINNED_FLIGHT_KEY = 'pinned_flight_v1';

type PinnedFlightSummary = {
  flightNumber: string;
  direction: 'arrival' | 'departure';
};

function todayIso(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function NotepadScreen() {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [note, setNote] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [entries, setEntries] = useState<HandoverEntry[]>([]);
  const [pinnedFlight, setPinnedFlight] = useState<PinnedFlightSummary | null>(null);
  const [scope, setScope] = useState<HandoverScope>('shift');
  const [handoverNote, setHandoverNote] = useState('');
  const [checkedItems, setCheckedItems] = useState<string[]>([]);
  const shiftDate = todayIso();

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(HANDOVER_STORAGE_KEY),
      AsyncStorage.getItem(PINNED_FLIGHT_KEY),
    ]).then(([saved, handoverRaw, pinnedRaw]) => {
      const nextNote = saved ?? '';
      setNote(nextNote);
      setSavedNote(nextNote);
      setEntries(parseHandoverEntries(handoverRaw));
      if (!pinnedRaw) return;
      try {
        const pinned = JSON.parse(pinnedRaw);
        const flightNumber = pinned?.flight?.identification?.number?.default;
        if (typeof flightNumber === 'string' && flightNumber) {
          setPinnedFlight({
            flightNumber,
            direction: pinned._pinTab === 'arrivals' ? 'arrival' : 'departure',
          });
        }
      } catch {}
    });
  }, []);

  const todayEntries = useMemo(
    () => entries.filter(entry => entry.shiftDate === shiftDate).sort((a, b) => b.createdAt - a.createdAt),
    [entries, shiftDate],
  );
  const noteSaved = note === savedNote;

  const saveNote = async () => {
    await AsyncStorage.setItem(STORAGE_KEY, note);
    setSavedNote(note);
  };

  const clearNote = () => {
    Alert.alert(t('notepadClearTitle'), t('notepadClearMsg'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('notepadClearConfirm'),
        style: 'destructive',
        onPress: async () => {
          setNote('');
          setSavedNote('');
          await AsyncStorage.setItem(STORAGE_KEY, '');
        },
      },
    ]);
  };

  const toggleChecklist = (label: string) => {
    setCheckedItems(current => current.includes(label)
      ? current.filter(item => item !== label)
      : [...current, label]);
  };

  const saveHandover = async () => {
    const trimmed = handoverNote.trim();
    if (!trimmed && checkedItems.length === 0) {
      Alert.alert('Consegna vuota', 'Scrivi una nota o completa almeno una voce della checklist.');
      return;
    }
    if (scope === 'flight' && !pinnedFlight) {
      Alert.alert('Nessun volo pinnato', 'Pinna prima un volo dalla schermata Voli.');
      return;
    }
    const entry = createHandoverEntry({
      shiftDate,
      scope,
      flightNumber: scope === 'flight' ? pinnedFlight?.flightNumber : undefined,
      direction: scope === 'flight' ? pinnedFlight?.direction : undefined,
      note: trimmed,
      checklist: checkedItems,
    });
    const next = [entry, ...entries].slice(0, 200);
    setEntries(next);
    setHandoverNote('');
    setCheckedItems([]);
    await AsyncStorage.setItem(HANDOVER_STORAGE_KEY, JSON.stringify(next));
  };

  const deleteHandover = async (id: string) => {
    const next = entries.filter(entry => entry.id !== id);
    setEntries(next);
    await AsyncStorage.setItem(HANDOVER_STORAGE_KEY, JSON.stringify(next));
  };

  const shareHandover = async () => {
    await Share.share({
      title: 'Passaggio consegne AeroStaff Pro',
      message: buildHandoverSummary(entries, shiftDate),
    });
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerIcon}><MaterialIcons name="edit-note" size={24} color={colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Note e consegne</Text>
            <Text style={styles.subtitle}>Appunti personali e passaggio turno strutturato</Text>
          </View>
        </View>

        <View style={styles.noteCard}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>{t('notepadTitle')}</Text>
              <Text style={styles.cardMeta}>{note.length} {t('notepadChars')} · {noteSaved ? t('notepadSaved') : t('notepadUnsaved')}</Text>
            </View>
            <TouchableOpacity style={styles.iconButton} onPress={clearNote}>
              <MaterialIcons name="delete-outline" size={20} color={colors.danger} />
            </TouchableOpacity>
          </View>
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            textAlignVertical="top"
            placeholder={t('notepadPlaceholder')}
            placeholderTextColor={colors.textMuted}
            style={styles.noteInput}
          />
          <TouchableOpacity style={[styles.primaryButton, noteSaved && styles.savedButton]} onPress={saveNote}>
            <MaterialIcons name={noteSaved ? 'check' : 'save'} size={18} color="#fff" />
            <Text style={styles.primaryButtonText}>{noteSaved ? t('notepadSaved') : t('notepadSave')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>PASSAGGIO CONSEGNE</Text>
            <Text style={styles.sectionSubtitle}>{shiftDate.split('-').reverse().join('/')}</Text>
          </View>
          <TouchableOpacity style={styles.shareButton} onPress={shareHandover}>
            <MaterialIcons name="share" size={18} color={colors.primaryText} />
            <Text style={styles.shareButtonText}>Condividi</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.handoverComposer}>
          <View style={styles.scopeRow}>
            {(['shift', 'flight'] as HandoverScope[]).map(item => {
              const selected = scope === item;
              const disabled = item === 'flight' && !pinnedFlight;
              return (
                <TouchableOpacity
                  key={item}
                  disabled={disabled}
                  style={[styles.scopeButton, selected && styles.scopeButtonSelected, disabled && styles.disabled]}
                  onPress={() => setScope(item)}
                >
                  <MaterialIcons name={item === 'shift' ? 'schedule' : 'flight'} size={17} color={selected ? '#fff' : colors.textSub} />
                  <Text style={[styles.scopeText, selected && styles.scopeTextSelected]}>
                    {item === 'shift' ? 'Turno' : pinnedFlight?.flightNumber ?? 'Volo non pinnato'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TextInput
            value={handoverNote}
            onChangeText={setHandoverNote}
            multiline
            textAlignVertical="top"
            placeholder="Cosa deve sapere chi prende il turno?"
            placeholderTextColor={colors.textMuted}
            style={styles.handoverInput}
          />

          <View style={styles.checklist}>
            {HANDOVER_CHECKLIST.map(item => {
              const checked = checkedItems.includes(item);
              return (
                <TouchableOpacity key={item} style={styles.checkRow} onPress={() => toggleChecklist(item)}>
                  <MaterialIcons name={checked ? 'check-box' : 'check-box-outline-blank'} size={22} color={checked ? colors.success : colors.textMuted} />
                  <Text style={[styles.checkText, checked && { color: colors.text }]}>{item}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity style={styles.primaryButton} onPress={saveHandover}>
            <MaterialIcons name="add-task" size={19} color="#fff" />
            <Text style={styles.primaryButtonText}>Salva consegna</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.entriesList}>
          {todayEntries.length === 0 ? (
            <View style={styles.emptyCard}>
              <MaterialIcons name="task-alt" size={28} color={colors.textMuted} />
              <Text style={styles.emptyText}>Nessuna consegna registrata per oggi.</Text>
            </View>
          ) : todayEntries.map(entry => (
            <View key={entry.id} style={styles.entryCard}>
              <View style={styles.entryHeader}>
                <View style={styles.entryScopePill}>
                  <MaterialIcons name={entry.scope === 'flight' ? 'flight' : 'schedule'} size={14} color={colors.primaryText} />
                  <Text style={styles.entryScopeText}>{entry.scope === 'flight' ? entry.flightNumber : 'Turno'}</Text>
                </View>
                <TouchableOpacity onPress={() => deleteHandover(entry.id)}>
                  <MaterialIcons name="close" size={19} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              {!!entry.note && <Text style={styles.entryNote}>{entry.note}</Text>}
              {entry.checklist.length > 0 && <Text style={styles.entryChecklist}>✓ {entry.checklist.join(' · ')}</Text>}
              <Text style={styles.entryTime}>{new Date(entry.createdAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    content: { padding: SPACING.lg, paddingBottom: 120 },
    header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.lg },
    headerIcon: { width: 48, height: 48, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
    title: { ...TYPE.title, color: colors.text },
    subtitle: { ...TYPE.caption, color: colors.textSub, marginTop: 3 },
    noteCard: { padding: SPACING.md, borderRadius: RADIUS.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
    cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
    cardTitle: { ...TYPE.headline, color: colors.text },
    cardMeta: { ...TYPE.micro, color: colors.textMuted, marginTop: 3 },
    iconButton: { width: 38, height: 38, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerSoft },
    noteInput: { minHeight: 180, padding: SPACING.md, borderRadius: RADIUS.md, color: colors.text, backgroundColor: colors.cardSecondary, borderWidth: 1, borderColor: colors.border, fontSize: 15, lineHeight: 22 },
    primaryButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, marginTop: SPACING.md, borderRadius: RADIUS.md, backgroundColor: colors.primary },
    savedButton: { backgroundColor: colors.success },
    primaryButtonText: { ...TYPE.subhead, color: '#fff' },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SPACING.xxl, marginBottom: SPACING.sm },
    sectionTitle: { ...TYPE.overline, color: colors.textMuted },
    sectionSubtitle: { ...TYPE.caption, color: colors.textSub, marginTop: 2 },
    shareButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, backgroundColor: colors.primaryLight },
    shareButtonText: { ...TYPE.caption, color: colors.primaryText, fontWeight: WEIGHT.semibold },
    handoverComposer: { padding: SPACING.md, borderRadius: RADIUS.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
    scopeRow: { flexDirection: 'row', gap: SPACING.sm },
    scopeButton: { flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: RADIUS.md, backgroundColor: colors.cardSecondary, borderWidth: 1, borderColor: colors.border },
    scopeButtonSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    scopeText: { ...TYPE.caption, color: colors.textSub, fontWeight: WEIGHT.semibold },
    scopeTextSelected: { color: '#fff' },
    disabled: { opacity: 0.45 },
    handoverInput: { minHeight: 90, marginTop: SPACING.sm, padding: SPACING.md, borderRadius: RADIUS.md, color: colors.text, backgroundColor: colors.cardSecondary, borderWidth: 1, borderColor: colors.border, fontSize: 14, lineHeight: 20 },
    checklist: { marginTop: SPACING.sm },
    checkRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
    checkText: { ...TYPE.callout, color: colors.textSub },
    entriesList: { gap: SPACING.sm, marginTop: SPACING.sm },
    emptyCard: { minHeight: 110, alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, borderRadius: RADIUS.lg, backgroundColor: colors.cardSecondary },
    emptyText: { ...TYPE.caption, color: colors.textMuted },
    entryCard: { padding: SPACING.md, borderRadius: RADIUS.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
    entryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    entryScopePill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: SPACING.sm, paddingVertical: 5, borderRadius: RADIUS.pill, backgroundColor: colors.primaryLight },
    entryScopeText: { ...TYPE.micro, color: colors.primaryText, fontWeight: WEIGHT.bold },
    entryNote: { ...TYPE.callout, color: colors.text, marginTop: SPACING.sm, lineHeight: 20 },
    entryChecklist: { ...TYPE.caption, color: colors.success, marginTop: SPACING.sm, lineHeight: 18 },
    entryTime: { ...TYPE.micro, color: colors.textMuted, marginTop: SPACING.sm, textAlign: 'right' },
  });
}
