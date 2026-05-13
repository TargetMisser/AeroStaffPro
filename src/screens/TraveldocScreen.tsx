// src/screens/TraveldocScreen.tsx
import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { useAppTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';

const DARK_CSS_JS = `
(function() {
  var s = document.createElement('style');
  s.innerHTML =
    'html { filter: invert(1) hue-rotate(180deg) !important; background:#111 !important; }' +
    'img, video, canvas, svg image { filter: invert(1) hue-rotate(180deg) !important; }';
  document.documentElement.appendChild(s);
})();
true;
`;

export default function TraveldocScreen({ isFocused = true }: { isFocused?: boolean }) {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const [hasActivated, setHasActivated] = useState(isFocused);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (isFocused) setHasActivated(true);
  }, [isFocused]);

  useEffect(() => {
    if (!isFocused || !hasActivated || !loading) return;
    const timer = setTimeout(() => { setLoading(false); setLoadError(true); }, 15_000);
    return () => clearTimeout(timer);
  }, [hasActivated, isFocused, loading]);

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
          <Text style={[styles.loadingText, { color: colors.textSub }]}>
            Caricamento lento. Verifica la connessione internet.
          </Text>
        </View>
      )}
      {hasActivated && (
        <WebView
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
  loadingWrap: { position: 'absolute', top: 60, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  loadingText: { marginTop: 12, fontSize: 14 },
});
