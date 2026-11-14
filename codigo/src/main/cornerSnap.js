/**
 * Encaixe da janela flutuante nos cantos da tela.
 * Funcoes puras: recebem retangulos e devolvem retangulos, sem tocar no Electron.
 */

const CORNERS = ['tl', 'tr', 'bl', 'br'];

function nearestCorner(bounds, workArea) {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const midX = workArea.x + workArea.width / 2;
  const midY = workArea.y + workArea.height / 2;
  return (cy < midY ? 't' : 'b') + (cx < midX ? 'l' : 'r');
}

function cornerBounds(corner, size, workArea, margin = 12) {
  const width = Math.min(Math.round(size.width), workArea.width);
  const height = Math.min(Math.round(size.height), workArea.height);
  const left = corner === 'tl' || corner === 'bl';
  const top = corner === 'tl' || corner === 'tr';
  let x = left ? workArea.x + margin : workArea.x + workArea.width - width - margin;
  let y = top ? workArea.y + margin : workArea.y + workArea.height - height - margin;
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width));
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height));
  return { x: Math.round(x), y: Math.round(y), width, height };
}

function pickDisplay(displays, primaryId, savedDisplayId) {
  const list = Array.isArray(displays) ? displays : [];
  return (
    list.find((d) => d.id === savedDisplayId) ||
    list.find((d) => d.id === primaryId) ||
    list[0] ||
    null
  );
}

module.exports = { CORNERS, nearestCorner, cornerBounds, pickDisplay };
