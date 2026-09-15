import { z } from 'zod';
import { LINE_ID_PATTERN } from './script.js';

/**
 * ショート（projects/<id>/shorts.json）。工程9。
 *
 * 本編の台本から行を id で選んで切り出す。音声は本編のキャッシュをそのまま使うので
 * 追加の TTS 生成は要らない。縦 9:16 で焼く。
 *
 * 事例A: 「冒頭2秒で内容が伝わる一言」を最初に出す。ここでは hook として持つ。
 */

/** ショートの上限（秒）。YouTube Shorts の上限に合わせる。 */
export const SHORT_MAX_SECONDS = 60;
/** フックは1行で読める長さに限る。 */
export const HOOK_MAX_CHARS = 24;

export const shortSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id は英小文字・数字・ハイフン'),
  title: z.string().trim().min(1),
  /** 冒頭に大きく出す一言。読んで2秒で内容が伝わるもの。 */
  hook: z.string().trim().min(1).max(HOOK_MAX_CHARS),
  /** 本編の台本の行 id。この順に並べる。 */
  lineIds: z.array(z.string().regex(LINE_ID_PATTERN)).min(1),
});
export type Short = z.infer<typeof shortSchema>;

export const shortsSchema = z.object({
  shorts: z.array(shortSchema).min(1),
});
export type Shorts = z.infer<typeof shortsSchema>;

/** 縦動画の寸法。 */
export const SHORT_SIZE = { width: 1080, height: 1920 } as const;
/** フックを表示するフレーム数の目安（秒）。 */
export const HOOK_SECONDS = 2.5;
