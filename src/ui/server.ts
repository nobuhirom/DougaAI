import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addIdea, dropIdea, pickIdea, readInbox, restoreIdea } from '../pipeline/ideas.js';
import {
  listProjects,
  nextStep,
  projectStatus,
  readIdea,
  STEPS,
} from '../pipeline/steps.js';
import { projectDir } from '../pipeline/paths.js';
import { KIND_LABELS } from '../schema/idea.js';

/**
 * 制作用の画面（docs/06_全体計画.md 4章）。
 *
 * この画面がやるのは「見る・選ぶ・直す」だけ。**AI は呼ばない。**
 * UI から LLM を叩くと 1本ごとの API 課金に戻り、「何本作っても定額」が崩れる。
 * 生成はエージェントが端末側で行い、ここはその成果物を見て直す場所に徹する。
 *
 * 依存を増やさないため、フレームワークを使わず node:http だけで書いている。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_HTML = path.join(here, 'app.html');

interface Json {
  status: number;
  body: unknown;
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      // 画面からの入力しか来ない。大きすぎるものは受け取らない。
      if (size > 1024 * 256) {
        reject(new Error('リクエストが大きすぎる'));
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
        reject(new Error('JSON として読めない'));
      }
    });
    req.on('error', reject);
  });
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} が必要`);
  }
  return value.trim();
}

/** 工程ごとの成果物を読む。無ければ null。 */
function readArtifact(projectId: string, artifact: string): string | null {
  const file = path.join(projectDir(projectId), artifact);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf-8');
}

function projectSummary(id: string) {
  const idea = readIdea(id);
  const status = projectStatus(id);
  const next = nextStep(id);
  return {
    id,
    title: idea?.title ?? id,
    kind: idea?.kind ?? null,
    kindLabel: idea ? KIND_LABELS[idea.kind] : null,
    text: idea?.text ?? null,
    next: next ? { id: next.step.id, label: next.step.label, state: next.state } : null,
    steps: status.map((s) => ({
      id: s.step.id,
      label: s.step.label,
      executor: s.step.executor,
      artifact: s.step.artifact,
      prompt: s.step.prompt ?? null,
      state: s.state,
      exists: s.exists,
      issues: s.issues,
    })),
  };
}

async function route(req: http.IncomingMessage, url: URL): Promise<Json> {
  const { pathname } = url;
  const method = req.method ?? 'GET';

  if (method === 'GET' && pathname === '/api/ideas') {
    return { status: 200, body: readInbox() };
  }

  if (method === 'POST' && pathname === '/api/ideas') {
    const body = (await readBody(req)) as { text?: unknown; tags?: unknown };
    const tags = Array.isArray(body.tags)
      ? body.tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '')
      : [];
    return { status: 200, body: addIdea(asString(body.text, 'text'), tags) };
  }

  const dropMatch = /^\/api\/ideas\/([^/]+)\/drop$/.exec(pathname);
  if (method === 'POST' && dropMatch) {
    const body = (await readBody(req)) as { reason?: unknown };
    const reason = typeof body.reason === 'string' ? body.reason : '';
    return { status: 200, body: dropIdea(decodeURIComponent(dropMatch[1]!), reason) };
  }

  const restoreMatch = /^\/api\/ideas\/([^/]+)\/restore$/.exec(pathname);
  if (method === 'POST' && restoreMatch) {
    return { status: 200, body: restoreIdea(decodeURIComponent(restoreMatch[1]!)) };
  }

  const pickMatch = /^\/api\/ideas\/([^/]+)\/pick$/.exec(pathname);
  if (method === 'POST' && pickMatch) {
    const body = (await readBody(req)) as {
      projectId?: unknown;
      title?: unknown;
      kind?: unknown;
    };
    const kind = typeof body.kind === 'string' ? body.kind : undefined;
    if (kind !== undefined && !(kind in KIND_LABELS)) {
      throw new Error(`未知の用途: ${kind}`);
    }
    const idea = pickIdea({
      ideaId: decodeURIComponent(pickMatch[1]!),
      projectId: asString(body.projectId, 'projectId'),
      title: typeof body.title === 'string' && body.title.trim() !== '' ? body.title.trim() : undefined,
      kind: kind as keyof typeof KIND_LABELS | undefined,
    });
    return { status: 200, body: idea };
  }

  if (method === 'GET' && pathname === '/api/projects') {
    return { status: 200, body: listProjects().map(projectSummary) };
  }

  const projectMatch = /^\/api\/projects\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && projectMatch) {
    const id = decodeURIComponent(projectMatch[1]!);
    if (!listProjects().includes(id)) {
      return { status: 404, body: { error: `プロジェクトがない: ${id}` } };
    }
    const artifacts: Record<string, string | null> = {};
    for (const step of STEPS) {
      artifacts[step.id] = readArtifact(id, step.artifact);
    }
    return { status: 200, body: { ...projectSummary(id), artifacts } };
  }

  return { status: 404, body: { error: 'そのような API はない' } };
}

export interface UiOptions {
  port: number;
  host?: string;
}

export function createServer(): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(APP_HTML));
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }

    route(req, url)
      .then(({ status, body }) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(body));
      })
      .catch((error: unknown) => {
        // 画面には理由をそのまま出す。黙って握りつぶさない。
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      });
  });
}

export function startUi({ port, host = '127.0.0.1' }: UiOptions): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
