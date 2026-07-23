# Reversi – Entwicklungsdokumentation

Stand: Juli 2026. Reine Vanilla-Web-App ohne Framework, ohne Build-Schritt,
ohne Abhängigkeiten. Alle Dateien sind statisch auslieferbar.

## Projektstruktur

```
claude-reversi/
├── index.html            Oberfläche: Menü, Spielbrett, Spielende-Dialog, Toast
├── style.css             Layout, Themes/Paletten, Animationen (responsiv)
├── app.js                Spielregeln, KI und UI-Steuerung (eine Datei, drei Abschnitte)
├── sw.js                 Service Worker (Offline-Cache der App-Shell)
├── manifest.webmanifest  PWA-Manifest (Android-Installation)
├── icons/                App-Icons 192/512 px (generiert, s. u.)
├── README.md             Kurzüberblick und Installationsanleitung
├── SPIELEIGENSCHAFTEN.md Funktionsumfang aus Nutzersicht
└── ENTWICKLUNG.md        diese Datei
```

## Architektur von `app.js`

Die Datei ist bewusst in drei unabhängige Schichten gegliedert:

### 1. Spiellogik (pur, ohne DOM)

- Brett = `Uint8Array(64)`; Werte: `0` leer, `1` Schwarz/Spieler 1, `2` Weiß/Spieler 2.
  Index = `zeile * 8 + spalte`.
- `flipsFor(board, idx, p)` – Kernfunktion: liefert alle Steine, die ein Zug
  umdrehen würde (leeres Array = illegaler Zug). Läuft die 8 Richtungen ab.
- `legalMoves`, `hasLegalMove`, `applyMove` (arbeitet auf einer Kopie),
  `countDiscs`, `initialBoard`.
- Alle Funktionen sind frei von Seiteneffekten → direkt testbar, auch von
  der KI wiederverwendet.

### 2. KI

- **Negamax mit Alpha-Beta-Schnitt** (`search`). Passen wird im Baum korrekt
  behandelt (Zugrecht wechselt ohne Tiefenverbrauch); können beide Seiten
  nicht ziehen, zählt der exakte Endstand (`finalScore`, hoch skaliert, damit
  er jede Heuristik dominiert).
- **Bewertung** (`evaluate`), aus Sicht des Ziehenden:
  - Feldgewichte (`WEIGHTS`): Ecken +120, Felder neben Ecken negativ
    (X-/C-Felder), klassische Othello-Matrix.
  - Eckenbonus ±100 und Mobilität `9 × (eigene Züge − gegnerische Züge)`.
  - Endspiel (≤ 10 leere Felder): Steindifferenz dominiert.
- **Stufen** (`LEVELS`): Suchtiefe 0 (Zufall) / 2 / 4 / 6. Ab `exact` leeren
  Feldern (0/6/10/13) wird stattdessen bis zum Spielende gerechnet →
  perfektes Endspiel. Experten-Züge dauern maximal ~0,5 s.
- **Zugsortierung** nach Feldgewicht verbessert die Schnittrate.

#### Gelernte Lektion: Zufall bei „gleich guten" Zügen

Die erste Version sammelte an der Wurzel alle Züge mit gleichem Suchwert und
wählte zufällig. Das ist bei Alpha-Beta **falsch**: Werte späterer Wurzelzüge,
die nur die Alpha-Schranke berühren, sind bloße Obergrenzen – der Zug kann
real schlechter sein. Folge: Stufe „Experte" verlor gegen „Mittel".
Korrektur in `bestMove`: Die Zugliste wird **vor** der Suche gemischt
(Fisher-Yates) und dann stabil nach Feldgewicht sortiert; gewählt wird nur
ein strikt bester Zug. Varianz bleibt erhalten, Korrektheit auch.

### 3. UI-Steuerung

- Ein zentrales `state`-Objekt (Brett, Zugrecht, Modus, Stufe, Historie,
  Palette …). Das DOM wird in `render()` komplett aus dem Zustand abgeleitet.
- `advanceTurn()` ist die einzige Stelle, die Spielerwechsel, Passen und
  Spielende entscheidet – danach ggf. `scheduleAI()`.
- `scheduleAI()` rechnet in einem `setTimeout`, damit der Browser erst die
  Anzeige („… denkt") zeichnet; eine Mindestverzögerung hält Computerzüge
  optisch nachvollziehbar. `state.session` (Zähler) entwertet veraltete
  Timer nach Neustart/Menüwechsel – wichtig gegen Geisterzüge.
- „Zug zurück" spult über Snapshots (`state.history`) zurück; gegen den
  Computer bis zum letzten menschlichen Zug.

## Farbpaletten

Zwei Paletten: **Schwarz/Weiß** (Standard) und **Rot/Blau**. Umsetzung:

- CSS-Variablen `--grad-p1`/`--grad-p2` tragen die Steinverläufe; die Klasse
  `palette-redblue` auf `<body>` belegt sie um. Spielsteine (`.disc`) und
  Anzeige-Steine (`.mini-disc`) nutzen ausschließlich diese Variablen.
- Die Paletten-Vorschau im Menü nutzt feste Klassen (`fix-black` …), damit
  sie sich nicht mit umschaltet.
- Texte („Schwarz ist am Zug" → „Rot ist am Zug") laufen über den Helfer
  `colorName()`; intern bleiben die Spieler immer `BLACK`/`WHITE`.
- Die Wahl wird in `localStorage` (`reversi-palette`) gespeichert und beim
  Start wiederhergestellt.

Weitere Paletten hinzufügen: Verläufe als `--grad-*` definieren, eine
`body.palette-<name>`-Regel ergänzen, Button im `#palette-group` eintragen
und `colorName()` erweitern.

## PWA

- `manifest.webmanifest`: Standalone-Anzeige, Portrait, Icons 192/512
  (inkl. `maskable`).
- `sw.js`: Cache-first für die App-Shell. **Bei jeder Änderung an
  ausgelieferten Dateien die `CACHE`-Konstante hochzählen** (`reversi-v2`,
  `-v3` …), sonst sehen installierte Apps die alte Version.
- Installation setzt HTTPS voraus (localhost ist ausgenommen).

## Icons

Die PNGs in `icons/` wurden mit einem Python-Skript ohne Abhängigkeiten
erzeugt (eigener PNG-Encoder über `zlib`/`struct`, zeichnet ein 4×4-Brett
mit den vier Startsteinen). Bei Bedarf neu generieren und Größen 192/512
ausgeben.

## Entwickeln und Testen

```
py -m http.server 8173
```

im Projektordner starten, dann `http://localhost:8173` öffnen.

Da die Spiellogik DOM-frei ist, lassen sich KI-Partien direkt in der
Browser-Konsole simulieren, z. B. Stufe 3 gegen Stufe 2:

```js
function playGame(lb, lw) {
  let b = initialBoard(), p = BLACK, passes = 0;
  while (passes < 2) {
    const m = bestMove(b, p, p === BLACK ? lb : lw);
    if (!m) { passes++; p = opponent(p); continue; }
    passes = 0;
    b = applyMove(b, m.idx, m.flips, p);
    p = opponent(p);
  }
  return countDiscs(b);
}
playGame(3, 2);
```

Damit wurde u. a. verifiziert: vollständige Partien auf allen Stufen
(60 Züge, 64 Steine), Stufenleiter (2 schlägt 1 mit 8/8, 3 schlägt 2 mit
5/6, 4 schlägt 2 mit 3/4) und die Zugzeiten.

## Ideen für später

- Online-Mehrspieler (braucht einen kleinen Server, z. B. WebSocket-Relay)
- Soundeffekte und Vibration (`navigator.vibrate`) beim Zug
- Zughistorie/Notation (a1–h8) und Partie-Export
- Web Worker für die KI, falls höhere Suchtiefen gewünscht sind
- Eröffnungsbuch für den Experten
