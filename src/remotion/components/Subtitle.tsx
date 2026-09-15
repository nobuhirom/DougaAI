import type { Character } from '../../schema/character.js';
import { FONT_FAMILY } from '../Fonts.js';
import { COLORS, NAMEPLATE, SUBTITLE } from '../theme.js';

/**
 * 字幕帯と話者名。
 *
 * 行はマニフェストで確定済み（src/layout/subtitle.ts で禁則処理を適用）。
 * ここでは折り返しを一切行わず、渡された行をそのまま描く。ブラウザに
 * 改行を任せると、検証した結果と実際の表示がずれる。
 */

export interface SubtitleProps {
  lines: string[];
  character: Character;
  /** 紙芝居ではナレーターの名札を出さない。 */
  showName?: boolean;
}

export function Subtitle({ lines, character, showName = true }: SubtitleProps) {
  return (
    <>
      {showName ? <div
        style={{
          position: 'absolute',
          left: SUBTITLE.x,
          top: SUBTITLE.y + NAMEPLATE.offsetY,
          height: NAMEPLATE.height,
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${NAMEPLATE.paddingX}px`,
          borderRadius: NAMEPLATE.radius,
          background: character.color,
          color: '#ffffff',
          fontFamily: FONT_FAMILY,
          fontWeight: 700,
          fontSize: NAMEPLATE.fontSize,
          letterSpacing: '0.04em',
          boxShadow: '0 6px 18px rgba(0, 0, 0, 0.35)',
        }}
      >
        {character.displayName}
      </div> : null}

      <div
        style={{
          position: 'absolute',
          left: SUBTITLE.x,
          top: SUBTITLE.y,
          width: SUBTITLE.width,
          height: SUBTITLE.height,
          padding: `${SUBTITLE.paddingY}px ${SUBTITLE.paddingX}px`,
          borderRadius: SUBTITLE.radius,
          background: COLORS.subtitleBg,
          border: `2px solid ${character.color}`,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        {lines.map((line, index) => (
          <div
            // 行は位置が意味を持つので index をキーにしてよい
            key={`${index}-${line}`}
            style={{
              fontFamily: FONT_FAMILY,
              fontWeight: 500,
              fontSize: SUBTITLE.fontSize,
              lineHeight: SUBTITLE.lineHeight,
              color: COLORS.subtitleText,
              whiteSpace: 'pre',
              textShadow: '0 2px 8px rgba(0, 0, 0, 0.6)',
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </>
  );
}
