import { useMemo } from 'react';
import { Audio } from '@remotion/media';
import { AbsoluteFill, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import type { Manifest, ManifestLine } from '../schema/manifest.js';
import { CharacterView } from './components/Character.js';
import { Subtitle } from './components/Subtitle.js';
import { FONT_FAMILY, useLoadFonts } from './Fonts.js';
import { ThemeContext, useTheme, withAlpha, type ThemeRuntime } from './ThemeContext.js';
import { VOICE_VOLUME } from './theme.js';
import { VisualView, type PanelGeometry } from './visuals/index.js';
import { SHORT_SUBTITLE } from '../shared/short-layout.js';

/**
 * ショート（縦 9:16）のコンポジション。
 *
 * 本編と同じ部品（立ち絵・字幕・ビジュアル）を縦の寸法で並べ直す。
 * 行の選択と開始フレームの詰め直しはビルド側（src/pipeline/shorts.ts）で
 * 済んでいるので、ここでは本編と同じく「いつ何を出すか」だけを組む。
 */

export const SHORT_STAGE = { width: 1080, height: 1920 } as const;

/** 掛け合い: スライドは上、立ち絵は中央、字幕は下。 */
const PANEL_DIALOGUE: PanelGeometry = { x: 60, y: 200, width: 960, height: 620, radius: 28, padding: 44 };
/** 紙芝居: スライドを大きく。 */
const PANEL_KAMISHIBAI: PanelGeometry = { x: 60, y: 200, width: 960, height: 1180, radius: 28, padding: 52 };

/** 字幕帯の寸法は src/shared/short-layout.ts。ビルド側も同じ値で折り返している。 */

/** 立ち絵。話者だけを中央に大きく置く。 */
const CHARACTER_BOX = { centerX: 540, bottom: 380, height: 820, stageHeight: SHORT_STAGE.height };

interface Segment<T> { value: T; from: number; durationInFrames: number }
function segmentBy<T>(lines: ManifestLine[], pick: (l: ManifestLine) => T, key: (v: T) => string): Segment<T>[] {
  const out: Segment<T>[] = [];
  for (const line of lines) {
    const value = pick(line);
    const last = out[out.length - 1];
    if (last && key(last.value) === key(value)) { last.durationInFrames += line.durationInFrames; continue; }
    out.push({ value, from: line.startFrame, durationInFrames: line.durationInFrames });
  }
  return out;
}
function lineAtFrame(lines: ManifestLine[], frame: number): ManifestLine | undefined {
  for (const line of lines) if (frame < line.startFrame + line.durationInFrames) return line;
  return lines[lines.length - 1];
}

/** 冒頭の一言。最初の数秒だけ大きく出して消える。 */
function Hook({ text, frames }: { text: string; frames: number }) {
  const frame = useCurrentFrame();
  const { colors } = useTheme();
  const opacity = interpolate(frame, [0, 6, frames - 8, frames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const y = interpolate(frame, [0, 10], [14, 0], { extrapolateRight: 'clamp' });
  if (frame >= frames) return null;
  return (
    <div
      style={{
        position: 'absolute', left: 60, right: 60, top: 60,
        padding: '22px 30px', borderRadius: 20,
        background: withAlpha(colors.accent, 0.92), color: '#ffffff',
        fontFamily: FONT_FAMILY, fontWeight: 700, fontSize: 56, lineHeight: 1.3, textAlign: 'center',
        boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
        opacity, transform: `translateY(${y}px)`,
      }}
    >
      {text}
    </div>
  );
}

function Foreground({ manifest }: { manifest: Manifest }) {
  const frame = useCurrentFrame();
  const line = lineAtFrame(manifest.lines, frame);
  if (!line) return null;
  const local = frame - line.startFrame;
  const speaking = local < line.speechFrames;
  const mouth = speaking ? (line.mouth[local] ?? 0) : 0;
  const character = manifest.characters[line.character];
  if (!character) return null;
  const kamishibai = manifest.format === 'kamishibai';

  return (
    <>
      {kamishibai ? null : (
        <CharacterView character={character} emotion={line.emotion} mouth={mouth} speaking box={CHARACTER_BOX} />
      )}
      <Subtitle lines={line.subtitleLines} character={character} showName={!kamishibai} geometry={SHORT_SUBTITLE} />
    </>
  );
}

export interface ShortVideoProps {
  projectId: string;
  shortId: string;
  manifest?: Manifest;
}

export function ShortVideo({ manifest }: ShortVideoProps) {
  if (!manifest) throw new Error('マニフェストが解決されていない');
  if (!manifest.short) throw new Error('ショート用のマニフェストではない');
  return <ShortBody manifest={manifest} />;
}

function ShortBody({ manifest }: { manifest: Manifest }) {
  useLoadFonts(manifest.fonts);
  const short = manifest.short!;
  const runtime: ThemeRuntime = {
    colors: manifest.theme.colors,
    subtitleOpacity: manifest.theme.subtitleOpacity,
    bgmVolume: manifest.theme.bgmVolume,
  };
  const panel = manifest.format === 'kamishibai' ? PANEL_KAMISHIBAI : PANEL_DIALOGUE;

  const visualSegments = useMemo(() => segmentBy(manifest.lines, (l) => l.visual, (v) => JSON.stringify(v)), [manifest.lines]);
  const bgmSegments = useMemo(() => segmentBy(manifest.lines, (l) => l.bgm, (b) => b ?? ''), [manifest.lines]);

  return (
    <ThemeContext.Provider value={runtime}>
      <AbsoluteFill style={{ background: `linear-gradient(170deg, ${runtime.colors.backgroundTop} 0%, ${runtime.colors.backgroundBottom} 100%)` }}>
        {visualSegments.map((seg) => (
          <Sequence key={`v-${seg.from}`} from={seg.from} durationInFrames={seg.durationInFrames}>
            <VisualView visual={seg.value} projectId={short.sourceProjectId} format={manifest.format} panel={panel} />
          </Sequence>
        ))}
        <Foreground manifest={manifest} />
        <Hook text={short.hook} frames={short.hookFrames} />
        {manifest.lines.map((line) => (
          <Sequence key={`a-${line.id}`} from={line.startFrame} durationInFrames={line.speechFrames}>
            <Audio src={staticFile(line.audio)} volume={VOICE_VOLUME} />
          </Sequence>
        ))}
        {bgmSegments.map((seg) => seg.value === null ? null : (
          <Sequence key={`b-${seg.from}`} from={seg.from} durationInFrames={seg.durationInFrames}>
            <Audio src={staticFile(seg.value)} volume={runtime.bgmVolume} loop />
          </Sequence>
        ))}
      </AbsoluteFill>
    </ThemeContext.Provider>
  );
}
