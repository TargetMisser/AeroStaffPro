import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, Modal, Linking, Platform, KeyboardAvoidingView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppTheme, type ThemeColors } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';

const STORAGE_KEY = 'aerostaff_phonebook_v1';

type Contact = {
  id: string;
  name: string;
  number: string;
  category: string;
  note: string;
};

const CATEGORIES = ['Ops', 'Handling', 'Compagnia', 'Aeroporto', 'Hotel', 'Altro'];

const CATEGORY_COLORS: Record<string, string> = {
  'Ops':        '#F47B16',
  'Handling':   '#16A34A',
  'Compagnia':  '#FF6600',
  'Aeroporto':  '#7C3AED',
  'Hotel':      '#DB2777',
  'Altro':      '#64748B',
};

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─── Modal di aggiunta/modifica ───────────────────────────────────────────────
interface EditModalProps {
  visible: boolean;
  contact: Partial<Contact> | null;
  onSave: (c: Contact) => void;
  onClose: () => void;
}

function makeModalStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: {
      flex: 1, justifyContent: 'flex-end',
      backgroundColor: 'rgba(15,23,42,0.5)',
    },
    scrollContent: { flexGrow: 1, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: c.card,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 20, paddingBottom: 36, maxHeight: '92%',
    },
    handle: {
      width: 40, height: 4, borderRadius: 2,
      backgroundColor: c.border,
      alignSelf: 'center', marginBottom: 18,
    },
    title: { fontSize: 18, fontWeight: '700', color: c.primaryDark, marginBottom: 16 },
    label: { fontSize: 12, fontWeight: '600', color: c.textSub, marginBottom: 6, marginTop: 12 },
    input: {
      borderWidth: 1.5, borderColor: c.border, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 11,
      fontSize: 15, color: c.text, backgroundColor: c.cardSecondary,
    },
    catRow: { marginBottom: 4 },
    catChip: {
      paddingHorizontal: 14, paddingVertical: 7,
      borderRadius: 20, borderWidth: 1.5, borderColor: c.border,
      marginRight: 8, backgroundColor: c.card,
    },
    catTxt: { fontSize: 12, fontWeight: '600', color: c.textSub },
    actions: { flexDirection: 'row', gap: 10, marginTop: 20 },
    cancelBtn: {
      flex: 1, borderWidth: 1.5, borderColor: c.border,
      borderRadius: 12, paddingVertical: 13, alignItems: 'center',
    },
    cancelTxt: { fontSize: 14, fontWeight: '600', color: c.textSub },
    saveBtn: {
      flex: 2, backgroundColor: c.primary,
      borderRadius: 12, paddingVertical: 13,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    },
    saveTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },
  });
}

function EditModal({ visible, contact, onSave, onClose }: EditModalProps) {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const modalStyles = useMemo(() => makeModalStyles(colors), [colors]);
  const [name, setName]         = useState('');
  const [number, setNumber]     = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [note, setNote]         = useState('');

  useEffect(() => {
    if (contact) {
      setName(contact.name ?? '');
      setNumber(contact.number ?? '');
      setCategory(contact.category ?? CATEGORIES[0]);
      setNote(contact.note ?? '');
    } else {
      setName(''); setNumber(''); setCategory(CATEGORIES[0]); setNote('');
    }
  }, [contact, visible]);

  const handleSave = () => {
    if (!name.trim() || !number.trim()) {
      Alert.alert(t('contactErrReqTitle'), t('contactErrReqMsg'));
      return;
    }
    onSave({
      id: contact?.id ?? genId(),
      name: name.trim(),
      number: number.trim(),
      category,
      note: note.trim(),
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={modalStyles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
      >
        <ScrollView contentContainerStyle={modalStyles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={modalStyles.sheet}>
          <View style={modalStyles.handle} />

          <Text style={modalStyles.title}>
            {contact?.id ? t('contactModalEdit') : t('contactModalNew')}
          </Text>

          {/* Nome */}
          <Text style={modalStyles.label}>{t('contactNameLabel')}</Text>
          <TextInput
            style={modalStyles.input}
            value={name}
            onChangeText={setName}
            placeholder={t('contactNamePh')}
            placeholderTextColor={colors.textSub}
            autoCapitalize="words"
          />

          {/* Numero */}
          <Text style={modalStyles.label}>{t('contactNumberLabel')}</Text>
          <TextInput
            style={modalStyles.input}
            value={number}
            onChangeText={setNumber}
            placeholder={t('contactNumberPh')}
            placeholderTextColor={colors.textSub}
            keyboardType="phone-pad"
          />

          {/* Categoria */}
          <Text style={modalStyles.label}>{t('contactCatLabel')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={modalStyles.catRow}>
            {CATEGORIES.map(cat => (
              <TouchableOpacity
                key={cat}
                style={[
                  modalStyles.catChip,
                  category === cat && { backgroundColor: CATEGORY_COLORS[cat] },
                ]}
                onPress={() => setCategory(cat)}
              >
                <Text style={[modalStyles.catTxt, category === cat && { color: '#fff' }]}>
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Nota */}
          <Text style={modalStyles.label}>{t('contactNoteLabel')}</Text>
          <TextInput
            style={[modalStyles.input, { height: 70, textAlignVertical: 'top' }]}
            value={note}
            onChangeText={setNote}
            placeholder={t('contactNotePh')}
            placeholderTextColor={colors.textSub}
            multiline
          />

          {/* Azioni */}
          <View style={modalStyles.actions}>
            <TouchableOpacity style={modalStyles.cancelBtn} onPress={onClose}>
              <Text style={modalStyles.cancelTxt}>Annulla</Text>
            </TouchableOpacity>
            <TouchableOpacity style={modalStyles.saveBtn} onPress={handleSave}>
              <MaterialIcons name="save" size={18} color="#fff" />
              <Text style={modalStyles.saveTxt}>Salva</Text>
            </TouchableOpacity>
          </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}


// ─── Riga contatto ────────────────────────────────────────────────────────────
function makeRowStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: c.card,
      borderRadius: 14, padding: 14, marginBottom: 10,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
      shadowOpacity: c.isDark ? 0 : 0.05, shadowRadius: 4, elevation: c.isDark ? 0 : 2, borderWidth: c.isDark ? 1 : 0, borderColor: c.border,
    },
    dot: { width: 4, borderRadius: 2, alignSelf: 'stretch', marginRight: 12 },
    info: { flex: 1 },
    topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
    name:   { fontSize: 14, fontWeight: '700', color: c.text, flex: 1 },
    badge: {
      paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
    },
    badgeTxt: { fontSize: 10, fontWeight: '700' },
    number: { fontSize: 13, color: c.textSub, fontWeight: '500' },
    note:   { fontSize: 11, color: c.textMuted, marginTop: 2 },
    callBtn: {
      width: 36, height: 36, borderRadius: 18,
      justifyContent: 'center', alignItems: 'center', marginLeft: 8,
    },
    editBtn: { padding: 6, marginLeft: 2 },
  });
}

interface ContactRowProps {
  contact: Contact;
  onEdit: (c: Contact) => void;
  onDelete: (id: string) => void;
}

function ContactRowComponent({ contact, onEdit, onDelete }: ContactRowProps) {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const rowStyles = useMemo(() => makeRowStyles(colors), [colors]);
  const color = CATEGORY_COLORS[contact.category] ?? '#64748B';

  const call = () => {
    const url = `tel:${contact.number.replace(/\s/g, '')}`;
    Linking.canOpenURL(url).then(ok => {
      if (ok) Linking.openURL(url);
    });
  };

  const confirmDelete = () => {
    Alert.alert(t('contactDeleteTitle'), `${t('contactDeleteTitle')} "${contact.name}"?`, [
      { text: 'Annulla', style: 'cancel' },
      { text: t('contactDeleteConfirm'), style: 'destructive', onPress: () => onDelete(contact.id) },
    ]);
  };

  return (
    <View style={rowStyles.card}>
      <View style={[rowStyles.dot, { backgroundColor: color }]} />
      <View style={rowStyles.info}>
        <View style={rowStyles.topRow}>
          <Text style={rowStyles.name} numberOfLines={1}>{contact.name}</Text>
          <View style={[rowStyles.badge, { backgroundColor: color + '20' }]}>
            <Text style={[rowStyles.badgeTxt, { color }]}>{contact.category}</Text>
          </View>
        </View>
        <Text style={rowStyles.number} numberOfLines={1}>{contact.number}</Text>
        {!!contact.note && <Text style={rowStyles.note}>{contact.note}</Text>}
      </View>
      <TouchableOpacity style={[rowStyles.callBtn, { backgroundColor: color }]} onPress={call} accessible={true} accessibilityRole="button" accessibilityLabel={t('contactA11yCall')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <MaterialIcons name="call" size={18} color="#fff" />
      </TouchableOpacity>
      <TouchableOpacity style={rowStyles.editBtn} onPress={() => onEdit(contact)} accessible={true} accessibilityRole="button" accessibilityLabel={t('contactA11yEdit')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <MaterialIcons name="edit" size={18} color={colors.textSub} />
      </TouchableOpacity>
      <TouchableOpacity style={rowStyles.editBtn} onPress={confirmDelete} accessible={true} accessibilityRole="button" accessibilityLabel={t('contactA11yDelete')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <MaterialIcons name="delete-outline" size={18} color="#EF4444" />
      </TouchableOpacity>
    </View>
  );
}

// Performance optimization: memoize flatlist item to prevent unnecessary re-renders
const ContactRow = React.memo(ContactRowComponent);


// ─── Main Screen ──────────────────────────────────────────────────────────────
function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: 16, paddingVertical: 12,
      backgroundColor: c.card,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    headerTitle: { fontSize: 17, fontWeight: '700', color: c.primaryDark, flex: 1 },
    addBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: c.primary, borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: 8,
    },
    addTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
    searchRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      margin: 12, paddingHorizontal: 14, paddingVertical: 10,
      backgroundColor: c.card, borderRadius: 14,
      borderWidth: 1.5, borderColor: c.border,
    },
    searchInput: { flex: 1, fontSize: 14, color: c.text },
    filterBar: { maxHeight: 50, backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.border },
    filterContent: { paddingHorizontal: 12, paddingVertical: 9, gap: 8 },
    filterChip: {
      paddingHorizontal: 14, paddingVertical: 6,
      borderRadius: 20, borderWidth: 1.5, borderColor: c.border,
      backgroundColor: c.card,
    },
    filterChipActive: { backgroundColor: c.primary, borderColor: c.primary },
    filterTxt: { fontSize: 12, fontWeight: '600', color: c.textSub },
    filterTxtActive: { color: '#fff' },
    list: { flex: 1 },
    listPad: { padding: 16, paddingBottom: 96 },
    groupHeader: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      marginBottom: 8, marginTop: 6,
    },
    groupDot: { width: 8, height: 8, borderRadius: 4 },
    groupLabel: { fontSize: 11, fontWeight: '700', color: c.textSub, letterSpacing: 0.8, flex: 1 },
    groupCount: {
      fontSize: 11, fontWeight: '700', color: c.textMuted,
      backgroundColor: c.cardSecondary, borderRadius: 10,
      paddingHorizontal: 7, paddingVertical: 1,
    },
    empty: { alignItems: 'center', paddingTop: 80, gap: 10 },
    emptyTitle: { fontSize: 16, fontWeight: '600', color: c.textSub },
    emptyHint: { fontSize: 13, color: c.textMuted, textAlign: 'center' },
  });
}

export default function PhonebookScreen() {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [contacts, setContacts]       = useState<Contact[]>([]);
  const [search, setSearch]           = useState('');
  const [filterCat, setFilterCat]     = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing]         = useState<Partial<Contact> | null>(null);

  // Load
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(val => {
      if (val) setContacts(JSON.parse(val));
    });
  }, []);

  const handleSave = useCallback((c: Contact) => {
    setContacts(prev => {
      const exists = prev.find(x => x.id === c.id);
      const next = exists
        ? prev.map(x => (x.id === c.id ? c : x))
        : [c, ...prev];
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setModalVisible(false);
  }, []);

  const handleDelete = useCallback((id: string) => {
    setContacts(prev => {
      const next = prev.filter(x => x.id !== id);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const openAdd = () => { setEditing(null); setModalVisible(true); };
  const openEdit = (c: Contact) => { setEditing(c); setModalVisible(true); };

  // Filter
  const filtered = contacts.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q || c.name.toLowerCase().includes(q) || c.number.includes(q);
    const matchCat = !filterCat || c.category === filterCat;
    return matchSearch && matchCat;
  });

  const grouped = CATEGORIES.reduce<Record<string, Contact[]>>((acc, cat) => {
    const list = filtered.filter(c => c.category === cat);
    if (list.length) acc[cat] = list;
    return acc;
  }, {});

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <MaterialIcons name="contacts" size={22} color={colors.primary} />
        <Text style={s.headerTitle}>{t('phonebookTitle')}</Text>
        <TouchableOpacity style={s.addBtn} onPress={openAdd}>
          <MaterialIcons name="add" size={20} color="#fff" />
          <Text style={s.addTxt}>{t('contactAdd')}</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={s.searchRow}>
        <MaterialIcons name="search" size={18} color={colors.textSub} />
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder={t('contactSearch')}
          placeholderTextColor={colors.textSub}
          autoCorrect={false}
        />
        {!!search && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <MaterialIcons name="close" size={18} color={colors.textSub} />
          </TouchableOpacity>
        )}
      </View>

      {/* Category filter */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={s.filterBar}
        contentContainerStyle={s.filterContent}
      >
        <TouchableOpacity
          style={[s.filterChip, !filterCat && s.filterChipActive]}
          onPress={() => setFilterCat(null)}
        >
          <Text style={[s.filterTxt, !filterCat && s.filterTxtActive]}>{t('contactAll')}</Text>
        </TouchableOpacity>
        {CATEGORIES.map(cat => {
          const active = filterCat === cat;
          return (
            <TouchableOpacity
              key={cat}
              style={[
                s.filterChip,
                active && { backgroundColor: CATEGORY_COLORS[cat], borderColor: CATEGORY_COLORS[cat] },
              ]}
              onPress={() => setFilterCat(active ? null : cat)}
            >
              <Text style={[s.filterTxt, active && { color: '#fff' }]}>{cat}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* List */}
      <ScrollView style={s.list} contentContainerStyle={s.listPad} showsVerticalScrollIndicator={false}>
        {contacts.length === 0 ? (
          <View style={s.empty}>
            <MaterialIcons name="contacts" size={56} color={colors.textMuted} />
            <Text style={s.emptyTitle}>{t('contactEmptyTitle')}</Text>
            <Text style={s.emptyHint}>Tocca "Aggiungi" per inserire il primo contatto</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={s.empty}>
            <MaterialIcons name="search-off" size={48} color={colors.textMuted} />
            <Text style={s.emptyTitle}>{t('contactNoResults')}</Text>
          </View>
        ) : (
          Object.entries(grouped).map(([cat, list]) => (
            <View key={cat}>
              <View style={s.groupHeader}>
                <View style={[s.groupDot, { backgroundColor: CATEGORY_COLORS[cat] }]} />
                <Text style={s.groupLabel}>{cat.toUpperCase()}</Text>
                <Text style={s.groupCount}>{list.length}</Text>
              </View>
              {list.map(c => (
                <ContactRow key={c.id} contact={c} onEdit={openEdit} onDelete={handleDelete} />
              ))}
            </View>
          ))
        )}
        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Edit modal */}
      <EditModal
        visible={modalVisible}
        contact={editing}
        onSave={handleSave}
        onClose={() => setModalVisible(false)}
      />
    </View>
  );
}
