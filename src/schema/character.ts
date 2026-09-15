import { z } from 'zod';
import { EMOTIONS, type Emotion } from './script.js';

/**
 * キャラクター定義（characters/<id>/character.json）。
 * 台本からは名前で参照する（docs/04_要件定義.md 3.6）。
 */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, '#rrggbb 形式で指定する');

const emotionMapSchema = z.object(
  Object.fromEntries(EMOTIONS.map((e) => [e, z.string().min(1)])) as {
    [K in Emotion]: z.ZodString;
  },
);

/**
 * 立ち絵の描画方式。
 *
 * `placeholder` は画像アセットを一切必要とせず、SVG を手続き的に描く。
 * パイプライン全体を絵の用意で止めないために用意している。実素材ができたら
 * `sprite` に差し替える。どちらもフレーム番号から決定的に描画される。
 */
const appearanceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('placeholder'),
    /** 髪・服の色相（0-359）。キャラの区別に使う。 */
    hue: z.number().int().min(0).max(359),
    /** 髪型のバリエーション。 */
    hair: z.enum(['long', 'short', 'bob']).default('long'),
  }),
  z.object({
    kind: z.literal('sprite'),
    /** characters/<id>/ からの相対パス。表情6種すべてが必要。 */
    expressions: emotionMapSchema,
    /** 立ち絵の基準サイズ。mouth の座標はこの空間で指定する。 */
    size: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    /** 口パク用の差分。省略すると口は動かない。 */
    mouth: z
      .object({
        frames: z.object({
          closed: z.string().min(1),
          half: z.string().min(1),
          open: z.string().min(1),
        }),
        x: z.number().int(),
        y: z.number().int(),
        width: z.number().int().positive(),
      })
      .optional(),
  }),
]);
export type Appearance = z.infer<typeof appearanceSchema>;

export const characterSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  displayName: z.string().min(1),
  /** 名前表示・字幕の話者色。 */
  color: hexColor,
  /** 画面上の立ち位置。 */
  position: z.enum(['left', 'right']),
  appearance: appearanceSchema,
  voice: z.object({
    /**
     * Irodori TTS の参照音声（characters/<id>/ からの相対パス）。
     * ゼロショットクローンで声を固定する（docs/04_要件定義.md Q4-2）。
     * 省略時は参照なし生成になり、声が回ごとに揺れる。
     */
    referenceAudio: z.string().min(1).optional(),
    /** VoiceDesign 用の声質記述。referenceAudio が無いときに使う。 */
    caption: z.string().min(1).optional(),
    /** 話速。Irodori-TTS-Server の speed に渡す。 */
    speed: z.number().min(0.25).max(4).default(1),
    /**
     * `macos-say` バックエンドで使う音声名（`say -v '?'` で一覧が出る）。
     * これは下書き用のバックエンドで、公開する動画の音声ではない。
     * どちらのバックエンドを使うかは `--tts` で明示的に選ぶ。自動では切り替えない。
     */
    systemVoice: z.string().min(1).default('Kyoko'),
  }),
});
export type Character = z.infer<typeof characterSchema>;
