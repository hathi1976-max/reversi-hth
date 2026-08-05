/* Der Hintergrund-Thread: laedt er die Engine, antwortet er, und reicht er die
   Sitzungsnummer unveraendert zurueck? Ohne diesen Test faellt ein kaputter
   Worker erst im Spiel auf - und dort greift der Rueckfall auf den Hauptthread,
   sodass es niemandem auffaellt. */

import { gruppe, test, gleich, wahr } from './lauf.js';
import { BLACK, WHITE, initialBoard, legalMoves } from '../engine.js';

/* Bewusst ohne Zeitwaechter: ein `setTimeout` als Abbruch waere im Testlauf
   unbrauchbar, weil Browser im Headless-Betrieb die Uhr vorspulen und der
   Waechter dann vor der Antwort des Workers zuschlaegt. Bleibt die Seite bei
   diesen Tests haengen, ist genau das der Befund - der Worker laedt nicht. */
function frage(nachricht){
  return new Promise((auf, ab) => {
    let w;
    try { w = new Worker('../ai-worker.js', { type: 'module' }); }
    catch (e){ ab(new Error('Worker liess sich nicht erzeugen: ' + e.message)); return; }
    w.onmessage = (e) => { w.terminate(); auf(e.data); };
    w.onerror = (e) => { w.terminate(); ab(new Error('Worker-Fehler: ' + (e.message || 'unbekannt'))); };
    w.postMessage(nachricht);
  });
}

gruppe('ai-worker', () => {
  test('antwortet aus der Startstellung mit einem legalen Zug', async () => {
    const a = await frage({ board: initialBoard(), p: BLACK, level: 2, session: 7 });
    gleich(a.session, 7, 'Sitzungsnummer muss unveraendert zurueckkommen');
    wahr(a.move !== null, 'es gibt vier legale Zuege');
    wahr([19, 26, 37, 44].includes(a.move.idx), `unerwarteter Zug ${a.move.idx}`);
    wahr(Array.isArray(a.move.flips) && a.move.flips.length > 0, 'flips fehlen');
    wahr(typeof a.dauer === 'number' && a.dauer >= 0, 'Dauer fehlt');
  });

  test('auch auf der hoechsten Stufe kommt ein legaler Zug zurueck', async () => {
    const b = initialBoard();
    const a = await frage({ board: b, p: BLACK, level: 4, session: 1 });
    wahr(legalMoves(b, BLACK).map(z => z.idx).includes(a.move.idx));
  });

  test('ohne legalen Zug meldet der Worker null', async () => {
    const b = new Uint8Array(64);
    b[0] = BLACK; b[1] = WHITE;   // Weiss hat hier keinen Zug
    const a = await frage({ board: b, p: WHITE, level: 2, session: 3 });
    gleich(a.move, null);
  });
});
