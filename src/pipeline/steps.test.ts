import { describe, expect, it } from 'vitest';
import { PHASES, PLAN_SECTIONS, RESEARCH_SECTIONS, STEPS, readSections } from './steps.js';

/**
 * 工程の検証ロジック。
 *
 * 企画メモと調査メモは Markdown なので、節が揃っているかを機械で見る。
 * 「節はあるが中身が空」を通してしまうと、次の工程が入力なしで走ることになる。
 */

describe('readSections', () => {
  it('## 見出しごとに本文を切り出す', () => {
    const md = ['# タイトル', '前書き', '', '## 誰に', '初心者', '', '## 構成', '1. 導入'].join('\n');
    const sections = readSections(md);
    expect(sections.get('誰に')).toBe('初心者');
    expect(sections.get('構成')).toBe('1. 導入');
  });

  it('見出しの前の文章は節に入れない', () => {
    const sections = readSections('# タイトル\n前書き\n\n## 誰に\n本文');
    expect([...sections.keys()]).toEqual(['誰に']);
  });

  it('中身が空の節は空文字になる', () => {
    const sections = readSections('## 誰に\n\n## 構成\n本文');
    expect(sections.get('誰に')).toBe('');
    expect(sections.get('構成')).toBe('本文');
  });

  it('### は節の区切りにしない（節の中の小見出しとして扱う）', () => {
    const sections = readSections('## 構成\n### 導入\n本文');
    expect([...sections.keys()]).toEqual(['構成']);
    expect(sections.get('構成')).toContain('### 導入');
  });

  it('見出しの前後の空白を落とす', () => {
    const sections = readSections('##   誰に   \n本文');
    expect(sections.has('誰に')).toBe(true);
  });

  it('節がなければ空を返す', () => {
    expect(readSections('見出しのない文章').size).toBe(0);
  });
});

describe('工程の定義', () => {
  it('依存先が実在する工程を指している', () => {
    const ids = new Set(STEPS.map((s) => s.id));
    for (const step of STEPS) {
      for (const required of step.requires) {
        expect(ids.has(required), `${step.id} が未定義の工程 ${required} に依存`).toBe(true);
      }
    }
  });

  it('依存先は自分より前に定義されている', () => {
    const seen = new Set<string>();
    for (const step of STEPS) {
      for (const required of step.requires) {
        expect(seen.has(required), `${step.id} が後ろの工程 ${required} に依存`).toBe(true);
      }
      seen.add(step.id);
    }
  });

  it('実装済みでエージェントが行う工程には手順書がある', () => {
    for (const step of STEPS.filter((s) => s.executor === 'agent' && s.implemented)) {
      expect(step.prompt, `${step.id} に手順書がない`).toBeTruthy();
    }
  });

  it('未実装の工程には、どのフェーズで作るかが書いてある', () => {
    for (const step of STEPS.filter((s) => !s.implemented)) {
      expect(step.plannedPhase, `${step.id} の予定フェーズがない`).toBeTruthy();
    }
  });

  it('工程の並びが参考構成に沿っている（レビューは各工程のゲート、多言語化は不要）', () => {
    expect(STEPS.map((s) => s.id)).toEqual([
      'idea', 'plan', 'research', 'script', 'visual',
      'audio', 'thumbnail', 'assemble', 'shorts', 'publish',
    ]);
  });

  it('各工程が5つの段階のどれかに属している', () => {
    const phases = new Set(PHASES.map((p) => p.id));
    for (const step of STEPS) expect(phases.has(step.phase), `${step.id} の段階が不明`).toBe(true);
  });

  it('成果物のパスが重複していない', () => {
    const artifacts = STEPS.map((s) => s.artifact);
    expect(new Set(artifacts).size).toBe(artifacts.length);
  });
});

describe('必須の節', () => {
  it('企画メモは5節', () => {
    expect(PLAN_SECTIONS).toHaveLength(5);
    expect(PLAN_SECTIONS).toContain('扱わないこと');
    expect(PLAN_SECTIONS).toContain('調べること');
  });

  it('調査メモには限界を書く節がある', () => {
    // 分からなかったことを書く場所を必須にしている。
    // ここがないと、調べられなかった項目が黙って消える。
    expect(RESEARCH_SECTIONS).toContain('調査の限界');
    expect(RESEARCH_SECTIONS).toContain('出典');
  });
});
