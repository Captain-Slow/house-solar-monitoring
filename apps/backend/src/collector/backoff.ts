/** 5, 10, 20, 40, 80, 160, 300 seconds, with bounded ±10% jitter. */
export function reconnectDelaySec(
  failures: number,
  rand: () => number,
): number {
  const exponent = Math.min(6, Math.max(0, Math.floor(failures) - 1));
  const base = Math.min(300, 5 * 2 ** exponent);
  return base * (0.9 + 0.2 * rand());
}
