# Calendario turni stampabile - luglio 2026

## Obiettivo

Creare un PDF personale, leggibile e pronto per la stampa, ricavato dai quattro prospetti forniti dall'utente. Gli orari individuali non saranno salvati nel repository.

## Formato

- Una pagina A4 orizzontale.
- Griglia mensile con colonne da lunedi a domenica.
- Titolo: "Turni di Corrado Papucci - Luglio 2026".
- Numero del giorno ben visibile nell'angolo superiore di ogni cella.
- Orario centrato e sufficientemente grande per la stampa domestica.

## Stile

- Palette pastello leggera, adatta sia alla stampa a colori sia alla conversione in scala di grigi.
- Giorni lavorativi con fondo azzurro molto chiaro.
- Riposi con fondo verde chiaro e dicitura completa "RIPOSO".
- Giorni senza prospetto con fondo grigio chiaro e dicitura "Orario non disponibile", per non confonderli con i riposi.
- Weekend distinguibili tramite l'intestazione, senza ridurre il contrasto del testo.

## Dati

- Le fonti coprono 1-19 luglio e 22-28 luglio 2026.
- I giorni 20-21 e 29-31 luglio saranno esplicitamente indicati come non disponibili.
- Gli orari saranno normalizzati nel formato `HH:MM - HH:MM`.
- Ogni valore sarà verificato visivamente contro la riga del dipendente nei PDF originali.

## Verifica

- Renderizzare il PDF finale in PNG.
- Controllare che non vi siano testi tagliati, sovrapposizioni o celle illeggibili.
- Confrontare tutti i turni con le quattro fonti prima della consegna.
- Consegnare soltanto il PDF finale; i file temporanei resteranno esclusi da Git.
