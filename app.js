/* ============================================================
 * Reversi – Oberfläche und Ablaufsteuerung
 *
 * Die Spielregeln und die KI liegen in `engine.js`; diese Datei kennt nur
 * Zustand, DOM und Zeitsteuerung. Die Suche läuft in `ai-worker.js`, damit
 * die Oberfläche während des Rechnens bedienbar bleibt.
 * ============================================================ */

import {
  EMPTY, BLACK, WHITE,
  initialBoard, flipsFor, legalMoves, zugrechtNach,
  applyMove, countDiscs, bestMove,
} from "./engine.js";

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
  session: 0,         // entwertet laufende Timer und Worker-Antworten
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

/* ============================================================
 * KI im Hintergrund-Thread
 *
 * Ein Worker wird beim ersten Bedarf erzeugt und danach wiederverwendet.
 * Schlägt das fehl (kein Worker, keine Modul-Worker, Ladefehler), wird im
 * Hauptthread gerechnet – langsamer in der Bedienung, aber spielbar.
 * ============================================================ */

let aiWorker = null;
let workerDefekt = false;
let workerRechnet = false;
let offeneAnfrage = null;

function getWorker() {
  if (workerDefekt) return null;
  if (aiWorker) return aiWorker;
  try {
    aiWorker = new Worker("ai-worker.js", { type: "module" });
    aiWorker.onmessage = (e) => {
      workerRechnet = false;
      const anfrage = offeneAnfrage;
      if (!anfrage || e.data.session !== anfrage.session) return;
      zugUebernehmen(anfrage, e.data.move);
    };
    aiWorker.onerror = () => {
      // Einmalig auf den Hauptthread zurückfallen und dort weiterrechnen.
      workerDefekt = true;
      workerRechnet = false;
      try { aiWorker.terminate(); } catch (err) { /* egal */ }
      aiWorker = null;
      if (offeneAnfrage) rechneImHauptThread(offeneAnfrage);
    };
  } catch (e) {
    workerDefekt = true;
    aiWorker = null;
  }
  return aiWorker;
}

/**
 * Partie ungültig machen: Der Zähler entwertet alle noch laufenden Timer und
 * Worker-Antworten. Rechnet der Worker gerade eine tiefe Stellung, wird er
 * beendet – sonst würde der nächste Zug hinter der alten Rechnung warten.
 */
function sessionEntwerten() {
  state.session++;
  offeneAnfrage = null;
  if (aiWorker && workerRechnet) {
    aiWorker.terminate();
    aiWorker = null;
    workerRechnet = false;
  }
}

/** Ergebnis der Suche einspielen – frühestens nach der Mindestanzeigedauer. */
function zugUebernehmen(anfrage, move) {
  if (anfrage.session !== state.session) return;
  offeneAnfrage = null;
  const rest = anfrage.minDelay - (performance.now() - anfrage.t0);
  setTimeout(() => {
    if (anfrage.session !== state.session) return;
    state.busy = false;
    if (move) makeMove(move);
  }, Math.max(0, rest));
}

/** Rückfall ohne Worker: setTimeout, damit "denkt" vor der Rechnung erscheint. */
function rechneImHauptThread(anfrage) {
  setTimeout(() => {
    if (anfrage.session !== state.session) return;
    zugUebernehmen(anfrage, bestMove(anfrage.board, anfrage.p, anfrage.level));
  }, 30);
}

/* ---------- Spielablauf ---------- */

function startGame() {
  sessionEntwerten();
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
  const recht = zugrechtNach(state.board, state.current);
  state.current = recht.current;
  state.over = recht.over;
  if (recht.passt) toast(`${playerLabel(recht.passt)} muss passen`);

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

  // Mindestdauer, damit Computerzüge optisch nachvollziehbar bleiben. Sie
  // blockiert nichts mehr – die Rechnung läuft daneben im Worker.
  const anfrage = {
    board: state.board,
    p: state.current,
    level: state.level,
    session: state.session,
    minDelay: state.mode === "demo" ? 650 : 350,
    t0: performance.now(),
  };
  offeneAnfrage = anfrage;

  const worker = getWorker();
  if (worker) {
    workerRechnet = true;
    worker.postMessage({
      board: anfrage.board, p: anfrage.p, level: anfrage.level, session: anfrage.session,
    });
  } else {
    rechneImHauptThread(anfrage);
  }
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
    sessionEntwerten();
    $("gameover").classList.remove("visible");
    $("game").hidden = true;
    $("menu").classList.add("visible");
  });
  $("btn-menu").addEventListener("click", () => {
    sessionEntwerten();
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
