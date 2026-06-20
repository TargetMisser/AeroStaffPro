import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, Alert, TouchableOpacity, Image, Linking } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { WebView } from 'react-native-webview';
import * as Calendar from 'expo-calendar';
import { useLanguage } from '../context/LanguageContext';

const PRIMARY = '#F47B16';
const DARK_ORANGE = '#C2520A';
const BG = '#F3F4F6';

export default function ShiftScreen() {
  const { t } = useLanguage();
  const [imageList, setImageList] = useState<string[]>([]);
  const [ocrText, setOcrText] = useState<string>('');
  const [processing, setProcessing] = useState(false);
  const webViewRef = useRef<WebView>(null);

  const pickImage = async () => {
    try {
      let result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 0,
        orderedSelection: true,
        quality: 1,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setImageList(result.assets.map(a => a.uri));
        setProcessing(true);
        setOcrText('');
        
        const base64List = result.assets
          .map(a => a.base64 ? `data:${a.mimeType || 'image/jpeg'};base64,${a.base64}` : null)
          .filter((item): item is string => !!item);
        if (base64List.length === 0) {
          setProcessing(false);
          Alert.alert('Errore OCR', 'Nessuna immagine leggibile selezionata.');
          return;
        }
        const base64Json = JSON.stringify(base64List);
        
        const jsCode = `
          if (window.runTesseract) {
            window.runTesseract(${JSON.stringify(base64Json)});
          } else {
            window.ReactNativeWebView.postMessage(JSON.stringify({ success: false, error: "Motore OCR non pronto." }));
          }
          true;
        `;
        webViewRef.current?.injectJavaScript(jsCode);
      }
    } catch (e) {
      Alert.alert("Errore OCR", "Impossibile elaborare l'immagine.");
      setProcessing(false);
    }
  };

  const handleWebViewMessage = (event: any) => {
    const rawData = event.nativeEvent.data;
    try {
      const result = JSON.parse(rawData);
      if (result.success) {
        setOcrText(result.text);
      } else {
        Alert.alert("Errore", "Impossibile analizzare il documento: " + result.error);
      }
    } catch(e) {
      console.error(e);
    } finally {
      setProcessing(false);
    }
  };

  const parseAndSaveShifts = async () => {
    const { status, canAskAgain } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') {
      if (!canAskAgain) {
        Alert.alert("Permesso negato", "Abilita l'accesso al calendario nelle impostazioni del dispositivo.", [
          { text: 'Annulla', style: 'cancel' },
          { text: 'Apri Impostazioni', onPress: () => Linking.openSettings() },
        ]);
      } else {
        Alert.alert("Permesso negato", "Devi autorizzare l'accesso al calendario del telefono.");
      }
      return;
    }

    try {
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      // Su iOS isPrimary è comodo, su Android cerchiamo un calendario che accetti scritture
      let targetCalendar = calendars.find(c => c.allowsModifications && c.isPrimary);
      if (!targetCalendar) {
        targetCalendar = calendars.find(c => c.allowsModifications);
      }

      if (!targetCalendar) {
        Alert.alert('Errore', t('shiftNoCalendar'));
        return;
      }
      // Normalizzazione Estrema OCR globale prima di estrarre
      const norText = ocrText.replace(/[OoQ]/g, '0').replace(/[Il|]/g, '1');

      // Estrai tutte le date in ordine compatto
      const dateRegex = /\b(\d{2})[\/\-](\d{2})[\/\-](\d{4})\b/g;
      const dates: any[] = [];
      let matchDate;
      while ((matchDate = dateRegex.exec(norText)) !== null) {
        dates.push({
          day: parseInt(matchDate[1], 10),
          month: parseInt(matchDate[2], 10) - 1, // JS months are 0-indexed
          year: parseInt(matchDate[3], 10),
          raw: matchDate[0]
        });
      }

      // Nascondiamo gli anni a 4 cifre per evitare che "2026" possa essere letto come l'orario "20:26" dall'OCR
      const safeTextForTimes = norText.replace(/\b20\d{2}\b/g, ' ANNO ');

      // Estrai tutti i turni (orari o Riposo) in ordine compatto
      // Tolto il flag 'i' per evitare falsi positivi sulla lettera 'r' minuscola (es. o[r]ario, ma[r]tedì, ecc.)
      const shiftRegex = /\b([01]?\d|2\d)[.,:]?(\d{2})\s*[-–—_~|]+\s*([01]?\d|2\d)[.,:]?(\d{2})\b|\b(R|RIP|RIP0S0|R1P0S0|R1POSO)\b/g;
      const shifts: any[] = [];
      let matchShift;
      while ((matchShift = shiftRegex.exec(safeTextForTimes)) !== null) {
        if (matchShift[5]) {
          shifts.push({ isRest: true, raw: matchShift[0] });
        } else {
          shifts.push({
            isRest: false,
            startH: parseInt(matchShift[1], 10), startM: parseInt(matchShift[2], 10),
            endH: parseInt(matchShift[3], 10), endM: parseInt(matchShift[4], 10),
            raw: matchShift[0]
          });
        }
      }

      let savedCount = 0;
      // ZIP degli array: Associa la prima data al primo turno, la seconda al secondo, ecc.
      // E' perfetto per le estrazioni in colonna!
      const iterCount = Math.min(dates.length, shifts.length);

      for (let i = 0; i < iterCount; i++) {
        const d = dates[i];
        const s = shifts[i];

        // --- PREVENZIONE DUPLICATI ---
        // Controlliamo l'intera giornata per evitare sovrascritture se l'operazione viene ripetuta
        const dayStart = new Date(d.year, d.month, d.day, 0, 0, 0);
        const dayEnd = new Date(d.year, d.month, d.day, 23, 59, 59);
        const existingEvents = await Calendar.getEventsAsync([targetCalendar.id], dayStart, dayEnd);

        const isDuplicate = existingEvents.some(e => {
          if (s.isRest) {
            return e.title.includes("Riposo");
          } else {
            // Verifica se c'è già un turno di lavoro che inizia alla stessa ora
            const eStart = new Date(e.startDate);
            return e.title.includes("Lavoro") && eStart.getHours() === s.startH;
          }
        });

        if (isDuplicate) {
          continue; // Salta alla prossima iterazione senza aggiungere
        }
        // ------------------------------

        if (s.isRest) {
          const alldayStart = new Date(d.year, d.month, d.day, 12, 0, 0);
          const alldayEnd = new Date(d.year, d.month, d.day, 14, 0, 0);
          await Calendar.createEventAsync(targetCalendar.id, {
            title: 'Riposo',
            startDate: alldayStart,
            endDate: alldayEnd,
            allDay: true,
            notes: "Dati estratti: " + d.raw + " -> " + s.raw,
            timeZone: 'Europe/Rome',
          });
          savedCount++;
        } else {
          const startDate = new Date(d.year, d.month, d.day);
          startDate.setHours(s.startH, s.startM, 0, 0);

          let endDate = new Date(d.year, d.month, d.day);
          endDate.setHours(s.endH, s.endM, 0, 0);

          if (endDate <= startDate) {
             endDate.setDate(endDate.getDate() + 1); // Notturno
          }

          await Calendar.createEventAsync(targetCalendar.id, {
            title: 'Turno Lavoro',
            startDate: startDate,
            endDate: endDate,
            notes: "Dati estratti: " + d.raw + " -> " + s.raw,
            timeZone: 'Europe/Rome',
          });
          savedCount++;
        }
      }

      if (savedCount > 0) {
        Alert.alert(
          t('shiftSyncOkTitle'),
          `${savedCount} turni salvati nel calendario.`
        );
      } else {
        Alert.alert("Nessun orario trovato", `Errore estrazione. Date Trovate: ${dates.length}, Orari Trovati: ${shifts.length}. Assicurati di scansionare bene le colonne.`);
      }

    } catch (e: any) {
      console.error(e);
      Alert.alert(t('shiftCalErrTitle'), 'Non è stato possibile salvare: ' + e.message);
    }
  };

  const engineHtml = `
    <!DOCTYPE html>
    <html lang="it">
    <head>
      <!-- Tesseract.js (Foto OCR) -->
      <script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script>
    </head>
    <body style="background-color: transparent;">
      <script>
        window.runTesseract = async function(base64JsonStr) {
          try {
            const images = JSON.parse(base64JsonStr);
            let combinedText = '';
            for (let i = 0; i < images.length; i++) {
              const ret = await Tesseract.recognize(images[i], 'ita+eng');
              combinedText += ret.data.text + '\\n\\n';
            }
            window.ReactNativeWebView.postMessage(JSON.stringify({ success: true, text: combinedText }));
          } catch (e) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ success: false, error: e.message || e.toString() }));
          }
        };
      </script>
    </body>
    </html>
  `;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={styles.container}>
      <View style={styles.hiddenWebView}>
        <WebView 
          ref={webViewRef}
          source={{ html: engineHtml }}
          onMessage={handleWebViewMessage}
          javaScriptEnabled={true}
        />
      </View>

      {/* Page Header */}
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>{t('shiftTitle')}</Text>
        <Text style={styles.pageSub}>{t('shiftSub')}</Text>
      </View>

      <View style={styles.infoCard}>
        <View style={styles.infoTitleRow}>
          <MaterialIcons name="calendar-today" size={18} color={PRIMARY} />
          <Text style={styles.infoTitle}>{t('shiftSyncTitle')}</Text>
        </View>
        <Text style={styles.infoDesc}>
          Seleziona gli screenshot del tuo tabellone orari. Il sistema li leggerà per cercare e salvare automaticamente i voli nel calendario del tuo telefono.
        </Text>
      </View>

      <View style={styles.buttonsContainer}>
        <TouchableOpacity style={styles.button} onPress={pickImage}>
          <View style={styles.buttonInner}>
            <MaterialIcons name="photo-camera" size={18} color="#fff" />
            <Text style={styles.buttonText}>{t('shiftScanBtn')}</Text>
          </View>
        </TouchableOpacity>
      </View>
      
      {imageList.length > 0 && (
        <View style={styles.imagesPreview}>
          {imageList.map((uri, index) => (
             <Image key={index} source={{ uri }} style={styles.image} />
          ))}
        </View>
      )}
      
      {processing && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={PRIMARY} />
          <Text style={styles.loadingText}>{t('shiftExtracting')}</Text>
        </View>
      )}

      {ocrText ? (
        <View style={styles.resultContainer}>
          <Text style={styles.resultTitle}>{t('shiftExtractedTitle')}</Text>
          <Text style={styles.resultText}>{ocrText}</Text>
          
          <TouchableOpacity style={styles.saveButton} onPress={parseAndSaveShifts}>
            <View style={styles.buttonInner}>
              <MaterialIcons name="check-circle" size={18} color="#fff" />
              <Text style={styles.saveButtonText}>{t('shiftSyncBtn')}</Text>
            </View>
          </TouchableOpacity>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: BG,
    paddingBottom: 32,
  },
  hiddenWebView: { height: 1, width: 1, opacity: 0, position: 'absolute', top: -100 },
  pageHeader: {
    backgroundColor: '#fff',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  pageTitle: { fontSize: 24, fontWeight: 'bold', color: DARK_ORANGE },
  pageSub: { fontSize: 13, color: '#6B7280', marginTop: 4 },
  infoCard: {
    backgroundColor: '#fff',
    margin: 16, marginBottom: 0,
    padding: 16, borderRadius: 14,
    borderLeftWidth: 4, borderLeftColor: PRIMARY,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  infoTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  infoTitle: { fontWeight: 'bold', fontSize: 15, color: PRIMARY },
  infoDesc: { fontSize: 13, color: '#6B7280', lineHeight: 20 },
  buttonsContainer: { margin: 16, marginBottom: 0 },
  button: {
    backgroundColor: DARK_ORANGE,
    padding: 16, borderRadius: 14,
    alignItems: 'center',
    shadowColor: DARK_ORANGE, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  imagesPreview: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', margin: 16, gap: 10 },
  image: { width: '45%', height: 140, resizeMode: 'cover', borderRadius: 10, borderWidth: 1, borderColor: '#E5E7EB' },
  loadingContainer: { marginTop: 24, alignItems: 'center' },
  loadingText: { marginTop: 10, color: '#6B7280', fontWeight: '500' },
  resultContainer: {
    margin: 16, padding: 16,
    backgroundColor: '#fff', borderRadius: 14,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  resultTitle: { fontSize: 15, fontWeight: 'bold', color: DARK_ORANGE, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: '#E5E7EB', paddingBottom: 8 },
  resultText: { fontSize: 13, color: '#374151', lineHeight: 20, marginBottom: 16 },
  saveButton: {
    backgroundColor: PRIMARY,
    padding: 15, borderRadius: 12, alignItems: 'center',
    shadowColor: PRIMARY, shadowOpacity: 0.3, shadowRadius: 6, elevation: 4,
  },
  saveButtonText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
});

