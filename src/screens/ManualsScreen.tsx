import React, { useState, useMemo, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  LayoutAnimation, Platform, TextInput, Modal, Alert, KeyboardAvoidingView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppTheme, type ThemeColors } from '../context/ThemeContext';
import { enableLegacyAndroidLayoutAnimation } from '../utils/layoutAnimation';

const STORAGE_KEY = 'manuals_data_v2';

const AIRLINE_COLORS = [
  { color: '#FF6600', textColor: '#fff' },
  { color: '#C01380', textColor: '#fff' },
  { color: '#003580', textColor: '#fff' },
  { color: '#F7C800', textColor: '#1a1a1a' },
  { color: '#006DBF', textColor: '#fff' },
  { color: '#2E7D32', textColor: '#fff' },
  { color: '#B71C1C', textColor: '#fff' },
  { color: '#4A148C', textColor: '#fff' },
  { color: '#E65100', textColor: '#fff' },
  { color: '#37474F', textColor: '#fff' },
];

enableLegacyAndroidLayoutAnimation();

// ─── Types ───────────────────────────────────────────────────────────────────
type ManualItem = { title: string; body: string };
type Section    = { title: string; items: ManualItem[] };
type DCSCommand = { cmd: string; desc: string; category: string };
type Airline    = { id: string; name: string; code: string; color: string; textColor: string; sections: Section[]; commands?: DCSCommand[] };

type ModalState =
  | { kind: 'none' }
  | { kind: 'airline_add' }
  | { kind: 'airline_edit'; airlineId: string }
  | { kind: 'section_add'; airlineId: string }
  | { kind: 'section_edit'; airlineId: string; sectionIdx: number }
  | { kind: 'item_add'; airlineId: string; sectionIdx: number }
  | { kind: 'item_edit'; airlineId: string; sectionIdx: number; itemIdx: number };

// ─── Data ────────────────────────────────────────────────────────────────────
const DEFAULT_AIRLINES: Airline[] = [
  {
    id: 'easyjet', name: 'easyJet', code: 'EZY',
    color: '#FF6600', textColor: '#fff',
    commands: [
      { cmd: 'L', desc: 'Lista voli del giorno', category: 'Flight Ops' },
      { cmd: 'OF/[volo]', desc: 'Apri volo per check-in', category: 'Flight Ops' },
      { cmd: 'CF/[volo]', desc: 'Chiudi volo', category: 'Flight Ops' },
      { cmd: 'LOF', desc: 'Lista voli aperti', category: 'Flight Ops' },
      { cmd: 'GC/[gate]', desc: 'Cambia gate', category: 'Flight Ops' },
      { cmd: 'F[cognome]/[nome]', desc: 'Cerca passeggero per nome', category: 'Search' },
      { cmd: '.[booking ref]', desc: 'Cerca per codice prenotazione', category: 'Search' },
      { cmd: 'C[n]', desc: 'Check-in passeggero linea n', category: 'Check-in' },
      { cmd: 'C[n]-[m]', desc: 'Check-in gruppo (linee n-m)', category: 'Check-in' },
      { cmd: 'AB[n]', desc: 'Aggiungi bagaglio a passeggero', category: 'Baggage' },
      { cmd: '.DSP[n]', desc: 'Mostra/cambia seat plan', category: 'Seating' },
      { cmd: '.SS/[volo]/[s1]-[s2]', desc: 'Seat swap', category: 'Seating' },
      { cmd: '.SAG[volo]', desc: 'Lista Seat at Gate', category: 'Seating' },
      { cmd: 'DSP1', desc: 'Seat plan per SAG customer 1', category: 'Seating' },
      { cmd: '.COM[n]', desc: 'Visualizza commenti booking', category: 'Customer' },
      { cmd: 'COM[n]', desc: 'Aggiungi commento a booking', category: 'Customer' },
      { cmd: 'TM[n]', desc: 'Cambia titolo a Male', category: 'Customer' },
      { cmd: 'TF[n]', desc: 'Cambia titolo a Female', category: 'Customer' },
      { cmd: 'J[n]', desc: 'Cambia titolo a Child', category: 'Customer' },
      { cmd: 'EX', desc: 'Esci / logout', category: 'System' },
    ],
    sections: [
      {
        title: 'Check-in DCS',
        items: [
          {
            title: 'Apertura volo',
            body: 'Accedere al DCS (opzione 16). Digitare `L` per lista voli.\n\nPer aprire il volo: `OF/[numero volo]` e confermare con Y.\n\nImpostare boarding card e bag tag su A (auto).\nInserire gate, orario boarding e capacità.\n\nVerificare:\n• Numero volo e data corretti\n• Rotta e gate assegnati\n• Segmenti collegati (connessioni)\n• Restrizioni eventuali sul volo',
          },
          {
            title: 'Check-in passeggeri',
            body: 'Cercare passeggero: `F[cognome]/[nome]` oppure `.[booking ref]`.\n\nCheck-in: `C[n]` per singolo, `C[n]-[m]` per gruppo.\n\nRichiedere documento d\'identità valido.\n\nDocumenti accettati (UE):\n• Carta d\'identità\n• Passaporto\n\nVerificare: validità, nome uguale al biglietto, destinazione.\n\nAssegnare posto con `.DSP[n]`.',
          },
          {
            title: 'Bagaglio a mano',
            body: 'Misure max bagaglio cabina:\n• Standard: 56×45×25 cm (inclusa impugnatura e ruote)\n• Borsa aggiuntiva: 45×36×20 cm\n\nSe eccede → addebitare hold baggage fee.\nSe il volo è pieno → imbarchare gratis in stiva.',
          },
          {
            title: 'Overbooking',
            body: 'Procedura overbooking:\n1. Verificare numero di passeggeri in eccesso\n2. Cercare volontari (offrire voucher + volo alternativo)\n3. Se nessun volontario → denied boarding involontario\n\nAggiungere commento al booking con `COM[n]` selezionando il motivo appropriato.\n\nRegolamento EU 261/2004:\n• Voli ≤1.500 km → €250\n• Voli 1.500–3.500 km → €400\n• Voli >3.500 km → €600\n\nOltre a rimborso o volo alternativo.',
          },
        ],
      },
      {
        title: 'Gate e Imbarco',
        items: [
          {
            title: 'Apertura gate',
            body: 'Prima di aprire il gate:\n• Attivare gate nel sistema DCS\n• Per cambiare gate: `GC/[numero gate]`\n• Verificare lista SPEQ comunicata al capo cabina\n• Controllare info gate board\n• Comunicare ritardi se presenti\n\nPer lista SAG: `.SAG[numero volo]`',
          },
          {
            title: 'Sequenza boarding',
            body: 'Ordine imbarco easyJet:\n1. Passeggeri speciali (WCHR, WCHC, famiglie con bambini <5 anni)\n2. easyJet Plus + posti Upfront & Extra Legroom\n3. Tutti gli altri passeggeri\n\nVerificare sempre boarding pass + documento.\n\nPer seat swap operativo: `.SS/[volo]/[posto1]-[posto2]`',
          },
          {
            title: 'Chiusura volo',
            body: 'Procedura chiusura:\n1. Scansione ultimi passeggeri (T-15 min)\n2. Riconciliare no-show nel DCS\n3. Last-minute changes comunicati al capo volo\n4. Invio load sheet definitiva\n5. Chiusura volo: `CF/[numero volo]`\n6. Comunicare al gate supervisore\n\nPer verificare voli aperti: `LOF`',
          },
        ],
      },
      {
        title: 'Passeggeri Speciali',
        items: [
          {
            title: 'Codici WCHR / WCHC / WCHS',
            body: 'WCHR → può camminare, ha difficoltà sulle scale.\nWCHC → non può camminare, necessita assistenza totale.\nWCHS → non può fare scale (usa pontile o bus).\n\nSempre:\n• Pre-imbarcare\n• Notificare capo cabina e handling\n• Verificare posto (non uscita emergenza)',
          },
          {
            title: 'UM – Unaccompanied Minor',
            body: 'Minori non accompagnati (5–14 anni):\n• Servizio UM obbligatorio\n• Modulo UM compilato da genitore/tutore\n• Accettare solo con form completo\n• Notificare capo cabina\n• Contatti ritirante a destinazione\n• Non lasciare mai il minore da solo',
          },
          {
            title: 'MEDA – Passeggero Medico',
            body: 'Passeggero con condizione medica rilevante:\n• Richiede MEDA clearance pre-volo\n• MEDA form compilato dal medico curante\n• Eventuale accompagnatore medico (MEDA + 1)\n• Comunicare al Comandante\n• Equipaggiamento medico a bordo verificato',
          },
          {
            title: 'Documenti di viaggio',
            body: 'Verificare sempre:\n• Validità documento (min. 3 mesi oltre la data di rientro per alcuni paesi)\n• Visto se necessario (TIMATIC nel DCS)\n• Per viaggi extra-Schengen: passaporto obbligatorio\n• APIS: inserire dati documento nel sistema se richiesto dalla rotta',
          },
        ],
      },
      {
        title: 'Tariffe Aeroportuali',
        items: [
          {
            title: 'Bagaglio irregolare al gate',
            body: 'Bagaglio cabina fuori misura o non conforme al gate: €58.\n\nViene imbarcato in stiva.\n\nMisure consentite:\n• Standard: 45×36×20 cm\n• Grande (Plus/Up Front/Extra Legroom): 56×45×25 cm',
          },
          {
            title: 'Bagaglio da aggiungere',
            body: 'Bagaglio stiva da aggiungere in aeroporto: €65.\n\nBagaglio stiva 23kg prenotato online: da €11.99 (varia per rotta/periodo).',
          },
          {
            title: 'Sovrappeso bagaglio',
            body: 'Bagaglio che supera il peso acquistato:\n• €15 per ogni kg in eccesso\n• Peso massimo consentito: 32kg\n\nPesare sempre il bagaglio e addebitare la differenza.',
          },
        ],
      },
    ],
  },
  {
    id: 'wizzair', name: 'Wizz Air', code: 'W6',
    color: '#C01380', textColor: '#fff',
    sections: [
      {
        title: 'Check-in DCS',
        items: [
          {
            title: 'Apertura check-in',
            body: 'Accedere al sistema DCS Wizz Air con credenziali personali.\n\nSelezionare il volo → verificare rotta, data e orario → avviare check-in.\n\nCheck-in online disponibile da 30 giorni a 3 ore prima del volo.',
          },
          {
            title: 'Documenti accettati',
            body: 'Per TUTTI i voli:\n• Passaporto valido\n\nVoli intra-Schengen (paesi selezionati):\n• Carta d\'identità\n\nVerificare sempre validità e destinazione tramite TIMATIC.',
          },
          {
            title: 'WIZZ Priority',
            body: 'Passeggeri WIZZ Priority:\n• Corsia dedicata al check-in\n• Imbarco prioritario\n• Bagaglio cabina grande (40×30×20 cm + borsa)\n• Verificare tariffa Priority sulla prenotazione o Wizz+ membership\n\nSenza Priority: solo borsa piccola 40×30×20 cm.',
          },
        ],
      },
      {
        title: 'Bagaglio',
        items: [
          {
            title: 'Politica bagagli',
            body: 'Bagaglio incluso in tutti i biglietti:\n• 1 borsa piccola 40×30×20 cm (sotto sedile) – GRATIS\n\nA pagamento (prenotato online o al banco):\n• Bagaglio cabina grande 55×40×23 cm\n\nBagaglio stiva disponibile: 10 kg / 20 kg / 26 kg / 32 kg\nVerificare la prenotazione nel DCS.',
          },
          {
            title: 'Eccesso bagaglio al banco',
            body: 'Se il bagaglio non è prenotato o supera i limiti:\n1. Verificare nel DCS la prenotazione bagagli\n2. Addebitare la tariffa airport fee (superiore al prezzo online)\n3. Registrare il pagamento nel sistema\n4. Emettere ricevuta\n5. Attaccare tag bagaglio correttamente',
          },
        ],
      },
      {
        title: 'Gate e Imbarco',
        items: [
          {
            title: 'Sequenza boarding',
            body: 'Ordine imbarco Wizz Air:\n1. Passeggeri speciali + WCHR + famiglie con bambini piccoli\n2. WIZZ Priority\n3. Tutti gli altri\n\nVerificare boarding pass (app o cartaceo) + documento d\'identità ad ogni imbarco.',
          },
          {
            title: 'Chiusura volo',
            body: 'Procedura chiusura volo:\n1. Scansione ultimi passeggeri\n2. Riconciliare no-show nel sistema\n3. Bags reconcile (bagagli senza passeggero → scaricare)\n4. Trasmettere dati finali al vettore\n5. Chiudere gate nel DCS\n6. Notificare supervisore',
          },
        ],
      },
      {
        title: 'Tariffe Aeroportuali',
        items: [
          {
            title: 'Check-in aeroportuale',
            body: 'Check-in al banco aeroporto: €40 a passeggero.\n\nIl passeggero deve aver fatto check-in online (da 30 giorni a 3h prima). Se non l\'ha fatto, addebitare la tariffa.',
          },
          {
            title: 'Bagaglio irregolare al gate',
            body: 'Bagaglio cabina fuori misura o non conforme al gate: €58.\n\nViene imbarcato in stiva.\n\nMisure consentite senza Priority: 40×30×20 cm.\nCon WIZZ Priority: 55×40×23 cm inclusa.',
          },
          {
            title: 'Bagaglio da aggiungere',
            body: 'Bagaglio stiva da aggiungere in aeroporto: €65.\n\nBagaglio stiva disponibile online: 10kg / 20kg / 26kg / 32kg.\nVerificare sempre la prenotazione nel DCS.',
          },
          {
            title: 'Sovrappeso bagaglio',
            body: 'Bagaglio che supera il peso acquistato:\n• €15 per ogni kg in eccesso\n\nPesare sempre il bagaglio e addebitare la differenza.',
          },
        ],
      },
    ],
  },
  {
    id: 'ryanair', name: 'Ryanair', code: 'FR',
    color: '#003580', textColor: '#fff',
    sections: [
      {
        title: 'Check-in DCS',
        items: [
          {
            title: 'Check-in online obbligatorio',
            body: 'Ryanair richiede check-in online obbligatorio (2–30 giorni prima).\n\nAl banco: solo per casi speciali (SPEQ, documenti da verificare, bagagli).\n\nVerificare boarding pass su app Ryanair o PDF stampato.',
          },
          {
            title: 'Priority Boarding',
            body: 'Passeggeri con Priority:\n• Boarding prioritario\n• Bagaglio cabina grande 55×40×20 cm incluso\n• Verificare tariffa (Regular Plus, Family Plus) o Ryanair+ membership\n\nSenza Priority:\n• Solo borsa 40×20×25 cm (sotto sedile) – GRATIS\n• Bagaglio cabina non incluso',
          },
          {
            title: 'Gestione bagagli non-Priority',
            body: 'Se passeggero senza Priority porta bagaglio grande:\n• Al gate: imbarcare in stiva GRATIS (se volo non pieno)\n• Addebitare tariffa se supera i limiti\n\nAl banco check-in:\n• Addebitare bagaglio cabina se non incluso nel biglietto\n• Registrare nel DCS e emettere ricevuta',
          },
        ],
      },
      {
        title: 'Gate Operations',
        items: [
          {
            title: 'Scan boarding pass',
            body: 'Scansione boarding pass:\n• App Ryanair (QR code)\n• PDF stampato (con QR code leggibile)\n\nIn caso di errore lettura:\n1. Verificare volo e data\n2. Controllare documento d\'identità\n3. Verificare manualmente nel DCS\n4. Contattare supervisore se necessario',
          },
          {
            title: 'Eccesso bagaglio al gate',
            body: 'Al gate – bagaglio fuori misura:\n1. Misurare con il gauge\n2. Addebitare gate fee (tariffa più alta)\n3. Imbarcare in stiva\n4. Emettere ricevuta\n\nNote: il gate fee è significativamente più alto della tariffa online.',
          },
          {
            title: 'Chiusura e DEP',
            body: 'Chiusura volo Ryanair:\n• Chiudere scansione 15 min prima della partenza\n• Riconciliare no-show\n• Bags off per no-show (sicurezza)\n• Trasmettere DEP (Departure Message)\n• Comunicare via radio/telefono al supervisore operativo',
          },
        ],
      },
    ],
  },
  {
    id: 'vueling', name: 'Vueling', code: 'VY',
    color: '#F7C800', textColor: '#1a1a1a',
    sections: [
      {
        title: 'Check-in Amadeus Altéa',
        items: [
          {
            title: 'Apertura volo',
            body: 'DCS Vueling – Amadeus Altéa DCS:\n\nLogin → selezionare volo → verificare rotta e data → aprire check-in.\n\nVerificare eventuali restrizioni operative sul volo.',
          },
          {
            title: 'Tariffe e bagagli',
            body: 'Tariffa Basic:\n• 1 borsa 40×20×30 cm (gratis, sotto sedile)\n\nTariffa Optima / TimeFlex:\n• Bagaglio cabina 55×35×25 cm incluso\n• Possibile bagaglio stiva incluso\n\nVerificare sempre la tariffa nella prenotazione.',
          },
          {
            title: 'Documenti e TIMATIC',
            body: 'Consultare TIMATIC in Altéa per requisiti documenti.\n\nVoli intra-UE: carta d\'identità o passaporto.\nVoli extra-UE: passaporto + eventuale visto.\n\nVerificare validità documento rispetto alla data di rientro.',
          },
        ],
      },
      {
        title: 'Imbarco',
        items: [
          {
            title: 'Sequenza imbarco',
            body: 'Ordine imbarco Vueling:\n1. Passeggeri speciali\n2. Vueling Club Platinum / Gold\n3. Biglietti Excellence\n4. Tutti gli altri\n\nAnnuncio imbarco via interfono o display gate.',
          },
          {
            title: 'Chiusura e APIS',
            body: 'Chiusura volo:\n1. Scansione passeggeri completata\n2. Riconciliare no-show in Altéa\n3. Trasmissione APIS se rotta lo richiede\n4. Load sheet definitiva approvata\n5. Chiusura volo nel sistema',
          },
        ],
      },
    ],
  },
];

// ─── Inline command highlighting ──────────────────────────────────────────────
const CMD_REGEX = /(`[^`]+`)/g;

function RichBodyText({ text, colors }: { text: string; colors: any }) {
  const parts = text.split(CMD_REGEX);
  return (
    <Text style={{ fontSize: 13, color: colors.textSub, lineHeight: 20 }}>
      {parts.map((part, i) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          const cmd = part.slice(1, -1);
          return (
            <Text
              key={i}
              style={{
                fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
                fontSize: 12,
                fontWeight: '700',
                color: '#93C5FD',
                backgroundColor: '#1E3A5F',
                paddingHorizontal: 5,
                borderRadius: 4,
              }}
            >
              {cmd}
            </Text>
          );
        }
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
}

// ─── Commands Tab component ──────────────────────────────────────────────────
function CommandsTab({ commands, colors }: { commands: DCSCommand[]; colors: any }) {
  const [search, setSearch] = useState('');
  const lower = search.toLowerCase();
  const filtered = lower
    ? commands.filter(c => c.cmd.toLowerCase().includes(lower) || c.desc.toLowerCase().includes(lower))
    : commands;

  const categories = [...new Set(filtered.map(c => c.category))];

  return (
    <View style={{ flex: 1 }}>
      <View style={{
        backgroundColor: colors.card, borderRadius: 8, marginBottom: 12,
        borderWidth: 1, borderColor: colors.border,
        flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10,
      }}>
        <MaterialIcons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={{
            flex: 1, paddingVertical: 9, paddingHorizontal: 8,
            fontSize: 13, color: colors.text,
            fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
          }}
          placeholder="Cerca comando..."
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel="Chiudi / Close" accessible>
            <MaterialIcons name="close" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {categories.map(cat => (
        <View key={cat} style={{ marginBottom: 12 }}>
          <View style={{
            borderLeftWidth: 3, borderLeftColor: colors.primary,
            paddingLeft: 8, marginBottom: 6,
          }}>
            <Text style={{
              fontSize: 10, fontWeight: '700', color: colors.textMuted,
              letterSpacing: 1.2, textTransform: 'uppercase',
            }}>
              {cat}
            </Text>
          </View>
          {filtered.filter(c => c.category === cat).map((c, i) => (
            <View key={i} style={{
              backgroundColor: colors.card, borderRadius: 8,
              borderWidth: 1, borderColor: colors.border,
              paddingHorizontal: 12, paddingVertical: 9, marginBottom: 4,
              flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <Text style={{
                fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
                fontSize: 14, fontWeight: '700', color: '#93C5FD',
              }}>
                {c.cmd.split(/(\[[^\]]+\])/).map((part, j) =>
                  part.startsWith('[') ? (
                    <Text key={j} style={{ color: '#F59E0B' }}>{part}</Text>
                  ) : (
                    <Text key={j}>{part}</Text>
                  )
                )}
              </Text>
              <Text style={{ fontSize: 12, color: colors.text, flexShrink: 1, textAlign: 'right', marginLeft: 12 }}>
                {c.desc}
              </Text>
            </View>
          ))}
        </View>
      ))}

      {filtered.length === 0 && (
        <Text style={{ textAlign: 'center', marginTop: 30, color: colors.textMuted, fontSize: 13 }}>
          Nessun comando trovato
        </Text>
      )}
    </View>
  );
}

// ─── Item component ───────────────────────────────────────────────────────────
function makeItemStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrapper: {
      backgroundColor: c.card,
      borderRadius: 10,
      marginBottom: 6,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: c.border,
    },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      padding: 13,
    },
    title: { fontSize: 13, fontWeight: '600', color: c.text, flex: 1 },
    body: {
      paddingHorizontal: 14, paddingBottom: 14, paddingTop: 2,
      borderTopWidth: 1, borderTopColor: c.cardSecondary,
    },
    bodyText: {
      fontSize: 13, color: c.textSub, lineHeight: 20,
    },
  });
}

function ManualItemRow({
  item, itemIdx, sectionIdx, airlineId, editMode, onEdit,
}: {
  item: ManualItem;
  itemIdx: number;
  sectionIdx: number;
  airlineId: string;
  editMode: boolean;
  onEdit: () => void;
}) {
  const { colors } = useAppTheme();
  const itemStyles = useMemo(() => makeItemStyles(colors), [colors]);
  const [open, setOpen] = useState(false);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen(v => !v);
  };

  return (
    <View style={itemStyles.wrapper}>
      <TouchableOpacity style={itemStyles.header} onPress={toggle} activeOpacity={0.7}>
        <MaterialIcons
          name={open ? 'expand-less' : 'expand-more'}
          size={20}
          color={colors.textSub}
        />
        <Text style={itemStyles.title}>{item.title}</Text>
        {editMode && (
          <TouchableOpacity onPress={onEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="edit" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
      {open && (
        <View style={itemStyles.body}>
          <RichBodyText text={item.body} colors={colors} />
        </View>
      )}
    </View>
  );
}

// ─── Section component ────────────────────────────────────────────────────────
function makeSectionStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrapper: {
      marginBottom: 12,
    },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 10, paddingHorizontal: 4,
      borderBottomWidth: 1, borderBottomColor: c.border,
      marginBottom: 8,
    },
    title: { fontSize: 12, fontWeight: '700', color: c.textSub, letterSpacing: 0.8 },
    body:  { paddingLeft: 0 },
  });
}

function SectionBlock({
  section, sectionIdx, airlineId, editMode, onEdit, onAddItem, onEditItem,
}: {
  section: Section;
  sectionIdx: number;
  airlineId: string;
  editMode: boolean;
  onEdit: () => void;
  onAddItem: () => void;
  onEditItem: (itemIdx: number) => void;
}) {
  const { colors } = useAppTheme();
  const sectionStyles = useMemo(() => makeSectionStyles(colors), [colors]);
  const [open, setOpen] = useState(true);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen(v => !v);
  };

  return (
    <View style={sectionStyles.wrapper}>
      <TouchableOpacity style={sectionStyles.header} onPress={toggle} activeOpacity={0.8}>
        <Text style={sectionStyles.title}>{section.title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {editMode && (
            <TouchableOpacity onPress={onEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="edit" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          <MaterialIcons name={open ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={20} color={colors.textSub} />
        </View>
      </TouchableOpacity>
      {open && (
        <View style={sectionStyles.body}>
          {section.items.map((item, i) => (
            <ManualItemRow
              key={i}
              item={item}
              itemIdx={i}
              sectionIdx={sectionIdx}
              airlineId={airlineId}
              editMode={editMode}
              onEdit={() => onEditItem(i)}
            />
          ))}
          {editMode && (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 4 }}
              onPress={onAddItem}
            >
              <MaterialIcons name="add" size={14} color={colors.textSub} />
              <Text style={{ fontSize: 12, color: colors.textSub }}>Aggiungi voce</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  scrollContent: { flexGrow: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36, maxHeight: '92%' },
  title: { fontSize: 17, fontWeight: '700', marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 4, marginTop: 12 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  inputMulti: { minHeight: 100, paddingTop: 9 },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  colorDot: { width: 28, height: 28, borderRadius: 14 },
  colorDotSelected: { borderWidth: 3, borderColor: '#000', transform: [{ scale: 1.2 }] },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 20 },
  btn: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 8 },
  btnCancel: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#ccc' },
  btnSave: {},
  btnDanger: { marginRight: 'auto', backgroundColor: '#FEE2E2' },
  btnText: { fontSize: 14, fontWeight: '600' },
  btnDangerText: { fontSize: 14, fontWeight: '600', color: '#DC2626' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: 16, paddingVertical: 13,
      backgroundColor: c.card,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    headerTitle: { fontSize: 17, fontWeight: '700', color: c.primaryDark },
    airlineBar: {
      backgroundColor: c.card,
      borderBottomWidth: 1, borderBottomColor: c.border,
      maxHeight: 62,
    },
    airlineBarContent: {
      paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    },
    airlineChip: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 14, paddingVertical: 7,
      borderRadius: 20, borderWidth: 1.5, borderColor: c.border,
      backgroundColor: c.card,
    },
    airlineCode: { fontSize: 11, fontWeight: '800', color: c.textSub },
    airlineName: { fontSize: 12, fontWeight: '600', color: c.textSub },
    content:    { flex: 1 },
    contentPad: { padding: 14, paddingBottom: 80 },
    banner: {
      borderRadius: 14, padding: 18, marginBottom: 18,
    },
    bannerCode: { fontSize: 28, fontWeight: '900', letterSpacing: 1 },
    bannerName: { fontSize: 15, fontWeight: '600', marginTop: 2 },
    bannerSub:  { fontSize: 12, marginTop: 4 },
    addBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingVertical: 10, paddingHorizontal: 12,
      borderWidth: 1, borderStyle: 'dashed', borderRadius: 8,
      marginBottom: 8,
    },
    addBtnText: { fontSize: 13, fontWeight: '600' },
  });
}

function AirlineModal({
  modal, airlines, persist, closeModal,
}: {
  modal: ModalState;
  airlines: Airline[];
  persist: (a: Airline[]) => void;
  closeModal: () => void;
}) {
  const { colors } = useAppTheme();
  const isEdit = modal.kind === 'airline_edit';
  const existing = isEdit ? airlines.find(a => a.id === (modal as any).airlineId) : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [code, setCode] = useState(existing?.code ?? '');
  const [colorIdx, setColorIdx] = useState(() => {
    if (!existing) return 0;
    const idx = AIRLINE_COLORS.findIndex(c => c.color === existing.color);
    return idx >= 0 ? idx : 0;
  });

  const visible = modal.kind === 'airline_add' || modal.kind === 'airline_edit';

  const save = () => {
    if (!name.trim() || !code.trim()) return;
    const chosen = AIRLINE_COLORS[colorIdx] ?? AIRLINE_COLORS[0];
    if (isEdit) {
      const updated = airlines.map(a =>
        a.id === (modal as any).airlineId
          ? { ...a, name: name.trim(), code: code.trim().toUpperCase(), color: chosen.color, textColor: chosen.textColor }
          : a
      );
      persist(updated);
    } else {
      const newAirline: Airline = {
        id: Date.now().toString(),
        name: name.trim(),
        code: code.trim().toUpperCase(),
        color: chosen.color,
        textColor: chosen.textColor,
        sections: [],
      };
      persist([...airlines, newAirline]);
    }
    closeModal();
  };

  const del = () => {
    Alert.alert(
      'Elimina compagnia',
      `Eliminare "${existing?.name}" e tutti i suoi contenuti?`,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Elimina', style: 'destructive',
          onPress: () => {
            persist(airlines.filter(a => a.id !== (modal as any).airlineId));
            closeModal();
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={closeModal}>
      <KeyboardAvoidingView
        style={modalStyles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
      >
        <ScrollView contentContainerStyle={modalStyles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={[modalStyles.sheet, { backgroundColor: colors.card === 'transparent' ? colors.bg : colors.card }]}>
          <Text style={[modalStyles.title, { color: colors.text }]}>
            {isEdit ? 'Modifica compagnia' : 'Nuova compagnia'}
          </Text>
          <Text style={[modalStyles.label, { color: colors.textSub }]}>Nome</Text>
          <TextInput
            style={[modalStyles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
            value={name} onChangeText={setName} placeholder="es. easyJet"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={[modalStyles.label, { color: colors.textSub }]}>Codice IATA</Text>
          <TextInput
            style={[modalStyles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
            value={code} onChangeText={setCode} placeholder="es. EZY"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters" maxLength={3}
          />
          <Text style={[modalStyles.label, { color: colors.textSub }]}>Colore</Text>
          <View style={modalStyles.colorRow}>
            {AIRLINE_COLORS.map((c, i) => (
              <TouchableOpacity
                key={i}
                style={[modalStyles.colorDot, { backgroundColor: c.color },
                  colorIdx === i && modalStyles.colorDotSelected]}
                onPress={() => setColorIdx(i)}
              />
            ))}
          </View>
          <View style={modalStyles.btnRow}>
            {isEdit && (
              <TouchableOpacity style={[modalStyles.btn, modalStyles.btnDanger]} onPress={del}>
                <Text style={modalStyles.btnDangerText}>Elimina</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[modalStyles.btn, modalStyles.btnCancel]} onPress={closeModal}>
              <Text style={[modalStyles.btnText, { color: colors.textSub }]}>Annulla</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[modalStyles.btn, modalStyles.btnSave, { backgroundColor: colors.primary }]} onPress={save}>
              <Text style={[modalStyles.btnText, { color: '#fff' }]}>Salva</Text>
            </TouchableOpacity>
          </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SectionModal({
  modal, airlines, persist, closeModal,
}: {
  modal: ModalState;
  airlines: Airline[];
  persist: (a: Airline[]) => void;
  closeModal: () => void;
}) {
  const { colors } = useAppTheme();
  const isEdit = modal.kind === 'section_edit';
  const airlineId = (modal as any).airlineId as string | undefined;
  const sectionIdx = (modal as any).sectionIdx as number | undefined;
  const existingTitle = isEdit && airlineId !== undefined && sectionIdx !== undefined
    ? airlines.find(a => a.id === airlineId)?.sections[sectionIdx]?.title ?? ''
    : '';

  const [title, setTitle] = useState(existingTitle);
  const visible = modal.kind === 'section_add' || modal.kind === 'section_edit';

  const save = () => {
    if (!title.trim() || !airlineId) return;
    const updated = airlines.map(a => {
      if (a.id !== airlineId) return a;
      if (isEdit && sectionIdx !== undefined) {
        const sections = a.sections.map((s, i) =>
          i === sectionIdx ? { ...s, title: title.trim() } : s
        );
        return { ...a, sections };
      } else {
        return { ...a, sections: [...a.sections, { title: title.trim(), items: [] }] };
      }
    });
    persist(updated);
    closeModal();
  };

  const del = () => {
    const airline = airlines.find(a => a.id === airlineId);
    const sectionTitle = sectionIdx !== undefined ? airline?.sections[sectionIdx]?.title : '';
    Alert.alert(
      'Elimina sezione',
      `Eliminare la sezione "${sectionTitle}" e tutte le sue voci?`,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Elimina', style: 'destructive',
          onPress: () => {
            const updated = airlines.map(a => {
              if (a.id !== airlineId) return a;
              return { ...a, sections: a.sections.filter((_, i) => i !== sectionIdx) };
            });
            persist(updated);
            closeModal();
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={closeModal}>
      <KeyboardAvoidingView
        style={modalStyles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
      >
        <ScrollView contentContainerStyle={modalStyles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={[modalStyles.sheet, { backgroundColor: colors.card === 'transparent' ? colors.bg : colors.card }]}>
          <Text style={[modalStyles.title, { color: colors.text }]}>
            {isEdit ? 'Modifica sezione' : 'Nuova sezione'}
          </Text>
          <Text style={[modalStyles.label, { color: colors.textSub }]}>Titolo</Text>
          <TextInput
            style={[modalStyles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
            value={title} onChangeText={setTitle} placeholder="es. Check-in DCS"
            placeholderTextColor={colors.textMuted}
          />
          <View style={modalStyles.btnRow}>
            {isEdit && (
              <TouchableOpacity style={[modalStyles.btn, modalStyles.btnDanger]} onPress={del}>
                <Text style={modalStyles.btnDangerText}>Elimina</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[modalStyles.btn, modalStyles.btnCancel]} onPress={closeModal}>
              <Text style={[modalStyles.btnText, { color: colors.textSub }]}>Annulla</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[modalStyles.btn, modalStyles.btnSave, { backgroundColor: colors.primary }]} onPress={save}>
              <Text style={[modalStyles.btnText, { color: '#fff' }]}>Salva</Text>
            </TouchableOpacity>
          </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ItemModal({
  modal, airlines, persist, closeModal,
}: {
  modal: ModalState;
  airlines: Airline[];
  persist: (a: Airline[]) => void;
  closeModal: () => void;
}) {
  const { colors } = useAppTheme();
  const isEdit = modal.kind === 'item_edit';
  const airlineId = (modal as any).airlineId as string | undefined;
  const sectionIdx = (modal as any).sectionIdx as number | undefined;
  const itemIdx = (modal as any).itemIdx as number | undefined;

  const existing = isEdit && airlineId && sectionIdx !== undefined && itemIdx !== undefined
    ? airlines.find(a => a.id === airlineId)?.sections[sectionIdx]?.items[itemIdx]
    : undefined;

  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const visible = modal.kind === 'item_add' || modal.kind === 'item_edit';

  const save = () => {
    if (!title.trim() || !airlineId || sectionIdx === undefined) return;
    const updated = airlines.map(a => {
      if (a.id !== airlineId) return a;
      const sections = a.sections.map((s, si) => {
        if (si !== sectionIdx) return s;
        if (isEdit && itemIdx !== undefined) {
          const items = s.items.map((it, ii) =>
            ii === itemIdx ? { title: title.trim(), body: body.trim() } : it
          );
          return { ...s, items };
        } else {
          return { ...s, items: [...s.items, { title: title.trim(), body: body.trim() }] };
        }
      });
      return { ...a, sections };
    });
    persist(updated);
    closeModal();
  };

  const del = () => {
    Alert.alert(
      'Elimina voce',
      `Eliminare "${existing?.title}"?`,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Elimina', style: 'destructive',
          onPress: () => {
            const updated = airlines.map(a => {
              if (a.id !== airlineId) return a;
              const sections = a.sections.map((s, si) => {
                if (si !== sectionIdx) return s;
                return { ...s, items: s.items.filter((_, ii) => ii !== itemIdx) };
              });
              return { ...a, sections };
            });
            persist(updated);
            closeModal();
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={closeModal}>
      <KeyboardAvoidingView
        style={modalStyles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
      >
        <ScrollView contentContainerStyle={modalStyles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={[modalStyles.sheet, { backgroundColor: colors.card === 'transparent' ? colors.bg : colors.card }]}>
          <Text style={[modalStyles.title, { color: colors.text }]}>
            {isEdit ? 'Modifica voce' : 'Nuova voce'}
          </Text>
          <Text style={[modalStyles.label, { color: colors.textSub }]}>Titolo</Text>
          <TextInput
            style={[modalStyles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
            value={title} onChangeText={setTitle} placeholder="es. Apertura volo"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={[modalStyles.label, { color: colors.textSub }]}>Contenuto</Text>
          <TextInput
            style={[modalStyles.input, modalStyles.inputMulti, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
            value={body} onChangeText={setBody} placeholder="Procedura..."
            placeholderTextColor={colors.textMuted}
            multiline numberOfLines={5} textAlignVertical="top"
          />
          <View style={modalStyles.btnRow}>
            {isEdit && (
              <TouchableOpacity style={[modalStyles.btn, modalStyles.btnDanger]} onPress={del}>
                <Text style={modalStyles.btnDangerText}>Elimina</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[modalStyles.btn, modalStyles.btnCancel]} onPress={closeModal}>
              <Text style={[modalStyles.btnText, { color: colors.textSub }]}>Annulla</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[modalStyles.btn, modalStyles.btnSave, { backgroundColor: colors.primary }]} onPress={save}>
              <Text style={[modalStyles.btnText, { color: '#fff' }]}>Salva</Text>
            </TouchableOpacity>
          </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function ManualsScreen() {
  const { colors } = useAppTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [airlines, setAirlines] = useState<Airline[]>(DEFAULT_AIRLINES);
  const [selectedAirline, setSelectedAirline] = useState(DEFAULT_AIRLINES[0].id);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (raw) {
        try {
          const parsed: Airline[] = JSON.parse(raw);
          if (parsed.length > 0) {
            setAirlines(parsed);
            setSelectedAirline(parsed[0].id);
          }
        } catch {
          AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_AIRLINES));
        }
      } else {
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_AIRLINES));
      }
    });
  }, []);

  const persist = (updated: Airline[]) => {
    setAirlines(updated);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const [editMode, setEditMode] = useState(false);
  const [activeTab, setActiveTab] = useState<'guides' | 'commands'>('guides');
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const closeModal = () => setModal({ kind: 'none' });

  const airline = airlines.find(a => a.id === selectedAirline) ?? airlines[0];

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <MaterialIcons name="menu-book" size={22} color={colors.primary} />
        <Text style={s.headerTitle}>Manuali DCS</Text>
        <TouchableOpacity onPress={() => setEditMode(v => !v)} style={{ marginLeft: 'auto' }}>
          <MaterialIcons
            name="edit"
            size={20}
            color={editMode ? colors.primary : colors.textMuted}
          />
        </TouchableOpacity>
      </View>

      {/* Airline selector */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.airlineBar}
        contentContainerStyle={s.airlineBarContent}
      >
        {airlines.map(a => {
          const active = a.id === selectedAirline;
          return (
            <TouchableOpacity
              key={a.id}
              style={[
                s.airlineChip,
                active && { backgroundColor: a.color, borderColor: a.color },
              ]}
              onPress={() => { setSelectedAirline(a.id); setActiveTab('guides'); }}
              onLongPress={editMode ? () => setModal({ kind: 'airline_edit', airlineId: a.id }) : undefined}
              activeOpacity={0.8}
            >
              <Text style={[s.airlineCode, active && { color: a.textColor }]}>
                {a.code}
              </Text>
              <Text style={[s.airlineName, active && { color: a.textColor }]}>
                {a.name}
              </Text>
            </TouchableOpacity>
          );
        })}
        {editMode && (
          <TouchableOpacity
            style={[s.airlineChip, { borderStyle: 'dashed' }]}
            onPress={() => setModal({ kind: 'airline_add' })}
            activeOpacity={0.8}
          >
            <MaterialIcons name="add" size={16} color={colors.textSub} />
            <Text style={s.airlineName}>Aggiungi</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Content */}
      <ScrollView
        style={s.content}
        contentContainerStyle={s.contentPad}
        showsVerticalScrollIndicator={false}
      >
        {/* Airline banner */}
        <View style={[s.banner, { backgroundColor: airline.color }]}>
          <Text style={[s.bannerCode, { color: airline.textColor }]}>{airline.code}</Text>
          <Text style={[s.bannerName, { color: airline.textColor, opacity: 0.85 }]}>{airline.name}</Text>
          <Text style={[s.bannerSub, { color: airline.textColor, opacity: 0.7 }]}>
            {airline.sections.length} sezioni · {airline.sections.reduce((n, s) => n + s.items.length, 0)} argomenti
            {airline.commands ? ` · ${airline.commands.length} comandi` : ''}
          </Text>
        </View>

        {/* Tab bar (only if airline has commands) */}
        {airline.commands && airline.commands.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: 14 }}>
            {(['guides', 'commands'] as const).map(tab => (
              <TouchableOpacity
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={{
                  paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8,
                  backgroundColor: activeTab === tab ? colors.primary : 'transparent',
                  borderWidth: activeTab === tab ? 0 : 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{
                  fontSize: 12, fontWeight: activeTab === tab ? '700' : '600',
                  color: activeTab === tab ? '#fff' : colors.textSub,
                }}>
                  {tab === 'guides' ? 'Guide' : 'Comandi'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Content based on active tab */}
        {activeTab === 'commands' && airline.commands && airline.commands.length > 0 ? (
          <CommandsTab commands={airline.commands} colors={colors} />
        ) : (
          <>
            {/* Sections */}
            {airline.sections.map((section, i) => (
              <SectionBlock
                key={i}
                section={section}
                sectionIdx={i}
                airlineId={airline.id}
                editMode={editMode}
                onEdit={() => setModal({ kind: 'section_edit', airlineId: airline.id, sectionIdx: i })}
                onAddItem={() => setModal({ kind: 'item_add', airlineId: airline.id, sectionIdx: i })}
                onEditItem={(itemIdx) => setModal({ kind: 'item_edit', airlineId: airline.id, sectionIdx: i, itemIdx })}
              />
            ))}
            {editMode && (
              <TouchableOpacity
                style={[s.addBtn, { borderColor: colors.border }]}
                onPress={() => setModal({ kind: 'section_add', airlineId: airline.id })}
              >
                <MaterialIcons name="add" size={16} color={colors.textSub} />
                <Text style={[s.addBtnText, { color: colors.textSub }]}>Aggiungi sezione</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>

      {(modal.kind === 'airline_add' || modal.kind === 'airline_edit') && (
        <AirlineModal modal={modal} airlines={airlines} persist={persist} closeModal={closeModal} />
      )}
      {(modal.kind === 'section_add' || modal.kind === 'section_edit') && (
        <SectionModal modal={modal} airlines={airlines} persist={persist} closeModal={closeModal} />
      )}
      {(modal.kind === 'item_add' || modal.kind === 'item_edit') && (
        <ItemModal modal={modal} airlines={airlines} persist={persist} closeModal={closeModal} />
      )}
    </View>
  );
}
