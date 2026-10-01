import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppTheme } from '../context/ThemeContext';
import { TYPE } from '../theme/typography';
import { type UpdateInfo, APP_VERSION } from '../utils/updateChecker';
import { SPACING, RADIUS } from '../theme/spacing';
import {
  downloadUpdatePackage,
  getDownloadedUpdateUri,
  installDownloadedUpdate,
  openUnknownSourcesSettings,
  openUpdateReleasePage,
} from '../utils/updateDownload';

interface Props {
  info: UpdateInfo;
  onDismiss: () => void;
}

function renderNotes(raw: string): string {
  return raw
    .replace(/^#{1,3} ?/gm, '')          // strip markdown headers
    .replace(/\*\*(.+?)\*\*/g, '$1')     // strip bold
    .replace(/`(.+?)`/g, '$1')           // strip inline code
    .replace(/^AeroStaff Pro [^\n]+\n?/m, '') // strip redundant title line
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function UpdateModal({ info, onDismiss }: Props) {
  const { colors } = useAppTheme();
  const [downloadState, setDownloadState] = useState<'idle' | 'downloading' | 'downloaded' | 'error'>('idle');
  const [progress, setProgress] = useState<number | null>(null);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const notes = renderNotes(info.releaseNotes);
  const latestVersionLabel = info.latestVersion.replace(/^v/i, '');
  const hasDirectDownload = Boolean(info.downloadUrl);

  useEffect(() => {
    let active = true;

    getDownloadedUpdateUri(info).then(uri => {
      if (!active || !uri) {
        return;
      }

      setLocalUri(uri);
      setDownloadState('downloaded');
    }).catch(() => {});

    return () => {
      active = false;
    };
  }, [info]);

  const statusLabel = useMemo(() => {
    if (downloadState === 'downloading') {
      if (progress == null) {
        return 'Download in corso…';
      }

      return `Download ${Math.round(progress * 100)}%`;
    }

    if (downloadState === 'downloaded') {
      return 'APK pronto per l’installazione';
    }

    if (downloadState === 'error' && errorText) {
      return errorText;
    }

    if (!hasDirectDownload) {
      return 'La release non include un APK scaricabile direttamente.';
    }

    return null;
  }, [downloadState, errorText, hasDirectDownload, progress]);

  const primaryLabel = useMemo(() => {
    if (!hasDirectDownload) {
      return 'Apri release';
    }

    if (downloadState === 'downloading') {
      return 'Scaricamento…';
    }

    if (downloadState === 'downloaded') {
      return 'Installa APK';
    }

    if (downloadState === 'error') {
      return 'Riprova download';
    }

    return 'Scarica in app';
  }, [downloadState, hasDirectDownload]);

  const handlePrimaryAction = async () => {
    if (!hasDirectDownload) {
      await openUpdateReleasePage(info);
      onDismiss();
      return;
    }

    if (downloadState === 'downloading') {
      return;
    }

    if (downloadState === 'downloaded' && localUri) {
      try {
        await installDownloadedUpdate(localUri);
      } catch {
        Alert.alert(
          'Installazione non avviata',
          'Android non ha avviato o completato l’installazione dell’APK. Verifica che AeroStaff Pro possa installare app da questa sorgente.',
          [
            { text: 'Annulla', style: 'cancel' },
            { text: 'Apri impostazioni', onPress: () => { openUnknownSourcesSettings().catch(() => {}); } },
          ],
        );
      }
      return;
    }

    try {
      setDownloadState('downloading');
      setErrorText(null);
      setProgress(0);
      const uri = await downloadUpdatePackage(info, next => {
        setProgress(next.progress);
      });
      setLocalUri(uri);
      setDownloadState('downloaded');
      setProgress(1);
    } catch {
      setDownloadState('error');
      setErrorText('Download non riuscito. Riprova oppure apri GitHub.');
      setProgress(null);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={downloadState === 'downloading' ? undefined : onDismiss}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          {/* Header */}
          <View style={[styles.header, { backgroundColor: colors.primary }]}>
            <MaterialIcons name="system-update" size={28} color="#fff" />
            <View style={{ marginLeft: SPACING.md, flex: 1 }}>
              <Text style={styles.headerTitle}>Aggiornamento disponibile</Text>
              <Text style={styles.headerSub}>
                v{APP_VERSION} → v{latestVersionLabel}
              </Text>
            </View>
          </View>

          {statusLabel && (
            <View style={[styles.statusBox, { backgroundColor: colors.cardSecondary, borderBottomColor: colors.border }]}>
              <View style={styles.statusRow}>
                {downloadState === 'downloading'
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <MaterialIcons name={downloadState === 'downloaded' ? 'check-circle' : 'info-outline'} size={18} color={downloadState === 'error' ? '#DC2626' : colors.primary} />}
                <Text style={[styles.statusText, { color: downloadState === 'error' ? '#DC2626' : colors.text }]}>
                  {statusLabel}
                </Text>
              </View>
              {downloadState === 'downloading' && (
                <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.progressFill,
                      { backgroundColor: colors.primary, width: `${Math.max(6, Math.round((progress ?? 0) * 100))}%` },
                    ]}
                  />
                </View>
              )}
            </View>
          )}

          {/* Release notes */}
          {notes.length > 0 && (
            <ScrollView
              style={styles.notesScroll}
              contentContainerStyle={styles.notesContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.notesText, { color: colors.text }]}>{notes}</Text>
            </ScrollView>
          )}

          {/* Buttons */}
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.btnLater, downloadState === 'downloading' && styles.btnDisabled]}
              onPress={onDismiss}
              activeOpacity={0.7}
              disabled={downloadState === 'downloading'}
            >
              <Text style={[styles.btnLaterText, { color: colors.textMuted }]}>Più tardi</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, { borderColor: colors.primary }]}
              onPress={() => { openUpdateReleasePage(info).catch(() => {}); }}
              activeOpacity={0.8}
            >
              <MaterialIcons name="open-in-browser" size={16} color={colors.primary} />
              <Text style={[styles.btnText, { color: colors.primaryText }]}>GitHub</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, { backgroundColor: colors.primary }, downloadState === 'downloading' && styles.btnDisabled]}
              onPress={() => { handlePrimaryAction().catch(() => {}); }}
              disabled={downloadState === 'downloading'}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name={downloadState === 'downloaded' ? 'install-mobile' : 'download'}
                size={16}
                color="#fff"
              />
              <Text style={[styles.btnText, { color: '#fff' }]}>{primaryLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xxl,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    borderRadius: RADIUS.xl,
    overflow: 'hidden',
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  headerSub: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    marginTop: 2,
  },
  notesScroll: {
    maxHeight: 320,
  },
  notesContent: {
    padding: SPACING.xl,
  },
  notesText: {
    fontSize: 13,
    lineHeight: 20,
  },
  statusBox: {
    paddingHorizontal: SPACING.xl,
    paddingTop: 14,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  statusText: {
    flex: 1,
    ...TYPE.callout,
  },
  progressTrack: {
    height: 8,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
    marginTop: 10,
  },
  progressFill: {
    height: '100%',
    borderRadius: RADIUS.pill,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.lg,
    borderTopWidth: 1,
  },
  btnLater: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnLaterText: {
    fontSize: 14,
    fontWeight: '500',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  btnPrimary: {
    borderWidth: 0,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
