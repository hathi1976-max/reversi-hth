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
> Zustand, DOM und Zeitsteuerung zusammengeschrumpft (573 → 409 Zeilen, durch
> A2 und D später wieder auf 516) und wird als `type="module"` geladen.
> `sw.js`: `CACHE` auf `reversi-v3`, `engine.js` und `ai-worker.js` in `ASSETS`.
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

### A2. Das Brett ist mit der Tastatur nicht bedienbar — ✅ erledigt 05.08.2026

> **Behoben.** Alle vier Punkte umgesetzt:
> 1. `#board` ist `role="grid"` mit `aria-rowcount`/`aria-colcount`, die Felder
>    sind `role="gridcell"` mit Beschriftung „D4, leer" / „C3, Schwarz,
>    möglicher Zug" / „… letzter Zug". Die Beschriftung wird in `render()`
>    mitgeschrieben und folgt der Palette (Rot/Blau statt Schwarz/Weiß).
> 2. Pfeiltasten bewegen, Pos1/Ende springen an den Zeilenrand, Enter und
>    Leertaste setzen den Stein — ein `keydown`-Listener am Container.
>    Roving Tabindex: genau ein Feld ist über Tab erreichbar. Ein Klick zieht
>    den Fokus mit, sonst springt die nächste Pfeiltaste an eine alte Stelle.
> 3. Neue Live-Region `#ansage` (`role="status"`, `aria-live="polite"`,
>    visuell versteckt über `.sr-only`) meldet nach jedem Zug
>    „Schwarz 12, Weiß 8. Weiß am Zug." — auch nach „Zug zurück" und am Ende.
> 4. `user-scalable=no` ist aus `index.html` verschwunden;
>    `touch-action: manipulation` auf Feldern und Schaltflächen nimmt dafür die
>    Doppeltipp-Verzögerung.
>
> **Ergänzung zum Vorschlag:** Zwischen `#board` und den Feldern liegen jetzt
> acht `role="row"`-Elemente — ein Raster ohne Zeilen ist ARIA-widrig, und
> Screenreader zählen sonst keine Zeilen. Damit das CSS-Raster unberührt bleibt,
> tragen sie `display: contents`.
>
> **Gegenprobe:** Ladeprobe im Browser — 64 `role="gridcell"`, 8 `role="row"`,
> Live-Region vorhanden, keine Konsolenfehler. Die Tastaturbedienung selbst
> muss von Hand geprüft werden (siehe `ENTWICKLUNG.md`).

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

### B2. `applyMove` kopiert das Brett in jedem Knoten — ✅ erledigt 05.08.2026

> **Behoben.** `search` arbeitet über `doMove`/`undoMove` auf einem einzigen
> Arbeitsbrett und stellt es vor der Rückkehr wieder her; `bestMove` legt dafür
> einmal je Zug eine Kopie an, damit das übergebene Brett unberührt bleibt.
> `makeMove` in der Oberfläche benutzt weiter `applyMove` — wie im Review
> vorgesehen, die Historie braucht Momentaufnahmen.
>
> **Der erhoffte Gewinn bleibt aus:** Über 120 Stellungen gemessen ist
> `search` mit make/unmake **nicht messbar schneller** (Tiefe 6: 3087 → 3024 ms,
> 1,02× — Rauschen). `board.slice()` auf 64 Byte ist offenbar so billig, dass
> die Speicherbereinigung nicht ins Gewicht fällt. Die Umstellung bleibt
> trotzdem drin: Sie kostet nichts, und ohne sie hätte die
> Transpositionstabelle (B4) den Hash je Knoten neu berechnen müssen.
>
> **Gleichheit belegt:** `search(b, p, d, -∞, +∞)` über 120 Stellungen × Tiefen
> 2/4/6 = **360 Werte, alle exakt gleich** zur Fassung davor; das Brett ist
> danach jedes Mal unverändert. `tests/ki.test.js` rechnet zusätzlich gegen ein
> schlichtes Negamax ohne Alpha-Beta gegen.

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

### B3. Feste Suchtiefe statt iterativer Vertiefung — ✅ erledigt 05.08.2026 (mit Abweichung)

> **Umgesetzt: iterative Vertiefung. Nicht umgesetzt: das Zeitbudget.**
> `bestMove` rechnet Tiefe 1, 2, 3 … bis zur Zieltiefe der Stufe und zieht den
> Bestzug einer Runde in der nächsten nach vorn.
>
> **Warum kein Zeitbudget:** Eine nach Wanduhr gemessene Tiefe macht die
> Spielstärke geräteabhängig — „Experte" wäre auf dem Rechner ein anderer
> Gegner als auf dem Handy, und dieselbe Stellung ergäbe zweimal einen anderen
> Zug. Bei einer beschrifteten Schwierigkeitsstufe ist das ein Fehler, kein
> Merkmal. Auch die Tests und jede Gegenprobe verlören ihre Grundlage. Die
> Zieltiefen je Stufe bleiben deshalb, wie sie waren.
>
> **Gemessen — der Vorschlag trägt sich erst mit B4:** Iterative Vertiefung
> allein war **langsamer** als die feste Tiefe (120 Stellungen: Stufe 3
> 272 → 485 ms, Stufe 4 4650 → 7008 ms, also 0,56× bzw. 0,66×). Die
> Gewichtssortierung ist bei Reversi schon so gut, dass die zusätzliche
> Ordnung an der Wurzel den Aufwand der Vorrunden nicht hereinholt. Erst mit
> der Transpositionstabelle (B4), über die der Bestzug auch **innere** Knoten
> sortiert, dreht sich das Bild:
>
> | Stufe | vorher | mit B2+B3+B4 | Faktor |
> | ----- | -----: | -----------: | -----: |
> | 2 (Tiefe 2) |   19 ms |   27 ms | 0,71× |
> | 3 (Tiefe 4) |  288 ms |  335 ms | 0,86× |
> | 4 (Tiefe 6) | 4595 ms | 3330 ms | **1,38×** |
> | 4, fünf feste Stellungen | 207 ms | 120 ms | **1,72×** |
>
> Dass die flachen Stufen leicht verlieren, bleibt so: Es sind 0,07 ms (Stufe 2)
> bzw. 0,4 ms (Stufe 3) je Zug gegen eine Mindestanzeigedauer von 350 ms. Eine
> Sonderregel „ab Tiefe 5 vertiefen" wäre mehr Code als Nutzen.
>
> **Keine Verschlechterung der Spielstärke:** Von 360 Zugentscheidungen weichen
> 11 ab. Für jede einzelne wurde der Wert beider Züge mit der alten,
> exakten Suche auf der Zieltiefe nachgerechnet: **11 von 11 exakt gleichwertig,
> 0 schlechter.** Es sind ausschließlich anders aufgelöste Gleichstände.
>
> **Nebenbemerkung:** Stufe „Experte" braucht jetzt im Mittel 28 ms je Zug.
> Eine Tiefe mehr wäre also bezahlbar — das ist aber eine Entscheidung über die
> Spielstärke, keine Aufräumarbeit, und bleibt beim Nutzer.

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

### B4. Keine Transpositionstabelle — ✅ erledigt 05.08.2026

> **Behoben.** Zobrist-Hashing über 64 Felder × 2 Farben plus Zugrecht, `Map`
> mit Tiefe, Wert, Schrankenart (exakt / Unter- / Obergrenze) und Bestzug.
> Der Schlüssel wird beim Zug **fortgeschrieben** statt neu berechnet.
>
> **Der Schlüssel ist 64 Bit breit, geführt als zwei 32-Bit-Hälften.** Ein
> einzelner 32-Bit-Wert hätte bei einigen hunderttausend Knoten je Zug
> regelmäßig Kollisionen — und eine Kollision liefert still eine falsche
> Bewertung. Die `Map` schlägt über die erste Hälfte nach, die zweite prüft den
> Treffer gegen.
>
> **Gefundene Falle:** Eine dauerhaft stehende Tabelle macht `search` von
> früheren Aufrufen abhängig — mit fremden Schranken im Fenster liefert die
> Funktion statt des exakten Wertes eine Schranke. In der ersten Fassung wichen
> dadurch 5 von 120 Werten ab (einmal −203 gegen −583). Behoben: Ein Aufruf
> **von außen** (ohne Hash-Argumente) leert die Tabelle; innerhalb der Rekursion
> und über die Vertiefungsrunden hinweg bleibt sie stehen, `bestMove` leert
> einmal je Zug. Damit ist `search(b, p, d, -∞, +∞)` wieder exakt.
>
> **Wirkung:** `search` allein auf Tiefe 6 1,14×; zusammen mit der iterativen
> Vertiefung (B3) Stufe „Experte" 1,38× über 120 Stellungen und 1,72× auf den
> fünf festen Stellungen. Das liegt unter dem im Review erwarteten Faktor 2–3 —
> bei Reversi entstehen weniger Zugumstellungen als etwa im Schach, weil Steine
> nicht wandern.
>
> **Gleichheit belegt:** 360 `search`-Werte exakt gleich zur Fassung ohne
> Tabelle; die 11 abweichenden Zugentscheidungen sind exakt gleichwertig
> (s. B3). `tests/ki.test.js` prüft `search` zusätzlich gegen ein schlichtes
> Negamax ohne Tabelle und ohne Alpha-Beta, dazu Idempotenz bei wiederholtem
> Aufruf.

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

### C3. Service Worker ist cache-first ohne Netzabgleich — ✅ erledigt 05.08.2026

> **Behoben.** `sw.js` ist auf **network-first** umgestellt (Vorlage
> `claude-geo/sw.js`): Die eigenen Dateien kommen aus dem Netz, der Cache ist
> Offline-Rückfall. `skipWaiting()` und `clients.claim()` hängen jetzt **in**
> den `waitUntil`-Ketten, nicht mehr daneben. `CACHE` steht auf `reversi-v4`.
>
> **Strenger als die Vorlage:** Nachgecacht wird nur, was in `SHELL` steht
> (`SHELL_URLS`-Abgleich). Sonst landet der Testlauf unter `tests/` im
> App-Cache und wird offline als App-Datei ausgeliefert. Fremde Herkünfte und
> alles außer `GET` fasst der Worker gar nicht an.
>
> **Zusätzlich gegen dieselbe Falle:** `tests/test.html` meldet einen
> registrierten Service Worker ab und leert die Caches, bevor die Module
> geladen werden — sonst testet man den alten Stand.

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

## D. Kleinigkeiten — ✅ erledigt 05.08.2026

> **Behoben.** Fünf von sechs Punkten umgesetzt, einer bewusst nicht — im
> Einzelnen unten.

- `render` (`:267-270`): `void disc.offsetWidth;` erzwingt einen Reflow, um die
  Flip-Animation neu anzustoßen — funktioniert, ist aber ein Trick. Kommentar ist
  vorhanden, gut. Alternative wäre `disc.getAnimations().forEach(a => a.cancel())`.

  > **Nicht umgesetzt, mit Absicht.** `getAnimations().cancel()` ist zwar
  > sauberer zu lesen, stößt die Animation aber nicht zuverlässig neu an: Die
  > Klasse `flip` wird im selben Ablauf entfernt und wieder gesetzt, der Browser
  > berechnet den Stil erst am Ende — ohne erzwungenen Stilabgleich sieht er gar
  > keine Änderung. Der Reflow ist genau dieser Abgleich und deshalb die
  > verlässlichere Zeile. Da die Wirkung sich nur im Browser beurteilen lässt und
  > hier keiner zur Verfügung stand, bleibt die funktionierende Fassung stehen.
  > Der Kommentar im Code benennt den Grund jetzt.

- `evaluate`: Skala der drei Terme dokumentieren.
  > **Erledigt** als Teil von C2: Über `CONFIG` in `engine.js` steht eine
  > Tabelle der Größenordnungen (Feldgewichte ±150, Ecken ±400, Mobilität ±90,
  > Endspiel ±3.800, `finalScore` ×100.000).

- `bestMove`: `LEVELS[level]` ohne Fallback.
  > **Erledigt.** `CONFIG.stufen[level] || CONFIG.stufen[CONFIG.standardStufe]`.
  > `tests/ki.test.js` ruft `bestMove(b, p, 99)` auf und erwartet einen legalen
  > Zug statt einer Ausnahme.

- `applyPalette` fängt localStorage-Fehler korrekt ab — vorbildlich, so lassen.
  > **Unverändert gelassen**, wie empfohlen.

- `toast`: Bei schnell aufeinanderfolgenden Meldungen überschreibt jede die vorige.
  > **Erledigt.** Meldungen laufen jetzt über eine Warteschlange nacheinander
  > durch (je 1,8 s, dazwischen 300 ms für das Ausblenden). `sessionEntwerten()`
  > verwirft wartende Meldungen — nach einem Neustart gehören sie zur alten
  > Partie.

- Drei Dokumente für 525 Zeilen Code — eines veraltet erfahrungsgemäß still.
  > **Erledigt.** Die Zuständigkeiten stehen jetzt ausdrücklich im `README.md`:
  > README = Kurzüberblick und Installation, `SPIELEIGENSCHAFTEN.md` =
  > Nutzersicht, `ENTWICKLUNG.md` = Technik und Entwicklungsschritte. Beim
  > Nachsehen war genau der befürchtete Fall schon eingetreten:
  > `SPIELEIGENSCHAFTEN.md` kannte die Tastaturbedienung nicht — nachgetragen,
  > samt Tastentabelle und Screenreader-Verhalten.

---

## Reihenfolge der Umsetzung

1. **B1** (`countMoves`/`hasFlip`) — kleinster Eingriff, größte Wirkung, und
   Voraussetzung dafür, dass A1 sich lohnt ✅ 04.08.2026
2. **A1** (Web Worker) + `sw.js`-Anpassung ✅ 05.08.2026
3. **C1** (Tests) — nach A1 liegt die Logik ohnehin isoliert ✅ 05.08.2026
4. **A2** (Tastatur/Screenreader) + `user-scalable` entfernen ✅ 05.08.2026
5. **C3** (Service-Worker-Disziplin) ✅ 05.08.2026
6. **B2/B3** (make/unmake, iterative Vertiefung) — nur, wenn mehr Spielstärke
   gewünscht ist ✅ 05.08.2026 (B3 ohne Zeitbudget, Begründung dort)
7. **B4** (Transpositionstabelle) — optional ✅ 05.08.2026

Dazu **C2** (Suchparameter in `CONFIG`) und **D** (Kleinigkeiten), beide
✅ 05.08.2026. Damit ist die Liste abgearbeitet.

## Was von Hand nachzuprüfen bleibt — ✅ durchgeführt 06.08.2026

> **Ergebnis: vier von fünf Punkten ohne Beanstandung, einer hat einen Fehler
> zutage gefördert** (Punkt 1, behoben, `v7`).
>
> | Punkt | Ergebnis |
> |---|---|
> | 1. Tastatur | Pfeiltasten und Enter arbeiten wie beschrieben, Fokusrahmen sichtbar (2,4 px), Roving Tabindex hält genau ein Feld erreichbar, die Live-Region meldet nach jedem Zug den Stand. **Aber:** bei laufendem Spiel führten die ersten **zwölf** Tab-Schritte durch das unsichtbare Menü — siehe unten. |
> | 2. Zoom | `user-scalable=no` und `maximum-scale` sind aus dem Viewport-Tag verschwunden, `touch-action: manipulation` liegt auf Feldern und Schaltflächen, nicht auf `body`. Zwei-Finger-Zoom bleibt also möglich, Doppeltipp zoomt nicht. Am echten Gerät nicht nachstellbar — geprüft wurde die Ursache, nicht die Geste. |
> | 3. Menü während der Rechnung | Ein Klick auf „Menü" wird **im selben Task** verarbeitet (0 ms), das Menü ist sofort offen. Zusätzlich gemessen: während der Worker eine Endspielstellung (13 leere Felder, Stufe Experte) 256 ms lang durchrechnet, verarbeitet der Hauptthread 34 133 Aufgaben, größte Lücke **4 ms**. Genau dafür ist A1 da. |
> | 4. Neustart während der Rechnung | Menschlicher Zug (4:1), im selben Task „Neu" — Brett steht sofort wieder auf 2:2 und bleibt es auch nach 2,5 s. Die Antwort des Workers aus der alten Partie wird über `session` verworfen. |
> | 5. Service-Worker-Update | Cache-Namen testweise auf `v7` gesetzt, `update()` + Neuladen: nur noch `reversi-v7` vorhanden (`v6` gelöscht), alle neun Shell-Dateien darin, die Seite wird vom neuen Worker gesteuert. Rückweg auf `v6` genauso sauber. |
>
> **Gefunden bei Punkt 1: geschlossene Überlagerungen blieben in der
> Tab-Reihenfolge.** `.overlay` versteckt nur über `opacity: 0` und
> `pointer-events: none` — beides nimmt Elemente **nicht** aus der
> Tabulator-Reihenfolge. Bei laufendem Spiel lauteten die ersten dreizehn
> Tab-Stationen: „Gegen Computer", „Zwei Spieler", „Demo", „Leicht", „Mittel",
> „Schwer", „Experte", „Schwarz", „Weiß", „Schwarz/Weiß", „Rot/Blau", „Spiel
> starten" — und erst dann das Brett. Ein Tastaturnutzer konnte dort auch
> **auslösen**: Enter auf dem unsichtbaren „Spiel starten" warf die laufende
> Partie weg. Für Sehende war nichts davon zu erkennen.
>
> **Behoben** mit dem `inert`-Attribut: `zeigeOverlay(id, sichtbar)` in `app.js`
> setzt Klasse und `inert` gemeinsam, `#gameover` startet schon im HTML als
> `inert`. Bewusst nicht über `visibility: hidden` gelöst — das hätte an der
> 0,25-s-Blende gehangen, und die Tab-Reihenfolge sollte nicht von einer
> Animation abhängen.
>
> **Gegenprobe:** Tab-Folge bei laufendem Spiel jetzt Brett → „Menü" → „Neu" →
> Brett; das Menü bleibt im geöffneten Zustand voll bedienbar, und am Spielende
> ist der Endstand-Dialog wieder erreichbar (Demo bis 52:12 durchlaufen).
> Alle 67 Tests weiter grün.

Die Tests decken die Logik ab, nicht die Anzeige. Im Browser nachzusehen:

1. Tabulator ins Brett, mit den Pfeiltasten wandern, mit der Leertaste setzen —
   der Fokusrahmen muss sichtbar sein und dem Zug folgen.
2. Auf dem Handy mit zwei Fingern zoomen (muss gehen), Doppeltipp auf ein Feld
   (darf nicht zoomen).
3. Demo-Modus auf „Experte": Der Menü-Knopf muss während des Rechnens sofort
   reagieren — das ist der eigentliche Zweck von A1.
4. Während die KI rechnet „Neustart" drücken: Es darf kein Zug aus der alten
   Partie nachkommen.
5. Nach dem Neuladen prüfen, dass der neue Service Worker greift
   (Entwicklertools → Application → Service Workers).
