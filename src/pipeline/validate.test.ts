import { describe, expect, it } from 'vitest';
import { scriptSchema, type Script } from '../schema/script.js';
import { characterSchema, type Character } from '../schema/character.js';
import { validateDurations, validateScript, MAX_LINE_SECONDS } from './validate.js';

/**
 * 機械的チェックが本当に問題を捕まえるかを確かめる。
 *
 * 「正しい台本が通ること」だけを確かめても意味がない。壊れた台本が
 * ちゃんと止まることの方が重要なので、そちらを厚く書いている
 * （docs/04_要件定義.md 7章 / N5）。
 */

const kaede: Character = characterSchema.parse({
  id: 'kaede',
  displayName: '楓',
  color: '#2f6feb',
  position: 'left',
  appearance: { kind: 'placeholder', hue: 212, hair: 'long' },
  voice: { speed: 1 },
});

const tsumugi: Character = characterSchema.parse({
  id: 'tsumugi',
  displayName: '紬',
  color: '#d9457f',
  position: 'right',
  appearance: { kind: 'placeholder', hue: 338, hair: 'bob' },
  voice: { speed: 1 },
});

const characters = { kaede, tsumugi };

/** 検証を通る最小の台本。各テストはここから1箇所だけ壊す。 */
function baseScript(): Script {
  return scriptSchema.parse({
    meta: {
      id: 'test',
      title: 'テスト',
      characters: ['kaede', 'tsumugi'],
    },
    sections: [
      {
        type: 'introduction',
        name: '導入',
        lines: [
          { id: 's0_intro_001', character: 'kaede', text: 'こんにちは。' },
          { id: 's0_intro_002', character: 'tsumugi', text: 'よろしくお願いします。' },
        ],
      },
    ],
  });
}

/** 指定したコードの問題だけを取り出す。 */
function codes(script: Script): string[] {
  return validateScript(script, characters).map((i) => i.code);
}

describe('validateScript', () => {
  it('正しい台本は通す', () => {
    expect(validateScript(baseScript(), characters)).toEqual([]);
  });

  it('id の重複を検出する', () => {
    const script = baseScript();
    script.sections[0]!.lines[1]!.id = 's0_intro_001';
    expect(codes(script)).toContain('duplicate-id');
  });

  it('id のセクション番号がずれていたら検出する', () => {
    const script = baseScript();
    script.sections[0]!.lines[0]!.id = 's3_intro_001';
    expect(codes(script)).toContain('id-section-mismatch');
  });

  it('id の種別が section.type と合っていなければ検出する', () => {
    const script = baseScript();
    script.sections[0]!.lines[0]!.id = 's0_main_001';
    expect(codes(script)).toContain('id-type-mismatch');
  });

  it('meta.characters にない話者を検出する', () => {
    const script = baseScript();
    script.sections[0]!.lines[0]!.character = 'unknown';
    expect(codes(script)).toContain('unknown-character');
  });

  it('一度も話さないキャラクターの宣言を検出する', () => {
    const script = baseScript();
    script.sections[0]!.lines[1]!.character = 'kaede';
    expect(codes(script)).toContain('unused-character');
  });

  it('2行に収まらない字幕を検出する', () => {
    const script = baseScript();
    script.sections[0]!.lines[0]!.text = 'あ'.repeat(120);
    expect(codes(script)).toContain('subtitle-overflow');
  });

  it('ちょうど2行に収まる字幕は通す', () => {
    const script = baseScript();
    // 28em 上限 × 2行。全角 50 文字なら収まる。
    script.sections[0]!.lines[0]!.text = 'あ'.repeat(50);
    expect(codes(script)).not.toContain('subtitle-overflow');
  });

  it('存在しない BGM を検出する', () => {
    const script = baseScript();
    script.sections[0]!.lines[0]!.bgm = 'no-such-file.mp3';
    expect(codes(script)).toContain('missing-bgm');
  });

  it('存在しない画像を検出する', () => {
    const script = baseScript();
    script.sections[0]!.lines[0]!.visual = {
      type: 'image',
      src: 'no-such-image.png',
      fit: 'contain',
    };
    expect(codes(script)).toContain('missing-image');
  });

  it('問題を1件で打ち切らず全部返す', () => {
    const script = baseScript();
    script.sections[0]!.lines[0]!.character = 'unknown';
    script.sections[0]!.lines[1]!.text = 'あ'.repeat(120);
    const found = codes(script);
    expect(found).toContain('unknown-character');
    expect(found).toContain('subtitle-overflow');
  });
});

describe('scriptSchema', () => {
  it('空のセリフを弾く', () => {
    const result = scriptSchema.safeParse({
      meta: { id: 'test', title: 'テスト', characters: ['kaede'] },
      sections: [
        {
          type: 'introduction',
          name: '導入',
          lines: [{ id: 's0_intro_001', character: 'kaede', text: '   ' }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('id の命名規則違反を弾く', () => {
    const result = scriptSchema.safeParse({
      meta: { id: 'test', title: 'テスト', characters: ['kaede'] },
      sections: [
        {
          type: 'introduction',
          name: '導入',
          lines: [{ id: 'intro-1', character: 'kaede', text: 'あ' }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('未知の emotion を弾く', () => {
    const result = scriptSchema.safeParse({
      meta: { id: 'test', title: 'テスト', characters: ['kaede'] },
      sections: [
        {
          type: 'introduction',
          name: '導入',
          lines: [
            { id: 's0_intro_001', character: 'kaede', text: 'あ', emotion: 'angry' },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('未知のビジュアル型を弾く', () => {
    const result = scriptSchema.safeParse({
      meta: { id: 'test', title: 'テスト', characters: ['kaede'] },
      sections: [
        {
          type: 'introduction',
          name: '導入',
          lines: [
            {
              id: 's0_intro_001',
              character: 'kaede',
              text: 'あ',
              visual: { type: 'chart', data: [] },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('emotion を省略したら normal になる', () => {
    const script = baseScript();
    expect(script.sections[0]!.lines[0]!.emotion).toBe('normal');
  });
});

describe('validateDurations', () => {
  it('長すぎるセリフを検出する', () => {
    const issues = validateDurations([
      { lineId: 's0_intro_001', seconds: MAX_LINE_SECONDS + 1 },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('line-too-long');
  });

  it('上限内のセリフは通す', () => {
    expect(validateDurations([{ lineId: 's0_intro_001', seconds: 5 }])).toEqual([]);
  });
});
