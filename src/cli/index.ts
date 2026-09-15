import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { build, readManifest } from '../pipeline/build.js';
import { DIRS, outPath } from '../pipeline/paths.js';
import {
  ValidationError,
  formatIssues,
  loadCharacter,
  loadScript,
  validateScript,
} from '../pipeline/validate.js';
import { BACKEND_IDS, isBackendId, type BackendId } from '../pipeline/tts.js';
import type { Character } from '../schema/character.js';

/**
 * douga コマンド。
 *
 *   douga validate <projectId>   台本を検証する（音声は作らない）
 *   douga build    <projectId>   音声を作り、マニフェストを組む
 *   douga render   <projectId>   ビルドして MP4 を書き出す
 *   douga preview  <projectId>   Remotion Studio を開く
 *   douga info     <projectId>   ビルド済みマニフェストの要約を出す
 */

const USAGE = `使い方:
  npm run douga -- <command> <projectId> [options]

コマンド:
  validate <id>   台本を検証する（音声は生成しない）
  build    <id>   音声を生成してマニフェストを組む
  render   <id>   ビルドしてから MP4 を書き出す
  preview  <id>   Remotion Studio を開く
  info     <id>   ビルド済みマニフェストの要約を表示する

オプション:
  --tts <backend>   音声合成の方式（${BACKEND_IDS.join(' | ')}）。既定: irodori
                    irodori   = 公開用。Irodori-TTS-Server が要る
                    macos-say = 下書き用。公開する動画には使わない
  --force           音声キャッシュを無視して作り直す
  --preset <name>   render のみ。draft | final（既定: final）
  --concurrency <n> render のみ。並列数。既定は Remotion の自動判定
`;

function fail(message: string): never {
  process.stderr.write(`\n${message}\n`);
  process.exit(1);
}

function reportValidationError(error: ValidationError): never {
  process.stderr.write(`\n検証に失敗した（${error.issues.length} 件）\n`);
  process.stderr.write(`${formatIssues(error.issues)}\n`);
  process.exit(1);
}

function listProjects(): string[] {
  if (!fs.existsSync(DIRS.projects)) return [];
  return fs
    .readdirSync(DIRS.projects, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function requireProjectId(value: string | undefined): string {
  if (value) return value;
  const projects = listProjects();
  fail(
    `プロジェクト ID を指定する。\n${USAGE}\n` +
      (projects.length > 0
        ? `既存のプロジェクト: ${projects.join(', ')}\n`
        : 'projects/ がまだ空\n'),
  );
}

function resolveBackend(value: string | undefined): BackendId {
  const id = value ?? 'irodori';
  if (!isBackendId(id)) {
    fail(`未知の TTS バックエンド: ${id}（${BACKEND_IDS.join(' | ')}）`);
  }
  return id;
}

function formatDuration(frames: number, fps: number): string {
  const total = Math.round(frames / fps);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}分${String(s).padStart(2, '0')}秒`;
}

// --- コマンド ----------------------------------------------------------------

function cmdValidate(projectId: string): void {
  const script = loadScript(projectId);
  const characters: Record<string, Character> = {};
  for (const id of script.meta.characters) characters[id] = loadCharacter(id);

  const issues = validateScript(script, characters);
  if (issues.length > 0) reportValidationError(new ValidationError(issues));

  const lineCount = script.sections.reduce((n, s) => n + s.lines.length, 0);
  process.stdout.write(
    `検証を通過: ${script.meta.title}\n` +
      `  ${script.sections.length} セクション / ${lineCount} セリフ / ` +
      `キャラクター ${script.meta.characters.join(', ')}\n`,
  );
}

async function cmdBuild(
  projectId: string,
  backendId: BackendId,
  force: boolean,
): Promise<void> {
  const started = Date.now();
  const result = await build({
    projectId,
    backendId,
    force,
    onProgress: (message) => process.stdout.write(`${message}\n`),
  });

  const { manifest, backend } = result;
  process.stdout.write(
    `\nビルド完了 ${formatDuration(manifest.totalDurationInFrames, manifest.meta.fps)}` +
      ` / ${manifest.totalDurationInFrames} フレーム\n` +
      `  音声: 新規 ${result.synthesized} / キャッシュ ${result.cached}\n` +
      `  所要: ${((Date.now() - started) / 1000).toFixed(1)} 秒\n` +
      `  出力: build/${projectId}/manifest.json\n`,
  );

  if (!backend.productionReady) {
    process.stdout.write(
      `\n注意: TTS バックエンドが ${backend.id} になっている。` +
        `これは下書き用で、公開する動画の音声ではない。\n` +
        `公開用に焼き直すときは --tts irodori を付ける。\n`,
    );
  }
}

function runRemotion(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['remotion', ...args], {
      stdio: 'inherit',
      cwd: path.resolve(DIRS.projects, '..'),
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`remotion が終了コード ${code} で終了した`));
    });
  });
}

async function cmdRender(
  projectId: string,
  backendId: BackendId,
  force: boolean,
  preset: string,
  concurrency: string | undefined,
): Promise<void> {
  await cmdBuild(projectId, backendId, force);

  const output = outPath(projectId);
  fs.mkdirSync(path.dirname(output), { recursive: true });

  const args = [
    'render',
    'src/remotion/index.ts',
    'Video',
    output,
    '--props',
    JSON.stringify({ projectId }),
  ];

  if (preset === 'draft') {
    // 確認用。解像度と画質を落として時間を削る（docs/04_要件定義.md 6章）。
    args.push('--scale', '0.5', '--jpeg-quality', '70', '--image-format', 'jpeg');
  } else if (preset !== 'final') {
    fail(`未知のプリセット: ${preset}（draft | final）`);
  }

  if (concurrency) args.push('--concurrency', concurrency);

  process.stdout.write(`\nレンダリング開始（preset: ${preset}）\n`);
  await runRemotion(args);
  process.stdout.write(`\n書き出し完了: out/${projectId}.mp4\n`);
}

async function cmdPreview(projectId: string): Promise<void> {
  if (!readManifest(projectId)) {
    fail(
      `マニフェストがない。先に実行する:\n  npm run douga -- build ${projectId}`,
    );
  }
  await runRemotion([
    'studio',
    'src/remotion/index.ts',
    '--props',
    JSON.stringify({ projectId }),
  ]);
}

function cmdInfo(projectId: string): void {
  const manifest = readManifest(projectId);
  if (!manifest) {
    fail(`マニフェストがない。先に npm run douga -- build ${projectId} を実行する`);
  }

  const { meta, lines, totalDurationInFrames } = manifest;
  const bySpeaker = new Map<string, number>();
  const byVisual = new Map<string, number>();
  for (const line of lines) {
    bySpeaker.set(line.character, (bySpeaker.get(line.character) ?? 0) + 1);
    byVisual.set(line.visual.type, (byVisual.get(line.visual.type) ?? 0) + 1);
  }

  const speech = lines.reduce((sum, l) => sum + l.audioDurationSec, 0);

  process.stdout.write(
    `${meta.title}（${meta.id}）\n` +
      `  尺        ${formatDuration(totalDurationInFrames, meta.fps)} / ${totalDurationInFrames} フレーム @ ${meta.fps}fps\n` +
      `  解像度    ${meta.width}×${meta.height}\n` +
      `  セリフ    ${lines.length} 件 / 発話 ${speech.toFixed(1)} 秒\n` +
      `  話者      ${[...bySpeaker].map(([k, v]) => `${k} ${v}`).join(' / ')}\n` +
      `  ビジュアル ${[...byVisual].map(([k, v]) => `${k} ${v}`).join(' / ')}\n` +
      `  ビルド    ${manifest.builtAt}\n`,
  );
}

// --- エントリポイント --------------------------------------------------------

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      tts: { type: 'string' },
      force: { type: 'boolean', default: false },
      preset: { type: 'string', default: 'final' },
      concurrency: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });

  const [command, projectArg] = positionals;

  if (values.help || !command) {
    process.stdout.write(USAGE);
    return;
  }

  const backendId = resolveBackend(values.tts);

  switch (command) {
    case 'validate':
      cmdValidate(requireProjectId(projectArg));
      return;
    case 'build':
      await cmdBuild(requireProjectId(projectArg), backendId, values.force);
      return;
    case 'render':
      await cmdRender(
        requireProjectId(projectArg),
        backendId,
        values.force,
        values.preset,
        values.concurrency,
      );
      return;
    case 'preview':
      await cmdPreview(requireProjectId(projectArg));
      return;
    case 'info':
      cmdInfo(requireProjectId(projectArg));
      return;
    default:
      fail(`未知のコマンド: ${command}\n${USAGE}`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof ValidationError) reportValidationError(error);
  fail(error instanceof Error ? error.message : String(error));
});
