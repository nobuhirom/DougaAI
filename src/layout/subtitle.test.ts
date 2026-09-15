import { describe, expect, it } from 'vitest';
import {
  MAX_LINE_WIDTH_EM,
  charWidthEm,
  measureEm,
  toClusters,
  wrapSubtitle,
} from './subtitle.js';

describe('charWidthEm', () => {
  it('全角を 1.0em として数える', () => {
    expect(charWidthEm('あ')).toBe(1.0);
    expect(charWidthEm('漢')).toBe(1.0);
    expect(charWidthEm('、')).toBe(1.0);
    expect(charWidthEm('Ａ')).toBe(1.0);
  });

  it('半角を 0.55em として数える', () => {
    expect(charWidthEm('A')).toBe(0.55);
    expect(charWidthEm('1')).toBe(0.55);
    expect(charWidthEm(' ')).toBe(0.55);
  });

  it('半角カタカナは半角として数える', () => {
    expect(charWidthEm('ｱ')).toBe(0.55);
  });
});

describe('measureEm', () => {
  it('混在した文字列の幅を足し合わせる', () => {
    // 全角3 + 半角2
    expect(measureEm('あいうAB')).toBeCloseTo(3 * 1.0 + 2 * 0.55);
  });
});

describe('toClusters', () => {
  it('英単語を途中で割らない', () => {
    expect(toClusters('Remotionを使う')).toEqual(['Remotion', 'を', '使', 'う']);
  });

  it('桁区切りや小数点を含む数値を1かたまりにする', () => {
    expect(toClusters('1,000と3.14')).toEqual(['1,000', 'と', '3.14']);
  });

  it('数字と単位を分離しない', () => {
    expect(toClusters('30秒かかる')).toEqual(['30秒', 'か', 'か', 'る']);
  });

  it('行頭禁則文字を直前のかたまりに繋げる', () => {
    // 「、」「。」が単独のかたまりにならない
    expect(toClusters('です。')).toEqual(['で', 'す。']);
    expect(toClusters('はい、そう')).toEqual(['は', 'い、', 'そ', 'う']);
  });

  it('閉じ括弧と小書き仮名も行頭に来ないよう繋げる', () => {
    expect(toClusters('（A）')).toEqual(['（A）']);
    expect(toClusters('あっ')).toEqual(['あっ']);
  });

  it('行末禁則文字を直後のかたまりに繋げる', () => {
    expect(toClusters('見「本')).toEqual(['見', '「本']);
  });

  it('文頭の禁則文字は単独で残す（繋げる先がない）', () => {
    expect(toClusters('。あ')).toEqual(['。', 'あ']);
  });
});

describe('wrapSubtitle', () => {
  it('短いセリフは1行に収める', () => {
    const r = wrapSubtitle('こんにちは');
    expect(r.lines).toEqual(['こんにちは']);
    expect(r.overflow).toBe(false);
  });

  it('最大幅を超えたら2行に折り返す', () => {
    const text = 'あ'.repeat(40);
    const r = wrapSubtitle(text);
    expect(r.lines).toHaveLength(2);
    expect(r.overflow).toBe(false);
    expect(r.lines.join('')).toBe(text);
    for (const w of r.widths) expect(w).toBeLessThanOrEqual(MAX_LINE_WIDTH_EM);
  });

  it('句読点を行頭に送らない', () => {
    // 30文字目がちょうど行末に来て、31文字目が「、」になるよう調整する
    const text = `${'あ'.repeat(30)}、${'い'.repeat(20)}`;
    const r = wrapSubtitle(text);
    for (const line of r.lines) {
      expect(line.startsWith('、')).toBe(false);
    }
  });

  it('英単語を行またぎで割らない', () => {
    const text = `${'あ'.repeat(28)}Remotionを使います`;
    const r = wrapSubtitle(text);
    const joined = r.lines.join('');
    expect(joined).toBe(text);
    // Remotion がどちらか片方の行に丸ごと含まれる
    expect(r.lines.some((l) => l.includes('Remotion'))).toBe(true);
  });

  it('3行になるセリフを overflow として報告する', () => {
    const r = wrapSubtitle('あ'.repeat(80));
    expect(r.overflow).toBe(true);
    expect(r.lines.length).toBeGreaterThan(2);
    expect(r.reason).toContain('2行に収まらない');
  });

  it('改行文字を強制改行として扱う', () => {
    const r = wrapSubtitle('前半\n後半');
    expect(r.lines).toEqual(['前半', '後半']);
    expect(r.overflow).toBe(false);
  });

  it('折り返しても文字を失わない', () => {
    const text = 'Remotion は React で動画を書くフレームワークで、1,000 行のコードも 30秒 で描画します。';
    const r = wrapSubtitle(text, { maxLines: 10 });
    expect(r.lines.join('')).toBe(text);
  });

  it('1かたまりが最大幅を超える場合も表示は破綻させない', () => {
    const r = wrapSubtitle('A'.repeat(200));
    expect(r.overflow).toBe(true);
    for (const w of r.widths) expect(w).toBeLessThanOrEqual(MAX_LINE_WIDTH_EM + 1e-9);
  });
});
