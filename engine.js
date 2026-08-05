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

/* ------------------------------------------------------------
 * Transpositionstabelle (Zobrist-Hashing)
 *
 * Dieselbe Stellung entsteht über verschiedene Zugreihenfolgen. Der Schlüssel
 * ist 64 Bit breit, geführt als zwei 32-Bit-Hälften: `Map` schlägt über die
 * erste nach, die zweite prüft den Treffer gegen. Ein einzelner 32-Bit-Wert
 * hätte bei hunderttausenden Knoten regelmäßig Kollisionen – und eine
 * Kollision liefert stillschweigend eine falsche Bewertung.
 * ------------------------------------------------------------ */

const [Z1, Z2, ZSEITE1, ZSEITE2] = (() => {
  // Fester Startwert: gleiche Tabelle in jeder Sitzung, damit Messungen und
  // Tests reproduzierbar bleiben (kein Math.random).
  let s = 0x2f6e2b1;
  const wuerfel = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s;
  };
  const a = new Uint32Array(64 * 3), b = new Uint32Array(64 * 3);
  for (let i = 0; i < 64 * 3; i++) { a[i] = wuerfel(); b[i] = wuerfel(); }
  return [a, b, wuerfel(), wuerfel()];
})();

/** Schlüssel einer Stellung samt Zugrecht. */
function hashOf(board, p) {
  let h1 = 0, h2 = 0;
  for (let i = 0; i < 64; i++) {
    const v = board[i];
    if (v !== EMPTY) { h1 ^= Z1[i * 3 + v]; h2 ^= Z2[i * 3 + v]; }
  }
  if (p === WHITE) { h1 ^= ZSEITE1; h2 ^= ZSEITE2; }
  return [h1 >>> 0, h2 >>> 0];
}

/** Schlüssel der Stellung nach einem Zug. In `search` steht dieselbe Rechnung
    noch einmal ausgeschrieben – dort ist sie der heißeste Pfad und darf kein
    Array anlegen. */
function kindHash(h1, h2, idx, flips, p, opp) {
  let n1 = h1 ^ Z1[idx * 3 + p] ^ ZSEITE1;
  let n2 = h2 ^ Z2[idx * 3 + p] ^ ZSEITE2;
  for (let i = 0; i < flips.length; i++) {
    const f = flips[i];
    n1 ^= Z1[f * 3 + opp] ^ Z1[f * 3 + p];
    n2 ^= Z2[f * 3 + opp] ^ Z2[f * 3 + p];
  }
  return [n1 >>> 0, n2 >>> 0];
}

const EXAKT = 0, UNTERGRENZE = 1, OBERGRENZE = 2;
const TT = new Map();
/** Notbremse gegen unbegrenztes Wachstum bei langen Endspielrechnungen. */
const TT_MAX = 600000;

/* Zug auf dem Arbeitsbrett ausführen und wieder zurücknehmen. `flips` liegt
   ohnehin vor, deshalb ist die Rücknahme exakt – und die Suche kommt ohne eine
   Brettkopie je Knoten aus. Nur für die Suche gedacht; die Oberfläche braucht
   für ihre Historie weiter `applyMove`. */
function doMove(b, idx, flips, p) {
  b[idx] = p;
  for (let i = 0; i < flips.length; i++) b[flips[i]] = p;
}
function undoMove(b, idx, flips, opp) {
  b[idx] = EMPTY;
  for (let i = 0; i < flips.length; i++) b[flips[i]] = opp;
}

/**
 * Negamax mit Alpha-Beta-Schnitt.
 *
 * Arbeitet direkt auf `board` und stellt es vor der Rückkehr wieder her – der
 * Aufrufer sieht also ein unverändertes Brett, während der Suche gilt das
 * jedoch nicht.
 */
export function search(board, p, depth, alpha, beta, h1, h2) {
  if (h1 === undefined) {
    // Aufruf von außen: Die Tabelle darf keine Schranken aus einer früheren,
    // fremden Suche mitbringen – sonst liefert `search` statt des exakten
    // Wertes eine Schranke, und der Rückgabewert hinge von der Vorgeschichte
    // ab. Innerhalb der Rekursion ist `h1` immer gesetzt, dort bleibt die
    // Tabelle stehen; `bestMove` leert sie einmal je Zug.
    TT.clear();
    [h1, h2] = hashOf(board, p);
  }

  const moves = legalMoves(board, p);
  const opp = opponent(p);

  if (moves.length === 0) {
    if (!hasLegalMove(board, opp)) return finalScore(board, p);
    // Passen: gleiche Tiefe, nur das Zugrecht wechselt.
    return -search(board, opp, depth, -beta, -alpha, (h1 ^ ZSEITE1) >>> 0, (h2 ^ ZSEITE2) >>> 0);
  }
  if (depth <= 0) return evaluate(board, p);

  const alphaVorher = alpha;
  const eintrag = TT.get(h1);
  const passt = eintrag !== undefined && eintrag.h2 === h2;

  if (passt && eintrag.tiefe >= depth) {
    if (eintrag.flag === EXAKT) return eintrag.wert;
    if (eintrag.flag === UNTERGRENZE) { if (eintrag.wert > alpha) alpha = eintrag.wert; }
    else if (eintrag.wert < beta) beta = eintrag.wert;
    if (alpha >= beta) return eintrag.wert;
  }

  // Zugsortierung: vielversprechende Felder zuerst → mehr Schnitte.
  moves.sort((a, b) => WEIGHTS[b.idx] - WEIGHTS[a.idx]);
  // Der in dieser Stellung schon einmal beste Zug zuerst – auch wenn er aus
  // einer flacheren Suche stammt, ist er die beste verfügbare Vermutung.
  if (passt && eintrag.zug >= 0) {
    const k = moves.findIndex((m) => m.idx === eintrag.zug);
    if (k > 0) moves.unshift(moves.splice(k, 1)[0]);
  }

  let best = -Infinity;
  let besterZug = -1;
  for (const m of moves) {
    doMove(board, m.idx, m.flips, p);
    let n1 = h1 ^ Z1[m.idx * 3 + p] ^ ZSEITE1;
    let n2 = h2 ^ Z2[m.idx * 3 + p] ^ ZSEITE2;
    for (let i = 0; i < m.flips.length; i++) {
      const f = m.flips[i];
      n1 ^= Z1[f * 3 + opp] ^ Z1[f * 3 + p];
      n2 ^= Z2[f * 3 + opp] ^ Z2[f * 3 + p];
    }
    const v = -search(board, opp, depth - 1, -beta, -alpha, n1 >>> 0, n2 >>> 0);
    undoMove(board, m.idx, m.flips, opp);
    if (v > best) { best = v; besterZug = m.idx; }
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }

  if (TT.size >= TT_MAX) TT.clear();
  TT.set(h1, {
    h2,
    tiefe: depth,
    wert: best,
    flag: best <= alphaVorher ? OBERGRENZE : (best >= beta ? UNTERGRENZE : EXAKT),
    zug: besterZug,
  });
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

  // Arbeitskopie: `search` dreht Züge auf dem Brett hin und zurück, das
  // übergebene Brett bleibt unberührt.
  const brett = board.slice();
  const opp = opponent(p);
  let best = moves[0];

  // Frische Tabelle je Zug: begrenzt den Speicher und macht das Ergebnis
  // unabhängig vom bisherigen Partieverlauf (und damit nachvollziehbar).
  TT.clear();
  const [wh1, wh2] = hashOf(brett, p);

  // Iterative Vertiefung: Tiefe 1, 2, 3 … bis zur Zieltiefe. Der Bestzug einer
  // Runde wird in der nächsten zuerst probiert; die Alpha-Schranke steht damit
  // früher hoch und schneidet mehr weg. Der Wert der letzten Runde ist derselbe,
  // den eine einzelne Suche über die Zieltiefe liefern würde.
  for (let tiefe = 1; tiefe <= depth; tiefe++) {
    let bestVal = -Infinity;
    let alpha = -Infinity;
    let rundenBest = moves[0];

    for (const m of moves) {
      doMove(brett, m.idx, m.flips, p);
      const [n1, n2] = kindHash(wh1, wh2, m.idx, m.flips, p, opp);
      const v = -search(brett, opp, tiefe - 1, -Infinity, -alpha, n1, n2);
      undoMove(brett, m.idx, m.flips, opp);
      if (v > bestVal) {
        bestVal = v;
        rundenBest = m;
        if (v > alpha) alpha = v;
      }
    }

    best = rundenBest;
    const k = moves.indexOf(best);
    if (k > 0) { moves.splice(k, 1); moves.unshift(best); }
  }
  return best;
}
