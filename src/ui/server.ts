import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { doctor } from '../pipeline/doctor.js';
import { addIdea, dropIdea, pickIdea, readInbox, restoreIdea } from '../pipeline/ideas.js';
import {
  MODIFICATION_CATEGORIES,
  appendModification,
  readModifications,
} from '../pipeline/logs.js';
import { DIRS, ROOT, outPath, characterConfigPath, characterDir } from '../pipeline/paths.js';
import {
  PHASES,
  STEPS,
  currentPhase,
  listProjects,
  nextStep,
  projectStatus,
  readIdea,
  stepById,
} from '../pipeline/steps.js';
import { BACKEND_IDS, isBackendId } from '../pipeline/tts.js';
import { characterSchema } from '../schema/character.js';
import { KIND_LABELS } from '../schema/idea.js';

/**
 * 制作用の画面（docs/06_全体計画.md 4章）。
 *
 * この画面がやるのは「見る・選ぶ・直す・焼く」。**AI は呼ばない。**
 * UI から LLM を叩くと 1本ごとの API 課金に戻り、「何本作っても定額」が崩れる。
 * 生成はエージェントが端末側で行い、ここはその成果物を見て直す場所に徹する。
 *
 * ただし音声生成とレンダリングは機械の工程（決定的なコード）なので、画面から
 * 実行できる。裏で `douga build` / `douga render` を子プロセスとして走らせる。
 *
 * 依存を増やさないため、フレームワークを使わず node:http だけで書いている。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_HTML = path.join(here, 'app.html');

// --- 共通 ----------------------------------------------------------------------

interface Json {
  status: number;
  body: unknown;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      // 画面からの入力しか来ない。台本 JSON でも数百 KB あれば足りる。
      if (size > 1024 * 1024 * 4) {
        reject(new HttpError(413, 'リクエストが大きすぎる'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (raw === '') return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'JSON として読めない'));
      }
    });
    req.on('error', reject);
  });
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new HttpError(400, `${field} が必要`);
  return value.trim();
}

function requireProject(id: string): string {
  if (!listProjects().includes(id)) throw new HttpError(404, `プロジェクトがない: ${id}`);
  return id;
}

// --- プロジェクトの要約 --------------------------------------------------------

function stepView(projectId: string) {
  return projectStatus(projectId).map((s) => ({
    id: s.step.id,
    label: s.step.label,
    phase: s.step.phase,
    executor: s.step.executor,
    implemented: s.step.implemented,
    plannedPhase: s.step.plannedPhase ?? null,
    artifact: s.step.artifact.replace('<id>', projectId),
    prompt: s.step.prompt ?? null,
    editable: s.step.editable,
    state: s.state,
    exists: s.exists,
    updatedAt: s.updatedAt,
    issues: s.issues,
  }));
}

function projectSummary(id: string) {
  const idea = readIdea(id);
  const next = nextStep(id);
  return {
    id,
    title: idea?.title ?? id,
    kind: idea?.kind ?? null,
    kindLabel: idea ? KIND_LABELS[idea.kind] : null,
    text: idea?.text ?? null,
    createdAt: idea?.createdAt ?? null,
    phase: currentPhase(id),
    next: next ? { id: next.step.id, label: next.step.label, state: next.state } : null,
    running: activeJob(id)?.id ?? null,
    steps: stepView(id),
  };
}

function readArtifactText(projectId: string, stepId: string): string | null {
  const step = stepById(stepId);
  if (!step || !step.editable) return null;
  const file = step.resolve(projectId);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf-8');
}

// --- ジョブ（音声生成・レンダリング）--------------------------------------------

type JobKind = 'build' | 'render';
type JobStatus = 'running' | 'done' | 'failed';

interface Job {
  id: string;
  projectId: string;
  kind: JobKind;
  args: string[];
  status: JobStatus;
  log: string[];
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  child: ChildProcess | null;
}

const jobs = new Map<string, Job>();
let jobSeq = 0;

function activeJob(projectId: string): Job | undefined {
  for (const job of jobs.values()) {
    if (job.projectId === projectId && job.status === 'running') return job;
  }
  return undefined;
}

function jobView(job: Job) {
  const { child: _child, ...rest } = job;
  return { ...rest, log: rest.log.slice(-400) };
}

function startJob(projectId: string, kind: JobKind, options: { tts: string; preset: string }): Job {
  if (activeJob(projectId)) throw new HttpError(409, 'このプロジェクトのジョブが実行中');
  if (!isBackendId(options.tts)) throw new HttpError(400, `未知の TTS: ${options.tts}`);
  if (kind === 'render' && !['draft', 'final'].includes(options.preset)) {
    throw new HttpError(400, `未知のプリセット: ${options.preset}`);
  }

  const args = ['tsx', 'src/cli/index.ts', kind, projectId, '--tts', options.tts];
  if (kind === 'render') args.push('--preset', options.preset);

  const id = `j${Date.now().toString(36)}${(++jobSeq).toString(36)}`;
  const job: Job = {
    id, projectId, kind, args, status: 'running', log: [],
    startedAt: new Date().toISOString(), endedAt: null, exitCode: null, child: null,
  };
  jobs.set(id, job);

  const push = (chunk: Buffer) => {
    for (const line of chunk.toString('utf-8').split(/\r?\n/)) {
      if (line.trim() !== '') job.log.push(line);
    }
    // メモリを食わないよう、古い行から落とす
    if (job.log.length > 2000) job.log.splice(0, job.log.length - 2000);
  };

  const child = spawn('npx', args, { cwd: ROOT, env: process.env });
  job.child = child;
  child.stdout.on('data', push);
  child.stderr.on('data', push);
  child.on('error', (error) => {
    job.log.push(`起動に失敗: ${error.message}`);
    job.status = 'failed';
    job.endedAt = new Date().toISOString();
    job.child = null;
  });
  child.on('exit', (code) => {
    job.exitCode = code;
    job.status = code === 0 ? 'done' : 'failed';
    job.endedAt = new Date().toISOString();
    job.child = null;
  });

  return job;
}

// --- 動画の配信（Range 対応）--------------------------------------------------

function serveVideo(req: http.IncomingMessage, res: http.ServerResponse, file: string): void {
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  const { size } = fs.statSync(file);
  const range = req.headers.range;
  const headers: Record<string, string> = {
    'content-type': 'video/mp4',
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  };

  if (!range) {
    res.writeHead(200, { ...headers, 'content-length': String(size) });
    fs.createReadStream(file).pipe(res);
    return;
  }

  // <video> のシークに必要。1レンジだけ受ける。
  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m) {
    res.writeHead(416, headers);
    res.end();
    return;
  }
  const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[2] === '' || m[1] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
    res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` });
    res.end();
    return;
  }
  res.writeHead(206, {
    ...headers,
    'content-range': `bytes ${start}-${end}/${size}`,
    'content-length': String(end - start + 1),
  });
  fs.createReadStream(file, { start, end }).pipe(res);
}

// --- ルーティング ---------------------------------------------------------------

async function route(req: http.IncomingMessage, url: URL): Promise<Json> {
  const { pathname } = url;
  const method = req.method ?? 'GET';
  const ok = (body: unknown): Json => ({ status: 200, body });

  // ネタ
  if (method === 'GET' && pathname === '/api/ideas') return ok(readInbox());
  if (method === 'POST' && pathname === '/api/ideas') {
    const body = (await readBody(req)) as { text?: unknown; tags?: unknown };
    const tags = Array.isArray(body.tags)
      ? body.tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '')
      : [];
    return ok(addIdea(asString(body.text, 'text'), tags));
  }
  let m = /^\/api\/ideas\/([^/]+)\/(drop|restore|pick)$/.exec(pathname);
  if (method === 'POST' && m) {
    const ideaId = decodeURIComponent(m[1]!);
    const body = (await readBody(req)) as Record<string, unknown>;
    if (m[2] === 'drop') return ok(dropIdea(ideaId, typeof body.reason === 'string' ? body.reason : ''));
    if (m[2] === 'restore') return ok(restoreIdea(ideaId));
    const kind = typeof body.kind === 'string' ? body.kind : undefined;
    if (kind !== undefined && !(kind in KIND_LABELS)) throw new HttpError(400, `未知の用途: ${kind}`);
    return ok(pickIdea({
      ideaId,
      projectId: asString(body.projectId, 'projectId'),
      title: typeof body.title === 'string' && body.title.trim() !== '' ? body.title.trim() : undefined,
      kind: kind as keyof typeof KIND_LABELS | undefined,
    }));
  }

  // ボードとプロジェクト
  if (method === 'GET' && pathname === '/api/board') {
    return ok({
      phases: PHASES,
      steps: STEPS.map((s) => ({ id: s.id, label: s.label, phase: s.phase, executor: s.executor, implemented: s.implemented, plannedPhase: s.plannedPhase ?? null })),
      projects: listProjects().map(projectSummary),
    });
  }
  if (method === 'GET' && pathname === '/api/projects') return ok(listProjects().map(projectSummary));

  m = /^\/api\/projects\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && m) {
    const id = requireProject(decodeURIComponent(m[1]!));
    const artifacts: Record<string, string | null> = {};
    for (const step of STEPS) if (step.editable) artifacts[step.id] = readArtifactText(id, step.id);
    return ok({ ...projectSummary(id), artifacts, modifications: readModifications(id).slice(-50) });
  }

  m = /^\/api\/projects\/([^/]+)\/artifacts\/([^/]+)$/.exec(pathname);
  if (method === 'PUT' && m) {
    const id = requireProject(decodeURIComponent(m[1]!));
    const step = stepById(decodeURIComponent(m[2]!));
    if (!step || !step.editable) throw new HttpError(400, '画面から編集できない工程');
    const body = (await readBody(req)) as { content?: unknown; category?: unknown; note?: unknown };
    if (typeof body.content !== 'string') throw new HttpError(400, 'content が必要');
    const category = typeof body.category === 'string' && (MODIFICATION_CATEGORIES as readonly string[]).includes(body.category)
      ? (body.category as (typeof MODIFICATION_CATEGORIES)[number])
      : 'other';

    const file = step.resolve(id);
    const before = fs.existsSync(file) ? fs.statSync(file).size : 0;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body.content, 'utf-8');

    // 人間の修正を記録する。改善ループの材料（docs/06_全体計画.md 5章）。
    appendModification({
      projectId: id, step: step.id, category,
      note: typeof body.note === 'string' ? body.note.trim() : '',
      bytesBefore: before, bytesAfter: Buffer.byteLength(body.content, 'utf-8'),
    });
    return ok({ saved: true, steps: stepView(id) });
  }

  // ジョブ
  m = /^\/api\/projects\/([^/]+)\/jobs$/.exec(pathname);
  if (m) {
    const id = requireProject(decodeURIComponent(m[1]!));
    if (method === 'GET') {
      return ok([...jobs.values()].filter((j) => j.projectId === id).map(jobView));
    }
    if (method === 'POST') {
      const body = (await readBody(req)) as { kind?: unknown; tts?: unknown; preset?: unknown };
      const kind = body.kind === 'render' ? 'render' : body.kind === 'build' ? 'build' : null;
      if (!kind) throw new HttpError(400, 'kind は build か render');
      return ok(jobView(startJob(id, kind, {
        tts: typeof body.tts === 'string' ? body.tts : 'irodori',
        preset: typeof body.preset === 'string' ? body.preset : 'final',
      })));
    }
  }
  m = /^\/api\/jobs\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && m) {
    const job = jobs.get(decodeURIComponent(m[1]!));
    if (!job) throw new HttpError(404, 'ジョブがない');
    return ok(jobView(job));
  }

  // キャラクター・環境
  if (method === 'GET' && pathname === '/api/characters') {
    const ids = fs.existsSync(DIRS.characters)
      ? fs.readdirSync(DIRS.characters, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
      : [];
    return ok(ids.map((id) => {
      const file = characterConfigPath(id);
      let config: unknown = null;
      let error: string | null = null;
      try {
        const parsed = characterSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf-8')));
        if (parsed.success) config = parsed.data;
        else error = parsed.error.issues[0]?.message ?? '不正';
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      return { id, config, error, hasPersona: fs.existsSync(path.join(characterDir(id), 'persona.md')) };
    }));
  }
  if (method === 'GET' && pathname === '/api/doctor') return ok(await doctor());
  if (method === 'GET' && pathname === '/api/meta') {
    return ok({ ttsBackends: BACKEND_IDS, categories: MODIFICATION_CATEGORIES, kinds: KIND_LABELS });
  }

  throw new HttpError(404, 'そのような API はない');
}

export function createServer(): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(fs.readFileSync(APP_HTML));
      return;
    }

    const media = /^\/media\/out\/([a-z0-9][a-z0-9-]*)\.mp4$/.exec(url.pathname);
    if (req.method === 'GET' && media) {
      serveVideo(req, res, outPath(media[1]!));
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }

    route(req, url)
      .then(({ status, body }) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(body));
      })
      .catch((error: unknown) => {
        // 画面には理由をそのまま出す。黙って握りつぶさない。
        const status = error instanceof HttpError ? error.status : 400;
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      });
  });
}

export interface UiOptions {
  port: number;
  host?: string;
}

export function startUi({ port, host = '127.0.0.1' }: UiOptions): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
