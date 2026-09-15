import fs from 'node:fs';
import { themeSchema, type Theme } from '../schema/theme.js';
import { themeConfigPath, themeDir } from './paths.js';
import { ValidationError } from './validate.js';

/** themes/<id>/theme.json を読む。無ければ検証エラー。 */
export function loadTheme(id: string): Theme {
  const file = themeConfigPath(id);
  if (!fs.existsSync(file)) {
    throw new ValidationError([{ code: 'missing-theme', message: `テーマが見つからない: themes/${id}/theme.json` }]);
  }
  const parsed = themeSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf-8')));
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => ({ code: 'schema', message: `themes/${id}: ${i.path.join('.')}: ${i.message}` })));
  }
  if (parsed.data.id !== id) {
    throw new ValidationError([{ code: 'theme-id-mismatch', message: `themes/${id}/theme.json の id が "${parsed.data.id}"` }]);
  }
  return parsed.data;
}

/** テーマの文体ガイド（style.md）。無ければ null。手順書の末尾に足す。 */
export function readStyleGuide(id: string): string | null {
  const file = `${themeDir(id)}/style.md`;
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
}
