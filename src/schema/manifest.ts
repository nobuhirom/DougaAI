import { z } from 'zod';
import { characterSchema } from './character.js';
import { themeSchema } from './theme.js';
import { emotionSchema, metaSchema, sectionTypeSchema, visualSchema } from './script.js';

/**
 * マニフェスト（build/<id>/manifest.json）。
 *
 * 台本に音声・尺・折り返し済み字幕を解決した派生物。常に再生成できるため
 * git 管理しない（docs/04_要件定義.md 3.1 / N3）。
 *
 * Remotion にはこれを props として渡す。レンダリング時に計算するものを
 * 極力なくし、同じマニフェストからは同じ動画が出るようにしている（N1）。
 */

/** マニフェストの構造が変わったら上げる。古いマニフェストを弾くために使う。 */
export const MANIFEST_VERSION = 2;

export const manifestLineSchema = z.object({
  id: z.string(),
  sectionIndex: z.number().int().nonnegative(),
  sectionType: sectionTypeSchema,
  sectionName: z.string(),
  lineIndex: z.number().int().nonnegative(),

  character: z.string(),
  /** 字幕に出す本文（折り返し前）。 */
  text: z.string(),
  emotion: emotionSchema,
  visual: visualSchema,
  /** このセリフの時点で鳴っている BGM の staticFile 相対パス。 */
  bgm: z.string().nullable(),

  /** staticFile() に渡す音声の相対パス。 */
  audio: z.string(),
  audioDurationSec: z.number().positive(),

  /** 動画全体の中での開始フレーム。 */
  startFrame: z.number().int().nonnegative(),
  /** 音声が鳴っているフレーム数。 */
  speechFrames: z.number().int().positive(),
  /** 間（pause）を含むこのセリフの総フレーム数。 */
  durationInFrames: z.number().int().positive(),

  /** 折り返し済みの字幕。レンダリング時に再計算しない。 */
  subtitleLines: z.array(z.string()).min(1),

  /**
   * フレームごとの口の開き（0〜1）。音声の振幅から事前に算出する。
   * 長さは speechFrames と一致する。
   */
  mouth: z.array(z.number().min(0).max(1)),
});
export type ManifestLine = z.infer<typeof manifestLineSchema>;

export const manifestSchema = z.object({
  version: z.literal(MANIFEST_VERSION),
  builtAt: z.string(),
  meta: metaSchema,
  /** テーマを丸ごと埋め込む。Remotion は配色をここから読む。 */
  theme: themeSchema,
  /** テーマの既定と台本の指定から確定した形式。 */
  format: z.enum(['dialogue', 'kamishibai']),
  /** 台本が参照するキャラクター定義を丸ごと埋め込む。 */
  characters: z.record(z.string(), characterSchema),
  /** staticFile() に渡すフォントの相対パス。 */
  fonts: z.object({
    regular: z.string(),
    bold: z.string(),
    /** コード表示用の等幅フォント。 */
    mono: z.string(),
  }),
  totalDurationInFrames: z.number().int().positive(),
  lines: z.array(manifestLineSchema).min(1),
});
export type Manifest = z.infer<typeof manifestSchema>;
