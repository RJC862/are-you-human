/**
 * Shared pure utilities used across the liveness verification app.
 * Kept framework-free so they are trivially unit-testable.
 */

/** Clamp a number into the inclusive [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Linearly map a value from one range to another, clamped to [0, 1] output by default. */
export function normalize(
  value: number,
  inMin: number,
  inMax: number
): number {
  if (inMax === inMin) return 0;
  return clamp((value - inMin) / (inMax - inMin), 0, 1);
}

/** Arithmetic mean of a numeric array (0 for empty input). */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Population standard deviation of a numeric array (0 for empty/single input). */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = mean(values.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}

/** Round to a fixed number of decimal places. */
export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
