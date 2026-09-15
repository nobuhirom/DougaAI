import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { DIRS } from './paths.js';
import { BACKEND_IDS, type BackendId } from './tts.js';
import { readVoiceLibrary, validateVoiceLibrary } from './voices.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

/**
 * 実行環境の確認。
 *
 * 「なぜか音が出ない」「なぜか字が化ける」を後から追うのは高くつく。
 * 前提が揃っているかを先に一覧で出す。
 */

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  /** false なら、失敗してもビルド自体は進められる。 */
  required: boolean;
}

async function checkBinary(
  bin: string,
  args: string[],
  extract: (stdout: string) => string,
): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync(bin, args);
    return { name: bin, ok: true, detail: extract(stdout), required: true };
  } catch {
    return {
      name: bin,
      ok: false,
      detail: '見つからない（brew install ffmpeg）',
      required: true,
    };
  }
}

function checkFonts(): CheckResult {
  const packages = ['@fontsource/noto-sans-jp', '@fontsource/roboto-mono'];
  const missing: string[] = [];
  for (const name of packages) {
    try {
      const pkg = path.dirname(require.resolve(`${name}/package.json`));
      if (!fs.existsSync(path.join(pkg, 'files'))) missing.push(name);
    } catch {
      missing.push(name);
    }
  }
  return {
    name: 'フォント',
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? 'Noto Sans JP / Roboto Mono'
        : `不足: ${missing.join(', ')}（npm install）`,
    required: true,
  };
}

/**
 * Irodori-TTS-Server に届くか確認する。
 *
 * サーバーを立てていない状態でも他の確認は進めたいので、required は false。
 * 実際に build するときは --tts irodori を選んだ時点で失敗する。
 */
async function checkIrodori(): Promise<CheckResult> {
  const baseUrl = process.env.IRODORI_BASE_URL ?? 'http://127.0.0.1:8088/v1';
  try {
    const response = await fetch(`${baseUrl}/models`, {
      signal: AbortSignal.timeout(3000),
      headers: process.env.IRODORI_API_KEY
        ? { authorization: `Bearer ${process.env.IRODORI_API_KEY}` }
        : {},
    });
    if (!response.ok) {
      return {
        name: 'Irodori TTS',
        ok: false,
        detail: `${baseUrl} が ${response.status} を返した`,
        required: false,
      };
    }
    const body = (await response.json()) as { data?: { id?: string }[] };
    const models = (body.data ?? []).map((m) => m.id).filter(Boolean);
    return {
      name: 'Irodori TTS',
      ok: true,
      detail: `${baseUrl}${models.length > 0 ? ` / モデル: ${models.join(', ')}` : ''}`,
      required: false,
    };
  } catch (error) {
    return {
      name: 'Irodori TTS',
      ok: false,
      detail:
        `${baseUrl} に接続できない（${error instanceof Error ? error.message : String(error)}）。` +
        'サーバー未起動なら下書きは --tts macos-say で進められる',
      required: false,
    };
  }
}

async function checkSay(): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync('say', ['-v', '?']);
    const japanese = stdout
      .split('\n')
      .filter((l) => l.includes('ja_JP'))
      .length;
    return {
      name: 'macOS say',
      ok: japanese > 0,
      detail:
        japanese > 0
          ? `日本語音声 ${japanese} 種`
          : '日本語音声が入っていない（システム設定 > 音声入力と読み上げ）',
      required: false,
    };
  } catch {
    return {
      name: 'macOS say',
      ok: false,
      detail: '使えない（macOS 以外）',
      required: false,
    };
  }
}

function checkVoices(): CheckResult {
  const issues = validateVoiceLibrary();
  let count = 0;
  try { count = readVoiceLibrary().voices.length; } catch { /* issues に出る */ }
  return {
    name: '声のライブラリ',
    ok: issues.length === 0 && count > 0,
    detail: issues.length > 0 ? issues.map((i) => i.message).join(' / ') : count > 0 ? `${count} 声（voices/library.json）` : 'voices/library.json に声がない',
    required: false,
  };
}

function checkProjects(): CheckResult {
  const projects = fs.existsSync(DIRS.projects)
    ? fs
        .readdirSync(DIRS.projects, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(DIRS.projects, e.name, 'script.json')))
        .map((e) => e.name)
    : [];
  return {
    name: 'プロジェクト',
    ok: projects.length > 0,
    detail: projects.length > 0 ? projects.join(', ') : 'projects/ に台本がない',
    required: false,
  };
}

function checkCharacters(): CheckResult {
  const found = fs.existsSync(DIRS.characters)
    ? fs
        .readdirSync(DIRS.characters, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(DIRS.characters, e.name, 'character.json')))
        .map((e) => e.name)
    : [];
  return {
    name: 'キャラクター',
    ok: found.length > 0,
    detail: found.length > 0 ? found.join(', ') : 'characters/ に定義がない',
    required: false,
  };
}

export async function doctor(): Promise<CheckResult[]> {
  return [
    await checkBinary('ffmpeg', ['-version'], (out) => out.split('\n')[0] ?? ''),
    await checkBinary('ffprobe', ['-version'], (out) => out.split('\n')[0] ?? ''),
    checkFonts(),
    await checkIrodori(),
    await checkSay(),
    checkVoices(),
    checkCharacters(),
    checkProjects(),
  ];
}

/** 選んだバックエンドが使える状態かだけを返す。 */
export async function backendAvailable(id: BackendId): Promise<CheckResult> {
  if (!(BACKEND_IDS as readonly string[]).includes(id)) {
    throw new Error(`未知のバックエンド: ${id}`);
  }
  return id === 'irodori' ? checkIrodori() : checkSay();
}
