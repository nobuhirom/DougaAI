import { z } from 'zod';

/**
 * テーマ（themes/<id>/theme.json）。
 *
 * 動画の「見た目と声と書き方」の組み合わせ。企業向けの落ち着いた配色と
 * アナウンサー風の声、カジュアルな解説と掛け合いの声、といった単位で切り替える。
 * 台本は `meta.theme` でテーマを選ぶ。プロジェクトごとに違ってよい。
 *
 * ここで持つのは値だけ。Remotion 側は manifest に埋め込まれたテーマの色を読み、
 * 手順書（prompts/）はテーマの `style.md` を末尾に足して使う。
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, '#rrggbb');

export const themeColorsSchema = z.object({
  /** 画面の背景（上→下のグラデーション）。 */
  backgroundTop: hex,
  backgroundBottom: hex,
  /** スライドのパネル。 */
  panel: hex,
  panelText: hex,
  panelMuted: hex,
  /** 強調色。箇条書きのハイライト、比較の左列など。 */
  accent: hex,
  /** 比較の右列など、2つ目の強調色。 */
  accent2: hex,
  /** コード表示。 */
  codeBg: hex,
  codeText: hex,
  /** 字幕帯。 */
  subtitleBg: hex,
  subtitleText: hex,
});
export type ThemeColors = z.infer<typeof themeColorsSchema>;

export const themeSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  label: z.string().trim().min(1),
  /** どういう動画向けか。 */
  description: z.string().default(''),
  /** 既定の形式。台本側の meta.format が優先。 */
  format: z.enum(['dialogue', 'kamishibai']).default('dialogue'),
  colors: themeColorsSchema,
  /** 字幕帯の背景の不透明度（0〜1）。 */
  subtitleOpacity: z.number().min(0).max(1).default(0.86),
  /** 既定の BGM ファイル名（assets/bgm/）。台本側が優先。 */
  bgm: z.string().optional(),
  /** BGM の音量係数。 */
  bgmVolume: z.number().min(0).max(1).default(0.09),
  /**
   * 台本・サムネイル・ショートの手順書に足す文体の指示（themes/<id>/style.md）。
   * ファイルの有無だけをここで持つ。中身は手順書を使うエージェントが読む。
   */
  hasStyleGuide: z.boolean().default(false),
});
export type Theme = z.infer<typeof themeSchema>;
