import { z } from 'zod';

/**
 * 台本スキーマ。
 *
 * これは「人間 / AI が書くもの」だけを表す。音声長・フレーム数といった派生値は
 * 含めない（docs/04_要件定義.md 3.1）。派生値は manifest.ts 側で扱う。
 */

/** 表情と TTS の感情制御を兼ねる語彙（docs/04_要件定義.md 3.4）。 */
export const EMOTIONS = [
  'normal',
  'explain',
  'happy',
  'surprised',
  'thinking',
  'trouble',
] as const;
export type Emotion = (typeof EMOTIONS)[number];
export const emotionSchema = z.enum(EMOTIONS);

/**
 * Irodori TTS は絵文字埋め込みで感情を制御する。字幕には出さず、
 * TTS へ渡すテキストにのみ付与する。
 */
export const EMOTION_EMOJI: Record<Emotion, string> = {
  normal: '',
  explain: '',
  happy: '😊',
  surprised: '😮',
  thinking: '🤔',
  trouble: '😓',
};

/** セクション種別と、id の中間トークン（docs/04_要件定義.md 3.3 Q2-1）。 */
export const SECTION_TYPES = {
  introduction: 'intro',
  main: 'main',
  summary: 'summary',
  outro: 'outro',
} as const;
export type SectionType = keyof typeof SECTION_TYPES;
export const sectionTypeSchema = z.enum(
  Object.keys(SECTION_TYPES) as [SectionType, ...SectionType[]],
);

// --- ビジュアルの型（docs/04_要件定義.md 3.5）--------------------------------

const compareColumnSchema = z.object({
  title: z.string().min(1),
  items: z.array(z.string().min(1)).min(1).max(6),
});

export const visualSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('none'),
  }),
  z.object({
    type: z.literal('title'),
    text: z.string().min(1),
    subtitle: z.string().optional(),
  }),
  z.object({
    type: z.literal('bullets'),
    title: z.string().min(1),
    items: z.array(z.string().min(1)).min(1).max(6),
    /** 強調する項目の index（0 始まり）。 */
    highlight: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal('code'),
    language: z.string().min(1),
    code: z.string().min(1),
    /** 強調する行番号（1 始まり）。 */
    highlightLines: z.array(z.number().int().positive()).optional(),
    caption: z.string().optional(),
  }),
  z.object({
    type: z.literal('compare'),
    title: z.string().optional(),
    left: compareColumnSchema,
    right: compareColumnSchema,
  }),
  z.object({
    type: z.literal('image'),
    /** projects/<id>/assets/ からの相対パス。 */
    src: z.string().min(1),
    caption: z.string().optional(),
    fit: z.enum(['contain', 'cover']).default('contain'),
  }),
]);
export type Visual = z.infer<typeof visualSchema>;
export type VisualType = Visual['type'];

// --- セリフ ------------------------------------------------------------------

/** `s{セクション番号}_{種別}_{3桁連番}` 例: s3_main_004 */
export const LINE_ID_PATTERN = /^s(\d+)_([a-z]+)_(\d{3})$/;

export const lineSchema = z.object({
  id: z.string().regex(LINE_ID_PATTERN, 'id は s0_intro_001 の形式にする'),
  character: z.string().min(1),
  /**
   * 字幕にそのまま出る本文。
   * trim を先に掛ける。min(1) を先に置くと、空白だけの文字列が長さ判定を
   * 通り抜けてから空文字になる。
   */
  text: z.string().trim().min(1),
  /**
   * TTS に渡す読み。省略時は text をそのまま使う。
   * Irodori TTS に読み指定の手段がないため、字幕は原綴りのまま
   * 読みだけ差し替えたい場合に使う（docs/04_要件定義.md 4.5）。
   */
  reading: z.string().min(1).optional(),
  emotion: emotionSchema.default('normal'),
  /**
   * 表示するビジュアル。省略すると直前のセリフの表示をそのまま引き継ぐ。
   * 消したいときは明示的に {"type":"none"} と書く。
   */
  visual: visualSchema.optional(),
  /** 省略時は直前のセリフの BGM を継続する。 */
  bgm: z.string().min(1).optional(),
  /** このセリフの後に入れる間（秒）。省略時は既定値。 */
  pauseAfter: z.number().min(0).max(10).optional(),
});
export type Line = z.infer<typeof lineSchema>;

export const sectionSchema = z.object({
  type: sectionTypeSchema,
  name: z.string().min(1),
  lines: z.array(lineSchema).min(1),
});
export type Section = z.infer<typeof sectionSchema>;

// --- メタ情報 ----------------------------------------------------------------

export const metaSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id は英小文字・数字・ハイフン'),
  title: z.string().min(1),
  fps: z.number().int().positive().default(30),
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
  /** characters/<id>/ を参照する。1人でも成立する（docs/04_要件定義.md Q2-3）。 */
  characters: z.array(z.string().min(1)).min(1).max(2),
  /** 冒頭の BGM。line.bgm で切り替えられる。 */
  bgm: z.string().min(1).optional(),
});
export type Meta = z.infer<typeof metaSchema>;

export const scriptSchema = z.object({
  meta: metaSchema,
  sections: z.array(sectionSchema).min(1),
});
export type Script = z.infer<typeof scriptSchema>;

// --- 導出ヘルパー ------------------------------------------------------------

/** 全セクションのセリフを、出現順にセクション情報付きで平坦化する。 */
export function flattenLines(
  script: Script,
): { line: Line; section: Section; sectionIndex: number; lineIndex: number }[] {
  return script.sections.flatMap((section, sectionIndex) =>
    section.lines.map((line, lineIndex) => ({
      line,
      section,
      sectionIndex,
      lineIndex,
    })),
  );
}

/** TTS に渡すテキスト。読みの上書きと感情絵文字を適用する。 */
export function ttsText(line: Line): string {
  const base = line.reading ?? line.text;
  const emoji = EMOTION_EMOJI[line.emotion];
  return emoji ? `${base}${emoji}` : base;
}
