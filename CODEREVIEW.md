# Code-Review: claude-reversi

Stand: 04.08.2026 · Umfang: `app.js` 525 Zeilen, `index.html`, `style.css`, `sw.js`

Das sauberste Projekt der Sammlung. Die Spiellogik ist knapp, korrekt und gut
kommentiert; `Uint8Array` als Brett, Negamax mit Alpha-Beta, Zugsortierung nach
Positionsgewichten, exaktes Endspiel ab einer Restfeldschwelle — das ist
handwerklich in Ordnung. Besonders gut gelöst:

- **`state.session`** (`:218, 383, 389, 394`) entwertet laufende KI-Timer nach
  Neustart oder Menürückkehr. Genau der Schutz, der `claude-skat` fehlt.
- Das Mischen **vor** der stabilen Gewichtssortierung (`:179-186`) mit der
  Begründung im Kommentar, warum nicht nachträglich unter gleichwertigen Zügen
  gelost wird — ein Detail, das viele Implementierungen falsch machen.
- `undo()` (`:400-425`) spult bei Mensch-gegen-Computer korrekt bis zum eigenen
  Zug zurück und stellt bei fehlendem eigenen Zug den Ausgangszustand her.

Es gibt entsprechend keine kritischen Befunde. Die folgenden Punkte sind
Verbesserungen, keine Reparaturen.

---

## A. Wichtig

### A1. Die KI blockiert den Hauptthread — ✅ erledigt 05.08.2026

> **Behoben.** Die reine Logik liegt jetzt in `engine.js` (ES-Modul, kein DOM),
> die Suche läuft in `ai-worker.js` als **Modul-Worker**; `app.js` ist auf
> Zustand, DOM und Zeitsteuerung zusammengeschrumpft (525 → 380 Zeilen) und wird
> als `type="module"` geladen. `sw.js`: `CACHE` auf `reversi-v3`, `engine.js`
> und `ai-worker.js` in `ASSETS`.
>
> **Abweichung 1 — zwei Dateien statt einer `ai.js`:** Die Logik wird an drei
> Stellen gebraucht (Oberfläche, Worker, Tests). Ein klassisches Worker-Skript
> lässt sich nicht importieren, deshalb die Trennung in `engine.js` (Modul, von
> allen dreien importiert) und `ai-worker.js` (nur Nachrichtenverarbeitung,
> 20 Zeilen).
>
> **Abweichung 2 — `minDelay` bleibt:** Punkt 4 wollte die ehrliche Denkzeit
> zeigen. Die Mindestdauer ist aber kein Kaschieren, sondern Absicht: In der
> Demo wären die Züge sonst nicht mitzulesen, und gegen den Computer wirkt eine
> Antwort nach 3 ms wie ein Aussetzer. Sie blockiert jetzt nichts mehr, weil sie
> neben der Rechnung läuft statt vor ihr.
>
> **Zusätzlich:** Fällt der Worker aus (kein Modul-Worker, Ladefehler), rechnet
> `app.js` im Hauptthread weiter — die App bleibt spielbar. `sessionEntwerten()`
> beendet einen rechnenden Worker bei Neustart/Menü, sonst wartet der nächste
> Zug hinter der alten Rechnung.
>
> **Gleichheit belegt:** 360 Vergleiche (120 gesäte Stellungen × Stufen 2/3/4)
> alt gegen neu **0 Abweichungen**, 11 gesäte Partien (658 Züge) Zug für Zug
> identisch, Laufzeit unverändert (Stufe 4: 5221 ms → 4905 ms über alle
> Stellungen, im Rahmen der Messstreuung). `tests/worker.test.js` prüft, dass
> der Worker lädt, antwortet und die Sitzungsnummer zurückreicht.

**Wo:** `scheduleAI` (`:388-397`) ruft `bestMove` (`:165-201`) synchron auf.

Auf Stufe 4 ("Experte") wird mit Tiefe 6 gesucht; im Endspiel ab 13 leeren
Feldern steigt die Tiefe auf `empty + 4`, also bis 17 Halbzüge — vollständig
ausgerechnet. Währenddessen friert die Oberfläche ein: Der Menü-Knopf reagiert
nicht, der Zugindikator kann nicht neu zeichnen, und auf einem langsameren Handy
wirkt die App abgestürzt. Der vorgeschaltete `setTimeout(…, 30)` (`:388`) sorgt
zwar dafür, dass "denkt" noch gezeichnet wird, hilft aber während der Rechnung
nicht.

**Anweisung:** Die Suche in einen Web Worker auslagern.
1. `ai.js` als Worker-Datei: enthält `EMPTY`…`DIRS`, `flipsFor`, `legalMoves`,
   `hasLegalMove`, `applyMove`, `countDiscs`, `WEIGHTS`, `evaluate`,
   `finalScore`, `search`, `LEVELS`, `bestMove`. Reine Logik, keine DOM-Zugriffe
   — die Trennung liegt im Code bereits sauber vor (`:1-201` gegen `:203-525`).
2. Kommunikation:
   ```js
   worker.postMessage({board: state.board, p: state.current,
                       level: state.level, session: state.session});
   worker.onmessage = e => {
     if (e.data.session !== state.session) return;   // vorhandenes Muster beibehalten
     state.busy = false;
     if (e.data.move) makeMove(e.data.move);
   };
   ```
   `Uint8Array` wird strukturiert kopiert, das passt ohne Umbau.
3. `sw.js:3-11` um `./ai.js` erweitern und `CACHE` auf `reversi-v3` erhöhen —
   sonst läuft der Worker offline ins Leere.
4. Nebeneffekt: Die Denkzeit lässt sich dann ehrlich anzeigen, statt sie mit
   `minDelay` (`:384`) künstlich zu glätten.

### A2. Das Brett ist mit der Tastatur nicht bedienbar

**Wo:** `buildBoard` (`:232-244`) erzeugt `<div class="cell">` mit Klick-Listener;
`index.html:79` hat nur ein `aria-label` am Container.

Für Tastaturnutzer und Screenreader ist das Spiel nicht zugänglich: keine
Fokussierbarkeit, keine Rollen, keine Feldbezeichnungen, keine Ansage des
Spielstands.

**Anweisung:**
1. Rollen und Beschriftung setzen:
   ```js
   cell.setAttribute('role', 'gridcell');
   cell.tabIndex = -1;                       // Roving Tabindex, aktives Feld bekommt 0
   cell.setAttribute('aria-label',
     `${'ABCDEFGH'[i & 7]}${(i >> 3) + 1}, ${v === EMPTY ? 'leer' : colorName(v)}`);
   ```
   Container: `role="grid"`, `aria-rowcount="8"`, `aria-colcount="8"`.
2. Pfeiltasten zum Bewegen, Leertaste/Enter zum Setzen — ein `keydown`-Listener
   am Container reicht.
3. Der bereits vorhandene `#toast` hat `role="status"` (`index.html:111`) — gut.
   Ergänzend den Spielstand nach jedem Zug in eine visuell versteckte
   `aria-live="polite"`-Region schreiben ("Schwarz 12, Weiß 8, Weiß am Zug").
4. `user-scalable=no` in `index.html:5` entfernen: Es unterbindet das Zoomen und
   ist eine bekannte Barriere für Menschen mit Sehbeeinträchtigung. Gegen
   Doppeltipp-Zoom hilft `touch-action: manipulation` im CSS, ohne die Einschränkung.

---

## B. Spielstärke und Leistung

### B1. `evaluate` erzeugt in jedem Blatt zwei Zuglisten — ✅ erledigt 04.08.2026

> **Umgesetzt:** `hasFlip` (Abbruch beim ersten Treffer, keine Allokation) und
> `countMoves` ergänzt; `evaluate` und `hasLegalMove` nutzen sie.
> **Diagnose des Reviews war unvollständig:** Nur die Zuglisten zu vermeiden
> brachte gemessen bloß 25 % (`bestMove` Stufe 4 über fünf feste Stellungen:
> 1356 ms → 1017 ms), nicht „ein Vielfaches". Der eigentliche Kostentreiber war
> die Richtungsschleife `for (const [dr, dc] of DIRS)` samt Randprüfung im
> innersten Kern. Mit vorberechneten Strahlen (`RAYS`) in `flipsFor`/`hasFlip`:
> 1356 ms → **356 ms (3,8×)**, `evaluate` 18,0 → 5,1 µs/Aufruf (3,5×),
> Demo-Partie Experte gegen Experte 15,4 s → 6,2 s.
> **Gleichheit belegt:** 11 gesäte Partien (alle Stufenpaarungen, 682 Züge)
> Zug für Zug identisch zum Stand vor der Änderung.

**Wo:** `:118-119`

```js
const myMob  = legalMoves(board, p).length;
const oppMob = legalMoves(board, opp).length;
```

`legalMoves` legt für jedes legale Feld ein Objekt mit einem `flips`-Array an —
in der Bewertungsfunktion wird davon nur die Anzahl gebraucht. Bei mehreren
zehntausend Blättern pro Zug ist das der mit Abstand teuerste Posten und der
Grund, warum Tiefe 6 spürbar dauert.

**Anweisung:** Eine Zählfunktion ohne Allokation:
```js
function countMoves(board, p) {
  let n = 0;
  for (let i = 0; i < 64; i++)
    if (board[i] === EMPTY && flipsFor(board, i, p).length) n++;
  return n;
}
```
Besser noch: `flipsFor` um eine Variante `hasFlip(board, idx, p)` ergänzen, die
beim ersten gefundenen Richtungstreffer `true` zurückgibt, statt alle acht
Richtungen zu Ende zu laufen und ein Array zu füllen. Erwartbar ein Vielfaches
an Geschwindigkeit — und damit eine Tiefe mehr bei gleicher Wartezeit.

### B2. `applyMove` kopiert das Brett in jedem Knoten

**Wo:** `:63-68`, aufgerufen in `search:147` und `bestMove:192`

64 Byte pro Knoten ist wenig, aber bei Hunderttausenden Knoten summiert es sich
und belastet die Speicherbereinigung.

**Anweisung:** In der Suche auf make/unmake umstellen — `flips` liegt ohnehin
vor, also lässt sich der Zug exakt zurücknehmen:
```js
function doMove(b, idx, flips, p){ b[idx] = p; for (const f of flips) b[f] = p; }
function undoMove(b, idx, flips, opp){ b[idx] = EMPTY; for (const f of flips) b[f] = opp; }
```
Nur in `search` ändern; `makeMove` in der Oberfläche (`:336-341`) braucht weiter
Momentaufnahmen für die Historie und bleibt wie es ist.

### B3. Feste Suchtiefe statt iterativer Vertiefung

**Wo:** `LEVELS` (`:157-162`)

Die Tiefe ist pro Stufe konstant, unabhängig davon, wie schnell das Gerät ist.
Auf einem schnellen Rechner bleibt Rechenleistung ungenutzt, auf einem langsamen
Handy wartet der Nutzer.

**Anweisung (nach A1, im Worker):** Iterative Vertiefung mit Zeitbudget —
Tiefe 1, 2, 3 … rechnen und den besten Zug der letzten vollständigen Iteration
behalten, bis `performance.now()` das Budget der Stufe überschreitet (z. B.
Leicht 0 ms/zufällig, Mittel 150 ms, Schwer 600 ms, Experte 2.000 ms). Nebeneffekt:
Die Zugsortierung kann den Bestzug der Vorrunde zuerst probieren, was die
Alpha-Beta-Schnitte deutlich verbessert.

### B4. Keine Transpositionstabelle

Dieselbe Stellung wird über verschiedene Zugreihenfolgen mehrfach bewertet.

**Anweisung:** Optional und erst nach B1–B3 sinnvoll. Zobrist-Hashing über die
64 Felder × 2 Farben, `Map` mit Tiefe und Schranke. Bringt bei Reversi typisch
Faktor 2–3. Nur angehen, wenn nach A1 noch Bedarf an Spielstärke besteht.

---

## C. Wartbarkeit

### C1. Keine Tests, obwohl die Logik dafür gemacht ist — ✅ erledigt 05.08.2026

> **Behoben.** `tests/test.html` mit eigenem, abhängigkeitsfreiem Läufer
> (`tests/lauf.js`, Aufbau aus `claude-wegpunkte` übernommen) lädt `engine.js`
> als Modul — kein Build, kein node. **64 Tests, alle grün.**
> Aufteilung: `regeln.test.js` (42), `ki.test.js` (19), `worker.test.js` (3).
>
> Alle im Review geforderten Fälle sind abgedeckt: Startstellung mit den vier
> Zügen 19/26/37/44, `flipsFor` in allen acht Richtungen je mit Treffer,
> Nicht-Treffer und direktem eigenen Nachbarn, drei Fälle gegen den Überlauf
> über die Zeilengrenze (Feld 8 nach links, Feld 15 nach rechts, Diagonale über
> die Ecke) samt Gegenprobe, Passsituation, beidseitiges Passen und
> `finalScore` aus Sicht beider Farben.
>
> **Abweichung — Passregel:** Der Review wollte `advanceTurn` testen, das steckt
> aber in der Oberfläche. Die Entscheidung ist deshalb als reine Funktion
> `zugrechtNach(board, current)` nach `engine.js` gewandert; `advanceTurn` ruft
> sie nur noch auf. Damit ist die Regel testbar, statt sie im Test nachzubauen.
>
> **Zusätzlich:** Antisymmetrie von `evaluate`, Spiegelsymmetrie der
> Gewichtstabelle, `search` bei Tiefe 0 gleich `evaluate`, Passen ohne
> Tiefenverbrauch, `bestMove` lässt das übergebene Brett unverändert, und eine
> durchgespielte Partie Mittel gegen Mittel.
>
> **Automatisierter Lauf:** `tests/test.html?melde=<pfad>` schickt das Ergebnis
> zusätzlich per POST dorthin — nötig, weil Kommandozeilen-Browser sich beim
> `load`-Ereignis beenden und damit mitten in den Worker-Tests. Ohne Parameter
> ändert sich nichts.

`flipsFor`, `legalMoves`, `applyMove`, `countDiscs`, `finalScore` und `evaluate`
sind reine Funktionen über einem `Uint8Array`. Nach A1 liegen sie ohnehin in
einer eigenen Datei.

**Anweisung:** `tests.html`, das `ai.js` als Modul lädt (kein Build-Schritt):
- Startstellung: `legalMoves(initialBoard(), BLACK).length === 4`, Felder
  19, 26, 37, 44
- `flipsFor` in alle acht Richtungen, je ein Treffer und ein Nicht-Treffer
- Ein Zug an den Rand darf nicht über die Zeilengrenze hinaus umdrehen
  (klassischer Fehler bei 1D-Brettern — der Code macht es über `r`/`c` korrekt,
  ein Test hält das fest)
- Passsituation: konstruiertes Brett, auf dem Weiß keinen Zug hat →
  `advanceTurn` lässt Schwarz am Zug
- Beidseitiges Passen → `state.over === true`
- `finalScore` Vorzeichen aus Sicht beider Farben

### C2. Suchparameter mehrfach verankert — ✅ erledigt 05.08.2026

> **Behoben.** Alle Zahlen der KI stehen in `CONFIG` (`engine.js`), jede mit
> Kommentar: `gewichte`, `eckenGewicht`, `eckenBonus`, `mobilitaet`,
> `steindifferenz`, `endspielFelder`, `endstandSkala`, `endspielReserve`,
> `stufen`, `standardStufe`. `CORNERS` ist verschwunden — die Eckfelder werden
> aus den Gewichten abgeleitet (`ECKEN`, Test hält `[0, 7, 56, 63]` fest).
> Über dem Objekt steht die im Abschnitt D geforderte Skalentabelle von
> `evaluate` (Feldgewichte ±150, Ecken ±400, Mobilität ±90, Endspiel ±3.800,
> `finalScore` ×100.000).
>
> **Abweichung — die beiden Endspielzahlen bleiben getrennt:** Der Review sah
> `evaluate:108` (`empty <= 10`) und `LEVELS[*].exact` als dieselbe Information.
> Das sind sie nicht: `endspielFelder` schaltet die **Bewertung** auf Steinzahl
> um, `stufen[*].exact` entscheidet über die **Suchtiefe**, und `exact` ist je
> Stufe anders (0/6/10/13). Dass Stufe „Schwer" ebenfalls bei 10 liegt, ist
> Zufall. Beide stehen jetzt in `CONFIG` nebeneinander, mit einem Kommentar,
> der die Verwechslung ausschließt.
>
> **Kein Verhaltenswechsel belegt:** dieselben 360 Stellungsvergleiche und
> 11 Partien wie bei A1 — 0 Abweichungen.

`WEIGHTS` dient gleichzeitig als Bewertung **und** als Zugsortierung (`:143`,
`:186`), `CORNERS` (`:95`) verdoppelt Information, die schon in `WEIGHTS` steckt
(die vier 120er-Felder), und die Endspielschwelle steht sowohl in `evaluate:108`
(`empty <= 10`) als auch in `LEVELS[*].exact`.

**Anweisung:** Die Konstanten in einem `CONFIG`-Objekt bündeln und dort
kommentieren, welche Zahl wofür gilt. Kein Verhaltenswechsel, erspart aber beim
nächsten Feintuning die Suche nach der zweiten Stelle.

### C3. Service Worker ist cache-first ohne Netzabgleich

**Wo:** `sw.js:27-31`

```js
caches.match(e.request).then(hit => hit || fetch(e.request))
```

Ein neuer Stand kommt erst an, wenn `CACHE` erhöht wird — bei einem reinen
Offline-Spiel vertretbar, aber es ist genau die Falle, die in den bisherigen
Sitzungen schon Tests verfälscht hat (getesteter Code war der alte). Die
Schwesterprojekte `claude-geo` und `claude-skat` nutzen inzwischen network-first.

**Anweisung:** Entweder auf network-first umstellen (Vorlage: `claude-geo/sw.js`)
oder — falls die Offline-Sofortverfügbarkeit wichtiger ist — bei cache-first
bleiben und in `README.md` eine Freigabe-Checkliste ergänzen:
> Vor jedem Push `CACHE` in `sw.js` erhöhen. Beim Testen in den Entwicklertools
> "Update on reload" aktivieren.

Außerdem in `sw.js:13-16` und `:18-25`: `skipWaiting()` und `clients.claim()`
stehen **außerhalb** von `waitUntil` und laufen damit möglicherweise vor dem
Abschluss des Cachens. In die Ketten hineinziehen, wie es `claude-geo/sw.js:16`
bereits macht.

---

## D. Kleinigkeiten

- `render` (`:267-270`): `void disc.offsetWidth;` erzwingt einen Reflow, um die
  Flip-Animation neu anzustoßen — funktioniert, ist aber ein Trick. Kommentar ist
  vorhanden, gut. Alternative wäre `disc.getAnimations().forEach(a => a.cancel())`.
- `evaluate` (`:98-123`) mischt drei Einheiten (Positionsgewichte, Steindifferenz
  ×60, Mobilität ×9) ohne dokumentierte Skala. Ein Satz im Kommentar, in welcher
  Größenordnung die Terme liegen sollen, hilft beim Nachjustieren.
- `bestMove` (`:170`): `LEVELS[level]` ohne Fallback. `level` kommt aus
  `dataset.level` (`:482`), ist also kontrolliert — trotzdem
  `const cfg = LEVELS[level] || LEVELS[2];` als Absicherung.
- `applyPalette` (`:469`) fängt localStorage-Fehler korrekt ab (privater Modus) —
  vorbildlich, so lassen.
- `toast` (`:301-307`): Bei schnell aufeinanderfolgenden Meldungen überschreibt
  jede die vorige. Bei "muss passen" in beiden Richtungen kurz hintereinander
  geht eine verloren. Niedrige Priorität.
- `SPIELEIGENSCHAFTEN.md` und `ENTWICKLUNG.md` liegen parallel zum `README.md`.
  Prüfen, ob sich Inhalte überschneiden — bei drei Dokumenten für 525 Zeilen Code
  veraltet erfahrungsgemäß eines still.

---

## Reihenfolge der Umsetzung

1. **B1** (`countMoves`/`hasFlip`) — kleinster Eingriff, größte Wirkung, und
   Voraussetzung dafür, dass A1 sich lohnt
2. **A1** (Web Worker) + `sw.js`-Anpassung
3. **C1** (Tests) — nach A1 liegt die Logik ohnehin isoliert
4. **A2** (Tastatur/Screenreader) + `user-scalable` entfernen
5. **C3** (Service-Worker-Disziplin)
6. **B2/B3** (make/unmake, iterative Vertiefung) — nur, wenn mehr Spielstärke
   gewünscht ist
7. **B4** (Transpositionstabelle) — optional
