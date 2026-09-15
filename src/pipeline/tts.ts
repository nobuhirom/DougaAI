import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Character } from '../schema/character.js';
import type { Voice } from '../schema/voice.js';
import { audioCacheDir } from './paths.js';
import { referencePath } from './voices.js';

const execFileAsync = promisify(execFile);

/**
 * 音声合成。
 *
 * バックエンドは2つある。どちらを使うかは `--tts` で明示的に選ぶ。
 * 一方が失敗したときに黙ってもう一方へ切り替えることはしない。
 * 気づかないうちに下書き音声で本番動画が焼けるのを防ぐため（N5）。
 *
 * - `irodori`   公開用。Irodori TTS（docs/03_方式決定.md 決定3）
 * - `macos-say` 下書き用。尺・口パク・字幕・レンダリングの検証に使う
 *
 * 声はライブラリ（voices/library.json）で管理し、キャラクターは id で参照する。
 * 生成はセリフ単位でキャッシュする（docs/04_要件定義.md 4.2 / N2）。
 */

export interface TtsRequest {
  /** TTS に渡す最終テキスト（読みの上書きと感情絵文字が適用済み）。 */
  text: string;
  character: Character;
  voice: Voice;
}

export interface TtsBackend {
  readonly id: string;
  /** キャッシュキーに混ぜる。変わると全音声が再生成される。 */
  readonly version: string;
  /** 公開する動画に使ってよい音声か。 */
  readonly productionReady: boolean;
  synthesize(request: TtsRequest, outFile: string): Promise<void>;
}

/** キャラ側の上書きがあればそちら、無ければライブラリの話速。 */
export const effectiveSpeed = (request: TtsRequest): number =>
  request.character.voice.speed ?? request.voice.speed;

// --- Irodori TTS ------------------------------------------------------------

/** Irodori-TTS-Server の既定ポートは 8088（README）。 */
const DEFAULT_IRODORI_BASE_URL = 'http://127.0.0.1:8088/v1';

/**
 * Irodori-TTS-Server（OpenAI TTS 互換 API）を叩く。
 *
 * https://github.com/Aratako/Irodori-TTS-Server の README に従う:
 * - `voice` はサーバーが IRODORI_VOICES_DIR から解決する ID。参照音声が無い声は "none"
 * - キャプション（VoiceDesign）と seed は `irodori` オブジェクトで渡す
 * - `seed` を固定して、同じテキストからは同じ音声が出るようにする（N1）
 *
 * サーバーが受け付けないフィールドがあった場合、推測で補正せずエラーをそのまま投げる。
 */
export class IrodoriBackend implements TtsBackend {
  readonly id = 'irodori';
  readonly productionReady = true;

  constructor(
    private readonly baseUrl = process.env.IRODORI_BASE_URL ?? DEFAULT_IRODORI_BASE_URL,
    private readonly model = process.env.IRODORI_MODEL ?? 'irodori-tts',
    private readonly apiKey = process.env.IRODORI_API_KEY,
  ) {}

  get version(): string {
    return `${this.id}:${this.model}:v2`;
  }

  async synthesize(request: TtsRequest, outFile: string): Promise<void> {
    const { voice, text } = request;
    const hasReference = referencePath(voice) !== null;

    const body: Record<string, unknown> = {
      model: this.model,
      input: text,
      voice: hasReference ? voice.id : 'none',
      response_format: 'wav',
      speed: effectiveSpeed(request),
      irodori: {
        seed: voice.seed,
        ...(voice.caption ? { caption: voice.caption } : {}),
      },
    };

    const response = await fetch(`${this.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Irodori TTS が ${response.status} ${response.statusText} を返した。` +
          `${this.baseUrl} でサーバーが動いているか確認する（tools/irodori/start.sh）。${detail ? `\n${detail}` : ''}`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0) throw new Error('Irodori TTS が空の音声を返した');
    await fsp.writeFile(outFile, buffer);
  }
}

// --- macOS say（下書き用）----------------------------------------------------

/** 絵文字による感情制御は Irodori 固有。say には渡さない。 */
function stripEmoji(text: string): string {
  return text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim();
}

/**
 * macOS 標準の `say` で合成する。
 * 公開する動画の音声ではない。配管の検証に使う。
 */
export class MacosSayBackend implements TtsBackend {
  readonly id = 'macos-say';
  readonly version = 'macos-say:1';
  readonly productionReady = false;

  async synthesize(request: TtsRequest, outFile: string): Promise<void> {
    const { character, text } = request;
    const spoken = stripEmoji(text);
    if (spoken === '') throw new Error('読み上げるテキストが空になった');

    const aiff = `${outFile}.aiff`;
    // say の -r は words per minute。日本語では文字レートに近い挙動をする。
    const rate = Math.round(180 * effectiveSpeed(request));
    try {
      await execFileAsync('say', ['-v', character.voice.systemVoice, '-r', String(rate), '-o', aiff, spoken]);
      // 出力先は一時ファイル（.tmp）なので、拡張子から形式を推測させない。
      await execFileAsync('ffmpeg', ['-v', 'error', '-y', '-i', aiff, '-ar', '48000', '-ac', '1', '-f', 'wav', outFile]);
    } finally {
      await fsp.rm(aiff, { force: true });
    }
  }
}

export const BACKEND_IDS = ['irodori', 'macos-say'] as const;
export type BackendId = (typeof BACKEND_IDS)[number];

export function createBackend(id: BackendId): TtsBackend {
  switch (id) {
    case 'irodori':
      return new IrodoriBackend();
    case 'macos-say':
      return new MacosSayBackend();
  }
}

export function isBackendId(value: string): value is BackendId {
  return (BACKEND_IDS as readonly string[]).includes(value);
}

// --- キャッシュ --------------------------------------------------------------

/** 参照音声の中身までキーに含める。差し替えたら再生成されるように。 */
function referenceFingerprint(voice: Voice): string {
  const file = referencePath(voice);
  if (!file) return 'none';
  if (!fs.existsSync(file)) return `missing:${voice.reference}`;
  const stat = fs.statSync(file);
  return `${voice.reference}:${stat.size}:${stat.mtimeMs}`;
}

const KEY_SEPARATOR = String.fromCharCode(0);

/**
 * キャッシュキー = sha256(テキスト + 声の設定 + バックエンドのバージョン)
 * バックエンドを含めるため、下書き音声と公開用音声が混ざることはない。
 */
export function cacheKey(request: TtsRequest, backend: TtsBackend): string {
  const { character, voice, text } = request;
  const material = [
    backend.version,
    voice.id,
    String(effectiveSpeed(request)),
    voice.caption ?? '',
    String(voice.seed),
    character.voice.systemVoice,
    referenceFingerprint(voice),
    text,
  ].join(KEY_SEPARATOR);
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 32);
}

export interface SynthesizeResult {
  file: string;
  cached: boolean;
}

/** キャッシュを見て、無ければ合成する。 */
export async function synthesizeCached(request: TtsRequest, backend: TtsBackend): Promise<SynthesizeResult> {
  const dir = audioCacheDir();
  await fsp.mkdir(dir, { recursive: true });

  const key = cacheKey(request, backend);
  const file = path.join(dir, `${key}.wav`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return { file, cached: true };

  // 途中で落ちた中途半端なファイルを残さないよう、一時ファイル経由で置く。
  const temp = `${file}.tmp`;
  try {
    await backend.synthesize(request, temp);
    await fsp.rename(temp, file);
  } catch (error) {
    await fsp.rm(temp, { force: true });
    throw error;
  }
  return { file, cached: false };
}
