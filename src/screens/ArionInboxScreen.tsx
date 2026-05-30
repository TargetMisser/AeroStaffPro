import React, { useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { useAppTheme } from '../context/ThemeContext';

const ARION_INBOX_URL = 'https://prd-arion-ap.firebaseapp.com/messages/inbox';

type WebLoadError = {
  code?: number;
  description?: string;
};

export default function ArionInboxScreen() {
  const { colors, mode } = useAppTheme();
  const webViewRef = useRef<WebView>(null);
  const [progress, setProgress] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [error, setError] = useState<WebLoadError | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const isOperations = colors.isDark;

  const openExternal = () => {
    Linking.openURL(ARION_INBOX_URL).catch(() => {});
  };

  const retry = () => {
    setError(null);
    setReloadToken(value => value + 1);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View
        style={[
          styles.toolbar,
          {
            backgroundColor: isOperations ? 'rgba(2,8,12,0.64)' : colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={styles.navActions}>
          <TouchableOpacity
            style={[styles.navButton, { backgroundColor: colors.cardSecondary }, !canGoBack && styles.disabled]}
            disabled={!canGoBack}
            onPress={() => webViewRef.current?.goBack()}
            activeOpacity={0.8}
          >
            <MaterialIcons name="arrow-back-ios-new" size={16} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.navButton, { backgroundColor: colors.cardSecondary }, !canGoForward && styles.disabled]}
            disabled={!canGoForward}
            onPress={() => webViewRef.current?.goForward()}
            activeOpacity={0.8}
          >
            <MaterialIcons name="arrow-forward-ios" size={16} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.navButton, { backgroundColor: colors.cardSecondary }]}
            onPress={() => webViewRef.current?.reload()}
            activeOpacity={0.8}
          >
            <MaterialIcons name="refresh" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.urlBox}>
          <View style={[styles.secureDot, { backgroundColor: colors.primary }]} />
          <Text numberOfLines={1} style={[styles.urlText, { color: colors.textMuted }]}>
            Arion messages
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.externalButton, { borderColor: colors.border, backgroundColor: colors.cardSecondary }]}
          onPress={openExternal}
          activeOpacity={0.85}
        >
          <MaterialIcons name="open-in-new" size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {progress > 0 && progress < 1 && (
        <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
          <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${Math.round(progress * 100)}%` }]} />
        </View>
      )}

      <View style={[styles.webShell, { backgroundColor: colors.card }]}>
        {error ? (
          <View style={styles.errorState}>
            <View style={[styles.errorIcon, { backgroundColor: colors.primaryLight }]}>
              <MaterialIcons name="cloud-off" size={30} color={colors.primary} />
            </View>
            <Text style={[styles.errorTitle, { color: colors.text }]}>Arion non disponibile</Text>
            <Text style={[styles.errorCopy, { color: colors.textMuted }]}>
              La webapp non si e caricata dentro AeroStaff. Puoi riprovare o aprirla nel browser.
            </Text>
            {error.description && (
              <Text style={[styles.errorMeta, { color: colors.textMuted }]}>
                {error.code ? `${error.code} · ` : ''}{error.description}
              </Text>
            )}
            <View style={styles.errorActions}>
              <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.primary }]} onPress={retry} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>Riprova</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.secondaryBtn, { borderColor: colors.border }]} onPress={openExternal} activeOpacity={0.85}>
                <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Browser</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            <WebView
              key={reloadToken}
              ref={webViewRef}
              source={{ uri: ARION_INBOX_URL }}
              style={styles.webView}
              originWhitelist={['https://*']}
              javaScriptEnabled
              domStorageEnabled
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              setSupportMultipleWindows={false}
              startInLoadingState
              onLoadProgress={({ nativeEvent }) => setProgress(nativeEvent.progress)}
              onNavigationStateChange={(event: WebViewNavigation) => {
                setCanGoBack(event.canGoBack);
                setCanGoForward(event.canGoForward);
              }}
              onError={({ nativeEvent }) => {
                setError({ code: nativeEvent.code, description: nativeEvent.description });
              }}
              onHttpError={({ nativeEvent }) => {
                if (nativeEvent.statusCode >= 400) {
                  setError({ code: nativeEvent.statusCode, description: nativeEvent.description });
                }
              }}
              onShouldStartLoadWithRequest={request => {
                if (request.url.startsWith('http://') || request.url.startsWith('https://')) {
                  return true;
                }
                Linking.openURL(request.url).catch(() => {});
                return false;
              }}
              renderLoading={() => (
                <View style={[styles.loadingState, { backgroundColor: colors.bg }]}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={[styles.loadingText, { color: colors.textMuted }]}>Caricamento Arion...</Text>
                </View>
              )}
            />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  navActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.35 },
  urlBox: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  secureDot: { width: 7, height: 7, borderRadius: 99 },
  urlText: { flex: 1, fontSize: 12, fontWeight: '800' },
  externalButton: {
    width: 36,
    height: 36,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: { height: 2 },
  progressFill: { height: '100%' },
  webShell: { flex: 1 },
  webView: { flex: 1, backgroundColor: 'transparent' },
  loadingState: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: { fontSize: 13, fontWeight: '700' },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  errorTitle: { fontSize: 21, fontWeight: '900', textAlign: 'center' },
  errorCopy: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  errorMeta: { fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 12 },
  errorActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  primaryBtn: { borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12 },
  primaryBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  secondaryBtn: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12 },
  secondaryBtnText: { fontSize: 14, fontWeight: '900' },
});
