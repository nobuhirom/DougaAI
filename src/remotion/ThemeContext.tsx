import { createContext, useContext } from 'react';
import type { Theme } from '../schema/theme.js';
import { COLORS } from './theme.js';

/**
 * マニフェストに埋め込まれたテーマを、コンポーネントへ配る。
 * 配色をコード側に固定せず、themes/<id>/theme.json から差し替えられるようにする。
 * COLORS（theme.ts）は既定テーマと同じ値で、Context が無いときの保険。
 */

export interface ThemeRuntime {
  colors: Theme['colors'];
  subtitleOpacity: number;
  bgmVolume: number;
}

export const DEFAULT_THEME_RUNTIME: ThemeRuntime = {
  colors: {
    backgroundTop: COLORS.backgroundTop,
    backgroundBottom: COLORS.backgroundBottom,
    panel: COLORS.panel,
    panelText: COLORS.panelText,
    panelMuted: COLORS.panelMuted,
    accent: COLORS.panelAccent,
    accent2: '#8b5cf6',
    codeBg: COLORS.codeBg,
    codeText: COLORS.codeText,
    subtitleBg: '#080c16',
    subtitleText: COLORS.subtitleText,
  },
  subtitleOpacity: 0.86,
  bgmVolume: 0.09,
};

export const ThemeContext = createContext<ThemeRuntime>(DEFAULT_THEME_RUNTIME);
export const useTheme = () => useContext(ThemeContext);

/** #rrggbb と不透明度から rgba() を作る。 */
export function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
