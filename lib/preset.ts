// Manufacturing dimensions remain fixed; only curve tessellation is refined.
export const PRESET = Object.freeze({
  artboard: 120, base: 1.6, relief: 0.6, total: 2.2,
  quality: 'Maximum', tolerance: 0.00001,
});
export const LIMITS = Object.freeze({ pathPoints: 1750000, triangles: 5000000 });
export const CONVERSION_TIMEOUTS = Object.freeze({ svg: 450000, image: 540000 });
