import fs from 'node:fs';
import path from 'node:path';
import { voiceLibrarySchema, type Voice, type VoiceLibrary } from '../schema/voice.js';
import { DIRS } from './paths.js';
import type { Issue } from './validate.js';

/**
 * 声のライブラリの読み書き（voices/library.json）。
 *
 * サーバー側の登録は不要。Irodori-TTS-Server は IRODORI_VOICES_DIR を
 * このリポジトリの voices/ に向けてあるので、voices/<id>.wav を置けば
 * そのまま `voice: "<id>"` で解決される（tools/irodori/.env）。
 */

export const libraryPath = () => path.join(DIRS.voices, 'library.json');

export function readVoiceLibrary(): VoiceLibrary {
  const file = libraryPath();
  if (!fs.existsSync(file)) return { voices: [] };
  const parsed = voiceLibrarySchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf-8')));
  if (!parsed.success) {
    throw new Error(`voices/library.json が不正: ${parsed.error.issues[0]?.message ?? ''}`);
  }
  return parsed.data;
}

export function writeVoiceLibrary(library: VoiceLibrary): void {
  fs.mkdirSync(DIRS.voices, { recursive: true });
  fs.writeFileSync(libraryPath(), `${JSON.stringify(voiceLibrarySchema.parse(library), null, 2)}\n`, 'utf-8');
}

export function voiceById(id: string): Voice | undefined {
  return readVoiceLibrary().voices.find((v) => v.id === id);
}

/** 参照音声の実体。無ければ null。 */
export function referencePath(voice: Voice): string | null {
  return voice.reference ? path.join(DIRS.voices, voice.reference) : null;
}

/** ライブラリの整合性。参照音声の実在と id の重複を見る。 */
export function validateVoiceLibrary(): Issue[] {
  const issues: Issue[] = [];
  let library: VoiceLibrary;
  try {
    library = readVoiceLibrary();
  } catch (error) {
    return [{ code: 'voice-library', message: error instanceof Error ? error.message : String(error) }];
  }
  const seen = new Set<string>();
  for (const voice of library.voices) {
    if (seen.has(voice.id)) issues.push({ code: 'duplicate-voice', message: `声の id が重複: ${voice.id}` });
    seen.add(voice.id);
    const ref = referencePath(voice);
    if (ref && !fs.existsSync(ref)) {
      issues.push({ code: 'missing-reference', message: `参照音声が見つからない: voices/${voice.reference}（${voice.id}）` });
    }
    if (!ref && !voice.caption) {
      issues.push({ code: 'voice-undefined', message: `${voice.id} に参照音声もキャプションも無い。どちらかが要る` });
    }
  }
  return issues;
}
