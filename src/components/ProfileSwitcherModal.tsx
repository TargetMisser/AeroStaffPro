import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAirport, type AirportProfile } from '../context/AirportContext';
import { useLanguage } from '../context/LanguageContext';
import { useAppTheme, type ThemeColors } from '../context/ThemeContext';
import {
  AIRPORT_PRESETS,
  formatAirportSettingLabel,
  getAirportAirlines,
  isValidAirportCode,
  normalizeAirportCode,
} from '../utils/airportSettings';
import { AIRLINE_COLORS, AIRLINE_DISPLAY_NAMES } from '../utils/airlineOps';

type Props = {
  visible: boolean;
  onClose: () => void;
};

function getProfileBadge(profile: AirportProfile): string {
  const parts = profile.name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  const compact = profile.name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (compact.length >= 2) {
    return compact.slice(0, 2);
  }

  return profile.airportCode.slice(0, 2);
}

export default function ProfileSwitcherModal({ visible, onClose }: Props) {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const {
    profiles,
    activeProfile,
    activeProfileId,
    saveProfile,
    switchProfile,
    deleteProfile,
  } = useAirport();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [editorProfileId, setEditorProfileId] = useState<string | 'new' | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftAirportCode, setDraftAirportCode] = useState('');
  const [draftAirlines, setDraftAirlines] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const editingProfile = editorProfileId && editorProfileId !== 'new'
    ? profiles.find(profile => profile.id === editorProfileId) ?? null
    : null;
  const editorOpen = editorProfileId !== null;
  const normalizedAirportCode = normalizeAirportCode(draftAirportCode);
  const previewAirportCode = normalizedAirportCode || activeProfile?.airportCode || AIRPORT_PRESETS[0]?.code || 'PSA';
  const availableAirlines = useMemo(() => getAirportAirlines(previewAirportCode), [previewAirportCode]);

  useEffect(() => {
    if (!visible) {
      setEditorProfileId(null);
      setSaving(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!editorOpen) {
      return;
    }

    setDraftAirlines(prev => {
      const valid = prev.filter(key => availableAirlines.includes(key));
      if (valid.length > 0) {
        return valid;
      }
      return [...availableAirlines];
    });
  }, [availableAirlines, editorOpen]);

  const openEditor = (profile?: AirportProfile) => {
    if (profile) {
      setEditorProfileId(profile.id);
      setDraftName(profile.name);
      setDraftAirportCode(profile.airportCode);
      setDraftAirlines(profile.airlines.length > 0 ? [...profile.airlines] : [...getAirportAirlines(profile.airportCode)]);
      return;
    }

    const seedAirportCode = activeProfile?.airportCode || AIRPORT_PRESETS[0]?.code || 'PSA';
    setEditorProfileId('new');
    setDraftName('');
    setDraftAirportCode(seedAirportCode);
    setDraftAirlines(activeProfile?.airlines?.length ? [...activeProfile.airlines] : [...getAirportAirlines(seedAirportCode)]);
  };

  const toggleAirline = (key: string) => {
    setDraftAirlines(prev => (
      prev.includes(key)
        ? prev.filter(item => item !== key)
        : [...prev, key]
    ));
  };

  const handleSave = async () => {
    const normalized = normalizeAirportCode(draftAirportCode);
    if (!draftName.trim() || !isValidAirportCode(normalized) || draftAirlines.length === 0) {
      Alert.alert(t('profileValidationTitle'), t('profileValidationMessage'));
      return;
    }

    setSaving(true);
    try {
      await saveProfile({
        id: editingProfile?.id,
        name: draftName,
        airportCode: normalized,
        airlines: draftAirlines,
        activate: editorProfileId === 'new' || editingProfile?.id === activeProfileId,
      });
      setEditorProfileId(null);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (profile: AirportProfile) => {
    Alert.alert(
      t('profileDeleteTitle'),
      t('profileDeleteMessage'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProfile(profile.id);
              setEditorProfileId(null);
            } catch (error) {
              if (error instanceof Error && error.message === 'LAST_PROFILE') {
                Alert.alert(t('profileDeleteLastTitle'), t('profileDeleteLastMessage'));
              }
            }
          },
        },
      ],
    );
  };

  const handleSwitch = async (profile: AirportProfile) => {
    if (profile.id === activeProfileId) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      await switchProfile(profile.id);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{t('profileTitle')}</Text>
              <Text style={styles.subtitle}>{t('profileSubtitle')}</Text>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              activeOpacity={0.8}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={t('close')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {!editorOpen ? (
            <>
              <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
                {profiles.map(profile => {
                  const isActive = profile.id === activeProfileId;
                  const trackedCount = profile.airlines.length > 0
                    ? profile.airlines.length
                    : getAirportAirlines(profile.airportCode).length;

                  return (
                    <TouchableOpacity
                      key={profile.id}
                      style={[styles.profileCard, isActive && styles.profileCardActive]}
                      onPress={() => { handleSwitch(profile).catch(() => {}); }}
                      activeOpacity={0.85}
                    >
                      <View style={[styles.profileBadge, { backgroundColor: isActive ? colors.primary : colors.primaryLight }]}>
                        <Text style={[styles.profileBadgeText, { color: isActive ? '#fff' : colors.primaryDark }]}>
                          {getProfileBadge(profile)}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={styles.profileTitleRow}>
                          <Text style={styles.profileName}>{profile.name}</Text>
                          {isActive && (
                            <View style={styles.activePill}>
                              <Text style={styles.activePillText}>{t('profileActive')}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.profileMeta}>{formatAirportSettingLabel(profile.airportCode)}</Text>
                        <Text style={styles.profileMeta}>{trackedCount} compagnie</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.profileAction}
                        onPress={() => openEditor(profile)}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="edit" size={18} color={colors.primary} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View style={styles.footer}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => openEditor()} activeOpacity={0.85}>
                  <MaterialIcons name="add-circle-outline" size={18} color={colors.primary} />
                  <Text style={styles.secondaryBtnText}>{t('profileNew')}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
                <Text style={styles.label}>{t('profileName')}</Text>
                <TextInput
                  value={draftName}
                  onChangeText={setDraftName}
                  placeholder={t('profileNamePlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                />

                <Text style={styles.label}>{t('profileAirport')}</Text>
                <TextInput
                  value={draftAirportCode}
                  onChangeText={value => setDraftAirportCode(normalizeAirportCode(value))}
                  placeholder={t('profileAirportPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  maxLength={3}
                  autoCapitalize="characters"
                  style={styles.input}
                />

                <Text style={styles.label}>{t('profileQuickPick')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickPicks}>
                  {AIRPORT_PRESETS.map(airport => {
                    const active = airport.code === previewAirportCode;
                    return (
                      <TouchableOpacity
                        key={airport.code}
                        style={[styles.quickPickChip, active && styles.quickPickChipActive]}
                        onPress={() => setDraftAirportCode(airport.code)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.quickPickCode, active && { color: colors.primary }]}>{airport.code}</Text>
                        <Text style={[styles.quickPickCity, active && { color: colors.primary }]}>{airport.city}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <View style={styles.airlineHeader}>
                  <Text style={styles.label}>{t('profileAirlines')}</Text>
                  <View style={styles.airlineHeaderActions}>
                    <TouchableOpacity onPress={() => setDraftAirlines([...availableAirlines])} activeOpacity={0.8}>
                      <Text style={styles.linkText}>{t('profileSelectAll')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setDraftAirlines([])} activeOpacity={0.8}>
                      <Text style={styles.linkText}>{t('profileDeselectAll')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.airlineGrid}>
                  {availableAirlines.map(key => {
                    const checked = draftAirlines.includes(key);
                    const dot = AIRLINE_COLORS[key] ?? colors.primary;
                    const label = AIRLINE_DISPLAY_NAMES[key] ?? key;

                    return (
                      <TouchableOpacity
                        key={key}
                        style={[styles.airlineChip, checked && styles.airlineChipActive]}
                        onPress={() => toggleAirline(key)}
                        activeOpacity={0.85}
                      >
                        <View style={[styles.airlineDot, { backgroundColor: dot }]} />
                        <Text style={[styles.airlineText, checked && { color: colors.primary }]}>{label}</Text>
                        <MaterialIcons
                          name={checked ? 'check-circle' : 'radio-button-unchecked'}
                          size={18}
                          color={checked ? colors.primary : colors.textMuted}
                        />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              <View style={styles.footer}>
                {editingProfile && (
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleDelete(editingProfile)}
                    activeOpacity={0.85}
                    disabled={saving}
                  >
                    <MaterialIcons name="delete-outline" size={18} color="#DC2626" />
                    <Text style={styles.deleteBtnText}>{t('delete')}</Text>
                  </TouchableOpacity>
                )}

                <View style={{ flex: 1 }} />

                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => setEditorProfileId(null)}
                  activeOpacity={0.85}
                  disabled={saving}
                >
                  <Text style={styles.secondaryBtnText}>{t('cancel')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.primaryBtn, saving && { opacity: 0.7 }]}
                  onPress={() => { handleSave().catch(() => {}); }}
                  activeOpacity={0.85}
                  disabled={saving}
                >
                  <MaterialIcons name="save" size={18} color="#fff" />
                  <Text style={styles.primaryBtnText}>{t('save')}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.58)',
      justifyContent: 'center',
      padding: 18,
    },
    sheet: {
      maxHeight: '86%',
      borderRadius: 24,
      overflow: 'hidden',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      paddingHorizontal: 18,
      paddingTop: 18,
      paddingBottom: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.text,
    },
    subtitle: {
      marginTop: 4,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSub,
    },
    closeBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.cardSecondary,
    },
    body: {
      maxHeight: 540,
    },
    bodyContent: {
      padding: 18,
      gap: 14,
    },
    profileCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: 14,
      borderRadius: 18,
      backgroundColor: colors.cardSecondary,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 10,
    },
    profileCardActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryLight,
    },
    profileBadge: {
      width: 48,
      height: 48,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    profileBadgeText: {
      fontSize: 16,
      fontWeight: '800',
    },
    profileTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    },
    profileName: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
      flexShrink: 1,
    },
    profileMeta: {
      fontSize: 12,
      color: colors.textSub,
      marginTop: 2,
    },
    activePill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: colors.primary,
    },
    activePillText: {
      fontSize: 10,
      fontWeight: '800',
      color: '#fff',
      letterSpacing: 0.4,
    },
    profileAction: {
      width: 36,
      height: 36,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
    },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 16,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.card,
    },
    secondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderRadius: 14,
      backgroundColor: colors.primaryLight,
    },
    secondaryBtnText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.primary,
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 11,
      borderRadius: 14,
      backgroundColor: colors.primary,
    },
    primaryBtnText: {
      fontSize: 13,
      fontWeight: '800',
      color: '#fff',
    },
    deleteBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    deleteBtnText: {
      fontSize: 13,
      fontWeight: '700',
      color: '#DC2626',
    },
    label: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.textSub,
      letterSpacing: 0.5,
      marginBottom: 8,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      color: colors.text,
      backgroundColor: colors.cardSecondary,
      marginBottom: 14,
    },
    quickPicks: {
      gap: 10,
      paddingBottom: 8,
      paddingRight: 8,
    },
    quickPickChip: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.cardSecondary,
      minWidth: 82,
    },
    quickPickChipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryLight,
    },
    quickPickCode: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.text,
    },
    quickPickCity: {
      fontSize: 11,
      color: colors.textSub,
      marginTop: 2,
    },
    airlineHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 4,
      marginBottom: 8,
    },
    airlineHeaderActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    linkText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.primary,
    },
    airlineGrid: {
      gap: 10,
    },
    airlineChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.cardSecondary,
    },
    airlineChipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryLight,
    },
    airlineDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    airlineText: {
      flex: 1,
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
  });
}
