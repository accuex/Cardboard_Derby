export const renderConfig = {
  quality: 'high' as 'high' | 'medium' | 'low',
  /** Max turf/debris particles. */
  particles: 700,
  /** Lower the drawing resolution automatically when the frame rate drops. */
  adaptiveResolution: true,
  antialias: true,
  maxPixelRatio: 2,
  shadows: true,
  shadowMapSize: 2048,
  /** Half-size of the shadow camera box that follows the action. */
  shadowExtent: 70,
  showHorseNumberTags: true,
  crowd: { rows: 18, spacing: 0.95, occupancy: 0.75, apronPeople: 700 },
  stand: { xFrom: -150, xTo: 240, setback: 14 },
  trees: 260,
  bigScreen: { x: 60, z: 75, width: 34, height: 12, elevation: 6 },
};

/** Graphics presets (画質設定). 'auto' picks low on phones and high elsewhere. */
export type QualityLevel = 'high' | 'medium' | 'low';

export const qualityPresets: Record<QualityLevel, { antialias: boolean; maxPixelRatio: number; shadows: boolean; shadowMapSize: number; crowdRows: number; occupancy: number; apronPeople: number; trees: number; particles: number }> = {
  high: { antialias: true, maxPixelRatio: 2, shadows: true, shadowMapSize: 2048, crowdRows: 18, occupancy: 0.75, apronPeople: 700, trees: 260, particles: 700 },
  medium: { antialias: true, maxPixelRatio: 1.5, shadows: true, shadowMapSize: 1024, crowdRows: 12, occupancy: 0.65, apronPeople: 350, trees: 150, particles: 350 },
  low: { antialias: false, maxPixelRatio: 1, shadows: false, crowdRows: 6, shadowMapSize: 512, occupancy: 0.5, apronPeople: 120, trees: 60, particles: 120 },
};

/** Applied before the scene is built (changing it later reloads the page). */
export function applyQuality(level: QualityLevel): void {
  const q = qualityPresets[level];
  renderConfig.quality = level;
  renderConfig.antialias = q.antialias;
  renderConfig.maxPixelRatio = q.maxPixelRatio;
  renderConfig.shadows = q.shadows;
  renderConfig.shadowMapSize = q.shadowMapSize;
  renderConfig.crowd.rows = q.crowdRows;
  renderConfig.crowd.occupancy = q.occupancy;
  renderConfig.crowd.apronPeople = q.apronPeople;
  renderConfig.trees = q.trees;
  renderConfig.particles = q.particles;
}
