// src/screens/TraveldocScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { useAppTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import TactilePressable from '../components/motion/TactilePressable';

const DARK_CSS_JS = `
(function() {
  function applyTheme() {
    if (document.getElementById('aerostaff-dark-theme-style')) return;
    var s = document.createElement('style');
    s.id = 'aerostaff-dark-theme-style';
    s.innerHTML =
      'html { filter: invert(1) hue-rotate(180deg) !important; background:#111 !important; }' +
      'img, video, canvas, svg image, [class*="no-invert"] { filter: invert(1) hue-rotate(180deg) !important; }';
    if (document.documentElement) {
      document.documentElement.appendChild(s);
    }
  }
  applyTheme();
  var observer = new MutationObserver(applyTheme);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
true;
`;

export default function TraveldocScreen({ isFocused = true }: { isFocused?: boolean }) {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const [hasActivated, setHasActivated] = useState(isFocused);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const webViewRef = useRef<WebView>(null);

  useEffect(() => {
    if (isFocused) setHasActivated(true);
  }, [isFocused]);

  useEffect(() => {
    if (!isFocused || !hasActivated || !loading) return;
    const timer = setTimeout(() => { setLoading(false); setLoadError(true); }, 15_000);
    return () => clearTimeout(timer);
  }, [hasActivated, isFocused, loading]);

  const handleReload = () => {
    setLoading(true);
    setLoadError(false);
    webViewRef.current?.reload();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.primaryDark }]}>TravelDoc</Text>
        <Text style={[styles.sub, { color: colors.textSub }]}>{t('traveldocSub')}</Text>
      </View>

      {hasActivated && loading && (
        <View style={[styles.loadingWrap, { backgroundColor: colors.bg }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSub }]}>{t('traveldocLoading')}</Text>
        </View>
      )}
      {hasActivated && loadError && !loading && (
        <View style={[styles.loadingWrap, { backgroundColor: colors.bg }]}>
          <Text style={[styles.loadingText, { color: colors.textSub, marginBottom: 16 }]}>
            Caricamento lento o errore di rete.
          </Text>
          <TactilePressable
            onPress={handleReload}
            depth={2}
            pressedScale={0.96}
            animatedStyle={[styles.retryBtn, { backgroundColor: colors.primary }]}
            haptic="selection"
          >
            <Text style={styles.retryBtnText}>Riprova</Text>
          </TactilePressable>
        </View>
      )}
      {hasActivated && (
        <WebView
          ref={webViewRef}
          source={{ uri: 'https://legacy.traveldoc.aero/' }}
          style={{ flex: 1, backgroundColor: colors.isDark ? '#111111' : '#ffffff' }}
          onLoadEnd={() => { setLoading(false); setLoadError(false); }}
          onError={() => { setLoading(false); setLoadError(true); }}
          javaScriptEnabled
          domStorageEnabled
          injectedJavaScriptBeforeContentLoaded={colors.isDark ? DARK_CSS_JS : undefined}
          injectedJavaScript={colors.isDark ? DARK_CSS_JS : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  title: { fontSize: 22, fontWeight: 'bold' },
  sub: { fontSize: 12, marginTop: 2 },
  loadingWrap: { position: 'absolute', top: 60, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', zIndex: 10, paddingHorizontal: 20 },
  loadingText: { marginTop: 12, fontSize: 14, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
