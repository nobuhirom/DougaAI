import { Img, staticFile, useCurrentFrame } from 'remotion';
import type { Character } from '../../schema/character.js';
import type { Emotion } from '../../schema/script.js';
import { STATIC } from '../../shared/static.js';
import { CHARACTER, STAGE } from '../theme.js';
import { PLACEHOLDER_VIEWBOX, PlaceholderCharacter } from './PlaceholderCharacter.js';

/**
 * 立ち絵。
 *
 * 話している側を前に出し、話していない側を沈める。口の開きはマニフェストに
 * 焼き込んだ配列から読む（レンダリング時に音声を解析しない）。
 * まばたきもフレーム番号から決まるので、同じ動画を何度焼いても同じになる。
 */

/** キャラごとにまばたきの位相をずらす。id から決まるので毎回同じ。 */
function phaseOf(id: string): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return hash;
}

const BLINK_PERIOD = 168;
const BLINK_FRAMES = 8;

function blinkAmount(frame: number, phase: number): number {
  const t = (frame + phase) % BLINK_PERIOD;
  if (t >= BLINK_FRAMES) return 0;
  return Math.sin((t / BLINK_FRAMES) * Math.PI);
}

export interface CharacterViewProps {
  character: Character;
  emotion: Emotion;
  /** 口の開き 0〜1。話していないときは 0。 */
  mouth: number;
  speaking: boolean;
}

function Figure({ character, emotion, mouth, blink }: {
  character: Character;
  emotion: Emotion;
  mouth: number;
  blink: number;
}) {
  const { appearance } = character;

  if (appearance.kind === 'placeholder') {
    return (
      <PlaceholderCharacter
        hue={appearance.hue}
        hair={appearance.hair}
        emotion={emotion}
        mouth={mouth}
        blink={blink}
      />
    );
  }

  const expression = appearance.expressions[emotion];
  const { mouth: mouthConfig, size } = appearance;

  // 口スプライトは3段階。振幅をそのまま段階に割り当てる。
  const mouthState = mouth < 0.15 ? 'closed' : mouth < 0.55 ? 'half' : 'open';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Img
        src={staticFile(STATIC.characterSprite(character.id, expression))}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
      {mouthConfig ? (
        <Img
          src={staticFile(
            STATIC.characterSprite(character.id, mouthConfig.frames[mouthState]),
          )}
          style={{
            position: 'absolute',
            left: `${(mouthConfig.x / size.width) * 100}%`,
            top: `${(mouthConfig.y / size.height) * 100}%`,
            width: `${(mouthConfig.width / size.width) * 100}%`,
          }}
        />
      ) : null}
    </div>
  );
}

export function CharacterView({
  character,
  emotion,
  mouth,
  speaking,
}: CharacterViewProps) {
  const frame = useCurrentFrame();
  const blink = blinkAmount(frame, phaseOf(character.id));

  const side = character.position === 'left' ? CHARACTER.left : CHARACTER.right;
  const aspect =
    character.appearance.kind === 'placeholder'
      ? PLACEHOLDER_VIEWBOX.width / PLACEHOLDER_VIEWBOX.height
      : character.appearance.size.width / character.appearance.size.height;

  const height = CHARACTER.height;
  const width = height * aspect;

  return (
    <div
      style={{
        position: 'absolute',
        left: side.centerX - width / 2,
        top: STAGE.height - CHARACTER.bottom - height,
        width,
        height,
        opacity: speaking ? 1 : CHARACTER.idle.opacity,
        filter: speaking ? 'none' : `saturate(${CHARACTER.idle.saturation})`,
        transform: `scale(${speaking ? 1 : CHARACTER.idle.scale})`,
        transformOrigin: 'bottom center',
      }}
    >
      <Figure
        character={character}
        emotion={emotion}
        mouth={speaking ? mouth : 0}
        blink={blink}
      />
    </div>
  );
}
