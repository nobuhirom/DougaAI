import { z } from 'zod';

/**
 * 声のライブラリ（voices/library.json）。
 *
 * キャラクターの声、アナウンサー風のナレーション、といった「声」を
 * キャラクターとは別に登録し、ID で参照する。キャラの掛け合いと紙芝居の
 * ナレーションで同じ仕組みを使うため（docs/07_品質方針.md）。
 *
 * Irodori-TTS-Server は IRODORI_VOICES_DIR を走査し、`voices/<id>.wav` を
 * `voice: "<id>"` として解決する。参照音声が無い声はキャプション
 * （VoiceDesign）だけで指定する。
 */

export const VOICE_STYLES = ['character', 'announcer', 'narrator', 'casual'] as const;
export type VoiceStyle = (typeof VOICE_STYLES)[number];

export const VOICE_STYLE_LABELS: Record<VoiceStyle, string> = {
  character: 'キャラクター',
  announcer: 'アナウンサー風',
  narrator: 'ナレーター',
  casual: 'カジュアル',
};

export const voiceSchema = z.object({
  /** voices/<id>.wav と対応する。サーバー側の voice ID にもなる。 */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id は英小文字・数字・ハイフン'),
  label: z.string().trim().min(1),
  style: z.enum(VOICE_STYLES).default('character'),
  /**
   * 参照音声（voices/ からの相対パス）。あればゼロショットクローンで声を固定する。
   * 無ければ caption だけで声質を指定する（回ごとの揺れは seed で抑える）。
   */
  reference: z.string().trim().min(1).optional(),
  /** VoiceDesign 用の声質記述。参照音声があっても、話し方の指定として効く。 */
  caption: z.string().trim().min(1).optional(),
  /** 話速。0.25〜4.0。 */
  speed: z.number().min(0.25).max(4).default(1),
  /** 生成の固定シード。同じテキストから同じ音声を出すため。 */
  seed: z.number().int().nonnegative().default(42),
  /** 出自・権利など。参照音声は権利がクリアなものに限る（docs/05_TTS導入.md）。 */
  notes: z.string().default(''),
});
export type Voice = z.infer<typeof voiceSchema>;

export const voiceLibrarySchema = z.object({
  voices: z.array(voiceSchema),
});
export type VoiceLibrary = z.infer<typeof voiceLibrarySchema>;
