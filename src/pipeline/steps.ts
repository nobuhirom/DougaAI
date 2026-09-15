import fs from 'node:fs';
import path from 'node:path';
import { ideaSchema, type Idea } from '../schema/idea.js';
import { scriptSchema } from '../schema/script.js';
import type { Issue } from './validate.js';
import { loadCharacter, validateScript } from './validate.js';
import { DIRS, projectDir } from './paths.js';

/**
 * 制作工程（docs/06_全体計画.md）。
 *
 * 各工程は「ファイルを入力にファイルを出力する」。途中の状態をメモリに持たない。
 * 中断・再開・部分的なやり直しが効く。
 *
 * ここが持つのは成果物のスキーマ・検証・次に何をすべきかの提示だけで、
 * 生成そのものはエージェントが行う。パイプラインは LLM を呼ばない
 * （docs/06_全体計画.md 1章。従量課金を持ち込まないため）。
 */

export type Executor = 'human' | 'agent' | 'machine';

export interface Step {
  id: string;
  label: string;
  executor: Executor;
  /** projects/<id>/ からの相対パス。 */
  artifact: string;
  /** この工程を始めるのに揃っている必要がある工程。 */
  requires: string[];
  /** エージェントが従う手順書（prompts/ からの相対パス）。 */
  prompt?: string;
  /** 成果物を検証する。問題がなければ空配列。 */
  validate: (projectId: string) => Issue[];
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
function checkSections(
  file: string,
  required: string[],
  code: string,
): Issue[] {
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

// --- 各工程の検証 -------------------------------------------------------------

export const PLAN_SECTIONS = [
  '誰に',
  '何を持ち帰るか',
  '構成',
  '扱わないこと',
  '調べること',
] as const;

export const RESEARCH_SECTIONS = ['わかったこと', '出典', '調査の限界'] as const;

function validateIdea(projectId: string): Issue[] {
  const file = path.join(projectDir(projectId), 'idea.json');
  if (!fs.existsSync(file)) {
    return [{ code: 'missing-artifact', message: 'idea.json がない' }];
  }
  const parsed = ideaSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf-8')));
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({
      code: 'schema',
      message: `idea.json ${i.path.join('.')}: ${i.message}`,
    }));
  }
  if (parsed.data.id !== projectId) {
    return [
      {
        code: 'project-id-mismatch',
        message: `idea.json の id が "${parsed.data.id}" になっている`,
      },
    ];
  }
  return [];
}

function validatePlan(projectId: string): Issue[] {
  return checkSections(
    path.join(projectDir(projectId), 'plan.md'),
    [...PLAN_SECTIONS],
    'plan-section',
  );
}

function validateResearch(projectId: string): Issue[] {
  const file = path.join(projectDir(projectId), 'research.md');
  const issues = checkSections(file, [...RESEARCH_SECTIONS], 'research-section');
  if (issues.length > 0 || !fs.existsSync(file)) return issues;

  // 出典の節に URL が1つもないなら、裏が取れていない
  const sources = readSections(fs.readFileSync(file, 'utf-8')).get('出典') ?? '';
  if (!/https?:\/\/\S+/.test(sources)) {
    issues.push({
      code: 'no-sources',
      message: '「## 出典」に URL が1つもない。一次情報の裏が取れていない',
    });
  }
  return issues;
}

function validateScriptArtifact(projectId: string): Issue[] {
  const file = path.join(projectDir(projectId), 'script.json');
  if (!fs.existsSync(file)) {
    return [{ code: 'missing-artifact', message: 'script.json がない' }];
  }
  const parsed = scriptSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf-8')));
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({
      code: 'schema',
      message: `script.json ${i.path.join('.') || '(root)'}: ${i.message}`,
    }));
  }

  // 台本は既存の機械的チェック8種をそのまま通す（docs/04_要件定義.md 7章）
  try {
    const characters = Object.fromEntries(
      parsed.data.meta.characters.map((id) => [id, loadCharacter(id)]),
    );
    return validateScript(parsed.data, characters);
  } catch (error) {
    return [
      {
        code: 'character',
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}

// --- 工程の定義 ---------------------------------------------------------------

export const STEPS: Step[] = [
  {
    id: 'idea',
    label: 'ネタ決め',
    executor: 'human',
    artifact: 'idea.json',
    requires: [],
    validate: validateIdea,
  },
  {
    id: 'plan',
    label: '企画メモ',
    executor: 'agent',
    artifact: 'plan.md',
    requires: ['idea'],
    prompt: '02_plan.md',
    validate: validatePlan,
  },
  {
    id: 'research',
    label: '調査',
    executor: 'agent',
    artifact: 'research.md',
    requires: ['plan'],
    prompt: '03_research.md',
    validate: validateResearch,
  },
  {
    id: 'script',
    label: '台本',
    executor: 'agent',
    artifact: 'script.json',
    requires: ['plan', 'research'],
    prompt: '04_script.md',
    validate: validateScriptArtifact,
  },
];

export const stepById = (id: string): Step | undefined =>
  STEPS.find((s) => s.id === id);

export type StepState = 'done' | 'invalid' | 'ready' | 'blocked';

export interface StepStatus {
  step: Step;
  state: StepState;
  issues: Issue[];
  /** 成果物が存在するか。 */
  exists: boolean;
}

/** プロジェクトの現在地を出す。 */
export function projectStatus(projectId: string): StepStatus[] {
  const dir = projectDir(projectId);
  const results: StepStatus[] = [];
  const doneIds = new Set<string>();

  for (const step of STEPS) {
    const exists = fs.existsSync(path.join(dir, step.artifact));
    const blocked = step.requires.some((r) => !doneIds.has(r));

    if (!exists) {
      results.push({
        step,
        state: blocked ? 'blocked' : 'ready',
        issues: [],
        exists: false,
      });
      continue;
    }

    const issues = step.validate(projectId);
    const state: StepState = issues.length === 0 ? 'done' : 'invalid';
    if (state === 'done') doneIds.add(step.id);
    results.push({ step, state, issues, exists: true });
  }

  return results;
}

/** 次に手を付けるべき工程。全部終わっていれば undefined。 */
export function nextStep(projectId: string): StepStatus | undefined {
  const status = projectStatus(projectId);
  return (
    status.find((s) => s.state === 'invalid') ??
    status.find((s) => s.state === 'ready') ??
    status.find((s) => s.state === 'blocked')
  );
}

/** プロジェクトの一覧。idea.json か script.json があるものを拾う。 */
export function listProjects(): string[] {
  if (!fs.existsSync(DIRS.projects)) return [];
  return fs
    .readdirSync(DIRS.projects, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) =>
      ['idea.json', 'script.json'].some((f) =>
        fs.existsSync(path.join(DIRS.projects, name, f)),
      ),
    )
    .sort();
}

/** projects/<id>/idea.json を読む。無ければ null。 */
export function readIdea(projectId: string): Idea | null {
  const file = path.join(projectDir(projectId), 'idea.json');
  if (!fs.existsSync(file)) return null;
  const parsed = ideaSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf-8')));
  return parsed.success ? parsed.data : null;
}
