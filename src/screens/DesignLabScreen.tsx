import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppTheme } from '../context/ThemeContext';
import DesignDirectionPreview from '../dev/DesignDirectionPreview';
import { DESIGN_DIRECTIONS } from '../dev/designDirections';

export default function DesignLabScreen() {
  const { colors } = useAppTheme();
  const [selectedId, setSelectedId] = useState(DESIGN_DIRECTIONS[0].id);
  const selected = DESIGN_DIRECTIONS.find(item => item.id === selectedId) ?? DESIGN_DIRECTIONS[0];
  const styles = useMemo(() => makeStyles(colors.isDark), [colors.isDark]);

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={[styles.kicker, { color: colors.primary }]}>DEV ONLY</Text>
        <Text style={[styles.title, { color: colors.text }]}>Design Lab</Text>
        <Text style={[styles.copy, { color: colors.textSub }]}>
          Tre direzioni visuali per AeroStaff. Tocca una scheda e guarda subito come cambiano
          gerarchia, contrasto, card voli e footer.
        </Text>
      </View>

      <View style={styles.selectorRow}>
        {DESIGN_DIRECTIONS.map(direction => {
          const active = direction.id === selected.id;
          return (
            <TouchableOpacity
              key={direction.id}
              style={[
                styles.selector,
                {
                  borderColor: active ? direction.palette.primary : colors.border,
                  backgroundColor: active ? direction.palette.surfaceAlt : colors.card,
                },
              ]}
              activeOpacity={0.82}
              onPress={() => setSelectedId(direction.id)}
            >
              <MaterialIcons
                name={direction.icon}
                size={19}
                color={active ? direction.palette.primary : colors.textSub}
              />
              <Text style={[styles.selectorText, { color: active ? direction.palette.primary : colors.text }]}>
                {direction.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <DesignDirectionPreview direction={selected} />

      <View style={[styles.notesCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.notesTitle, { color: colors.text }]}>Perche provarla</Text>
        <Text style={[styles.notesMood, { color: colors.textSub }]}>{selected.mood}</Text>
        {selected.notes.map(note => (
          <View key={note} style={styles.noteRow}>
            <View style={[styles.noteDot, { backgroundColor: selected.palette.primary }]} />
            <Text style={[styles.noteText, { color: colors.textSub }]}>{note}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function makeStyles(isDark: boolean) {
  return StyleSheet.create({
    root: { flex: 1 },
    content: {
      padding: 18,
      paddingBottom: 110,
      gap: 18,
    },
    header: { gap: 6 },
    kicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1.8 },
    title: { fontSize: 34, fontWeight: '900', letterSpacing: -1 },
    copy: { fontSize: 14, lineHeight: 20 },
    selectorRow: { gap: 10 },
    selector: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderWidth: 1,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 13,
    },
    selectorText: { fontSize: 14, fontWeight: '900' },
    notesCard: {
      borderWidth: 1,
      borderRadius: 24,
      padding: 16,
      gap: 10,
      shadowColor: '#000',
      shadowOpacity: isDark ? 0.24 : 0.08,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 3,
    },
    notesTitle: { fontSize: 17, fontWeight: '900' },
    notesMood: { fontSize: 13, lineHeight: 19 },
    noteRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    noteDot: { width: 7, height: 7, borderRadius: 99 },
    noteText: { flex: 1, fontSize: 13, lineHeight: 18 },
  });
}
