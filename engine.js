/* ============================================================
 * Reversi – Spielregeln und KI (reine Logik, kein DOM)
 *
 * Brett: Uint8Array mit 64 Feldern. 0 = leer, 1 = Schwarz, 2 = Weiß.
 * Index = zeile * 8 + spalte.
 *
 * Diese Datei wird an drei Stellen geladen:
 *   - app.js        (Oberfläche, für Regelprüfung und als Notfall-Rückfall)
 *   - ai-worker.js  (Suche im Hintergrund-Thread)
 *   - tests/        (Testlauf im Browser)
 * Sie darf deshalb weder `window` noch `document` anfassen.
 * ============================================================ */

export const EMPTY = 0, BLACK = 1, WHITE = 2;

export const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

/* ============================================================
 * Suchparameter – eine Stelle für alle Zahlen der KI
 *
 * Größenordnungen von `evaluate` (damit die Terme beim Nachjustieren
 * vergleichbar bleiben):
 *   Feldgewichte  `pos`         typisch ±150, im Extremfall bis ±700
 *   Eckenbonus                  ±100 je Ecke, also bis ±400
 *   Mobilität                   9 × Zugdifferenz, typisch ±90
 *   Endspiel-Steindifferenz     60 × Differenz, bis ±3.800
 *   `finalScore`                100.000 × Differenz – dominiert alles andere
 * Wer einen Term ändert, sollte ihn im Verhältnis zu diesen Spannen sehen.
 * ============================================================ */
export const CONFIG = {
  /* Klassische Positionsgewichte: Ecken stark, Felder daneben gefährlich.
     Dient gleichzeitig als Bewertung und als Zugsortierung in der Suche. */
  gewichte: [
    120, -25,  16,   8,   8,  16, -25, 120,
    -25, -45,  -3,  -3,  -3,  -3, -45, -25,
     16,  -3,   4,   2,   2,   4,  -3,  16,
      8,  -3,   2,   1,   1,   2,  -3,   8,
      8,  -3,   2,   1,   1,   2,  -3,   8,
     16,  -3,   4,   2,   2,   4,  -3,  16,
    -25, -45,  -3,  -3,  -3,  -3, -45, -25,
    120, -25,  16,   8,   8,  16, -25, 120,
  ],

  /** Gewicht der Eckfelder – daraus werden die Eckindizes abgeleitet. */
  eckenGewicht: 120,
  /** Zusätzlicher Bonus je eigener Ecke (über das Feldgewicht hinaus). */
  eckenBonus: 100,
  /** Faktor auf die Zugdifferenz (Mobilität). */
  mobilitaet: 9,
  /** Faktor auf die Steindifferenz – gilt nur in der Endspielbewertung. */
  steindifferenz: 60,
  /** Ab so wenigen leeren Feldern zählt in `evaluate` fast nur die Steinzahl.
      Nicht zu verwechseln mit `stufen[*].exact` (s. u.). */
  endspielFelder: 10,
  /** Skalierung des exakten Endstands, damit er jede Heuristik dominiert. */
  endstandSkala: 100000,
  /** Sicherheitszuschlag auf die Tiefe beim Ausrechnen bis zum Spielende:
      Passzüge verbrauchen keine Tiefe, deshalb reicht `empty` allein nicht. */
  endspielReserve: 4,

  /* Suchtiefe je Stufe und Schwelle, ab der bis zum Spielende gerechnet wird.
     `exact` ist eine Zahl leerer Felder, `endspielFelder` oben eine andere
     Größe: dort wechselt die Bewertung, hier die Suchtiefe. */
  stufen: {
    1: { depth: 0, exact: 0 },   // Leicht: zufälliger Zug
    2: { depth: 2, exact: 6 },   // Mittel
    3: { depth: 4, exact: 10 },  // Schwer
    4: { depth: 6, exact: 13 },  // Experte
  },
  /** Stufe, auf die `bestMove` bei unbekanntem Wert zurückfällt. */
  standardStufe: 2,
};

// Kurze lokale Namen für die heißen Pfade (eine Quelle, s. CONFIG).
const WEIGHTS = CONFIG.gewichte;
/** Eckfelder [0, 7, 56, 63] – aus den Gewichten abgeleitet, nicht doppelt gepflegt. */
export const ECKEN = WEIGHTS.reduce((acc, w, i) => (w === CONFIG.eckenGewicht ? (acc.push(i), acc) : acc), []);

/**
 * Vorberechnete Strahlen: RAYS[feld][richtung] = Feldindizes vom Feld aus bis
 * zum Brettrand. Damit entfallen im heißesten Schleifenkern die Zeilen-/
 * Spaltenrechnung und die Randprüfung – der Zeilenüberlauf ist schon dadurch
 * ausgeschlossen, dass jeder Strahl am Rand endet.
 */
export const RAYS = (() => {
  const all = [];
  for (let i = 0; i < 64; i++) {
    const r0 = i >> 3, c0 = i & 7;
    const perField = [];
    for (const [dr, dc] of DIRS) {
      const line = [];
      let r = r0 + dr, c = c0 + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) { line.push(r * 8 + c); r += dr; c += dc; }
      perField.push(Uint8Array.from(line));
    }
    all.push(perField);
  }
  return all;
})();

export function initialBoard() {
  const b = new Uint8Array(64);
  b[27] = WHITE; b[28] = BLACK;
  b[35] = BLACK; b[36] = WHITE;
  return b;
}

export function opponent(p) { return 3 - p; }

/** Steine, die ein Zug von `p` auf `idx` umdrehen würde (leer = illegal). */
export function flipsFor(board, idx, p) {
  if (board[idx] !== EMPTY) return [];
  const opp = opponent(p);
  const rays = RAYS[idx];
  const flips = [];
  for (let d = 0; d < 8; d++) {
    const ray = rays[d];
    const len = ray.length;
    let k = 0;
    while (k < len && board[ray[k]] === opp) k++;
    // Nur eingeschlossene Ketten zählen: mindestens ein gegnerischer Stein und
    // dahinter ein eigener (k < len schließt den Brettrand aus).
    if (k > 0 && k < len && board[ray[k]] === p) {
      for (let j = 0; j < k; j++) flips.push(ray[j]);
    }
  }
  return flips;
}

/**
 * Wie `flipsFor`, aber nur die Ja/Nein-Frage: bricht beim ersten Treffer ab und
 * legt kein Array an. Mobilitätsbewertung und Passprüfung brauchen ausschließlich
 * diese Antwort und laufen in der Suche hunderttausendfach.
 */
export function hasFlip(board, idx, p) {
  if (board[idx] !== EMPTY) return false;
  const opp = opponent(p);
  const rays = RAYS[idx];
  for (let d = 0; d < 8; d++) {
    const ray = rays[d];
    const len = ray.length;
    let k = 0;
    while (k < len && board[ray[k]] === opp) k++;
    if (k > 0 && k < len && board[ray[k]] === p) return true;
  }
  return false;
}

/** Alle legalen Züge als Liste von { idx, flips }. */
export function legalMoves(board, p) {
  const moves = [];
  for (let i = 0; i < 64; i++) {
    if (board[i] !== EMPTY) continue;
    const flips = flipsFor(board, i, p);
    if (flips.length) moves.push({ idx: i, flips });
  }
  return moves;
}

/** Anzahl legaler Züge – gleiches Ergebnis wie `legalMoves(...).length`, ohne Allokation. */
export function countMoves(board, p) {
  let n = 0;
  for (let i = 0; i < 64; i++) if (hasFlip(board, i, p)) n++;
  return n;
}

export function hasLegalMove(board, p) {
  for (let i = 0; i < 64; i++) {
    if (hasFlip(board, i, p)) return true;
  }
  return false;
}

/** Wendet einen Zug auf eine Kopie des Bretts an (für Historie und Anzeige). */
export function applyMove(board, idx, flips, p) {
  const b = board.slice();
  b[idx] = p;
  for (const f of flips) b[f] = p;
  return b;
}

/**
 * Zugrecht nach einem ausgeführten Zug – die Pass- und Ende-Regel an einer
 * Stelle, frei von DOM und Zustand (und damit testbar):
 *   `current` – wer als Nächstes am Zug ist
 *   `passt`   – Farbe, die aussetzen muss (0 = niemand)
 *   `over`    – true, wenn beide Seiten nicht ziehen können
 */
export function zugrechtNach(board, current) {
  const next = opponent(current);
  if (hasLegalMove(board, next)) return { current: next, passt: EMPTY, over: false };
  if (hasLegalMove(board, current)) return { current, passt: next, over: false };
  return { current, passt: EMPTY, over: true };
}

export function countDiscs(board) {
  let black = 0, white = 0, empty = 0;
  for (let i = 0; i < 64; i++) {
    if (board[i] === BLACK) black++;
    else if (board[i] === WHITE) white++;
    else empty++;
  }
  return { black, white, empty };
}

/* ============================================================
 * KI – Bewertung und Alpha-Beta-Suche
 * ============================================================ */

/** Bewertung aus Sicht von `p` (größer = besser für p). Skalen siehe CONFIG. */
export function evaluate(board, p) {
  const opp = opponent(p);
  let pos = 0, myDiscs = 0, oppDiscs = 0, empty = 0;
  for (let i = 0; i < 64; i++) {
    if (board[i] === p) { pos += WEIGHTS[i]; myDiscs++; }
    else if (board[i] === opp) { pos -= WEIGHTS[i]; oppDiscs++; }
    else empty++;
  }

  // Im Endspiel zählt fast nur noch die Steinzahl.
  if (empty <= CONFIG.endspielFelder) {
    return (myDiscs - oppDiscs) * CONFIG.steindifferenz + pos;
  }

  let cornerScore = 0;
  for (const c of ECKEN) {
    if (board[c] === p) cornerScore += CONFIG.eckenBonus;
    else if (board[c] === opp) cornerScore -= CONFIG.eckenBonus;
  }

  const myMob = countMoves(board, p);
  const oppMob = countMoves(board, opp);
  const mobility = CONFIG.mobilitaet * (myMob - oppMob);

  return pos + cornerScore + mobility;
}

/** Exakter Endstand aus Sicht von `p`, hoch skaliert damit er alles dominiert. */
export function finalScore(board, p) {
  const { black, white } = countDiscs(board);
  const diff = p === BLACK ? black - white : white - black;
  return diff * CONFIG.endstandSkala;
}

/** Negamax mit Alpha-Beta-Schnitt. */
export function search(board, p, depth, alpha, beta) {
  const moves = legalMoves(board, p);

  if (moves.length === 0) {
    if (!hasLegalMove(board, opponent(p))) return finalScore(board, p);
    return -search(board, opponent(p), depth, -beta, -alpha);
  }
  if (depth <= 0) return evaluate(board, p);

  // Zugsortierung: vielversprechende Felder zuerst → mehr Schnitte.
  moves.sort((a, b) => WEIGHTS[b.idx] - WEIGHTS[a.idx]);

  let best = -Infinity;
  for (const m of moves) {
    const next = applyMove(board, m.idx, m.flips, p);
    const v = -search(next, opponent(p), depth - 1, -beta, -alpha);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

/** Besten Zug für Stufe `level` bestimmen. */
export function bestMove(board, p, level) {
  const moves = legalMoves(board, p);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const cfg = CONFIG.stufen[level] || CONFIG.stufen[CONFIG.standardStufe];
  if (cfg.depth === 0) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  const { empty } = countDiscs(board);
  // Nahe am Spielende: komplett ausrechnen (Brett füllt sich, Suche terminiert).
  const depth = empty <= cfg.exact ? empty + CONFIG.endspielReserve : cfg.depth;

  // Erst mischen, dann stabil nach Gewicht sortieren: gleichwertige Züge
  // stehen so in zufälliger Reihenfolge → Abwechslung, ohne dass Züge mit
  // bloßen Alpha-Beta-Schrankenwerten fälschlich als gleich gut gelten.
  for (let i = moves.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [moves[i], moves[j]] = [moves[j], moves[i]];
  }
  moves.sort((a, b) => WEIGHTS[b.idx] - WEIGHTS[a.idx]);

  let bestVal = -Infinity;
  let best = moves[0];
  let alpha = -Infinity;
  for (const m of moves) {
    const next = applyMove(board, m.idx, m.flips, p);
    const v = -search(next, opponent(p), depth - 1, -Infinity, -alpha);
    if (v > bestVal) {
      bestVal = v;
      best = m;
      if (v > alpha) alpha = v;
    }
  }
  return best;
}
