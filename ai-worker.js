/* Hintergrund-Thread für die Zugsuche.
 *
 * Modul-Worker: lädt `engine.js` per `import`, damit Regeln und Bewertung nur
 * einmal im Projekt stehen. Der Worker kennt keinen Spielzustand – er bekommt
 * Brett, Zugrecht und Stufe zugeschickt und antwortet mit einem Zug.
 *
 * `session` wird unverändert zurückgereicht: Die Oberfläche erkennt daran
 * Antworten, die zu einer inzwischen beendeten Partie gehören, und verwirft sie.
 */
import { bestMove } from "./engine.js";

self.onmessage = (e) => {
  const { board, p, level, session } = e.data;
  const t0 = performance.now();
  const move = bestMove(board, p, level);
  self.postMessage({
    session,
    // `flips` ist bereits ein einfaches Zahlen-Array – strukturiert kopierbar.
    move: move ? { idx: move.idx, flips: move.flips } : null,
    dauer: performance.now() - t0,
  });
};
