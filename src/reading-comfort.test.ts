// 版权所有：波哥
import { describe, expect, it } from 'vitest';
import { defaultSettings, validateSettings } from './model';
import { trailOpacity } from './trail-fade';

describe('环境音与留痕层次设置', () => {
  it('旧配置迁移不会自动播放，默认雨声20%、暂停继续与温和层次', () => {
    expect(validateSettings({ version: 2, speed: 600, cursorRow: 8 })).toMatchObject({
      speed: 600, cursorRow: 8, ambientEnabled: false, ambientSound: 'rain', ambientVolume: 20, ambientContinuePaused: true,
      trailFade: true, trailCurrent: 100, trailRecent: 65, trailMinimum: 25, trailFadeLines: 5, trailFadeDuration: 0.4,
    });
  });
  it('数值与枚举安全，保留零及关闭，不允许远处深于近处', () => {
    expect(validateSettings({ ambientSound: 'https://bad', ambientVolume: Infinity, ambientEnabled: 'true' })).toMatchObject({ ambientSound: 'rain', ambientVolume: 20, ambientEnabled: false });
    expect(validateSettings({ ambientVolume: 0, ambientContinuePaused: false, trailFade: false, trailFadeDuration: 0 })).toMatchObject({ ambientVolume: 0, ambientContinuePaused: false, trailFade: false, trailFadeDuration: 0 });
    expect(validateSettings({ trailCurrent: 40, trailRecent: 80, trailMinimum: 90, trailFadeLines: 99, trailFadeDuration: 20, ambientVolume: 200 })).toMatchObject({ trailCurrent: 40, trailRecent: 40, trailMinimum: 40, trailFadeLines: 30, trailFadeDuration: 1, ambientVolume: 100 });
    expect(validateSettings({ trailCurrent: NaN, trailRecent: -5, trailMinimum: -1, trailFadeLines: 0 })).toMatchObject({ trailCurrent: 100, trailRecent: 0, trailMinimum: 0, trailFadeLines: 1 });
    for (const ambientSound of ['rain', 'wind', 'stream']) expect(validateSettings({ ambientSound }).ambientSound).toBe(ambientSound);
  });
});

describe('留痕渐淡数学', () => {
  const settings = { ...defaultSettings, cursorMode: 'trail' as const };
  it('默认当前100%、上一行65%，往前5行达到25%', () => {
    expect(trailOpacity(settings, 0)).toBe(1);
    expect(trailOpacity(settings, 1)).toBe(0.65);
    expect(trailOpacity(settings, 3)).toBeCloseTo(0.49);
    expect(trailOpacity(settings, 6)).toBe(0.25);
    expect(trailOpacity(settings, 200)).toBe(0.25);
  });
  it('所有过渡阶段均单调，时间为0保持前一状态，0.4秒到达目标', () => {
    for (const time of [0, 0.05, 0.2, 0.4, 1]) {
      let previous = 1;
      for (let age = 0; age < 35; age++) {
        const opacity = trailOpacity(settings, age, time);
        expect(opacity).toBeLessThanOrEqual(previous);
        expect(opacity).toBeGreaterThanOrEqual(0.25);
        previous = opacity;
      }
    }
    expect(trailOpacity(settings, 1, 0)).toBe(1);
    expect(trailOpacity(settings, 1, 0.2)).toBeCloseTo(0.825);
    expect(trailOpacity(settings, 1, 0.4)).toBeCloseTo(0.65);
  });
  it('暂停和续读给定同一阅读时间完全相同，回退不使用历史最大值', () => {
    const snapshot = [0, 1, 2, 6].map(age => trailOpacity(settings, age, 0.1));
    for (let repeat = 0; repeat < 10; repeat++) expect([0, 1, 2, 6].map(age => trailOpacity(settings, age, 0.1))).toEqual(snapshot);
    expect(trailOpacity(settings, 1, 0.1)).toBeGreaterThan(trailOpacity(settings, 6, 0.1));
  });
  it('透明优先、关闭恢复等深、指读不变、远端0与立即过渡有效', () => {
    expect(trailOpacity({ ...settings, trailFade: false }, 20)).toBe(1);
    expect(trailOpacity({ ...settings, trailFade: false, cursorTransparent: true }, 0)).toBe(0);
    expect(trailOpacity({ ...settings, cursorMode: 'pointer' }, 20)).toBe(1);
    expect(trailOpacity({ ...settings, trailMinimum: 0 }, 6)).toBe(0);
    expect(trailOpacity({ ...settings, trailFadeDuration: 0 }, 1, 0)).toBe(0.65);
  });
});
