# Esperimento locale: ETA dalla pagina FR24

Prototipo separato dalla versione Android. Legge **una sola tratta** dalla normale
pagina web, usando il testo delle celle visibili e i timestamp associati alle
stesse celle. Non usa chiavi API, endpoint privati, OCR o servizi AI.

## Verifica del 12 settembre 2026

La consultazione con Playwright CLI e Chrome sul PC ha aperto senza login:

- `https://www.flightradar24.com/data/airports/psa/arrivals`
- `https://www.flightradar24.com/data/flights/w45029#419febbe`

Entrambe mostravano W45029, Tirana → Pisa, del 12 settembre: STA **12:15**,
stato **Estimated 12:16**. La scheda esponeva nelle celle i timestamp
`1789208100` e `1789208169`, con offset `7200`. Questo dimostra la possibilità di
leggere l'orario visibile, non la sua accuratezza rispetto all'atterraggio reale
né l'affidabilità di una raccolta prolungata. Gold non è stato usato.

Una seconda consultazione puntuale, alle 13:48–13:50 italiane, ha verificato
FR6937 Lamezia Terme → Pisa, tratta `41a057b6`, del 12 settembre: STA **13:45**,
ETA **14:33**. Il tabellone mostrava `Estimated 14:33`, la scheda del volo
`Delayed 14:33`. La funzione `readVisibleFlightRows` del prototipo è stata
eseguita direttamente sulla pagina e il risultato salvato localmente.
Questa prova ha riprodotto e corretto un errore del lettore: ignorava l'ETA
quando preceduta da `Delayed`. Il caso ora ha un test di regressione; un
semplice stato `Delayed` senza orario continua a non produrre un'ETA.
Le immagini `live-fr6937-board.png` e `live-fr6937-detail.png` documentano
le due schermate; `live-fr6937-result.json` contiene il risultato normalizzato.

**Il servizio non è stato avviato:** il controllo automatico di approvazione
ha respinto il tentativo di avvio del processo con il solo motivo
`blocked by policy`. Nessun tentativo alternativo di avvio è stato effettuato.
La lettura periodica, il server HTTP e il collegamento all'app non sono quindi
stati verificati in esecuzione. Gli screenshot e le letture del browser sono
locali sotto `output/playwright/fr24-eta`, esclusi da Git.

## Comportamento implementato, da validare in esecuzione

- Configurazione obbligatoria: volo e data del servizio; destinazione predefinita
  PSA, identificativo della tratta facoltativo. Data del servizio = data della
  partenza usata dalla tabella FR24, anche quando l'arrivo è il giorno seguente.
- Browser Chrome con profilo dedicato sotto `tmp`, senza usare il profilo personale.
- Cinque letture per impostazione predefinita, distanziate di almeno 60 secondi.
  Massimo 30 letture. Il browser si chiude alla fine o al primo errore.
- Nessun tentativo di superare login, challenge o accessi negati. Nessuna
  installazione di servizi permanenti, rinnovo automatico o esposizione pubblica.
- Server limitato a `127.0.0.1:8794`; `/` è il riepilogo e `/api/eta` restituisce
  l'ultima osservazione. Consultare il riepilogo non genera richieste a FR24.
- `readAt` indica quando abbiamo letto la pagina; `sourceUpdatedAt` resta `null`.
  `lastChangedAt` indica quando abbiamo osservato un cambiamento, non quando FR24
  lo ha calcolato. Oltre 150 secondi la lettura è scaduta.
- Non promuove lo schedulato a ETA. Atterraggio, stima e schedulato rimangono
  distinti. Date/tratte ambigue e timestamp incoerenti producono un errore.

## Controlli locali

Il progetto ha dipendenze autonome, senza modificare Expo o il bundle Android.
I test del lettore si eseguono con `npm test` in questa cartella; non accedono a
FR24 e non richiedono un account. Coprono data e tratta, cambio di giorno,
offset invernale, orari stimati/effettivi, ambiguità e letture scadute.

Il recupero automatico dal sito è escluso dai [termini FR24, § 2.3](https://www.flightradar24.com/terms-of-service).
La fattibilità della lettura non costituisce autorizzazione da parte del servizio.
Non considerare questo prototipo una fonte operativa o un'integrazione pubblicata.
