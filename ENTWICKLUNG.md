# Reversi – Entwicklungsdokumentation

Stand: Juli 2026. Reine Vanilla-Web-App ohne Framework, ohne Build-Schritt,
ohne Abhängigkeiten. Alle Dateien sind statisch auslieferbar.

## Projektstruktur

```
claude-reversi/
├── index.html            Oberfläche: Menü, Spielbrett, Spielende-Dialog, Toast
├── style.css             Layout, Themes/Paletten, Animationen (responsiv)
├── engine.js             Spielregeln und KI – reine Logik, kein DOM (ES-Modul)
├── ai-worker.js          Modul-Worker: rechnet die Zugsuche im Hintergrund
├── app.js                Zustand, DOM und Zeitsteuerung
├── tests/                Testlauf im Browser (test.html), ohne Build-Schritt
├── sw.js                 Service Worker (Offline-Cache der App-Shell)
├── manifest.webmanifest  PWA-Manifest (Android-Installation)
├── icons/                App-Icons 192/512 px (generiert, s. u.)
├── README.md             Kurzüberblick und Installationsanleitung
├── SPIELEIGENSCHAFTEN.md Funktionsumfang aus Nutzersicht
└── ENTWICKLUNG.md        diese Datei
```

## Architektur

Drei Schichten, drei Dateien. `engine.js` kennt weder `window` noch `document`
und wird von `app.js`, `ai-worker.js` und den Tests importiert.

### 1. Spiellogik (`engine.js`, pur, ohne DOM)

- Brett = `Uint8Array(64)`; Werte: `0` leer, `1` Schwarz/Spieler 1, `2` Weiß/Spieler 2.
  Index = `zeile * 8 + spalte`.
- `flipsFor(board, idx, p)` – Kernfunktion: liefert alle Steine, die ein Zug
  umdrehen würde (leeres Array = illegaler Zug). Läuft die 8 Richtungen ab.
- `legalMoves`, `countMoves`, `hasFlip`, `hasLegalMove`, `applyMove` (arbeitet
  auf einer Kopie), `countDiscs`, `initialBoard`.
- `zugrechtNach(board, current)` – Pass- und Ende-Regel als reine Funktion.
- Alle Funktionen sind frei von Seiteneffekten → direkt testbar, auch von
  der KI wiederverwendet.

### 2. KI

- **Negamax mit Alpha-Beta-Schnitt** (`search`), make/unmake auf einem einzigen
  Arbeitsbrett. Passen wird im Baum korrekt behandelt (Zugrecht wechselt ohne
  Tiefenverbrauch); können beide Seiten nicht ziehen, zählt der exakte Endstand
  (`finalScore`, hoch skaliert, damit er jede Heuristik dominiert).
- **Transpositionstabelle** mit Zobrist-Schlüssel (64 Bit als zwei 32-Bit-
  Hälften, zweite Hälfte als Kollisionsprüfung). Der gespeicherte Bestzug
  sortiert innere Knoten vor.
- **Iterative Vertiefung** in `bestMove`: Tiefe 1, 2, 3 … bis zur Zieltiefe der
  Stufe, Bestzug der Vorrunde zuerst. Kein Zeitbudget — die Stufen sollen auf
  jedem Gerät gleich stark spielen.
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

### 3. UI-Steuerung (`app.js`)

- Ein zentrales `state`-Objekt (Brett, Zugrecht, Modus, Stufe, Historie,
  Palette …). Das DOM wird in `render()` komplett aus dem Zustand abgeleitet.
- `advanceTurn()` ist die einzige Stelle, die Spielerwechsel, Passen und
  Spielende entscheidet – danach ggf. `scheduleAI()`.
- `scheduleAI()` schickt Brett, Zugrecht und Stufe an `ai-worker.js` und wartet
  auf die Antwort; eine Mindestverzögerung hält Computerzüge optisch
  nachvollziehbar. `state.session` (Zähler) entwertet veraltete Antworten und
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
- `sw.js`: **Network-first** für die eigenen Dateien, der Cache ist
  Offline-Rückfall. Nachgecacht wird nur, was in `SHELL` steht.
  **Bei jeder Änderung an ausgelieferten Dateien die `CACHE`-Konstante
  hochzählen** (`reversi-v3`, `-v4` …), sonst sehen installierte Apps die alte
  Version.
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

im Projektordner starten, dann `http://localhost:8173` öffnen. Testlauf:
`http://localhost:8173/tests/test.html`.

Da die Spiellogik DOM-frei ist, lassen sich KI-Partien direkt in der
Browser-Konsole simulieren – seit dem Umbau auf Module über einen
dynamischen Import, z. B. Stufe 3 gegen Stufe 2:

```js
const { initialBoard, bestMove, applyMove, countDiscs, opponent, BLACK } =
  await import('./engine.js');

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

## Umsetzung des Code-Reviews (August 2026)

Grundlage: `CODEREVIEW.md`. Ein Abschnitt je Arbeitsschritt, in der dort
empfohlenen Reihenfolge.

### 04.08.2026 — B1: `flipsFor`/`hasFlip` über vorberechnete Strahlen

**Geändert.** `RAYS[feld][richtung]` (vorberechnete Feldindizes bis zum Rand)
ersetzt die Zeilen-/Spaltenrechnung samt Randprüfung im innersten Kern.
Neu: `hasFlip` (Ja/Nein, bricht beim ersten Treffer ab, ohne Allokation) und
`countMoves`; `evaluate` und `hasLegalMove` nutzen sie statt `legalMoves(...).length`.

**Geprüft.** `bestMove` Stufe 4 über fünf feste Stellungen: 1356 ms → 356 ms
(3,8×). `evaluate` 18,0 → 5,1 µs/Aufruf. Demo-Partie Experte gegen Experte
15,4 s → 6,2 s. Verhaltensgleichheit über 11 gesäte Partien (alle
Stufenpaarungen, 682 Züge) Zug für Zug identisch zum Stand davor.

**Nebenbefund.** Der Review führte die Kosten allein auf die Zuglisten-
Allokation zurück; das war nur ein Viertel der Ersparnis (1356 → 1017 ms).
Der Hauptposten war die Richtungsschleife mit Randprüfung.

### 05.08.2026 — A1/C2: Suche im Worker, Logik in `engine.js`, `CONFIG`

**Geändert.** `app.js` war eine Datei mit drei Schichten; die unteren beiden
liegen jetzt in `engine.js` (Regeln + KI, ES-Modul, kein DOM). `ai-worker.js`
importiert daraus `bestMove` und beantwortet Nachrichten der Form
`{board, p, level, session}`. `app.js` behält Zustand, DOM und Zeitsteuerung
und wird als `type="module"` geladen.

- **Warum zwei Dateien statt einer `ai.js`:** Die Logik brauchen drei Seiten
  (Oberfläche, Worker, Tests). Ein klassisches Worker-Skript ist nicht
  importierbar, ein Modul-Worker schon.
- **Rückfall:** Lässt sich kein Modul-Worker erzeugen oder scheitert das Laden,
  setzt `app.js` `workerDefekt` und rechnet wie bisher im Hauptthread. Die App
  bleibt in jedem Browser spielbar.
- **Abbruch:** `sessionEntwerten()` erhöht `state.session` **und** beendet einen
  gerade rechnenden Worker. Ohne das würde der nächste Zug nach „Neustart"
  hinter einer laufenden Experten-Rechnung warten.
- **Mindestdauer bleibt.** Sie hält Computerzüge lesbar (Demo!) und blockiert
  jetzt nichts mehr, weil die Rechnung daneben läuft.
- **`zugrechtNach(board, current)`** ist neu in `engine.js`: Pass- und
  Ende-Regel als reine Funktion. `advanceTurn` ruft sie nur noch auf.
- **`CONFIG`** bündelt alle Zahlen der KI (C2). `CORNERS` entfällt, die
  Eckfelder werden aus den Gewichten abgeleitet.
- `sw.js`: `CACHE` auf `reversi-v3`, `engine.js` und `ai-worker.js` in `ASSETS`.

**Geprüft.** Vergleichsstand vor dem Umbau gegen den neuen, mit gesätem
Zufallsgenerator: 120 Stellungen × Stufen 2/3/4 = **360 Vergleiche, 0
Abweichungen**; 11 Partien über alle Stufenpaarungen, **658 Züge Zug für Zug
identisch**. Laufzeit unverändert (Stufe 4 über alle Stellungen 5221 → 4905 ms,
Messstreuung). Zusätzlich Ladeprobe der Seite: 64 Zellen im DOM, keine
Konsolenfehler.

### 05.08.2026 — C1: Tests im Browser, ohne node

**Geändert.** Neu `tests/` mit eigenem Läufer (`lauf.js`, Aufbau aus
`claude-wegpunkte` übernommen) und drei Testdateien:

| Datei              | Umfang | Inhalt                                              |
| ------------------ | -----: | --------------------------------------------------- |
| `regeln.test.js`   |     42 | Startstellung, `flipsFor` in acht Richtungen, Zeilengrenze, `applyMove`, Pass-/Ende-Regel |
| `ki.test.js`       |     19 | `CONFIG`, `evaluate`, `finalScore`, `search`, `bestMove`, ganze Partie |
| `worker.test.js`   |      3 | Der Modul-Worker lädt, antwortet und reicht die Sitzungsnummer zurück |

**Aufruf.** `py -m http.server 8173` im Projektordner, dann
`http://localhost:8173/tests/test.html`. Die Seite meldet oben
„alle 64 Tests bestanden" oder listet die Fehlschläge.

**Stolperstein Service Worker.** `test.html` meldet einen registrierten Service
Worker vor den Modul-Importen ab und leert die Caches, sonst testet man den
alten Stand. Derselbe Grund, aus dem `CACHE` in `sw.js` bei jeder Änderung
hochgezählt werden muss.

**Automatisierung.** Kommandozeilen-Browser beenden sich beim `load`-Ereignis –
also mitten in den asynchronen Worker-Tests. Deshalb schickt
`tests/test.html?melde=<pfad>` das Ergebnis zusätzlich per POST an diesen Pfad;
ein Server, der darauf hört, kann den Lauf ohne Fenster auswerten. Ohne den
Parameter ändert sich nichts.

**Geprüft.** 64/64 grün.

### 05.08.2026 — A2/C3: Tastatur, Screenreader, Service Worker

**Geändert (A2).**

- `#board` ist `role="grid"`, darunter acht `role="row"` (per
  `display: contents` unsichtbar fürs Layout), darin `role="gridcell"`.
- Jedes Feld trägt eine Beschriftung wie „D4, leer", „C3, Schwarz, möglicher
  Zug", „E6, Rot, letzter Zug" — `render()` schreibt sie mit, sie folgt also
  auch der Farbpalette.
- Tastatur: Pfeiltasten bewegen, Pos1/Ende an den Zeilenrand, Enter oder
  Leertaste setzt. Roving Tabindex — genau ein Feld ist über Tab erreichbar,
  ein Klick zieht den Fokus mit. Sichtbarer Fokusrahmen über `:focus-visible`.
- Neue versteckte Live-Region `#ansage`: nach jedem Zug „Schwarz 12, Weiß 8.
  Weiß am Zug." Auch nach „Zug zurück" und am Spielende.
- `user-scalable=no` ist raus (Zoomsperre ist eine Barriere), dafür
  `touch-action: manipulation` gegen die Doppeltipp-Verzögerung.

**Geändert (C3).** `sw.js` ist network-first; der Cache dient nur noch als
Offline-Rückfall. `skipWaiting()`/`clients.claim()` hängen jetzt in den
`waitUntil`-Ketten statt daneben. Nachgecacht wird ausschließlich, was in
`SHELL` steht — sonst landet der Testlauf unter `tests/` im App-Cache.
`CACHE` auf `reversi-v4`.

**Geprüft.** Testlauf 64/64 grün. Ladeprobe der Seite: 64 `role="gridcell"`,
8 `role="row"`, Live-Region vorhanden, keine Konsolenfehler.

**Von Hand nachzuprüfen** (geht nur im echten Browser): Tab bis ins Brett,
mit den Pfeiltasten wandern, mit Leertaste setzen; Zoomen mit zwei Fingern auf
dem Handy; und nach einem Neuladen, dass der neue Service Worker greift.

### 05.08.2026 — B2/B3/B4: make/unmake, iterative Vertiefung, Transpositionstabelle

**Geändert.**

- **B2** – `search` arbeitet über `doMove`/`undoMove` auf einem einzigen
  Arbeitsbrett statt auf einer Kopie je Knoten und stellt es vor der Rückkehr
  wieder her. `bestMove` legt einmal je Zug eine Arbeitskopie an, das
  übergebene Brett bleibt unberührt. Die Oberfläche nutzt für ihre Historie
  weiter `applyMove`.
- **B3** – `bestMove` vertieft iterativ (Tiefe 1, 2, 3 … bis zur Zieltiefe der
  Stufe) und zieht den Bestzug der Vorrunde nach vorn. **Ohne Zeitbudget:**
  Eine nach Wanduhr bemessene Tiefe machte die Spielstärke geräteabhängig und
  jede Gegenprobe unmöglich; die Zieltiefen je Stufe bleiben unverändert.
- **B4** – Transpositionstabelle mit Zobrist-Hashing. Der Schlüssel ist 64 Bit
  breit, geführt als zwei 32-Bit-Hälften: Die `Map` schlägt über die erste
  nach, die zweite prüft den Treffer gegen. Ein einzelner 32-Bit-Schlüssel
  hätte bei hunderttausenden Knoten regelmäßig Kollisionen — und eine
  Kollision liefert still eine falsche Bewertung. Gespeichert werden Tiefe,
  Wert, Schrankenart und Bestzug; der Bestzug sortiert auch innere Knoten.

**Gelernte Lektion: die Tabelle darf nicht über Suchen hinweg stehen bleiben.**
In der ersten Fassung lieferte `search` je nach Vorgeschichte statt des exakten
Wertes eine Schranke — 5 von 120 Werten wichen ab, einer um 380 Punkte. Ein
Aufruf von außen (ohne Hash-Argumente) leert die Tabelle jetzt; innerhalb der
Rekursion und über die Vertiefungsrunden hinweg bleibt sie stehen.

**Gemessen (120 gesäte Stellungen).** Iterative Vertiefung **allein** war
langsamer als die feste Tiefe (Stufe 3: 272 → 485 ms, Stufe 4: 4650 → 7008 ms).
Die Gewichtssortierung ist bei Reversi so gut, dass die zusätzliche Ordnung an
der Wurzel den Aufwand der Vorrunden nicht hereinholt. Erst zusammen mit der
Tabelle, über die der Bestzug auch innere Knoten sortiert, trägt sie:

| Messung                             | vorher  | nachher | Faktor |
| ----------------------------------- | ------: | ------: | -----: |
| `search` Tiefe 6, 120 Stellungen    | 3056 ms | 2690 ms |  1,14× |
| Stufe 2 (Tiefe 2), 120 Züge         |   19 ms |   27 ms |  0,71× |
| Stufe 3 (Tiefe 4), 120 Züge         |  288 ms |  335 ms |  0,86× |
| Stufe 4 (Tiefe 6), 120 Züge         | 4595 ms | 3330 ms |  1,38× |
| Stufe 4, fünf feste Stellungen      |  207 ms |  120 ms |  1,72× |

Dass die flachen Stufen leicht verlieren, bleibt so: 0,07 ms (Stufe 2) bzw.
0,4 ms (Stufe 3) je Zug gegen 350 ms Mindestanzeigedauer.

**Gleichheit belegt.** `search(b, p, d, -∞, +∞)` über 120 Stellungen × Tiefen
2/4/6 = 360 Werte, **alle exakt gleich** zur Fassung davor, Brett danach jedes
Mal unverändert. Von 360 Zugentscheidungen weichen 11 ab; für jede wurde der
Wert beider Züge mit der alten exakten Suche nachgerechnet — **11 von 11 exakt
gleichwertig, 0 schlechter.** Es sind ausschließlich anders aufgelöste
Gleichstände. Testlauf 67/67 grün, darunter neu eine Gegenrechnung von `search`
gegen ein schlichtes Negamax ohne Alpha-Beta und ohne Tabelle.

**Offen gelassen.** Stufe „Experte" braucht jetzt im Mittel 28 ms je Zug, eine
Tiefe mehr wäre also bezahlbar. Das ist aber eine Entscheidung über die
Spielstärke und keine Aufräumarbeit — die Zieltiefen bleiben unverändert.

## Ideen für später

- Online-Mehrspieler (braucht einen kleinen Server, z. B. WebSocket-Relay)
- Soundeffekte und Vibration (`navigator.vibrate`) beim Zug
- Zughistorie/Notation (a1–h8) und Partie-Export
- Eröffnungsbuch für den Experten
