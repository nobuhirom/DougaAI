/**
 * ショート（縦 9:16）の字幕帯の寸法。
 *
 * パイプライン（折り返しの再計算）と Remotion（描画）の両方が読む。
 * Node 依存も React 依存も置かない（src/shared の約束）。
 */
export const SHORT_SUBTITLE = {
  x: 60, y: 1500, width: 960, height: 330, radius: 22,
  fontSize: 44, lineHeight: 1.4, paddingX: 40, paddingY: 24,
} as const;

/** 全角1.0em / 半角0.55em の見積もり誤差を吸収する余裕。本編の字幕と同じ係数。 */
const SAFETY = 0.97;
export const SHORT_SUBTITLE_MAX_EM =
  Math.floor(((SHORT_SUBTITLE.width - SHORT_SUBTITLE.paddingX * 2) / SHORT_SUBTITLE.fontSize) * SAFETY * 100) / 100;
export const SHORT_SUBTITLE_MAX_LINES = 4;
