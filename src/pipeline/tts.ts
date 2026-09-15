import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Character } from '../schema/character.js';
import { audioCacheDir, characterDir } from './paths.js';

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
 * 生成はセリフ単位でキャッシュする。台本を1行直したときに全セリフを
 * 作り直さないため（docs/04_要件定義.md 4.2 / N2）。
 */

export interface TtsRequest {
  /** TTS に渡す最終テキスト（読みの上書きと感情絵文字が適用済み）。 */
  text: string;
  character: Character;
}

export interface TtsBackend {
  readonly id: string;
  /** キャッシュキーに混ぜる。変わると全音声が再生成される。 */
  readonly version: string;
  /** 公開する動画に使ってよい音声か。 */
  readonly productionReady: boolean;
  synthesize(request: TtsRequest, outFile: string): Promise<void>;
}

// --- Irodori TTS ------------------------------------------------------------

const DEFAULT_IRODORI_BASE_URL = 'http://127.0.0.1:8000/v1';

/**
 * Irodori-TTS-Server（OpenAI TTS 互換 API）を叩く。
 *
 * https://github.com/Aratako/Irodori-TTS-Server
 *
 * リクエスト形は OpenAI の /v1/audio/speech に準拠する。サーバーが受け付けない
 * フィールドがあった場合、推測で補正せずサーバーが返したエラーをそのまま投げる。
 * 黙って別の音声を作るより、止まって気づける方がよい。
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
    return `${this.id}:${this.model}`;
  }

  async synthesize(request: TtsRequest, outFile: string): Promise<void> {
    const { character, text } = request;

    // 参照音声はサーバー側に登録された voice 名で指定する。
    // 未設定なら VoiceDesign のキャプションに委ねる。
    const voice =
      character.voice.referenceAudio !== undefined
        ? path.parse(character.voice.referenceAudio).name
        : (character.voice.caption ?? 'default');

    const response = await fetch(`${this.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        voice,
        response_format: 'wav',
        speed: character.voice.speed,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Irodori TTS が ${response.status} ${response.statusText} を返した。` +
          `${this.baseUrl} でサーバーが動いているか確認する。${detail ? `\n${detail}` : ''}`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0) {
      throw new Error('Irodori TTS が空の音声を返した');
    }
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
 *
 * 公開する動画の音声ではない。Irodori TTS を立ち上げる前に、尺の計算・
 * 口パク・字幕・レンダリングまで通して検証するために置いている。
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
    const rate = Math.round(180 * character.voice.speed);
    try {
      await execFileAsync('say', [
        '-v', character.voice.systemVoice,
        '-r', String(rate),
        '-o', aiff,
        spoken,
      ]);
      // 出力先は一時ファイル（.tmp）なので、拡張子から形式を推測させない。
      await execFileAsync('ffmpeg', [
        '-v', 'error', '-y',
        '-i', aiff,
        '-ar', '48000', '-ac', '1',
        '-f', 'wav',
        outFile,
      ]);
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
function referenceFingerprint(character: Character): string {
  const ref = character.voice.referenceAudio;
  if (!ref) return 'none';
  const file = path.join(characterDir(character.id), ref);
  if (!fs.existsSync(file)) return `missing:${ref}`;
  const stat = fs.statSync(file);
  return `${ref}:${stat.size}:${stat.mtimeMs}`;
}

const KEY_SEPARATOR = String.fromCharCode(0);

/**
 * キャッシュキー = sha256(テキスト + キャラ設定 + バックエンドのバージョン)
 *
 * バックエンドを含めるため、下書き音声と公開用音声が混ざることはない。
 * TTS モデルを更新したときも自動で全再生成される（docs/04_要件定義.md 4.2）。
 */
export function cacheKey(request: TtsRequest, backend: TtsBackend): string {
  const { character, text } = request;
  const material = [
    backend.version,
    character.id,
    String(character.voice.speed),
    character.voice.caption ?? '',
    character.voice.systemVoice,
    referenceFingerprint(character),
    text,
  ].join(KEY_SEPARATOR);
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 32);
}

export interface SynthesizeResult {
  file: string;
  cached: boolean;
}

/** キャッシュを見て、無ければ合成する。 */
export async function synthesizeCached(
  request: TtsRequest,
  backend: TtsBackend,
): Promise<SynthesizeResult> {
  const dir = audioCacheDir();
  await fsp.mkdir(dir, { recursive: true });

  const key = cacheKey(request, backend);
  const file = path.join(dir, `${key}.wav`);

  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    return { file, cached: true };
  }

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
