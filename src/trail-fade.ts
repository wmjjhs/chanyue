// 版权所有：波哥
import type { Settings } from './model';

export function trailOpacity(settings: Settings, age: number, elapsed = Infinity): number {
  if (settings.cursorTransparent) return 0;
  if (!settings.trailFade || settings.cursorMode !== 'trail') return 1;
  const target = (distance: number) => distance <= 0 ? settings.trailCurrent / 100
    : (settings.trailRecent + (settings.trailMinimum - settings.trailRecent)
      * Math.min(1, Math.max(0, distance - 1) / settings.trailFadeLines)) / 100;
  if (age <= 0 || settings.trailFadeDuration === 0) return target(age);
  const progress = Math.min(1, Math.max(0, elapsed) / settings.trailFadeDuration);
  const blend = progress * progress * (3 - 2 * progress);
  return target(age - 1) + (target(age) - target(age - 1)) * blend;
}
