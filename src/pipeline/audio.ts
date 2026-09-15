import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * 音声の解析。
 *
 * レンダリング時に音声を解析するのではなく、ビルド時に解析して結果を
 * マニフェストへ焼き込む。Remotion 側は数値配列を読むだけになり、
 * 同じマニフェストからは必ず同じ口の動きが出る（docs/04_要件定義.md N1）。
 */

/** WAV の長さを秒で返す。 */
export async function probeDurationSec(file: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`音声の長さを取得できなかった: ${file}`);
  }
  return seconds;
}

/** 解析用に落とすサンプルレート。口の開閉の検出にはこれで十分。 */
const ANALYSIS_RATE = 8000;

/**
 * 音声を s16le モノラルにデコードして取り出す。
 *
 * WAV のヘッダを自前で解釈せず ffmpeg に任せる。Irodori TTS が返す形式が
 * 変わっても（16bit / float32 / サンプルレート違い）ここは壊れない。
 */
async function decodePcm(file: string): Promise<Int16Array> {
  const { stdout } = await execFileAsync(
    'ffmpeg',
    [
      '-v', 'error',
      '-i', file,
      '-ac', '1',
      '-ar', String(ANALYSIS_RATE),
      '-f', 's16le',
      '-',
    ],
    { encoding: 'buffer', maxBuffer: 1024 * 1024 * 256 },
  );
  const buffer = stdout as unknown as Buffer;
  const usable = buffer.byteLength - (buffer.byteLength % 2);
  return new Int16Array(buffer.buffer, buffer.byteOffset, usable / 2);
}

/** 口の開き具合の量子化段数。マニフェストを無駄に膨らませないため。 */
const MOUTH_STEPS = 10;

export interface MouthEnvelopeOptions {
  fps: number;
  frameCount: number;
}

/**
 * フレームごとの口の開き（0〜1）を音声の振幅から算出する。
 *
 * Irodori TTS は単語単位のタイムスタンプを返さないため、振幅から近似する
 * （docs/03_方式決定.md 決定3 の制約1）。音素レベルの精度は出ないが、
 * 「喋っている間だけ口が動く」は満たせる。
 */
export async function mouthEnvelope(
  file: string,
  { fps, frameCount }: MouthEnvelopeOptions,
): Promise<number[]> {
  const pcm = await decodePcm(file);
  const samplesPerFrame = ANALYSIS_RATE / fps;

  // フレームごとの RMS
  const rms: number[] = [];
  for (let frame = 0; frame < frameCount; frame++) {
    const start = Math.floor(frame * samplesPerFrame);
    const end = Math.min(Math.floor((frame + 1) * samplesPerFrame), pcm.length);
    let sum = 0;
    let count = 0;
    for (let i = start; i < end; i++) {
      const v = pcm[i]! / 32768;
      sum += v * v;
      count++;
    }
    rms.push(count > 0 ? Math.sqrt(sum / count) : 0);
  }

  // 音量の絶対値ではなく、そのセリフの中での相対的な大きさで開き具合を決める。
  // セリフごとに録音レベルが違っても口の動きが揃う。
  const sorted = [...rms].filter((v) => v > 0).sort((a, b) => a - b);
  const loud = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.9)]! : 0;
  if (loud <= 0) return new Array(frameCount).fill(0);

  // 無音と判定する閾値。これ以下は完全に口を閉じる。
  const silence = loud * 0.12;

  const raw = rms.map((v) => {
    if (v <= silence) return 0;
    return Math.min(1, (v - silence) / (loud - silence));
  });

  // 1フレームだけ跳ねるのを均す。口がパタパタして見えるのを防ぐ。
  const smoothed = raw.map((v, i) => {
    const prev = raw[i - 1] ?? v;
    const next = raw[i + 1] ?? v;
    return (prev + v * 2 + next) / 4;
  });

  return smoothed.map((v) => Math.round(v * MOUTH_STEPS) / MOUTH_STEPS);
}

/** ffmpeg / ffprobe が使えるか確認する。 */
export async function checkFfmpeg(): Promise<void> {
  for (const bin of ['ffmpeg', 'ffprobe']) {
    try {
      await execFileAsync(bin, ['-version']);
    } catch {
      throw new Error(`${bin} が見つからない。brew install ffmpeg でインストールする`);
    }
  }
}
