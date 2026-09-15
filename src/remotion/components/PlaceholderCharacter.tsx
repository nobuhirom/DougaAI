import { useId } from 'react';
import type { Emotion } from '../../schema/script.js';

/**
 * 画像アセットなしで描く立ち絵。
 *
 * パイプライン全体を絵の用意で止めないために置いている。実素材ができたら
 * character.json の appearance を sprite に切り替える。
 * 乱数も時刻も使わないので、同じ入力からは必ず同じ絵になる（N1）。
 */

export const PLACEHOLDER_VIEWBOX = { width: 400, height: 660 } as const;

export interface PlaceholderCharacterProps {
  hue: number;
  hair: 'long' | 'short' | 'bob';
  emotion: Emotion;
  /** 口の開き 0〜1。 */
  mouth: number;
  /** まばたき 0〜1（1 で完全に閉じる）。 */
  blink: number;
}

const HEAD = { cx: 200, cy: 286, rx: 104, ry: 118 } as const;
const EYE_Y = 306;
const EYE_DX = 42;
const MOUTH_Y = 372;

interface EyeShape {
  rx: number;
  ry: number;
  /** 上まぶたの下がり具合（0〜1）。 */
  lid: number;
}

const EYE_BY_EMOTION: Record<Emotion, EyeShape> = {
  normal: { rx: 17, ry: 21, lid: 0 },
  explain: { rx: 17, ry: 20, lid: 0.05 },
  happy: { rx: 18, ry: 20, lid: 1 },
  surprised: { rx: 20, ry: 26, lid: 0 },
  thinking: { rx: 16, ry: 18, lid: 0.45 },
  trouble: { rx: 16, ry: 18, lid: 0.25 },
};

/**
 * [内側の端の高さ, 外側の端の高さ]。値が小さいほど上。
 * 前髪の裾（おおよそ y=240）より下に置く。上に置くと髪の上に眉が乗って見える。
 */
const BROW_BY_EMOTION: Record<Emotion, [number, number]> = {
  normal: [272, 270],
  explain: [266, 262],
  happy: [264, 260],
  surprised: [252, 250],
  thinking: [276, 258],
  trouble: [262, 280],
};

function Eye({
  cx,
  shape,
  blink,
  mirrored,
}: {
  cx: number;
  shape: EyeShape;
  blink: number;
  mirrored: boolean;
}) {
  // 2人ぶんの SVG が同じ document に並ぶ。id を座標から作ると衝突して、
  // 片方の目がもう片方のクリップを参照してしまう。
  const clipId = useId();
  // まばたきと表情のまぶたを合成する。大きい方を採用する。
  const lid = Math.max(shape.lid, blink);

  if (lid >= 0.95) {
    // 閉じ目は上向きの弧で描く
    const w = shape.rx;
    const dir = mirrored ? -1 : 1;
    return (
      <path
        d={`M ${cx - w} ${EYE_Y + 4} Q ${cx + dir * 2} ${EYE_Y - 12} ${cx + w} ${EYE_Y + 4}`}
        fill="none"
        stroke="#3a2b28"
        strokeWidth={5}
        strokeLinecap="round"
      />
    );
  }

  const visibleRy = shape.ry * (1 - lid * 0.55);

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <ellipse cx={cx} cy={EYE_Y} rx={shape.rx} ry={visibleRy} />
        </clipPath>
      </defs>
      <ellipse cx={cx} cy={EYE_Y} rx={shape.rx} ry={visibleRy} fill="#ffffff" />
      <g clipPath={`url(#${clipId})`}>
        <circle cx={cx} cy={EYE_Y + 1} r={shape.rx * 0.72} fill="#3a2b28" />
        <circle cx={cx} cy={EYE_Y + 3} r={shape.rx * 0.36} fill="#120c0b" />
        <circle
          cx={cx - shape.rx * 0.26}
          cy={EYE_Y - shape.ry * 0.34}
          r={shape.rx * 0.22}
          fill="#ffffff"
          opacity={0.9}
        />
      </g>
      <ellipse
        cx={cx}
        cy={EYE_Y}
        rx={shape.rx}
        ry={visibleRy}
        fill="none"
        stroke="#3a2b28"
        strokeWidth={3.5}
      />
    </g>
  );
}

export function PlaceholderCharacter({
  hue,
  hair,
  emotion,
  mouth,
  blink,
}: PlaceholderCharacterProps) {
  const hairColor = `hsl(${hue}, 46%, 38%)`;
  const hairLight = `hsl(${hue}, 48%, 50%)`;
  const clothes = `hsl(${hue}, 32%, 42%)`;
  const clothesDark = `hsl(${hue}, 32%, 32%)`;
  const skin = '#f8ddc9';
  const skinShade = '#ecc3ab';

  const eye = EYE_BY_EMOTION[emotion];
  const [browInner, browOuter] = BROW_BY_EMOTION[emotion];

  // 口は開き具合で縦に伸びる。閉じているときは薄い線になる。
  const mouthRx = 15 + mouth * 9;
  const mouthRy = 2.5 + mouth * 20;

  const backHairHeight = hair === 'long' ? 250 : hair === 'bob' ? 150 : 96;

  return (
    <svg
      viewBox={`0 0 ${PLACEHOLDER_VIEWBOX.width} ${PLACEHOLDER_VIEWBOX.height}`}
      width="100%"
      height="100%"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {/* 後ろ髪 */}
      <ellipse
        cx={HEAD.cx}
        cy={HEAD.cy + 40}
        rx={HEAD.rx + 26}
        ry={HEAD.ry + backHairHeight * 0.42}
        fill={hairColor}
      />

      {/* 体 */}
      <path
        d={`M 200 396
            C 150 400 108 432 92 486
            L 66 660 L 334 660 L 308 486
            C 292 432 250 400 200 396 Z`}
        fill={clothes}
      />
      <path
        d={`M 200 404 L 172 660 L 228 660 Z`}
        fill={clothesDark}
        opacity={0.55}
      />

      {/* 首 */}
      <path d="M 172 356 L 172 408 Q 200 424 228 408 L 228 356 Z" fill={skinShade} />

      {/* 顔 */}
      <ellipse cx={HEAD.cx} cy={HEAD.cy} rx={HEAD.rx} ry={HEAD.ry} fill={skin} />

      {/* 前髪 */}
      <path
        d={`M ${HEAD.cx - HEAD.rx - 4} ${HEAD.cy - 46}
            C ${HEAD.cx - HEAD.rx} ${HEAD.cy - HEAD.ry - 46}
              ${HEAD.cx + HEAD.rx} ${HEAD.cy - HEAD.ry - 46}
              ${HEAD.cx + HEAD.rx + 4} ${HEAD.cy - 46}
            C ${HEAD.cx + 54} ${HEAD.cy - 88}
              ${HEAD.cx + 22} ${HEAD.cy - 64}
              ${HEAD.cx - 4} ${HEAD.cy - 96}
            C ${HEAD.cx - 32} ${HEAD.cy - 62}
              ${HEAD.cx - 66} ${HEAD.cy - 80}
              ${HEAD.cx - HEAD.rx - 4} ${HEAD.cy - 46} Z`}
        fill={hairColor}
      />
      <path
        d={`M ${HEAD.cx - 58} ${HEAD.cy - 100}
            C ${HEAD.cx - 20} ${HEAD.cy - 120} ${HEAD.cx + 26} ${HEAD.cy - 116} ${HEAD.cx + 52} ${HEAD.cy - 94}`}
        fill="none"
        stroke={hairLight}
        strokeWidth={9}
        strokeLinecap="round"
        opacity={0.65}
      />

      {/* 眉 */}
      <path
        d={`M ${HEAD.cx - EYE_DX - 22} ${browOuter} Q ${HEAD.cx - EYE_DX} ${Math.min(browInner, browOuter) - 8} ${HEAD.cx - EYE_DX + 20} ${browInner}`}
        fill="none"
        stroke="#4a3430"
        strokeWidth={6}
        strokeLinecap="round"
      />
      <path
        d={`M ${HEAD.cx + EYE_DX - 20} ${browInner} Q ${HEAD.cx + EYE_DX} ${Math.min(browInner, browOuter) - 8} ${HEAD.cx + EYE_DX + 22} ${browOuter}`}
        fill="none"
        stroke="#4a3430"
        strokeWidth={6}
        strokeLinecap="round"
      />

      {/* 目 */}
      <Eye cx={HEAD.cx - EYE_DX} shape={eye} blink={blink} mirrored={false} />
      <Eye cx={HEAD.cx + EYE_DX} shape={eye} blink={blink} mirrored />

      {/* 頬 */}
      <ellipse
        cx={HEAD.cx - 68}
        cy={EYE_Y + 34}
        rx={20}
        ry={10}
        fill="#f2a89a"
        opacity={emotion === 'happy' ? 0.55 : 0.3}
      />
      <ellipse
        cx={HEAD.cx + 68}
        cy={EYE_Y + 34}
        rx={20}
        ry={10}
        fill="#f2a89a"
        opacity={emotion === 'happy' ? 0.55 : 0.3}
      />

      {/* 口 */}
      <ellipse
        cx={HEAD.cx}
        cy={MOUTH_Y + mouthRy * 0.3}
        rx={mouthRx}
        ry={mouthRy}
        fill="#8c3b3b"
      />
      {mouth > 0.25 ? (
        <ellipse
          cx={HEAD.cx}
          cy={MOUTH_Y + mouthRy * 0.75}
          rx={mouthRx * 0.55}
          ry={mouthRy * 0.38}
          fill="#d8686b"
        />
      ) : null}
    </svg>
  );
}
