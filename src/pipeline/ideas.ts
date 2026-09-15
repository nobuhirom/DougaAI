import fs from 'node:fs';
import path from 'node:path';
import {
  ideaSchema,
  inboxIdeaSchema,
  newIdeaId,
  type Idea,
  type InboxIdea,
} from '../schema/idea.js';
import { DIRS, projectDir } from './paths.js';

/**
 * ネタの書き捨てと、プロジェクトへの昇格（docs/06_全体計画.md 工程1）。
 *
 * 起点は必ず人間。AI にネタを決めさせない。ここは「思いついたことを
 * 落とす場所」と「そのうち1つを動画1本ぶんの当たりまで持っていく場所」。
 */

const INBOX = path.join(DIRS.ideas, 'inbox.jsonl');

export const inboxPath = () => INBOX;

/** 壊れた行は捨てずに報告する。手で編集されることを想定している。 */
export interface InboxReadResult {
  ideas: InboxIdea[];
  broken: { line: number; reason: string }[];
}

export function readInbox(): InboxReadResult {
  if (!fs.existsSync(INBOX)) return { ideas: [], broken: [] };

  const ideas: InboxIdea[] = [];
  const broken: { line: number; reason: string }[] = [];

  const lines = fs.readFileSync(INBOX, 'utf-8').split('\n');
  for (const [index, raw] of lines.entries()) {
    const text = raw.trim();
    if (text === '') continue;
    try {
      const parsed = inboxIdeaSchema.safeParse(JSON.parse(text));
      if (parsed.success) ideas.push(parsed.data);
      else broken.push({ line: index + 1, reason: parsed.error.issues[0]?.message ?? '不正' });
    } catch {
      broken.push({ line: index + 1, reason: 'JSON として読めない' });
    }
  }
  return { ideas, broken };
}

function writeInbox(ideas: InboxIdea[]): void {
  fs.mkdirSync(DIRS.ideas, { recursive: true });
  const body = ideas.map((i) => JSON.stringify(i)).join('\n');
  fs.writeFileSync(INBOX, ideas.length > 0 ? `${body}\n` : '', 'utf-8');
}

/** ネタを1件足す。整える必要はない。 */
export function addIdea(text: string, tags: string[] = []): InboxIdea {
  const { ideas } = readInbox();
  const now = new Date();

  let id = newIdeaId(now);
  // 同じミリ秒に2件入れても衝突しないようにする
  let suffix = 0;
  const taken = new Set(ideas.map((i) => i.id));
  while (taken.has(id)) id = `${newIdeaId(now)}${(++suffix).toString(36)}`;

  const idea = inboxIdeaSchema.parse({
    id,
    text: text.trim(),
    tags,
    createdAt: now.toISOString(),
    status: 'inbox',
  });

  ideas.push(idea);
  writeInbox(ideas);
  return idea;
}

function updateIdea(id: string, patch: Partial<InboxIdea>): InboxIdea {
  const { ideas } = readInbox();
  const index = ideas.findIndex((i) => i.id === id);
  if (index < 0) throw new Error(`ネタが見つからない: ${id}`);
  const updated = inboxIdeaSchema.parse({ ...ideas[index], ...patch });
  ideas[index] = updated;
  writeInbox(ideas);
  return updated;
}

/** 見送る。消さずに残す。同じネタを何度も拾い直さないため。 */
export function dropIdea(id: string, reason: string): InboxIdea {
  return updateIdea(id, { status: 'dropped', reason });
}

/** 見送りを取り消す。 */
export function restoreIdea(id: string): InboxIdea {
  return updateIdea(id, { status: 'inbox', reason: undefined });
}

export interface PickOptions {
  ideaId: string;
  projectId: string;
  title?: string;
  kind?: Idea['kind'];
}

/**
 * ネタをプロジェクトにする。projects/<id>/idea.json を作る。
 * ここから先が制作工程（docs/06_全体計画.md 2章）。
 */
export function pickIdea(options: PickOptions): Idea {
  const { ideaId, projectId } = options;

  if (!/^[a-z0-9][a-z0-9-]*$/.test(projectId)) {
    throw new Error(`プロジェクト ID は英小文字・数字・ハイフンにする: ${projectId}`);
  }

  const { ideas } = readInbox();
  const source = ideas.find((i) => i.id === ideaId);
  if (!source) throw new Error(`ネタが見つからない: ${ideaId}`);

  const dir = projectDir(projectId);
  const file = path.join(dir, 'idea.json');
  if (fs.existsSync(file)) {
    throw new Error(`すでにある: projects/${projectId}/idea.json`);
  }

  const idea = ideaSchema.parse({
    id: projectId,
    // 仮タイトル。企画メモや台本で変わってよい。
    title: options.title ?? source.text.slice(0, 40),
    text: source.text,
    sourceIdeaId: source.id,
    kind: options.kind ?? 'explainer',
    notes: [],
    createdAt: new Date().toISOString(),
  });

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(idea, null, 2)}\n`, 'utf-8');

  updateIdea(ideaId, { status: 'picked', projectId });
  return idea;
}
