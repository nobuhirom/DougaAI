import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Character } from '../schema/character.js';
import {
  MANIFEST_VERSION,
  manifestSchema,
  type Manifest,
  type ManifestLine,
} from '../schema/manifest.js';
import { flattenLines, ttsText, type Script, type Visual } from '../schema/script.js';
import { wrapSubtitle } from '../layout/subtitle.js';
import { checkFfmpeg, mouthEnvelope, probeDurationSec } from './audio.js';
import {
  DIRS,
  STATIC,
  characterDir,
  projectAssetsDir,
  publicPath,
  manifestPath,
} from './paths.js';
import {
  createBackend,
  synthesizeCached,
  type BackendId,
  type TtsBackend,
} from './tts.js';
import {
  ValidationError,
  loadCharacter,
  loadScript,
  validateDurations,
  validateScript,
} from './validate.js';

/**
 * 台本 → マニフェストのビルド。
 *
 * 検証 → 音声生成 → 尺の確定 → アセットのステージング、の順に進む。
 * レンダリング時に計算するものを残さないのが目的で、Remotion 側は
 * ここで確定した数値を読むだけになる（docs/04_要件定義.md N1）。
 */

/** セリフ間に入れる既定の間（秒）。line.pauseAfter で上書きできる。 */
export const DEFAULT_PAUSE_SEC = 0.2;

const require = createRequire(import.meta.url);

export interface BuildOptions {
  projectId: string;
  backendId: BackendId;
  /** キャッシュを無視して音声を作り直す。 */
  force?: boolean;
  /** 進捗の通知先。 */
  onProgress?: (message: string) => void;
}

export interface BuildResult {
  manifest: Manifest;
  backend: TtsBackend;
  synthesized: number;
  cached: number;
}

/** public/ 配下へ複製する。同一内容ならスキップして無駄な I/O を避ける。 */
async function stage(source: string, relative: string): Promise<void> {
  const target = publicPath(relative);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    const [a, b] = [fs.statSync(source), fs.statSync(target)];
    if (a.size === b.size && b.mtimeMs >= a.mtimeMs) return;
  }
  await fsp.copyFile(source, target);
}

/** フォントを public/fonts/ に置く。システムフォント名には依存させない（N4）。 */
async function stageFonts(): Promise<{
  regular: string;
  bold: string;
  mono: string;
}> {
  const sources = {
    regular: ['@fontsource/noto-sans-jp', 'noto-sans-jp-japanese-400-normal.woff2'],
    bold: ['@fontsource/noto-sans-jp', 'noto-sans-jp-japanese-700-normal.woff2'],
    mono: ['@fontsource/roboto-mono', 'roboto-mono-latin-400-normal.woff2'],
  } as const;

  const staged: Record<string, string> = {};
  for (const [role, [pkgName, file]] of Object.entries(sources)) {
    const pkg = path.dirname(require.resolve(`${pkgName}/package.json`));
    const source = path.join(pkg, 'files', file);
    if (!fs.existsSync(source)) {
      throw new Error(`フォントが見つからない: ${source}。npm install をやり直す`);
    }
    await stage(source, STATIC.font(file));
    staged[role] = STATIC.font(file);
  }

  return staged as { regular: string; bold: string; mono: string };
}

export async function build(options: BuildOptions): Promise<BuildResult> {
  const { projectId, backendId, force = false } = options;
  const notify = options.onProgress ?? (() => {});

  await checkFfmpeg();

  // --- 読み込みと検証（チェック1〜6）---
  const script: Script = loadScript(projectId);
  if (script.meta.id !== projectId) {
    throw new ValidationError([
      {
        code: 'project-id-mismatch',
        message: `projects/${projectId}/script.json の meta.id が "${script.meta.id}" になっている`,
      },
    ]);
  }

  const characters: Record<string, Character> = {};
  for (const id of script.meta.characters) {
    characters[id] = loadCharacter(id);
  }

  const issues = validateScript(script, characters);
  if (issues.length > 0) throw new ValidationError(issues);

  const backend = createBackend(backendId);
  const entries = flattenLines(script);
  notify(`${entries.length} セリフ / TTS: ${backend.id}`);

  // --- 音声の生成と解析 ---
  if (force) {
    await fsp.rm(publicPath(`audio/${projectId}`), { recursive: true, force: true });
  }

  const fonts = await stageFonts();

  const lines: ManifestLine[] = [];
  const durations: { lineId: string; seconds: number }[] = [];
  let startFrame = 0;
  let currentBgm: string | null = script.meta.bgm
    ? STATIC.bgm(script.meta.bgm)
    : null;
  // visual と bgm は同じ規則で引き継ぐ。省略したセリフは直前の表示を保つ。
  // 掛け合いが数行続く間ずっとスライドを出しておきたい、という書き方に合わせる。
  // 明示的に消すときは {"type":"none"} と書く。
  let currentVisual: Visual = { type: 'none' };
  let synthesized = 0;
  let cached = 0;

  const { fps } = script.meta;

  for (const { line, section, sectionIndex, lineIndex } of entries) {
    const character = characters[line.character];
    if (!character) {
      // validateScript が先に落としているので、ここへは来ない
      throw new ValidationError([
        {
          code: 'unknown-character',
          lineId: line.id,
          message: `キャラクター定義がない: ${line.character}`,
        },
      ]);
    }

    const request = { text: ttsText(line), character };
    const result = force
      ? await (async () => {
          const dir = DIRS.build;
          await fsp.mkdir(dir, { recursive: true });
          const temp = path.join(dir, `_force-${line.id}.wav`);
          await backend.synthesize(request, temp);
          return { file: temp, cached: false };
        })()
      : await synthesizeCached(request, backend);

    if (result.cached) cached++;
    else synthesized++;

    const audioDurationSec = await probeDurationSec(result.file);
    durations.push({ lineId: line.id, seconds: audioDurationSec });

    const speechFrames = Math.max(1, Math.ceil(audioDurationSec * fps));
    const pauseSec = line.pauseAfter ?? DEFAULT_PAUSE_SEC;
    const durationInFrames = speechFrames + Math.round(pauseSec * fps);

    const mouth = await mouthEnvelope(result.file, { fps, frameCount: speechFrames });

    // 音声を public/ へ置く。ファイル名は id にして、どのセリフか追えるようにする。
    const audioRelative = STATIC.audio(projectId, `${line.id}.wav`);
    await stage(result.file, audioRelative);
    if (force) await fsp.rm(result.file, { force: true });

    if (line.bgm) currentBgm = STATIC.bgm(line.bgm);
    if (line.visual) currentVisual = line.visual;

    const wrapped = wrapSubtitle(line.text);

    lines.push({
      id: line.id,
      sectionIndex,
      sectionType: section.type,
      sectionName: section.name,
      lineIndex,
      character: line.character,
      text: line.text,
      emotion: line.emotion,
      visual: currentVisual,
      bgm: currentBgm,
      audio: audioRelative,
      audioDurationSec,
      startFrame,
      speechFrames,
      durationInFrames,
      subtitleLines: wrapped.lines,
      mouth,
    });

    startFrame += durationInFrames;
    notify(
      `  ${line.id} ${audioDurationSec.toFixed(2)}s ${result.cached ? '(cache)' : ''}`,
    );
  }

  // --- チェック8: 尺の異常 ---
  const durationIssues = validateDurations(durations);
  if (durationIssues.length > 0) throw new ValidationError(durationIssues);

  // --- チェック7: 音声の欠落 ---
  const missingAudio = lines
    .filter((l) => {
      const file = publicPath(l.audio);
      return !fs.existsSync(file) || fs.statSync(file).size === 0;
    })
    .map((l) => ({
      code: 'missing-audio',
      lineId: l.id,
      message: `音声が public/${l.audio} に置かれていない`,
    }));
  if (missingAudio.length > 0) throw new ValidationError(missingAudio);

  // --- 残りのアセットをステージング ---
  await stageBgm(lines);
  await stageCharacterSprites(characters);
  await stageProjectImages(script);

  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    builtAt: new Date().toISOString(),
    meta: script.meta,
    characters,
    fonts,
    totalDurationInFrames: Math.max(1, startFrame),
    lines,
  };

  // 自分が書いたものを自分のスキーマで検証する。構造の取りこぼしをここで捕まえる。
  const parsed = manifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => ({
        code: 'manifest-invalid',
        message: `${i.path.join('.')}: ${i.message}`,
      })),
    );
  }

  const serialized = `${JSON.stringify(parsed.data, null, 2)}\n`;

  const file = manifestPath(projectId);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, serialized, 'utf-8');

  // Remotion 側は calculateMetadata でこれを fetch して尺と解像度を決める。
  const staticManifest = publicPath(STATIC.manifest(projectId));
  await fsp.mkdir(path.dirname(staticManifest), { recursive: true });
  await fsp.writeFile(staticManifest, serialized, 'utf-8');

  return { manifest: parsed.data, backend, synthesized, cached };
}

async function stageBgm(lines: ManifestLine[]): Promise<void> {
  const used = new Set(lines.map((l) => l.bgm).filter((b): b is string => b !== null));
  for (const relative of used) {
    const file = path.basename(relative);
    await stage(path.join(DIRS.bgm, file), relative);
  }
}

async function stageCharacterSprites(
  characters: Record<string, Character>,
): Promise<void> {
  for (const [id, character] of Object.entries(characters)) {
    if (character.appearance.kind !== 'sprite') continue;
    const dir = characterDir(id);
    const files = [
      ...Object.values(character.appearance.expressions),
      ...(character.appearance.mouth
        ? Object.values(character.appearance.mouth.frames)
        : []),
    ];
    for (const file of files) {
      await stage(path.join(dir, file), STATIC.characterSprite(id, file));
    }
  }
}

async function stageProjectImages(script: Script): Promise<void> {
  for (const { line } of flattenLines(script)) {
    if (line.visual?.type !== 'image') continue;
    await stage(
      path.join(projectAssetsDir(script.meta.id), line.visual.src),
      STATIC.projectAsset(script.meta.id, line.visual.src),
    );
  }
}

/** 既存のマニフェストを読む。無ければ null。 */
export function readManifest(projectId: string): Manifest | null {
  const file = manifestPath(projectId);
  if (!fs.existsSync(file)) return null;
  const parsed = manifestSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf-8')));
  return parsed.success ? parsed.data : null;
}
