import { useMemo } from 'react';
import { Audio } from '@remotion/media';
import { AbsoluteFill, Sequence, staticFile, useCurrentFrame } from 'remotion';
import type { Manifest, ManifestLine } from '../schema/manifest.js';
import { CharacterView } from './components/Character.js';
import { Subtitle } from './components/Subtitle.js';
import { FONT_FAMILY, useLoadFonts } from './Fonts.js';
import { BGM_VOLUME, COLORS, PANEL_KAMISHIBAI, SECTION_CHIP, VOICE_VOLUME } from './theme.js';
import { VisualView } from './visuals/index.js';

/**
 * 本編のコンポジション。
 *
 * 尺・字幕の折り返し・口の開きはすべてマニフェストで確定済みで、ここでは
 * 計算しない。この層がやるのは「いつ何を出すか」の組み立てだけ
 * （docs/04_要件定義.md N1）。
 */

/** 連続する同じ値をひとまとまりにする。 */
interface Segment<T> {
  value: T;
  from: number;
  durationInFrames: number;
}

function segmentBy<T>(
  lines: ManifestLine[],
  pick: (line: ManifestLine) => T,
  key: (value: T) => string,
): Segment<T>[] {
  const segments: Segment<T>[] = [];
  for (const line of lines) {
    const value = pick(line);
    const last = segments[segments.length - 1];
    if (last && key(last.value) === key(value)) {
      last.durationInFrames += line.durationInFrames;
      continue;
    }
    segments.push({
      value,
      from: line.startFrame,
      durationInFrames: line.durationInFrames,
    });
  }
  return segments;
}

/** 現在のフレームに対応するセリフ。境界では後ろのセリフを採る。 */
function lineAtFrame(lines: ManifestLine[], frame: number): ManifestLine | undefined {
  // 線形探索で足りる長さ（10分 = 数百件）。二分探索にする理由がまだない。
  for (const line of lines) {
    if (frame < line.startFrame + line.durationInFrames) return line;
  }
  return lines[lines.length - 1];
}

function Background() {
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${COLORS.backgroundTop} 0%, ${COLORS.backgroundBottom} 100%)`,
      }}
    />
  );
}

function SectionChip({ label, kamishibai }: { label: string; kamishibai: boolean }) {
  // 紙芝居はパネルが上に伸びるので、札は右上の余白へ逃がす
  return (
    <div
      style={{
        position: 'absolute',
        left: kamishibai ? undefined : SECTION_CHIP.x,
        right: kamishibai ? PANEL_KAMISHIBAI.x : undefined,
        top: kamishibai ? 8 : SECTION_CHIP.y,
        height: SECTION_CHIP.height,
        display: 'flex',
        alignItems: 'center',
        padding: `0 ${SECTION_CHIP.paddingX}px`,
        borderRadius: 999,
        background: 'rgba(255, 255, 255, 0.12)',
        border: '1px solid rgba(255, 255, 255, 0.22)',
        color: 'rgba(255, 255, 255, 0.85)',
        fontFamily: FONT_FAMILY,
        fontSize: SECTION_CHIP.fontSize,
        letterSpacing: '0.06em',
      }}
    >
      {label}
    </div>
  );
}

/** 立ち絵と字幕。フレームから現在のセリフを引いて描く。 */
function Foreground({ manifest }: { manifest: Manifest }) {
  const frame = useCurrentFrame();
  const line = lineAtFrame(manifest.lines, frame);
  if (!line) return null;

  const local = frame - line.startFrame;
  const speaking = local < line.speechFrames;
  const mouth = speaking ? (line.mouth[local] ?? 0) : 0;
  const character = manifest.characters[line.character];
  if (!character) return null;

  const kamishibai = manifest.meta.format === 'kamishibai';

  return (
    <>
      {kamishibai ? null : manifest.meta.characters.map((id) => {
        const c = manifest.characters[id];
        if (!c) return null;
        const isSpeaker = id === line.character;
        return (
          <CharacterView
            key={id}
            character={c}
            emotion={isSpeaker ? line.emotion : 'normal'}
            mouth={isSpeaker ? mouth : 0}
            speaking={isSpeaker}
          />
        );
      })}
      <SectionChip label={line.sectionName} kamishibai={kamishibai} />
      <Subtitle lines={line.subtitleLines} character={character} showName={!kamishibai} />
    </>
  );
}

export interface VideoProps {
  projectId: string;
  /** calculateMetadata が解決して差し込む。 */
  manifest?: Manifest;
}

export function DougaVideo({ manifest }: VideoProps) {
  if (!manifest) {
    // calculateMetadata が失敗した場合のみ到達する。黙って空の動画を出さない。
    throw new Error('マニフェストが解決されていない');
  }
  return <VideoBody manifest={manifest} />;
}

function VideoBody({ manifest }: { manifest: Manifest }) {
  useLoadFonts(manifest.fonts);

  const visualSegments = useMemo(
    () =>
      segmentBy(
        manifest.lines,
        (line) => line.visual,
        (visual) => JSON.stringify(visual),
      ),
    [manifest.lines],
  );

  const bgmSegments = useMemo(
    () =>
      segmentBy(
        manifest.lines,
        (line) => line.bgm,
        (bgm) => bgm ?? '',
      ),
    [manifest.lines],
  );

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.backgroundTop }}>
      <Background />

      {/* ビジュアルは同じ内容が続く間ひとまとまりにする。
          セリフごとに作り直すと、登場アニメーションが毎回走ってちらつく。 */}
      {visualSegments.map((segment) => (
        <Sequence
          key={`visual-${segment.from}`}
          from={segment.from}
          durationInFrames={segment.durationInFrames}
        >
          <VisualView visual={segment.value} projectId={manifest.meta.id} format={manifest.meta.format} />
        </Sequence>
      ))}

      <Foreground manifest={manifest} />

      {/* セリフ音声 */}
      {manifest.lines.map((line) => (
        <Sequence
          key={`voice-${line.id}`}
          from={line.startFrame}
          durationInFrames={line.speechFrames}
        >
          <Audio src={staticFile(line.audio)} volume={VOICE_VOLUME} />
        </Sequence>
      ))}

      {/* BGM */}
      {bgmSegments.map((segment) =>
        segment.value === null ? null : (
          <Sequence
            key={`bgm-${segment.from}`}
            from={segment.from}
            durationInFrames={segment.durationInFrames}
          >
            <Audio src={staticFile(segment.value)} volume={BGM_VOLUME} loop />
          </Sequence>
        ),
      )}
    </AbsoluteFill>
  );
}
