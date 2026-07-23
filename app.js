"use strict";

/* ============================================================
 * Reversi – Spiellogik
 * Brett: Array mit 64 Feldern. 0 = leer, 1 = Schwarz, 2 = Weiß
 * ============================================================ */

const EMPTY = 0, BLACK = 1, WHITE = 2;
const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

function initialBoard() {
  const b = new Uint8Array(64);
  b[27] = WHITE; b[28] = BLACK;
  b[35] = BLACK; b[36] = WHITE;
  return b;
}

function opponent(p) { return 3 - p; }

/** Steine, die ein Zug von `p` auf `idx` umdrehen würde (leer = illegal). */
function flipsFor(board, idx, p) {
  if (board[idx] !== EMPTY) return [];
  const opp = opponent(p);
  const r0 = idx >> 3, c0 = idx & 7;
  const flips = [];
  for (const [dr, dc] of DIRS) {
    let r = r0 + dr, c = c0 + dc;
    const line = [];
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === opp) {
      line.push(r * 8 + c);
      r += dr; c += dc;
    }
    if (line.length && r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === p) {
      flips.push(...line);
    }
  }
  return flips;
}

/** Alle legalen Züge als Liste von { idx, flips }. */
function legalMoves(board, p) {
  const moves = [];
  for (let i = 0; i < 64; i++) {
    if (board[i] !== EMPTY) continue;
    const flips = flipsFor(board, i, p);
    if (flips.length) moves.push({ idx: i, flips });
  }
  return moves;
}

function hasLegalMove(board, p) {
  for (let i = 0; i < 64; i++) {
    if (board[i] === EMPTY && flipsFor(board, i, p).length) return true;
  }
  return false;
}

/** Wendet einen Zug auf eine Kopie des Bretts an. */
function applyMove(board, idx, flips, p) {
  const b = board.slice();
  b[idx] = p;
  for (const f of flips) b[f] = p;
  return b;
}

function countDiscs(board) {
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

// Klassische Positionsgewichte: Ecken stark, Felder daneben gefährlich.
const WEIGHTS = [
  120, -25,  16,   8,   8,  16, -25, 120,
  -25, -45,  -3,  -3,  -3,  -3, -45, -25,
   16,  -3,   4,   2,   2,   4,  -3,  16,
    8,  -3,   2,   1,   1,   2,  -3,   8,
    8,  -3,   2,   1,   1,   2,  -3,   8,
   16,  -3,   4,   2,   2,   4,  -3,  16,
  -25, -45,  -3,  -3,  -3,  -3, -45, -25,
  120, -25,  16,   8,   8,  16, -25, 120,
];
const CORNERS = [0, 7, 56, 63];

/** Bewertung aus Sicht von `p` (größer = besser für p). */
function evaluate(board, p) {
  const opp = opponent(p);
  let pos = 0, myDiscs = 0, oppDiscs = 0, empty = 0;
  for (let i = 0; i < 64; i++) {
    if (board[i] === p) { pos += WEIGHTS[i]; myDiscs++; }
    else if (board[i] === opp) { pos -= WEIGHTS[i]; oppDiscs++; }
    else empty++;
  }

  // Im Endspiel zählt fast nur noch die Steinzahl.
  if (empty <= 10) {
    return (myDiscs - oppDiscs) * 60 + pos;
  }

  let cornerScore = 0;
  for (const c of CORNERS) {
    if (board[c] === p) cornerScore += 100;
    else if (board[c] === opp) cornerScore -= 100;
  }

  const myMob = legalMoves(board, p).length;
  const oppMob = legalMoves(board, opp).length;
  const mobility = 9 * (myMob - oppMob);

  return pos + cornerScore + mobility;
}

/** Exakter Endstand aus Sicht von `p`, hoch skaliert damit er alles dominiert. */
function finalScore(board, p) {
  const { black, white } = countDiscs(board);
  const diff = p === BLACK ? black - white : white - black;
  return diff * 100000;
}

/** Negamax mit Alpha-Beta-Schnitt. */
function search(board, p, depth, alpha, beta) {
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

// Suchtiefe und Schwelle für exaktes Endspiel-Ausrechnen je Stufe.
const LEVELS = {
  1: { depth: 0, exact: 0 },   // Leicht: zufälliger Zug
  2: { depth: 2, exact: 6 },   // Mittel
  3: { depth: 4, exact: 10 },  // Schwer
  4: { depth: 6, exact: 13 },  // Experte
};

/** Besten Zug für Stufe `level` bestimmen. */
function bestMove(board, p, level) {
  const moves = legalMoves(board, p);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const cfg = LEVELS[level];
  if (cfg.depth === 0) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  const { empty } = countDiscs(board);
  // Nahe am Spielende: komplett ausrechnen (Brett füllt sich, Suche terminiert).
  const depth = empty <= cfg.exact ? empty + 4 : cfg.depth;

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

/* ============================================================
 * UI-Zustand und Ablaufsteuerung
 * ============================================================ */

const state = {
  board: initialBoard(),
  current: BLACK,
  mode: "pvc",        // pvc | pvp | demo
  level: 2,
  humanColor: BLACK,  // nur für pvc
  history: [],        // Snapshots für "Zug zurück"
  lastMove: -1,
  over: false,
  busy: false,        // KI denkt gerade / Demo läuft einen Zug
  demoPaused: false,
  session: 0,         // entwertet laufende Timer nach Neustart/Menü
  palette: "classic", // classic (Schwarz/Weiß) | redblue (Rot/Blau)
};

/** Anzeigename der Spielerfarbe gemäß aktiver Palette. */
function colorName(c) {
  if (state.palette === "redblue") return c === BLACK ? "Rot" : "Blau";
  return c === BLACK ? "Schwarz" : "Weiß";
}

const $ = (id) => document.getElementById(id);
const boardEl = $("board");
const cells = [];

function buildBoard() {
  for (let i = 0; i < 64; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.idx = i;
    const disc = document.createElement("div");
    disc.className = "disc";
    cell.appendChild(disc);
    cell.addEventListener("click", () => onCellClick(i));
    boardEl.appendChild(cell);
    cells.push(cell);
  }
}

function isHumanTurn() {
  if (state.over || state.busy) return false;
  if (state.mode === "pvp") return true;
  if (state.mode === "pvc") return state.current === state.humanColor;
  return false;
}

function render(flipped = []) {
  const flipSet = new Set(flipped);
  const showHints = isHumanTurn();
  const legal = showHints ? new Set(legalMoves(state.board, state.current).map((m) => m.idx)) : new Set();

  for (let i = 0; i < 64; i++) {
    const cell = cells[i];
    const disc = cell.firstChild;
    const v = state.board[i];

    disc.className = "disc";
    if (v !== EMPTY) {
      disc.classList.add(v === BLACK ? "black" : "white", "placed");
      if (flipSet.has(i)) {
        // Animation neu anstoßen
        void disc.offsetWidth;
        disc.classList.add("flip");
      }
    }
    cell.classList.toggle("legal", legal.has(i));
    cell.classList.toggle("last-move", i === state.lastMove);
  }

  const { black, white } = countDiscs(state.board);
  $("score-black").textContent = black;
  $("score-white").textContent = white;
  $("chip-black").classList.toggle("active", !state.over && state.current === BLACK);
  $("chip-white").classList.toggle("active", !state.over && state.current === WHITE);

  $("btn-undo").disabled = state.mode === "demo" || state.history.length === 0 || state.busy;
}

function playerLabel(color) {
  if (state.mode === "pvc") return color === state.humanColor ? "Du" : "Computer";
  if (state.mode === "demo") return `KI ${colorName(color)}`;
  return color === BLACK ? "Spieler 1" : "Spieler 2";
}

function updateTurnIndicator(thinking = false) {
  const el = $("turn-indicator");
  el.classList.toggle("thinking", thinking);
  if (state.over) { el.textContent = "Spiel beendet"; return; }
  const who = playerLabel(state.current);
  const color = colorName(state.current);
  el.textContent = thinking ? `${who} (${color}) denkt` : `${who} (${color}) ist am Zug`;
}

let toastTimer = null;
function toast(msg, ms = 1800) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

/* ---------- Spielablauf ---------- */

function startGame() {
  state.session++;
  state.board = initialBoard();
  state.current = BLACK;
  state.history = [];
  state.lastMove = -1;
  state.over = false;
  state.busy = false;
  state.demoPaused = false;

  $("name-black").textContent = playerLabel(BLACK);
  $("name-white").textContent = playerLabel(WHITE);
  $("btn-undo").hidden = state.mode === "demo";
  $("btn-pause").hidden = state.mode !== "demo";
  $("btn-pause").textContent = "Pause";

  $("menu").classList.remove("visible");
  $("gameover").classList.remove("visible");
  $("game").hidden = false;

  render();
  updateTurnIndicator();
  scheduleAI();
}

function makeMove(move) {
  state.history.push({ board: state.board, current: state.current, lastMove: state.lastMove });
  state.board = applyMove(state.board, move.idx, move.flips, state.current);
  state.lastMove = move.idx;
  advanceTurn(move.flips);
}

/** Nach einem Zug: Spielerwechsel, Passen und Spielende behandeln. */
function advanceTurn(flipped) {
  const next = opponent(state.current);
  if (hasLegalMove(state.board, next)) {
    state.current = next;
  } else if (hasLegalMove(state.board, state.current)) {
    toast(`${playerLabel(next)} muss passen`);
  } else {
    state.over = true;
  }

  render(flipped);
  updateTurnIndicator();

  if (state.over) {
    setTimeout(showGameOver, 700);
  } else {
    scheduleAI();
  }
}

function onCellClick(idx) {
  if (!isHumanTurn()) return;
  const flips = flipsFor(state.board, idx, state.current);
  if (!flips.length) return;
  makeMove({ idx, flips });
}

/** Stößt den nächsten KI-Zug an, falls die KI am Zug ist. */
function scheduleAI() {
  if (state.over || state.busy) return;
  const aiTurn =
    (state.mode === "pvc" && state.current !== state.humanColor) ||
    (state.mode === "demo" && !state.demoPaused);
  if (!aiTurn) return;

  state.busy = true;
  updateTurnIndicator(true);
  render();

  const session = state.session;
  const minDelay = state.mode === "demo" ? 650 : 350;
  const t0 = performance.now();

  // setTimeout, damit die UI vor der Rechenarbeit gezeichnet wird
  setTimeout(() => {
    if (session !== state.session) return;
    const move = bestMove(state.board, state.current, state.level);
    const elapsed = performance.now() - t0;
    setTimeout(() => {
      if (session !== state.session) return;
      state.busy = false;
      if (move) makeMove(move);
    }, Math.max(0, minDelay - elapsed));
  }, 30);
}

function undo() {
  if (state.busy || state.history.length === 0) return;

  // Bei Mensch gegen Computer bis zum letzten eigenen Zug zurückspulen
  const popped = [state.history.pop()];
  let snap = popped[0];
  if (state.mode === "pvc") {
    while (snap.current !== state.humanColor && state.history.length) {
      snap = state.history.pop();
      popped.push(snap);
    }
    if (snap.current !== state.humanColor) {
      // Kein eigener Zug in der Historie – nichts zurücknehmen
      while (popped.length) state.history.push(popped.pop());
      return;
    }
  }

  state.board = snap.board;
  state.current = snap.current;
  state.lastMove = snap.lastMove;
  state.over = false;
  $("gameover").classList.remove("visible");
  render();
  updateTurnIndicator();
}

function showGameOver() {
  const { black, white } = countDiscs(state.board);
  $("final-black").textContent = black;
  $("final-white").textContent = white;

  let title, text;
  if (black === white) {
    title = "Unentschieden!";
    text = "Beide Seiten haben gleich viele Steine.";
  } else {
    const winner = black > white ? BLACK : WHITE;
    const label = playerLabel(winner);
    title = label === "Du" ? "Du hast gewonnen! 🎉" : `${label} gewinnt!`;
    text = `${colorName(winner)} siegt mit ${Math.max(black, white)} zu ${Math.min(black, white)} Steinen.`;
  }
  $("result-title").textContent = title;
  $("result-text").textContent = text;
  $("gameover").classList.add("visible");
}

/* ---------- Menü ---------- */

function wireOptionGroup(groupId, attr, onChange) {
  const group = $(groupId);
  group.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-" + attr + "]");
    if (!btn) return;
    group.querySelectorAll(".opt").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    onChange(btn.dataset[attr]);
  });
}

function updateMenuVisibility() {
  $("level-section").hidden = state.mode === "pvp";
  $("color-section").hidden = state.mode !== "pvc";
}

/** Palette umschalten: Körperklasse, Beschriftungen, laufende Anzeige. */
function applyPalette(p) {
  state.palette = p;
  document.body.classList.toggle("palette-redblue", p === "redblue");
  try { localStorage.setItem("reversi-palette", p); } catch (e) { /* privater Modus o. Ä. */ }

  $("color-label-black").textContent = `${colorName(BLACK)} (beginnt)`;
  $("color-label-white").textContent = colorName(WHITE);
  $("name-black").textContent = playerLabel(BLACK);
  $("name-white").textContent = playerLabel(WHITE);
  updateTurnIndicator(state.busy);
}

function init() {
  buildBoard();

  wireOptionGroup("mode-group", "mode", (v) => { state.mode = v; updateMenuVisibility(); });
  wireOptionGroup("level-group", "level", (v) => { state.level = Number(v); });
  wireOptionGroup("color-group", "color", (v) => { state.humanColor = Number(v); });
  wireOptionGroup("palette-group", "palette", applyPalette);
  updateMenuVisibility();

  // Gespeicherte Palette wiederherstellen
  let savedPalette = null;
  try { savedPalette = localStorage.getItem("reversi-palette"); } catch (e) { /* ignorieren */ }
  if (savedPalette === "redblue") {
    $("palette-group").querySelectorAll(".opt").forEach((b) =>
      b.classList.toggle("selected", b.dataset.palette === savedPalette)
    );
    applyPalette(savedPalette);
  }

  $("btn-start").addEventListener("click", startGame);
  $("btn-rematch").addEventListener("click", startGame);
  $("btn-restart").addEventListener("click", startGame);
  $("btn-undo").addEventListener("click", undo);
  $("btn-to-menu").addEventListener("click", () => {
    state.session++;
    $("gameover").classList.remove("visible");
    $("game").hidden = true;
    $("menu").classList.add("visible");
  });
  $("btn-menu").addEventListener("click", () => {
    state.session++;
    state.busy = false;
    $("game").hidden = true;
    $("menu").classList.add("visible");
  });
  $("btn-pause").addEventListener("click", () => {
    state.demoPaused = !state.demoPaused;
    $("btn-pause").textContent = state.demoPaused ? "Weiter" : "Pause";
    if (!state.demoPaused) scheduleAI();
  });

  // Service Worker für Offline-Betrieb / Android-Installation
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();
