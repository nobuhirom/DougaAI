/**
 * 画面の寸法と配色。
 *
 * 数値をコンポーネントに散らさず、ここだけを見れば全体の構図が分かるようにする。
 * 座標はすべて 1920×1080 基準の絶対値。
 */

export const STAGE = {
  width: 1920,
  height: 1080,
} as const;

/**
 * ビジュアル（スライド）を置く領域。
 *
 * 立ち絵と横方向で重ならないよう幅を決めている。重ねると箇条書きやコードの
 * 左端がキャラクターの陰に入って読めなくなる。
 * 左端 372 / 右端 1548 に対し、立ち絵は 10..362 と 1558..1910 に収まる。
 */
export const PANEL = {
  x: 372,
  y: 106,
  width: 1176,
  height: 620,
  radius: 28,
  padding: 52,
} as const;

/** セクション名の札。パネルの上、立ち絵の外側に置く。 */
export const SECTION_CHIP = {
  x: PANEL.x,
  y: 44,
  height: 48,
  fontSize: 26,
  paddingX: 22,
} as const;

/**
 * 字幕帯。
 *
 * ここの寸法から折り返しの最大幅（em）を導出している（src/layout/subtitle.ts）。
 * 数値を直接いじると検証と実寸がずれるため、必ずこの定義を通して変更する。
 *
 * 高さの検算: fontSize 52 × lineHeight 1.45 × 2行 = 150.8px、
 * 上下パディング 26×2 = 52px、合計 202.8px ≤ height 210px。
 */
export const SUBTITLE = {
  x: 150,
  y: 840,
  width: 1620,
  height: 210,
  radius: 22,
  fontSize: 52,
  lineHeight: 1.45,
  paddingX: 56,
  paddingY: 26,
  maxLines: 2,
} as const;

/**
 * 立ち絵の配置。bottom を基準に下揃えする。
 *
 * 横位置はパネルと重ならないように決めている（PANEL のコメント参照）。
 * 縦は字幕帯に足元が少し隠れる程度にしてある。
 */
export const CHARACTER = {
  height: 580,
  bottom: 212,
  left: { centerX: 186 },
  right: { centerX: 1734 },
  /**
   * 話していない側の見え方。落としすぎると「消えた」ように見えるので、
   * 話者との差が分かる程度に留める。
   */
  idle: {
    opacity: 0.72,
    scale: 0.96,
    saturation: 0.72,
  },
} as const;

/** 話者名の札。 */
export const NAMEPLATE = {
  height: 54,
  fontSize: 30,
  paddingX: 26,
  radius: 12,
  /**
   * 字幕帯の上端からのオフセット。札の高さぶん以上に離さないと、
   * 後から描かれる字幕帯に下半分が隠れる。
   */
  offsetY: -64,
} as const;

export const COLORS = {
  backgroundTop: '#101726',
  backgroundBottom: '#1c2740',
  panel: '#f7f9fc',
  panelBorder: '#ffffff',
  panelText: '#18202f',
  panelMuted: '#5b6779',
  panelAccent: '#2f6feb',
  subtitleBg: 'rgba(8, 12, 22, 0.86)',
  subtitleText: '#ffffff',
  codeBg: '#141b2b',
  codeText: '#e6ecf7',
  codeHighlight: 'rgba(47, 111, 235, 0.28)',
} as const;

/**
 * BGM の音量。
 *
 * この値が意味を持つのは、BGM 音源が基準レベルに正規化されている前提のとき。
 * 音源のレベルがバラバラだと、同じ係数でも曲によって聞こえたり聞こえなかったり
 * する。assets/bgm/README.md に「平均 -20dBFS 程度に揃える」と決めてある。
 *
 * 0.09 は -20.9dB。基準どおりの音源なら混合後の BGM は平均 -40dB 前後になり、
 * セリフ（平均 -25dB 前後）との差が 15dB 程度に収まる。
 */
export const BGM_VOLUME = 0.09;

/** セリフ音声の音量。 */
export const VOICE_VOLUME = 1;

/** 画面切り替えのフェード時間（フレーム）。 */
export const FADE_FRAMES = 8;
