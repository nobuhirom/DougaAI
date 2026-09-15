import { z } from 'zod';

/**
 * ネタと企画（docs/06_全体計画.md 工程1〜3）。
 *
 * 起点は必ず人間。AI が勝手にネタを決めても、作りたいものにならない。
 * ここで扱うのは「人間が放り込んだ断片」と、それを企画へ育てた結果。
 */

/** 書き捨てたネタ。ideas/inbox.jsonl に1行1件で溜まる。 */
export const inboxIdeaSchema = z.object({
  /** 作成時刻から作る短い識別子。 */
  id: z.string().regex(/^i[0-9a-z]{7,}$/),
  /** 思いついたことをそのまま。整える必要はない。 */
  text: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).default([]),
  createdAt: z.string(),
  /**
   * inbox  まだ何もしていない
   * picked プロジェクトにした
   * dropped 見送った（消さずに残す。同じネタを何度も拾わないため）
   */
  status: z.enum(['inbox', 'picked', 'dropped']).default('inbox'),
  /** picked のとき、どのプロジェクトになったか。 */
  projectId: z.string().optional(),
  /** dropped のとき、なぜ見送ったか。 */
  reason: z.string().optional(),
});
export type InboxIdea = z.infer<typeof inboxIdeaSchema>;

/**
 * プロジェクトの起点（projects/<id>/idea.json）。
 * inbox から拾ったネタに、動画1本ぶんの当たりを付けたもの。
 */
export const ideaSchema = z.object({
  /** プロジェクト ID。projects/<id>/ と一致させる。 */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** 仮タイトル。企画メモや台本で変わってよい。 */
  title: z.string().trim().min(1),
  /** 元になったネタの本文。 */
  text: z.string().trim().min(1),
  /** inbox から拾った場合、その id。 */
  sourceIdeaId: z.string().optional(),
  /** 用途。人間の関与度がこれで変わる（docs/06_全体計画.md 3章）。 */
  kind: z.enum(['explainer', 'study', 'document']).default('explainer'),
  /** 補足。調べたいこと、引っかかっていること。 */
  notes: z.array(z.string().trim().min(1)).default([]),
  createdAt: z.string(),
});
export type Idea = z.infer<typeof ideaSchema>;

/** 用途ごとの既定の進め方（docs/06_全体計画.md 3章）。 */
export const KIND_LABELS: Record<Idea['kind'], string> = {
  explainer: '解説動画（公開）',
  study: '自分専用の学習動画',
  document: '資料の動画化',
};

/** 時刻から重複しない id を作る。 */
export function newIdeaId(now: Date = new Date()): string {
  return `i${now.getTime().toString(36)}`;
}
