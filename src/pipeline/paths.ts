import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * リポジトリ内のパスを一箇所で決める。
 *
 * 方針: `public/` はビルドが生成するステージング領域で、git 管理しない。
 * 正となるアセットは assets/ characters/ projects/ に置き、ビルド時に
 * 必要なものだけを public/ へ複製する。こうすると「宣言していないアセットが
 * たまたま手元にあったから動いた」という環境依存を作らずに済む
 * （docs/04_要件定義.md N4）。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');

export const DIRS = {
  assets: path.join(ROOT, 'assets'),
  fonts: path.join(ROOT, 'assets', 'fonts'),
  bgm: path.join(ROOT, 'assets', 'bgm'),
  characters: path.join(ROOT, 'characters'),
  projects: path.join(ROOT, 'projects'),
  build: path.join(ROOT, 'build'),
  out: path.join(ROOT, 'out'),
  logs: path.join(ROOT, 'logs'),
  /** Remotion が staticFile() で読む領域。ビルドが生成する。 */
  public: path.join(ROOT, 'public'),
} as const;

export const projectDir = (id: string) => path.join(DIRS.projects, id);
export const scriptPath = (id: string) => path.join(projectDir(id), 'script.json');
export const projectAssetsDir = (id: string) => path.join(projectDir(id), 'assets');

export const characterDir = (id: string) => path.join(DIRS.characters, id);
export const characterConfigPath = (id: string) =>
  path.join(characterDir(id), 'character.json');

export const buildDir = (id: string) => path.join(DIRS.build, id);
export const manifestPath = (id: string) => path.join(buildDir(id), 'manifest.json');

/** 音声キャッシュ。台本の変更で影響を受けた行だけが再生成される。 */
export const audioCacheDir = () => path.join(DIRS.build, '_audio-cache');

export const outPath = (id: string) => path.join(DIRS.out, `${id}.mp4`);

// --- public/ 配下（staticFile() から見えるパス）-------------------------------

/**
 * staticFile() に渡す相対パスの組み立ては src/shared/static.ts にある。
 * Remotion のバンドルからも読むため、Node 依存のないところへ切り出している。
 */
export { STATIC } from '../shared/static.js';

/** STATIC が返す相対パスを public/ 配下の絶対パスに直す。 */
export const publicPath = (relative: string) => path.join(DIRS.public, relative);
