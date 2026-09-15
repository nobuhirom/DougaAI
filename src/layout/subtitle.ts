/**
 * 日本語字幕の折り返しと禁則処理。
 *
 * Remotion は日本語の改行に公式対応していないため自前で実装する
 * （docs/04_要件定義.md 5.2）。ブラウザの改行任せにすると、行頭に句読点が
 * 来る・英単語が途中で割れるといった崩れが起きる。ここで確定させた行を
 * そのまま描画し、レンダー時に再計算はしない。
 */

import { SUBTITLE } from '../remotion/theme.js';

/**
 * 1行の最大幅（em）。字幕帯の実寸から導出する。
 *
 * 事例A は 30.93em という実測値を使っていたが、あれは向こうの字幕帯の寸法に
 * 紐づいた値でこちらには使えない。マジックナンバーを置くと検証を通ったのに
 * 実際にははみ出す、という一番まずい壊れ方をするため、描画に使う寸法から
 * 計算する（docs/04_要件定義.md 5.2）。
 *
 * SAFETY は全角1.0em / 半角0.55em という幅の見積もり誤差を吸収するための余裕。
 * Noto Sans JP の全角送りは 1.0em だが、欧文の実送り幅は字形ごとに違う。
 */
const SAFETY = 0.97;
export const MAX_LINE_WIDTH_EM =
  Math.floor(
    ((SUBTITLE.width - SUBTITLE.paddingX * 2) / SUBTITLE.fontSize) * SAFETY * 100,
  ) / 100;

/** 最大行数。これを超えるセリフは台本のミスとして扱う。 */
export const MAX_LINES = SUBTITLE.maxLines;

const WIDE_EM = 1.0;
const NARROW_EM = 0.55;

/** 行頭に置けない文字（句読点・閉じ括弧・小書き仮名・長音など）。 */
const NO_LINE_START = new Set(
  '、。，．・：；？！゛゜ヽヾゝゞ々ー」』）】〉》〕］｝〙〗｣”’%‰℃°' +
    'ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ' +
    ',.:;?!)]}>',
);

/** 行末に置けない文字（開き括弧など）。 */
const NO_LINE_END = new Set('「『（【〈《〔［｛〘〖｢“‘([{<￥＄');

/** 直前の数字と分離してはいけない単位文字。 */
const UNIT_AFTER_DIGIT = new Set(
  '年月日時分秒週円個人回本枚倍割番点件名歳％%℃度cmmkgKMGTBbit',
);

/** 1文字の表示幅を em で見積もる。全角 1.0em / 半角 0.55em。 */
export function charWidthEm(ch: string): number {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return 0;

  // 半角カタカナは narrow
  if (cp >= 0xff61 && cp <= 0xff9f) return NARROW_EM;

  const wide =
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK 部首・記号・句読点
    (cp >= 0x3041 && cp <= 0x33ff) || // かな・カナ・囲み CJK
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK 拡張A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 統合漢字
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || // ハングル音節
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 互換漢字
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) || // 全角形
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff) || // 絵文字
    (cp >= 0x20000 && cp <= 0x2fffd) ||
    (cp >= 0x30000 && cp <= 0x3fffd);

  return wide ? WIDE_EM : NARROW_EM;
}

/** 文字列の表示幅を em で見積もる。 */
export function measureEm(text: string): number {
  let total = 0;
  for (const ch of text) total += charWidthEm(ch);
  return total;
}

const isAsciiAlnum = (ch: string) => /[A-Za-z0-9]/.test(ch);
const isDigit = (ch: string) => /[0-9]/.test(ch);

/**
 * 分割してはいけない文字のかたまりに切る。
 *
 * 1. 連続する英数字は1かたまり（単語の途中で割らない）
 * 2. 数字＋単位は1かたまり（「30秒」を割らない）
 * 3. 行頭禁則文字は直前のかたまりに繋げる（追い出し）
 * 4. 行末禁則文字は直後のかたまりに繋げる
 */
export function toClusters(text: string): string[] {
  const chars = [...text];
  const clusters: string[] = [];

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;

    // 英数字の連なり。語中のピリオド・カンマ・ハイフン・アポストロフィも含める。
    if (isAsciiAlnum(ch)) {
      let word = ch;
      while (i + 1 < chars.length) {
        const next = chars[i + 1]!;
        if (isAsciiAlnum(next)) {
          word += next;
          i++;
          continue;
        }
        // 数字に挟まれた区切り記号（1,000 や 3.14）
        const after = chars[i + 2];
        if (
          (next === '.' || next === ',' || next === '-' || next === "'") &&
          after !== undefined &&
          isAsciiAlnum(after) &&
          isAsciiAlnum(chars[i]!)
        ) {
          word += next;
          i++;
          continue;
        }
        break;
      }
      // 数字＋単位は分離しない
      while (
        i + 1 < chars.length &&
        isDigit(word[word.length - 1] ?? '') &&
        UNIT_AFTER_DIGIT.has(chars[i + 1]!)
      ) {
        word += chars[i + 1]!;
        i++;
      }
      clusters.push(word);
      continue;
    }

    clusters.push(ch);
  }

  // 行頭禁則: 直前へ繋げる
  const merged: string[] = [];
  for (const cluster of clusters) {
    const first = [...cluster][0]!;
    if (NO_LINE_START.has(first) && merged.length > 0) {
      merged[merged.length - 1] += cluster;
    } else {
      merged.push(cluster);
    }
  }

  // 行末禁則: 直後へ繋げる（後ろから走査する）
  const result: string[] = [];
  for (let i = merged.length - 1; i >= 0; i--) {
    const cluster = merged[i]!;
    const chs = [...cluster];
    const last = chs[chs.length - 1]!;
    if (NO_LINE_END.has(last) && result.length > 0) {
      result[0] = cluster + result[0]!;
    } else {
      result.unshift(cluster);
    }
  }

  return result;
}

export interface WrapOptions {
  maxLineWidthEm?: number;
  maxLines?: number;
}

export interface WrapResult {
  /** 確定した各行。 */
  lines: string[];
  /** 各行の幅（em）。 */
  widths: number[];
  /** 収まらなかったか。true ならレンダー前に落とす。 */
  overflow: boolean;
  /** overflow の理由。 */
  reason?: string;
}

/**
 * セリフを字幕の行に折り返す。
 *
 * テキスト中の `\n` は強制改行として扱う。
 */
export function wrapSubtitle(text: string, options: WrapOptions = {}): WrapResult {
  const maxWidth = options.maxLineWidthEm ?? MAX_LINE_WIDTH_EM;
  const maxLines = options.maxLines ?? MAX_LINES;

  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    const clusters = toClusters(paragraph);
    let current = '';
    let currentWidth = 0;

    for (const cluster of clusters) {
      const width = measureEm(cluster);

      // かたまり単体で1行に収まらない場合は、やむを得ず文字単位で割る。
      // （検証で落とす対象だが、表示は破綻させない）
      if (width > maxWidth) {
        if (current !== '') {
          lines.push(current);
          current = '';
          currentWidth = 0;
        }
        let chunk = '';
        let chunkWidth = 0;
        for (const ch of cluster) {
          const w = charWidthEm(ch);
          if (chunkWidth + w > maxWidth && chunk !== '') {
            lines.push(chunk);
            chunk = '';
            chunkWidth = 0;
          }
          chunk += ch;
          chunkWidth += w;
        }
        current = chunk;
        currentWidth = chunkWidth;
        continue;
      }

      if (currentWidth + width > maxWidth && current !== '') {
        lines.push(current);
        current = cluster;
        currentWidth = width;
      } else {
        current += cluster;
        currentWidth += width;
      }
    }

    lines.push(current);
  }

  const widths = lines.map(measureEm);
  const tooManyLines = lines.length > maxLines;
  const tooWide = widths.some((w) => w > maxWidth + 1e-9);

  return {
    lines,
    widths,
    overflow: tooManyLines || tooWide,
    reason: tooManyLines
      ? `${maxLines}行に収まらない（${lines.length}行になった）`
      : tooWide
        ? `1行が最大幅 ${maxWidth}em を超えた`
        : undefined,
  };
}
