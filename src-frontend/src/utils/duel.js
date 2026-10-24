/** Countdown and gap labels for a duel. Scores arrive already summed by the API. */

export function countdownLabel(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function gapLabel(gap, leader) {
  const n = Number(gap) || 0;
  const shown = Number.isInteger(n) ? String(n) : n.toFixed(1);
  if (!leader || leader === "tied" || n === 0) return "Level";
  return `${shown} ahead`;
}

export function pointsLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(2).replace(/\.?0+$/, "");
}

export function recordLabel(record) {
  const wins = record?.wins || 0;
  const losses = record?.losses || 0;
  const ties = record?.ties || 0;
  if (!wins && !losses && !ties) return "";
  return `${wins}-${losses}-${ties}`;
}
