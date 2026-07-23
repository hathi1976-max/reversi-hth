# Reversi – Spieleigenschaften

## Das Spiel

Reversi (auch Othello) ist ein Strategiespiel für zwei Parteien auf einem
8×8-Brett. Wer am Ende die meisten Steine seiner Farbe auf dem Brett hat,
gewinnt.

### Regeln, wie sie die App umsetzt

- **Startaufstellung:** vier Steine über Kreuz in der Brettmitte
  (2 × Spieler 1, 2 × Spieler 2). Spieler 1 (Schwarz bzw. Rot) beginnt.
- **Legaler Zug:** Ein Stein muss so gelegt werden, dass mindestens ein
  gegnerischer Stein in gerader Linie (waagerecht, senkrecht oder diagonal)
  zwischen dem neuen und einem eigenen Stein eingeschlossen wird.
- **Umdrehen:** Alle eingeschlossenen Steine wechseln die Farbe – in allen
  Richtungen gleichzeitig.
- **Passen:** Wer keinen legalen Zug hat, muss aussetzen (die App meldet das
  automatisch per Einblendung).
- **Spielende:** Wenn keine Seite mehr ziehen kann. Die App zeigt den
  Endstand und den Gewinner an.

## Spielmodi

| Modus | Beschreibung |
| --- | --- |
| **Gegen Computer** | Du gegen die KI; Farbe frei wählbar (Spieler 1 beginnt) |
| **Zwei Spieler** | Zwei Personen abwechselnd am selben Gerät |
| **Demo (KI vs. KI)** | Der Computer spielt gegen sich selbst, mit Pause/Weiter |

## Schwierigkeitsstufen

| Stufe | Spielweise |
| --- | --- |
| **Leicht** | Zufällige legale Züge – ideal zum Regellernen |
| **Mittel** | Rechnet 2 Züge voraus, achtet auf gute Felder |
| **Schwer** | Rechnet 4 Züge voraus; die letzten ~10 Züge werden exakt ausgerechnet |
| **Experte** | Rechnet 6 Züge voraus; die letzten ~13 Züge werden exakt ausgerechnet |

Die KI bewertet Positionen nach Feldwerten (Ecken sind wertvoll, die Felder
daneben riskant), Beweglichkeit (Anzahl eigener Zugmöglichkeiten) und im
Endspiel nach der reinen Steinzahl. Bei gleichwertigen Zügen wählt sie
zufällig – keine zwei Partien verlaufen gleich.

## Steinfarben (Farbpaletten)

Im Menü unter **„Steinfarben"** wählbar; die Wahl wird gespeichert und gilt
auch nach einem Neustart der App:

- **Schwarz/Weiß** – klassisches Othello-Design
- **Rot/Blau** – kontrastreiche Alternative; alle Anzeigen (Spielernamen,
  Zuganzeige, Ergebnis) sprechen dann von „Rot" und „Blau"

## Bedienung und Komfort

- **Zughilfen:** grüne Punkte markieren alle legalen Züge des menschlichen Spielers
- **Letzter Zug:** gelb umrandet, damit man die Antwort des Gegners sofort sieht
- **Zug zurück:** nimmt bei „Gegen Computer" immer bis zum eigenen letzten Zug
  zurück (inklusive der Computerantwort); im Demo-Modus deaktiviert
- **Neustart** und **Revanche** starten sofort eine neue Partie
- **Punktestand** beider Seiten ist ständig sichtbar; der aktive Spieler ist
  hervorgehoben
- Flip-Animation beim Umdrehen der Steine

## Plattform

- **Web-App:** läuft in jedem modernen Browser (Desktop und Mobil)
- **Android:** als PWA installierbar („App installieren" in Chrome) –
  startet dann im Vollbild wie eine native App
- **Offline-fähig:** nach dem ersten Laden funktioniert das Spiel ohne
  Internetverbindung (Service Worker)
- Touch-optimiert, responsives Layout für Hoch- und Querformat
