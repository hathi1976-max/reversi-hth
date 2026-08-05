/* Regeln: Zugerkennung, Umdrehen, Pass- und Ende-Regel.
   Bretter werden von Hand gestellt, damit jede Erwartung nachrechenbar ist. */

import { gruppe, test, gleich, tiefGleich, mengeGleich, wahr } from './lauf.js';
import {
  EMPTY, BLACK, WHITE, DIRS,
  initialBoard, opponent, flipsFor, hasFlip, legalMoves, countMoves,
  hasLegalMove, applyMove, zugrechtNach, countDiscs,
} from '../engine.js';

/** Leeres Brett, danach Paare [index, farbe] setzen. */
function brett(...steine){
  const b = new Uint8Array(64);
  for (const [i, f] of steine) b[i] = f;
  return b;
}

gruppe('Startstellung', () => {
  test('vier Steine in der Mitte', () => {
    const b = initialBoard();
    gleich(b[27], WHITE); gleich(b[28], BLACK);
    gleich(b[35], BLACK); gleich(b[36], WHITE);
    tiefGleich(countDiscs(b), { black: 2, white: 2, empty: 60 });
  });

  test('Schwarz hat genau vier Zuege: 19, 26, 37, 44', () => {
    const zuege = legalMoves(initialBoard(), BLACK);
    gleich(zuege.length, 4);
    mengeGleich(zuege.map(z => z.idx), [19, 26, 37, 44]);
  });

  test('Weiss hat gespiegelt ebenfalls vier Zuege', () => {
    mengeGleich(legalMoves(initialBoard(), WHITE).map(z => z.idx), [20, 29, 34, 43]);
  });

  test('countMoves zaehlt wie legalMoves', () => {
    const b = initialBoard();
    gleich(countMoves(b, BLACK), legalMoves(b, BLACK).length);
    gleich(countMoves(b, WHITE), legalMoves(b, WHITE).length);
  });
});

gruppe('flipsFor in allen acht Richtungen', () => {
  // Feld 27 (Zeile 3, Spalte 3) liegt weit genug innen, dass alle acht
  // Richtungen zwei Felder Platz haben.
  const MITTE = 27;
  const schritt = (dr, dc) => dr * 8 + dc;

  test('acht Richtungen gleichzeitig: alle acht Nachbarn kippen', () => {
    const steine = [];
    for (const [dr, dc] of DIRS){
      steine.push([MITTE + schritt(dr, dc), WHITE]);
      steine.push([MITTE + 2 * schritt(dr, dc), BLACK]);
    }
    const b = brett(...steine);
    mengeGleich(flipsFor(b, MITTE, BLACK), [18, 19, 20, 26, 28, 34, 35, 36]);
    wahr(hasFlip(b, MITTE, BLACK), 'hasFlip muss ebenfalls anschlagen');
  });

  for (const [dr, dc] of DIRS){
    const s = schritt(dr, dc);
    const name = `(${dr},${dc})`;

    test(`Treffer in Richtung ${name}`, () => {
      const b = brett([MITTE + s, WHITE], [MITTE + 2 * s, BLACK]);
      tiefGleich(flipsFor(b, MITTE, BLACK), [MITTE + s]);
    });

    test(`kein Treffer in Richtung ${name} ohne eigenen Abschluss`, () => {
      const b = brett([MITTE + s, WHITE], [MITTE + 2 * s, WHITE]);
      tiefGleich(flipsFor(b, MITTE, BLACK), []);
      gleich(hasFlip(b, MITTE, BLACK), false);
    });

    test(`kein Treffer in Richtung ${name} bei direktem eigenen Nachbarn`, () => {
      const b = brett([MITTE + s, BLACK], [MITTE + 2 * s, BLACK]);
      tiefGleich(flipsFor(b, MITTE, BLACK), []);
    });
  }

  test('besetztes Feld ist nie ein Zug', () => {
    const b = initialBoard();
    tiefGleich(flipsFor(b, 27, BLACK), []);
    gleich(hasFlip(b, 27, BLACK), false);
  });
});

gruppe('Zeilengrenze (klassischer Fehler bei 1D-Brettern)', () => {
  test('Zug auf Feld 8 kippt nicht ueber den linken Rand in Zeile 0', () => {
    // 6 und 7 liegen in Zeile 0 ganz rechts, 8 in Zeile 1 ganz links.
    // Eine reine Indexrechnung wuerde 7 faelschlich als Nachbarn sehen.
    const b = brett([7, WHITE], [6, BLACK]);
    tiefGleich(flipsFor(b, 8, BLACK), []);
  });

  test('Zug auf Feld 15 kippt nicht ueber den rechten Rand in Zeile 2', () => {
    const b = brett([16, WHITE], [17, BLACK]);
    tiefGleich(flipsFor(b, 15, BLACK), []);
  });

  test('Gegenprobe: innerhalb derselben Zeile wird gekippt', () => {
    const b = brett([9, WHITE], [10, BLACK]);
    tiefGleich(flipsFor(b, 8, BLACK), [9]);
  });

  test('Diagonale laeuft nicht ueber die Ecke hinaus', () => {
    // Von Feld 0 aus gibt es nach oben und links nichts - kein Absturz, kein Treffer.
    const b = brett([1, WHITE], [2, BLACK], [8, WHITE], [16, BLACK]);
    mengeGleich(flipsFor(b, 0, BLACK), [1, 8]);
  });
});

gruppe('applyMove', () => {
  test('setzt den Stein und dreht die Kette um', () => {
    const b = initialBoard();
    const flips = flipsFor(b, 19, BLACK);
    tiefGleich(flips, [27]);
    const n = applyMove(b, 19, flips, BLACK);
    gleich(n[19], BLACK);
    gleich(n[27], BLACK);
    tiefGleich(countDiscs(n), { black: 4, white: 1, empty: 59 });
  });

  test('laesst das Ausgangsbrett unveraendert', () => {
    const b = initialBoard();
    applyMove(b, 19, flipsFor(b, 19, BLACK), BLACK);
    gleich(b[19], EMPTY);
    gleich(b[27], WHITE);
  });
});

gruppe('Pass- und Ende-Regel (zugrechtNach)', () => {
  test('normaler Fall: der Gegner kommt an die Reihe', () => {
    const r = zugrechtNach(initialBoard(), BLACK);
    tiefGleich(r, { current: WHITE, passt: EMPTY, over: false });
  });

  test('Weiss kann nicht ziehen: Schwarz bleibt am Zug und Weiss passt', () => {
    // Nur ein schwarzer und ein weisser Stein: Weiss faende keine schwarze
    // Kette mit weissem Abschluss, Schwarz dagegen schon (Feld 2).
    const b = brett([0, BLACK], [1, WHITE]);
    gleich(hasLegalMove(b, WHITE), false);
    gleich(hasLegalMove(b, BLACK), true);
    tiefGleich(zugrechtNach(b, BLACK), { current: BLACK, passt: WHITE, over: false });
  });

  test('beide koennen nicht ziehen: Partie vorbei', () => {
    const voll = new Uint8Array(64).fill(BLACK);
    tiefGleich(zugrechtNach(voll, BLACK), { current: BLACK, passt: EMPTY, over: true });
    tiefGleich(zugrechtNach(voll, WHITE), { current: WHITE, passt: EMPTY, over: true });
  });

  test('einzelner Stein auf leerem Brett: niemand kann ziehen', () => {
    const b = brett([0, BLACK]);
    gleich(zugrechtNach(b, BLACK).over, true);
  });
});

gruppe('Kleinigkeiten', () => {
  test('opponent kehrt die Farbe um', () => {
    gleich(opponent(BLACK), WHITE);
    gleich(opponent(WHITE), BLACK);
  });

  test('hasLegalMove und countMoves sind konsistent', () => {
    const b = brett([0, BLACK], [1, WHITE]);
    gleich(hasLegalMove(b, WHITE), countMoves(b, WHITE) > 0);
    gleich(hasLegalMove(b, BLACK), countMoves(b, BLACK) > 0);
  });
});
