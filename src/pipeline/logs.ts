import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { DIRS } from './paths.js';

/**
 * 改善ループのログ（docs/06_全体計画.md 5章）。
 *
 * 人間が成果物をどう直したかを残す。本数を重ねてから
 * 「同じ修正を何度もしている箇所」をプロンプトや検証に還元する。
 * 後付けだと初期データを失うので、フェーズ1 の時点から取る。
 */

/** フェーズ1〜2 で発生しうるカテゴリ（docs/04_要件定義.md 8章）。 */
export const MODIFICATION_CATEGORIES = [
  'script-fix',
  'outline-fix',
  'visual-fix',
  'reading-fix',
  'timing-fix',
  'other',
] as const;

export const modificationSchema = z.object({
  at: z.string(),
  projectId: z.string(),
  /** どの工程の成果物か。 */
  step: z.string(),
  category: z.enum(MODIFICATION_CATEGORIES).default('other'),
  /** 何を直したか。空でもよいが、書いてあると後で効く。 */
  note: z.string().default(''),
  /** 変更の大きさの目安。 */
  bytesBefore: z.number().int().nonnegative(),
  bytesAfter: z.number().int().nonnegative(),
});
export type Modification = z.infer<typeof modificationSchema>;

const FILE = () => path.join(DIRS.logs, 'modifications.jsonl');

export function appendModification(entry: Omit<Modification, 'at'>): Modification {
  const record = modificationSchema.parse({ ...entry, at: new Date().toISOString() });
  fs.mkdirSync(DIRS.logs, { recursive: true });
  fs.appendFileSync(FILE(), `${JSON.stringify(record)}\n`, 'utf-8');
  return record;
}

export function readModifications(projectId?: string): Modification[] {
  const file = FILE();
  if (!fs.existsSync(file)) return [];
  const out: Modification[] = [];
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed = modificationSchema.safeParse(JSON.parse(line));
      if (parsed.success && (!projectId || parsed.data.projectId === projectId)) out.push(parsed.data);
    } catch {
      // 壊れた行は読み飛ばす。ログは参考情報で、パイプラインを止める理由にはならない。
    }
  }
  return out;
}
