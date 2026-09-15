import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { characterSchema, type Character } from '../schema/character.js';
import {
  LINE_ID_PATTERN,
  SECTION_TYPES,
  flattenLines,
  scriptSchema,
  type Script,
} from '../schema/script.js';
import { MAX_LINES, MAX_LINE_WIDTH_EM, wrapSubtitle } from '../layout/subtitle.js';
import { DIRS, characterConfigPath, projectAssetsDir, scriptPath } from './paths.js';
import { validateVoiceLibrary, voiceById } from './voices.js';

/**
 * レンダリング前の機械的チェック（docs/04_要件定義.md 7章）。
 *
 * AI レビューより手前に置き、落とせるものは全部ここで落とす。
 * 警告ではなくエラーにする — サイレント失敗を作らないため（N5）。
 */

export interface Issue {
  code: string;
  message: string;
  /** 該当するセリフ。台本全体の問題なら undefined。 */
  lineId?: string;
}

export class ValidationError extends Error {
  constructor(readonly issues: Issue[]) {
    super(`検証で ${issues.length} 件の問題が見つかった`);
    this.name = 'ValidationError';
  }
}

/** 1セリフの上限。TTS の暴走や台本の事故を検知する。 */
export const MAX_LINE_SECONDS = 30;

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

/** zod のエラーを読める1行にする。 */
function formatZodError(error: z.ZodError): Issue[] {
  return error.issues.map((issue) => ({
    code: 'schema',
    message: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
  }));
}

export function loadScript(projectId: string): Script {
  const file = scriptPath(projectId);
  if (!fs.existsSync(file)) {
    throw new ValidationError([
      { code: 'missing-script', message: `台本が見つからない: ${file}` },
    ]);
  }
  const parsed = scriptSchema.safeParse(readJson(file));
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
  return parsed.data;
}

export function loadCharacter(characterId: string): Character {
  const file = characterConfigPath(characterId);
  if (!fs.existsSync(file)) {
    throw new ValidationError([
      {
        code: 'missing-character',
        message: `キャラクター定義が見つからない: ${file}`,
      },
    ]);
  }
  const parsed = characterSchema.safeParse(readJson(file));
  if (!parsed.success) {
    throw new ValidationError(
      formatZodError(parsed.error).map((i) => ({
        ...i,
        message: `characters/${characterId}: ${i.message}`,
      })),
    );
  }
  if (parsed.data.id !== characterId) {
    throw new ValidationError([
      {
        code: 'character-id-mismatch',
        message: `characters/${characterId}/character.json の id が "${parsed.data.id}" になっている`,
      },
    ]);
  }
  return parsed.data;
}

/**
 * 台本を検証する。チェック1〜6を実行し、見つかった問題をすべて返す。
 * 1件でも返ってきたらビルドを止める。
 */
export function validateScript(
  script: Script,
  characters: Record<string, Character>,
): Issue[] {
  const issues: Issue[] = [];
  const entries = flattenLines(script);

  // --- 2. id の一意性と命名規則 ---
  const seen = new Map<string, number>();
  for (const { line, section, sectionIndex } of entries) {
    const count = seen.get(line.id) ?? 0;
    seen.set(line.id, count + 1);
    if (count > 0) {
      issues.push({
        code: 'duplicate-id',
        lineId: line.id,
        message: `id が重複している（${count + 1} 回目の出現）`,
      });
    }

    const m = LINE_ID_PATTERN.exec(line.id);
    if (m) {
      const [, idSection, idType] = m;
      const expectedType = SECTION_TYPES[section.type];
      if (Number(idSection) !== sectionIndex) {
        issues.push({
          code: 'id-section-mismatch',
          lineId: line.id,
          message: `id のセクション番号が実際の位置（s${sectionIndex}）と合っていない`,
        });
      }
      if (idType !== expectedType) {
        issues.push({
          code: 'id-type-mismatch',
          lineId: line.id,
          message: `id の種別が section.type（${section.type} → ${expectedType}）と合っていない`,
        });
      }
    }
  }

  for (const { line } of entries) {
    // --- 6. 空テキスト ---
    if (line.text.trim() === '') {
      issues.push({ code: 'empty-text', lineId: line.id, message: 'text が空' });
      continue;
    }

    // --- 5. キャラクター参照 ---
    if (!script.meta.characters.includes(line.character)) {
      issues.push({
        code: 'unknown-character',
        lineId: line.id,
        message: `meta.characters にない話者 "${line.character}" が指定されている`,
      });
    }

    // --- 3. 字幕のはみ出し ---
    const wrapped = wrapSubtitle(line.text);
    if (wrapped.overflow) {
      issues.push({
        code: 'subtitle-overflow',
        lineId: line.id,
        message: `字幕が収まらない（${wrapped.reason}）。最大 ${MAX_LINES} 行 × ${MAX_LINE_WIDTH_EM}em: 「${line.text}」`,
      });
    }

    // --- 4. アセット参照（画像）---
    if (line.visual?.type === 'image') {
      const file = path.join(projectAssetsDir(script.meta.id), line.visual.src);
      if (!fs.existsSync(file)) {
        issues.push({
          code: 'missing-image',
          lineId: line.id,
          message: `画像が見つからない: projects/${script.meta.id}/assets/${line.visual.src}`,
        });
      }
    }

    // --- 4. アセット参照（BGM）---
    if (line.bgm && !fs.existsSync(path.join(DIRS.bgm, line.bgm))) {
      issues.push({
        code: 'missing-bgm',
        lineId: line.id,
        message: `BGM が見つからない: assets/bgm/${line.bgm}`,
      });
    }
  }

  if (script.meta.bgm && !fs.existsSync(path.join(DIRS.bgm, script.meta.bgm))) {
    issues.push({
      code: 'missing-bgm',
      message: `meta.bgm が見つからない: assets/bgm/${script.meta.bgm}`,
    });
  }

  // --- 4. アセット参照（表情スプライト）---
  for (const [characterId, character] of Object.entries(characters)) {
    if (character.appearance.kind !== 'sprite') continue;
    const dir = path.join(DIRS.characters, characterId);
    for (const [emotion, file] of Object.entries(character.appearance.expressions)) {
      if (!fs.existsSync(path.join(dir, file))) {
        issues.push({
          code: 'missing-expression',
          message: `表情スプライトが見つからない: characters/${characterId}/${file}（${emotion}）`,
        });
      }
    }
    const mouth = character.appearance.mouth;
    if (mouth) {
      for (const [state, file] of Object.entries(mouth.frames)) {
        if (!fs.existsSync(path.join(dir, file))) {
          issues.push({
            code: 'missing-mouth',
            message: `口スプライトが見つからない: characters/${characterId}/${file}（${state}）`,
          });
        }
      }
    }
  }

  // --- 4. 声の参照（ライブラリに登録されているか）---
  issues.push(...validateVoiceLibrary());
  for (const [characterId, character] of Object.entries(characters)) {
    if (!voiceById(character.voice.id)) {
      issues.push({
        code: 'unknown-voice',
        message: `characters/${characterId} の voice.id "${character.voice.id}" が voices/library.json にない`,
      });
    }
  }

  // 使われていないキャラクターの宣言も問題として扱う（台本のミスの兆候）
  const speakers = new Set(entries.map((e) => e.line.character));
  for (const declared of script.meta.characters) {
    if (!speakers.has(declared)) {
      issues.push({
        code: 'unused-character',
        message: `meta.characters の "${declared}" が一度も話していない`,
      });
    }
  }

  return issues;
}

/** チェック8（尺の異常）。音声生成後に実行する。 */
export function validateDurations(
  durations: { lineId: string; seconds: number }[],
): Issue[] {
  return durations
    .filter((d) => d.seconds > MAX_LINE_SECONDS)
    .map((d) => ({
      code: 'line-too-long',
      lineId: d.lineId,
      message: `1セリフが ${d.seconds.toFixed(1)} 秒ある（上限 ${MAX_LINE_SECONDS} 秒）。TTS が暴走している可能性がある`,
    }));
}

/** 人が読める形に整形する。 */
export function formatIssues(issues: Issue[]): string {
  return issues
    .map((i) => `  [${i.code}]${i.lineId ? ` ${i.lineId}` : ''} ${i.message}`)
    .join('\n');
}
