# Reversi – Web-App & Android (PWA)

Reversi/Othello als Progressive Web App: läuft in jedem modernen Browser und
lässt sich unter Android wie eine App installieren. Keine Abhängigkeiten,
kein Build-Schritt – nur statische Dateien.

**▶ Live spielen: https://hathi1976-max.github.io/reversi-hth/**

## Funktionen

- **Gegen Computer** mit 4 Schwierigkeitsstufen:
  - *Leicht* – zufällige Züge
  - *Mittel* – 2 Züge Vorausberechnung
  - *Schwer* – 4 Züge, Endspiel wird exakt ausgerechnet
  - *Experte* – 6 Züge, größeres exaktes Endspiel
- **Zwei Spieler** am selben Gerät (abwechselnd tippen)
- **Demo**: Computer gegen Computer, mit Pause-Taste
- **Zwei Steinpaletten**: klassisch Schwarz/Weiß oder Rot/Blau (Wahl wird gespeichert)
- Zughilfen (grüne Punkte), letzter Zug markiert, „Zug zurück", Passen-Hinweis
- Offline-fähig dank Service Worker

- Vollständig mit der **Tastatur** bedienbar, Feldansagen für Screenreader

Drei Dokumente, drei Zuständigkeiten — wer etwas ändert, pflegt genau eines:
diese Datei bleibt der Kurzüberblick mit Installationsanleitung,
[SPIELEIGENSCHAFTEN.md](SPIELEIGENSCHAFTEN.md) beschreibt das Spiel aus
Nutzersicht (Regeln, Modi, Stufen, Bedienung),
[ENTWICKLUNG.md](ENTWICKLUNG.md) den Aufbau und die Entwicklungsschritte.

## Lokal starten

Im Projektordner:

```
py -m http.server 8173
```

Dann im Browser `http://localhost:8173` öffnen.

## Auf Android installieren

Diese App wird bereits per HTTPS über GitHub Pages ausgeliefert:
**https://hathi1976-max.github.io/reversi-hth/**

1. Die URL in Chrome auf dem Android-Gerät öffnen.
2. Menü (⋮) → **„App installieren"** bzw. **„Zum Startbildschirm hinzufügen"**.
3. Reversi startet dann im Vollbild wie eine native App und funktioniert
   auch offline.

> Hinweis für eigenes Hosting: PWA-Installation setzt **HTTPS** voraus. Die
> Dateien dieses Ordners lassen sich alternativ auf jeden statischen Hoster
> legen (Netlify, Cloudflare Pages o. ä.).

## Dateien

| Datei                  | Zweck                                    |
| ---------------------- | ---------------------------------------- |
| `index.html`           | Oberfläche (Menü, Brett, Dialoge)        |
| `style.css`            | Gestaltung, responsiv & touch-optimiert  |
| `engine.js`            | Spielregeln und KI (Alpha-Beta-Suche)    |
| `ai-worker.js`         | Rechnet die Zugsuche im Hintergrund      |
| `app.js`               | Zustand, DOM und Zeitsteuerung           |
| `tests/`               | Testlauf im Browser (`tests/test.html`)  |
| `manifest.webmanifest` | PWA-Manifest für die Android-Installation|
| `sw.js`                | Service Worker (Offline-Cache)           |
| `icons/`               | App-Icons (192 px, 512 px)               |
| `SPIELEIGENSCHAFTEN.md`| Funktionsumfang aus Nutzersicht          |
| `ENTWICKLUNG.md`       | Technische Dokumentation                 |
