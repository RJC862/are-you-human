/**
 * Pure 2D geometry helpers for hand/face spatial reasoning.
 * Used by the occlusion (hand-over-face) and touch-nose detectors.
 */
import type { RawLandmark } from "@/lib/landmarks/types";

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Axis-aligned bounding box of a set of points, or null if empty. */
export function boundingBox(points: { x: number; y: number }[]): BBox | null {
  if (!points || points.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function area(b: BBox): number {
  return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
}

/**
 * Overlap of two boxes as (intersection area) / (smaller box area), in [0, 1].
 * 1 means the smaller box is fully inside the larger.
 */
export function overlapRatio(a: BBox, b: BBox): number {
  const ix = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const iy = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  const inter = ix * iy;
  if (inter <= 0) return 0;
  const minArea = Math.min(area(a), area(b));
  if (minArea <= 0) return 0;
  return Math.min(1, inter / minArea);
}

/** Whether a point lies within a box, optionally padded outward by `pad`. */
export function pointInBox(
  p: { x: number; y: number },
  box: BBox,
  pad = 0
): boolean {
  return (
    p.x >= box.minX - pad &&
    p.x <= box.maxX + pad &&
    p.y >= box.minY - pad &&
    p.y <= box.maxY + pad
  );
}

/** Euclidean distance between two 2D landmarks (x,y only). */
export function dist2D(
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Minimum distance from any hand point to a target point. */
export function minHandPointDistance(
  hand: RawLandmark[],
  target: { x: number; y: number }
): number {
  let min = Infinity;
  for (const p of hand) {
    const d = dist2D(p, target);
    if (d < min) min = d;
  }
  return min;
}
