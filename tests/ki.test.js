/* Bewertung, Suche und Stufen. Die Suche ist zufallsbehaftet (Mischen der
   Wurzelzuege), deshalb pruefen die Tests Invarianten statt fester Zuege. */

import { gruppe, test, gleich, tiefGleich, wahr } from './lauf.js';
import {
  EMPTY, BLACK, WHITE, CONFIG, ECKEN,
  initialBoard, opponent, legalMoves, applyMove, countDiscs,
  evaluate, finalScore, search, bestMove,
} from '../engine.js';

function brett(...steine){
  const b = new Uint8Array(64);
  for (const [i, f] of steine) b[i] = f;
  return b;
}

gruppe('CONFIG', () => {
  test('Eckfelder werden aus den Gewichten abgeleitet', () => {
    tiefGleich(ECKEN, [0, 7, 56, 63]);
  });

  test('Gewichtstabelle hat 64 Felder und ist symmetrisch', () => {
    const w = CONFIG.gewichte;
    gleich(w.length, 64);
    for (let r = 0; r < 8; r++){
      for (let c = 0; c < 8; c++){
        gleich(w[r * 8 + c], w[r * 8 + (7 - c)], `Spiegelung Spalte ${r},${c}`);
        gleich(w[r * 8 + c], w[(7 - r) * 8 + c], `Spiegelung Zeile ${r},${c}`);
      }
    }
  });

  test('jede Stufe hat Tiefe und Endspielschwelle', () => {
    for (const [name, s] of Object.entries(CONFIG.stufen)){
      wahr(Number.isInteger(s.depth) && s.depth >= 0, `Stufe ${name}: depth`);
      wahr(Number.isInteger(s.exact) && s.exact >= 0, `Stufe ${name}: exact`);
    }
  });
});

gruppe('evaluate', () => {
  test('ist antisymmetrisch: was fuer Schwarz gut ist, ist fuer Weiss schlecht', () => {
    const stellungen = [
      initialBoard(),
      brett([0, BLACK], [1, WHITE], [9, BLACK], [27, WHITE], [36, BLACK]),
      brett([63, WHITE], [62, BLACK], [55, WHITE], [28, BLACK]),
    ];
    for (const b of stellungen){
      // "+ 0" macht aus einer negativen Null eine positive - sonst stolpert
      // Object.is bei ausgeglichenen Stellungen ueber -0 gegen 0.
      gleich(evaluate(b, BLACK), -evaluate(b, WHITE) + 0);
    }
  });

  test('leeres Brett ist ausgeglichen', () => {
    gleich(evaluate(new Uint8Array(64), BLACK), 0);
  });

  test('eigene Ecke ist besser als keine Ecke', () => {
    const ohne = new Uint8Array(64);
    const mit = brett([0, BLACK]);
    wahr(evaluate(mit, BLACK) > evaluate(ohne, BLACK));
  });

  test('im Endspiel entscheidet die Steinzahl', () => {
    // 56 Steine gesetzt, 8 Felder frei: unter CONFIG.endspielFelder.
    const b = new Uint8Array(64);
    for (let i = 0; i < 30; i++) b[i] = BLACK;
    for (let i = 30; i < 56; i++) b[i] = WHITE;
    gleich(countDiscs(b).empty, 8);
    const soll = (30 - 26) * CONFIG.steindifferenz;
    let pos = 0;
    for (let i = 0; i < 64; i++){
      if (b[i] === BLACK) pos += CONFIG.gewichte[i];
      else if (b[i] === WHITE) pos -= CONFIG.gewichte[i];
    }
    gleich(evaluate(b, BLACK), soll + pos);
  });
});

gruppe('finalScore', () => {
  test('Vorzeichen aus Sicht beider Farben', () => {
    const b = new Uint8Array(64);
    for (let i = 0; i < 40; i++) b[i] = BLACK;
    for (let i = 40; i < 64; i++) b[i] = WHITE;
    gleich(finalScore(b, BLACK), 16 * CONFIG.endstandSkala);
    gleich(finalScore(b, WHITE), -16 * CONFIG.endstandSkala);
  });

  test('Gleichstand ergibt null', () => {
    const b = new Uint8Array(64);
    for (let i = 0; i < 32; i++) b[i] = BLACK;
    for (let i = 32; i < 64; i++) b[i] = WHITE;
    gleich(finalScore(b, BLACK), 0);
    gleich(finalScore(b, WHITE), 0);
  });
});

gruppe('search', () => {
  test('Tiefe 0 liefert die Bewertung der Stellung', () => {
    const b = initialBoard();
    gleich(search(b, BLACK, 0, -Infinity, Infinity), evaluate(b, BLACK));
  });

  test('beendete Partie liefert den exakten Endstand, egal bei welcher Tiefe', () => {
    const voll = new Uint8Array(64).fill(BLACK);
    for (const t of [0, 1, 5]){
      gleich(search(voll, BLACK, t, -Infinity, Infinity), finalScore(voll, BLACK));
    }
  });

  /* Unabhaengige Gegenrechnung: schlichtes Negamax ohne Alpha-Beta, ohne
     Transpositionstabelle, ohne make/unmake. Liefert per Definition den
     exakten Minimax-Wert - jede Abweichung von `search` waere ein Fehler in
     der Zugsortierung, im Zobrist-Schluessel oder in der Zugruecknahme. */
  function naiv(b, p, tiefe){
    const zuege = legalMoves(b, p);
    if (zuege.length === 0){
      if (legalMoves(b, opponent(p)).length === 0) return finalScore(b, p);
      return -naiv(b, opponent(p), tiefe);
    }
    if (tiefe <= 0) return evaluate(b, p);
    let best = -Infinity;
    for (const m of zuege){
      const w = -naiv(applyMove(b, m.idx, m.flips, p), opponent(p), tiefe - 1);
      if (w > best) best = w;
    }
    return best;
  }

  function nachZuegen(n){
    let b = initialBoard(), p = BLACK;
    for (let i = 0; i < n; i++){
      const z = legalMoves(b, p);
      if (z.length === 0){ p = opponent(p); continue; }
      b = applyMove(b, z[0].idx, z[0].flips, p);
      p = opponent(p);
    }
    return { board: b, p };
  }

  test('stimmt mit schlichtem Negamax ueberein', () => {
    for (const n of [0, 5, 12, 20]){
      const { board, p } = nachZuegen(n);
      for (const tiefe of [1, 2, 3]){
        gleich(
          search(board, p, tiefe, -Infinity, Infinity),
          naiv(board, p, tiefe),
          `nach ${n} Zuegen, Tiefe ${tiefe}`
        );
      }
    }
  });

  test('gibt das Brett unveraendert zurueck (make/unmake)', () => {
    const { board, p } = nachZuegen(12);
    const vorher = Array.from(board);
    search(board, p, 4, -Infinity, Infinity);
    tiefGleich(Array.from(board), vorher);
  });

  test('liefert bei wiederholtem Aufruf denselben Wert', () => {
    const { board, p } = nachZuegen(8);
    const a = search(board, p, 4, -Infinity, Infinity);
    const b = search(board, p, 4, -Infinity, Infinity);
    const c = search(board, p, 4, -Infinity, Infinity);
    gleich(a, b); gleich(b, c);
  });

  test('Passen verbraucht keine Tiefe und wechselt das Zugrecht', () => {
    // Weiss kann nicht ziehen, Schwarz schon: der Wert muss aus Schwarz'
    // Fortsetzung stammen, nicht aus einer Bewertung der Passstellung.
    const b = brett([0, BLACK], [1, WHITE]);
    const wertWeiss = search(b, WHITE, 2, -Infinity, Infinity);
    const wertSchwarz = search(b, BLACK, 2, -Infinity, Infinity);
    gleich(wertWeiss, -wertSchwarz);
  });
});

gruppe('bestMove', () => {
  const stellung = () => {
    let b = initialBoard();
    b = applyMove(b, 19, [27], BLACK);
    return b;
  };

  test('liefert immer einen legalen Zug', () => {
    for (const stufe of [1, 2, 3, 4]){
      const b = stellung();
      const m = bestMove(b, WHITE, stufe);
      const legal = legalMoves(b, WHITE).map(z => z.idx);
      wahr(legal.includes(m.idx), `Stufe ${stufe}: ${m.idx} ist nicht legal`);
    }
  });

  test('ohne Zug kommt null zurueck', () => {
    const b = brett([0, BLACK], [1, WHITE]);
    gleich(bestMove(b, WHITE, 4), null);
  });

  test('unbekannte Stufe faellt auf die Standardstufe zurueck statt zu werfen', () => {
    const b = stellung();
    const m = bestMove(b, WHITE, 99);
    wahr(m && legalMoves(b, WHITE).map(z => z.idx).includes(m.idx));
  });

  test('laesst das uebergebene Brett unveraendert', () => {
    const b = stellung();
    const vorher = Array.from(b);
    bestMove(b, WHITE, 4);
    tiefGleich(Array.from(b), vorher);
  });

  test('nimmt die freie Ecke mit sicherem Gewinn', () => {
    // Weiss am Zug: Feld 0 schliesst die Reihe 0-1-2 ab und ist die Ecke.
    const b = brett([1, BLACK], [2, WHITE], [9, BLACK], [18, WHITE]);
    gleich(bestMove(b, WHITE, 3).idx, 0);
  });

  test('Stufe Leicht bleibt im Rahmen der legalen Zuege', () => {
    const b = stellung();
    const legal = legalMoves(b, WHITE).map(z => z.idx);
    for (let i = 0; i < 20; i++) wahr(legal.includes(bestMove(b, WHITE, 1).idx));
  });
});

gruppe('Partie laeuft durch', () => {
  test('Mittel gegen Mittel endet mit vollem oder blockiertem Brett', () => {
    let b = initialBoard(), p = BLACK, passes = 0, zuege = 0;
    while (passes < 2 && zuege < 70){
      const m = bestMove(b, p, 2);
      if (!m){ passes++; p = opponent(p); continue; }
      passes = 0; zuege++;
      b = applyMove(b, m.idx, m.flips, p);
      p = opponent(p);
    }
    const { black, white, empty } = countDiscs(b);
    wahr(zuege >= 55 && zuege <= 60, `unerwartete Zugzahl: ${zuege}`);
    gleich(black + white + (64 - black - white), 64);
    wahr(empty <= 4, `zu viele leere Felder am Ende: ${empty}`);
  });
});
