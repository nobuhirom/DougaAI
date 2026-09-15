import fs from 'node:fs';
import path from 'node:path';
import { manifestSchema, type Manifest, type ManifestLine } from '../schema/manifest.js';
import { HOOK_SECONDS, SHORT_MAX_SECONDS, SHORT_SIZE, shortsSchema, type Shorts } from '../schema/shorts.js';
import { STATIC } from '../shared/static.js';
import { wrapSubtitle } from '../layout/subtitle.js';
import { SHORT_SUBTITLE_MAX_EM, SHORT_SUBTITLE_MAX_LINES } from '../shared/short-layout.js';
import { readManifest } from './build.js';
import { buildDir, projectDir, publicPath } from './paths.js';
import type { Issue } from './validate.js';

/**
 * ショートの切り出し（工程9）。
 *
 * 本編のマニフェストから行を選び、開始フレームを詰め直して縦動画用の
 * マニフェストを作る。音声・字幕・口の開きは本編で確定済みのものを再利用する。
 * 追加の TTS 生成は無い。
 */

export const shortsPath = (projectId: string) => path.join(projectDir(projectId), 'shorts.json');

export function readShorts(projectId: string): Shorts | null {
  const file = shortsPath(projectId);
  if (!fs.existsSync(file)) return null;
  const parsed = shortsSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf-8')));
  return parsed.success ? parsed.data : null;
}

/** shorts.json の検証。行 id の実在と尺は本編のマニフェストで見る。 */
export function validateShorts(projectId: string): Issue[] {
  const file = shortsPath(projectId);
  if (!fs.existsSync(file)) return [{ code: 'missing-artifact', message: 'shorts.json がない' }];

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (error) {
    return [{ code: 'json', message: `shorts.json: ${error instanceof Error ? error.message : String(error)}` }];
  }
  const parsed = shortsSchema.safeParse(raw);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({ code: 'schema', message: `shorts.json ${i.path.join('.')}: ${i.message}` }));
  }

  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const short of parsed.data.shorts) {
    if (seen.has(short.id)) issues.push({ code: 'duplicate-short', message: `ショートの id が重複: ${short.id}` });
    seen.add(short.id);
  }

  const manifest = readManifest(projectId);
  if (!manifest) {
    issues.push({ code: 'needs-build', message: '本編をビルドしてから検証する（尺を見るため）: npm run douga -- build ' + projectId });
    return issues;
  }
  const byId = new Map(manifest.lines.map((l) => [l.id, l]));

  for (const short of parsed.data.shorts) {
    let seconds = 0;
    let order = -1;
    for (const id of short.lineIds) {
      const line = byId.get(id);
      if (!line) {
        issues.push({ code: 'unknown-line', message: `${short.id}: 行 ${id} が本編にない` });
        continue;
      }
      const index = manifest.lines.indexOf(line);
      if (index < order) issues.push({ code: 'line-order', message: `${short.id}: 行 ${id} が本編の順序と逆` });
      order = index;
      seconds += line.durationInFrames / manifest.meta.fps;
      // 縦動画は字幕帯が狭い。本編で通った行でも溢れることがある
      const wrapped = wrapSubtitle(line.text, { maxLineWidthEm: SHORT_SUBTITLE_MAX_EM, maxLines: SHORT_SUBTITLE_MAX_LINES });
      if (wrapped.overflow) {
        issues.push({ code: 'subtitle-overflow', lineId: id, message: `${short.id}: 縦の字幕に収まらない（${wrapped.reason}）。本編の台本で行を割る` });
      }
    }
    if (seconds > SHORT_MAX_SECONDS) {
      issues.push({ code: 'short-too-long', message: `${short.id}: ${seconds.toFixed(1)} 秒。上限 ${SHORT_MAX_SECONDS} 秒` });
    }
  }
  return issues;
}

/** 派生マニフェストの置き場。 */
export const shortManifestPath = (projectId: string, shortId: string) =>
  path.join(buildDir(projectId), 'shorts', `${shortId}.json`);

/** 縦動画用のマニフェストを作り、public/manifests にも置く。 */
export function buildShorts(projectId: string): { id: string; manifest: Manifest }[] {
  const issues = validateShorts(projectId);
  if (issues.length > 0) {
    throw new Error(`shorts.json に問題がある:\n${issues.map((i) => `  [${i.code}] ${i.message}`).join('\n')}`);
  }
  const shorts = readShorts(projectId);
  const base = readManifest(projectId);
  if (!shorts || !base) throw new Error('shorts.json か本編のマニフェストが無い');

  const byId = new Map(base.lines.map((l) => [l.id, l]));
  const results: { id: string; manifest: Manifest }[] = [];

  for (const short of shorts.shorts) {
    let startFrame = 0;
    const lines: ManifestLine[] = short.lineIds.map((id) => {
      const src = byId.get(id)!;
      const line: ManifestLine = {
        ...src,
        startFrame,
        subtitleLines: wrapSubtitle(src.text, { maxLineWidthEm: SHORT_SUBTITLE_MAX_EM, maxLines: SHORT_SUBTITLE_MAX_LINES }).lines,
      };
      startFrame += src.durationInFrames;
      return line;
    });

    const manifest: Manifest = manifestSchema.parse({
      ...base,
      builtAt: new Date().toISOString(),
      meta: { ...base.meta, width: SHORT_SIZE.width, height: SHORT_SIZE.height },
      totalDurationInFrames: Math.max(1, startFrame),
      lines,
      short: {
        id: short.id,
        title: short.title,
        hook: short.hook,
        hookFrames: Math.round(HOOK_SECONDS * base.meta.fps),
        sourceProjectId: projectId,
      },
    });

    const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
    const file = shortManifestPath(projectId, short.id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serialized, 'utf-8');
    const staticFile = publicPath(STATIC.shortManifest(projectId, short.id));
    fs.mkdirSync(path.dirname(staticFile), { recursive: true });
    fs.writeFileSync(staticFile, serialized, 'utf-8');

    results.push({ id: short.id, manifest });
  }
  return results;
}
