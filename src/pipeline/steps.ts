import fs from 'node:fs';
import path from 'node:path';
import { ideaSchema, type Idea } from '../schema/idea.js';
import { manifestSchema } from '../schema/manifest.js';
import { scriptSchema } from '../schema/script.js';
import type { Issue } from './validate.js';
import { loadCharacter, validateScript } from './validate.js';
import {
  DIRS,
  characterConfigPath,
  manifestPath,
  outPath,
  projectDir,
  scriptPath,
} from './paths.js';

/**
 * 制作工程（docs/06_全体計画.md）。12工程すべてをここで定義する。
 *
 * 各工程は「ファイルを入力にファイルを出力する」。途中の状態をメモリに持たない。
 * 中断・再開・部分的なやり直しが効き、複数のプロジェクトを別々の段階で
 * 並行して進められる。
 *
 * まだ作っていない工程も定義に含め、`implemented: false` で示す。
 * 全体の流れを見せる以上、ないものを隠さない。
 *
 * レビューは独立した工程にしない。参考にした構成では「成果物 → 確認エージェントが
 * AI レビュー → 人間レビューを適宜」が**各工程の後ろに付くゲート**になっている。
 * これはフェーズ3で各工程の `review` として実装する（docs/06_全体計画.md）。
 * 多言語化は不要と決めたので定義に含めない。
 *
 * ここが持つのは成果物の場所・検証・次に何をすべきかの提示だけで、
 * 生成そのものはエージェントか人間が行う。パイプラインは LLM を呼ばない。
 */

export type Executor = 'human' | 'agent' | 'machine';

/** 12工程を5つの段階にまとめる。ボード画面の列になる。 */
export type PhaseId = 'plan' | 'script' | 'produce' | 'expand' | 'publish';

export interface Phase {
  id: PhaseId;
  label: string;
  description: string;
}

export const PHASES: Phase[] = [
  { id: 'plan', label: '企画', description: 'ネタを動画1本ぶんに育てる' },
  { id: 'script', label: '台本', description: '書いて、レビューして、絵を付ける' },
  { id: 'produce', label: '制作', description: '音声を作り、動画に焼く' },
  { id: 'expand', label: '展開', description: 'サムネイル・ショート・多言語' },
  { id: 'publish', label: '投稿', description: '公開する' },
];

export interface Step {
  id: string;
  label: string;
  phase: PhaseId;
  executor: Executor;
  /** 実装済みか。false なら状態は常に unavailable。 */
  implemented: boolean;
  /** 未実装の場合、どのフェーズで作る予定か（docs/06_全体計画.md 6章）。 */
  plannedPhase?: number;
  /** 成果物の表示用パス（リポジトリ相対）。 */
  artifact: string;
  /** 成果物の実体。 */
  resolve: (projectId: string) => string;
  /** この工程を始めるのに done である必要がある工程。 */
  requires: string[];
  /** エージェントが従う手順書（prompts/ からの相対パス）。 */
  prompt?: string;
  /**
   * 成果物より新しければ「古い」と判定する上流ファイル。
   * 台本を直したのにビルドし直していない、を検出する。
   */
  staleAgainst?: (projectId: string) => string[];
  /** 成果物を検証する。問題がなければ空配列。 */
  validate: (projectId: string) => Issue[];
  /** 画面で編集させてよい成果物か（テキストとして扱えるもの）。 */
  editable: boolean;
}

// --- Markdown の節を読む ------------------------------------------------------

/** `## 見出し` ごとに本文を切り出す。 */
export function readSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current !== null) sections.set(current, buffer.join('\n').trim());
    buffer = [];
  };

  for (const line of markdown.split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      current = heading[1]!;
      continue;
    }
    if (current !== null) buffer.push(line);
  }
  flush();
  return sections;
}

/** 必須の節が揃っていて、中身が空でないかを見る。 */
function checkSections(file: string, required: string[], code: string): Issue[] {
  if (!fs.existsSync(file)) {
    return [{ code: 'missing-artifact', message: `${path.basename(file)} がない` }];
  }
  const sections = readSections(fs.readFileSync(file, 'utf-8'));
  const issues: Issue[] = [];
  for (const heading of required) {
    const body = sections.get(heading);
    if (body === undefined) {
      issues.push({ code, message: `「## ${heading}」の節がない` });
    } else if (body === '') {
      issues.push({ code, message: `「## ${heading}」の中身が空` });
    }
  }
  return issues;
}

function readJsonSafe(file: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf-8')) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// --- 各工程の検証 -------------------------------------------------------------

export const PLAN_SECTIONS = ['誰に', '何を持ち帰るか', '構成', '扱わないこと', '調べること'] as const;
export const RESEARCH_SECTIONS = ['わかったこと', '出典', '調査の限界'] as const;

const inProject = (file: string) => (projectId: string) => path.join(projectDir(projectId), file);

function validateIdea(projectId: string): Issue[] {
  const file = inProject('idea.json')(projectId);
  if (!fs.existsSync(file)) return [{ code: 'missing-artifact', message: 'idea.json がない' }];
  const json = readJsonSafe(file);
  if (!json.ok) return [{ code: 'json', message: `idea.json: ${json.error}` }];
  const parsed = ideaSchema.safeParse(json.value);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({
      code: 'schema',
      message: `idea.json ${i.path.join('.')}: ${i.message}`,
    }));
  }
  if (parsed.data.id !== projectId) {
    return [{ code: 'project-id-mismatch', message: `idea.json の id が "${parsed.data.id}" になっている` }];
  }
  return [];
}

function validatePlan(projectId: string): Issue[] {
  return checkSections(inProject('plan.md')(projectId), [...PLAN_SECTIONS], 'plan-section');
}

function validateResearch(projectId: string): Issue[] {
  const file = inProject('research.md')(projectId);
  const issues = checkSections(file, [...RESEARCH_SECTIONS], 'research-section');
  if (issues.length > 0) return issues;

  // 出典の節に URL が1つもないなら、裏が取れていない
  const sources = readSections(fs.readFileSync(file, 'utf-8')).get('出典') ?? '';
  if (!/https?:\/\/\S+/.test(sources)) {
    issues.push({ code: 'no-sources', message: '「## 出典」に URL が1つもない。一次情報の裏が取れていない' });
  }
  return issues;
}

function validateScriptArtifact(projectId: string): Issue[] {
  const file = scriptPath(projectId);
  if (!fs.existsSync(file)) return [{ code: 'missing-artifact', message: 'script.json がない' }];
  const json = readJsonSafe(file);
  if (!json.ok) return [{ code: 'json', message: `script.json: ${json.error}` }];
  const parsed = scriptSchema.safeParse(json.value);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({
      code: 'schema',
      message: `script.json ${i.path.join('.') || '(root)'}: ${i.message}`,
    }));
  }
  if (parsed.data.meta.id !== projectId) {
    return [{ code: 'project-id-mismatch', message: `script.json の meta.id が "${parsed.data.meta.id}" になっている` }];
  }
  // 台本は機械的チェック8種をそのまま通す（docs/04_要件定義.md 7章）
  try {
    const characters = Object.fromEntries(parsed.data.meta.characters.map((id) => [id, loadCharacter(id)]));
    return validateScript(parsed.data, characters);
  } catch (error) {
    return [{ code: 'character', message: error instanceof Error ? error.message : String(error) }];
  }
}

function validateManifestArtifact(projectId: string): Issue[] {
  const file = manifestPath(projectId);
  if (!fs.existsSync(file)) return [{ code: 'missing-artifact', message: 'manifest.json がない' }];
  const json = readJsonSafe(file);
  if (!json.ok) return [{ code: 'json', message: `manifest.json: ${json.error}` }];
  const parsed = manifestSchema.safeParse(json.value);
  if (!parsed.success) {
    return [{ code: 'manifest-invalid', message: `マニフェストの形式が古いか壊れている。ビルドし直す（${parsed.error.issues[0]?.message ?? ''}）` }];
  }
  return [];
}

function validateVideoArtifact(projectId: string): Issue[] {
  const file = outPath(projectId);
  if (!fs.existsSync(file)) return [{ code: 'missing-artifact', message: `${path.basename(file)} がない` }];
  if (fs.statSync(file).size === 0) return [{ code: 'empty-video', message: '動画ファイルが空' }];
  return [];
}

/** 台本が参照するキャラクター定義。ビルドの鮮度判定に使う。 */
function scriptCharacterFiles(projectId: string): string[] {
  const file = scriptPath(projectId);
  if (!fs.existsSync(file)) return [];
  const json = readJsonSafe(file);
  if (!json.ok) return [];
  const parsed = scriptSchema.safeParse(json.value);
  if (!parsed.success) return [];
  return parsed.data.meta.characters.map(characterConfigPath);
}

const notImplemented = (label: string) => (): Issue[] => [
  { code: 'not-implemented', message: `${label}はまだ実装していない` },
];

// --- 工程の定義 ---------------------------------------------------------------

export const STEPS: Step[] = [
  {
    id: 'idea', label: 'ネタ決め', phase: 'plan', executor: 'human', implemented: true,
    artifact: 'projects/<id>/idea.json', resolve: inProject('idea.json'),
    requires: [], validate: validateIdea, editable: true,
  },
  {
    id: 'plan', label: '企画メモ', phase: 'plan', executor: 'agent', implemented: true,
    artifact: 'projects/<id>/plan.md', resolve: inProject('plan.md'),
    requires: ['idea'], prompt: '02_plan.md', validate: validatePlan, editable: true,
  },
  {
    id: 'research', label: '調査', phase: 'plan', executor: 'agent', implemented: true,
    artifact: 'projects/<id>/research.md', resolve: inProject('research.md'),
    requires: ['plan'], prompt: '03_research.md', validate: validateResearch, editable: true,
  },
  {
    id: 'script', label: '台本', phase: 'script', executor: 'agent', implemented: true,
    artifact: 'projects/<id>/script.json', resolve: scriptPath,
    requires: ['plan', 'research'], prompt: '04_script.md', validate: validateScriptArtifact, editable: true,
  },
  {
    id: 'visual', label: 'ビジュアル', phase: 'script', executor: 'agent', implemented: false, plannedPhase: 5,
    artifact: 'projects/<id>/script.json（visual）', resolve: scriptPath,
    requires: ['script'], validate: notImplemented('ビジュアルの自動選択'), editable: false,
  },
  {
    id: 'audio', label: '音声', phase: 'produce', executor: 'machine', implemented: true,
    artifact: 'build/<id>/manifest.json', resolve: manifestPath,
    requires: ['script'],
    staleAgainst: (id) => [scriptPath(id), ...scriptCharacterFiles(id)],
    validate: validateManifestArtifact, editable: false,
  },
  {
    id: 'thumbnail', label: 'サムネイル', phase: 'expand', executor: 'agent', implemented: false, plannedPhase: 5,
    artifact: 'projects/<id>/thumbnail/', resolve: inProject('thumbnail'),
    requires: ['script'], validate: notImplemented('サムネイル'), editable: false,
  },
  {
    id: 'assemble', label: '組み立て', phase: 'produce', executor: 'machine', implemented: true,
    artifact: 'out/<id>.mp4', resolve: outPath,
    requires: ['audio'],
    staleAgainst: (id) => [manifestPath(id)],
    validate: validateVideoArtifact, editable: false,
  },
  {
    id: 'shorts', label: 'ショート', phase: 'expand', executor: 'agent', implemented: false, plannedPhase: 6,
    artifact: 'projects/<id>/shorts.json', resolve: inProject('shorts.json'),
    requires: ['script'], validate: notImplemented('ショート'), editable: false,
  },
  {
    id: 'publish', label: '投稿', phase: 'publish', executor: 'human', implemented: false, plannedPhase: 6,
    artifact: '—', resolve: inProject('published.json'),
    requires: ['assemble'], validate: notImplemented('投稿'), editable: false,
  },
];

export const stepById = (id: string): Step | undefined => STEPS.find((s) => s.id === id);

/**
 * done         成果物があり、検証を通り、上流より新しい
 * stale        成果物はあるが、上流（台本など）がその後に変わった
 * invalid      成果物はあるが、検証で問題がある
 * ready        まだ無いが、着手できる
 * blocked      前の工程が終わっていない
 * unavailable  まだ実装していない工程
 */
export type StepState = 'done' | 'stale' | 'invalid' | 'ready' | 'blocked' | 'unavailable';

export interface StepStatus {
  step: Step;
  state: StepState;
  issues: Issue[];
  exists: boolean;
  /** 成果物の更新時刻（ISO）。無ければ null。 */
  updatedAt: string | null;
}

function mtime(file: string): number | null {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/** プロジェクトの現在地。12工程すべての状態を返す。 */
export function projectStatus(projectId: string): StepStatus[] {
  const results: StepStatus[] = [];
  const doneIds = new Set<string>();

  for (const step of STEPS) {
    const file = step.resolve(projectId);
    const exists = fs.existsSync(file);
    const updated = exists ? mtime(file) : null;
    const updatedAt = updated === null ? null : new Date(updated).toISOString();

    if (!step.implemented) {
      results.push({ step, state: 'unavailable', issues: [], exists, updatedAt });
      continue;
    }

    const upstreamDone = step.requires.every((r) => doneIds.has(r));

    if (!exists) {
      results.push({ step, state: upstreamDone ? 'ready' : 'blocked', issues: [], exists, updatedAt });
      continue;
    }

    const issues = step.validate(projectId);
    if (issues.length > 0) {
      results.push({ step, state: 'invalid', issues, exists, updatedAt });
      continue;
    }

    // 上流ファイルの方が新しければ「古い」。
    // 上流の成果物が「無い」ことは古さの理由にしない。手書きの台本のように、
    // 企画メモを経ずに作られた成果物も、それ自体が検証を通れば完了として扱う。
    const newerUpstream = (step.staleAgainst?.(projectId) ?? [])
      .map(mtime)
      .some((t) => t !== null && updated !== null && t > updated);
    if (newerUpstream) {
      results.push({ step, state: 'stale', issues: [], exists, updatedAt });
      continue;
    }

    doneIds.add(step.id);
    results.push({ step, state: 'done', issues: [], exists, updatedAt });
  }

  return results;
}

/**
 * 次に手を付けるべき工程。
 *
 * 1. 問題のある成果物（invalid / stale）があればそれ。直すのが先
 * 2. 無ければ、いちばん先まで進んだ完了工程より後ろで、最初に着手できるもの
 * 3. それも無ければ、後ろで最初の待ち／未実装の工程
 *
 * 「完了より後ろ」に限るのは、手書きの台本のように企画メモを飛ばして
 * 進んだプロジェクトを、企画の段階に引き戻さないため。
 * 全部終わっていれば undefined。
 */
export function nextStep(projectId: string): StepStatus | undefined {
  const status = projectStatus(projectId);
  const broken = status.find((s) => s.state === 'invalid' || s.state === 'stale');
  if (broken) return broken;

  const lastDone = status.reduce((last, s, i) => (s.state === 'done' ? i : last), -1);
  const after = status.slice(lastDone + 1);
  return (
    after.find((s) => s.state === 'ready') ??
    after.find((s) => s.state === 'blocked' || s.state === 'unavailable')
  );
}

/** ボードの列。次の工程が属する段階。全部終わっていれば publish。 */
export function currentPhase(projectId: string): PhaseId {
  return nextStep(projectId)?.step.phase ?? 'publish';
}

/** プロジェクトの一覧。idea.json か script.json があるものを拾う。 */
export function listProjects(): string[] {
  if (!fs.existsSync(DIRS.projects)) return [];
  return fs
    .readdirSync(DIRS.projects, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => ['idea.json', 'script.json'].some((f) => fs.existsSync(path.join(DIRS.projects, name, f))))
    .sort();
}

/** projects/<id>/idea.json を読む。無ければ null。 */
export function readIdea(projectId: string): Idea | null {
  const file = inProject('idea.json')(projectId);
  if (!fs.existsSync(file)) return null;
  const json = readJsonSafe(file);
  if (!json.ok) return null;
  const parsed = ideaSchema.safeParse(json.value);
  return parsed.success ? parsed.data : null;
}
