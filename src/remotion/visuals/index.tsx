import { createContext, useContext } from 'react';
import { Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { charWidthEm } from '../../layout/subtitle.js';
import type { Visual } from '../../schema/script.js';
import { STATIC } from '../../shared/static.js';
import { FONT_FAMILY, MONO_FAMILY } from '../Fonts.js';
import { FADE_FRAMES, PANEL, PANEL_KAMISHIBAI } from '../theme.js';
import { useTheme, withAlpha } from '../ThemeContext.js';
import type { Format } from '../../schema/script.js';

/**
 * ビジュアルの型（docs/04_要件定義.md 3.5）。
 *
 * AI にゼロからデザインさせず、ここにある型から選ばせる（P4）。型が増えるほど
 * 保守コストが上がるので、必要になってから足す。
 *
 * アニメーションはすべてフレーム番号から計算する。CSS アニメーションは使わない（P2）。
 */

/**
 * パネルの寸法は形式で変わる（掛け合い: 立ち絵の横 / 紙芝居: 幅いっぱい）。
 * 各ビジュアルは Context から受け取り、決め打ちの定数を持たない。
 */
type PanelGeometry = { x: number; y: number; width: number; height: number; radius: number; padding: number };
const PanelContext = createContext<PanelGeometry>(PANEL);
const usePanel = () => useContext(PanelContext);
const panelFor = (format: Format): PanelGeometry => (format === 'kamishibai' ? PANEL_KAMISHIBAI : PANEL);
const innerWidth = (g: PanelGeometry) => g.width - g.padding * 2;
const innerHeight = (g: PanelGeometry) => g.height - g.padding * 2;

/** 登場時のフェードと軽い迫り上がり。各ビジュアルの先頭フレームから計算する。 */
function useEntrance() {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, FADE_FRAMES], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const translateY = interpolate(frame, [0, FADE_FRAMES * 2], [18, 0], {
    extrapolateRight: 'clamp',
  });
  return { opacity, translateY };
}

function Panel({ children }: { children: React.ReactNode }) {
  const { opacity, translateY } = useEntrance();
  const g = usePanel();
  const { colors } = useTheme();
  return (
    <div
      style={{
        position: 'absolute',
        left: g.x,
        top: g.y,
        width: g.width,
        height: g.height,
        padding: g.padding,
        boxSizing: 'border-box',
        borderRadius: g.radius,
        background: colors.panel,
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.45)',
        fontFamily: FONT_FAMILY,
        color: colors.panelText,
        opacity,
        transform: `translateY(${translateY}px)`,
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
}

// --- title -------------------------------------------------------------------

function TitleVisual({ text, subtitle }: { text: string; subtitle?: string }) {
  const INNER_HEIGHT = innerHeight(usePanel());
  const { colors } = useTheme();
  return (
    <Panel>
      <div
        style={{
          height: INNER_HEIGHT,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 28,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 92, fontWeight: 700, lineHeight: 1.25 }}>{text}</div>
        {subtitle ? (
          <div style={{ fontSize: 40, color: colors.panelMuted, lineHeight: 1.4 }}>
            {subtitle}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

// --- bullets -----------------------------------------------------------------

function BulletsVisual({
  title,
  items,
  highlight,
}: {
  title: string;
  items: string[];
  highlight?: number;
}) {
  const frame = useCurrentFrame();
  const { colors } = useTheme();
  const fontSize = items.length <= 3 ? 48 : items.length <= 5 ? 42 : 36;

  return (
    <Panel>
      <div style={{ fontSize: 52, fontWeight: 700, marginBottom: 36 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        {items.map((item, index) => {
          // 項目を1つずつ出す。6フレーム間隔。
          const appear = interpolate(
            frame,
            [index * 6, index * 6 + FADE_FRAMES],
            [0, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          );
          const isHighlighted = highlight === index;
          return (
            <div
              key={`${index}-${item}`}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 20,
                fontSize,
                lineHeight: 1.45,
                opacity: appear,
                transform: `translateX(${(1 - appear) * 16}px)`,
                fontWeight: isHighlighted ? 700 : 400,
                color: isHighlighted ? colors.accent : colors.panelText,
              }}
            >
              <span
                style={{
                  flex: '0 0 auto',
                  width: 14,
                  height: 14,
                  marginTop: fontSize * 0.1,
                  borderRadius: 4,
                  background: isHighlighted ? colors.accent : colors.panelMuted,
                }}
              />
              <span>{item}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// --- code --------------------------------------------------------------------

/** 等幅フォント（Roboto Mono）の欧文送り幅。 */
const MONO_ADVANCE_EM = 0.6;
const CODE_HEADER_HEIGHT = 70;
const CODE_BOX_PADDING_X = 28;
const CODE_GUTTER_GAP = 20;

/**
 * 等幅で組んだときの行幅を em で見積もる。
 * CJK は等幅フォントに字形がなく Noto Sans JP へ落ちるため 1.0em で数える。
 */
function measureMonoEm(text: string): number {
  let total = 0;
  for (const ch of text) total += charWidthEm(ch) === 1 ? 1 : MONO_ADVANCE_EM;
  return total;
}

function CodeVisual({
  language,
  code,
  highlightLines,
  caption,
}: {
  language: string;
  code: string;
  highlightLines?: number[];
  caption?: string;
}) {
  const lines = code.replace(/\n+$/, '').split('\n');
  const highlighted = new Set(highlightLines ?? []);
  const gutter = String(lines.length).length;
  const g = usePanel();
  const { colors } = useTheme();
  const INNER_HEIGHT = innerHeight(g);
  const INNER_WIDTH = innerWidth(g);

  // 高さと幅の両方から字の大きさを決める。
  // 行数だけで決めると、長い行が右端で黙って切れる（overflow: hidden なので
  // エラーも警告も出ない）。それが一番たちの悪い壊れ方なので幅も見る。
  const byHeight = Math.floor((INNER_HEIGHT - CODE_HEADER_HEIGHT) / lines.length / 1.5);
  const widestEm = Math.max(
    ...lines.map((line) => measureMonoEm(line) + gutter * MONO_ADVANCE_EM),
  );
  const available = INNER_WIDTH - CODE_BOX_PADDING_X * 2 - CODE_GUTTER_GAP;
  const byWidth = Math.floor(available / Math.max(widestEm, 1));

  const fontSize = Math.max(16, Math.min(34, byHeight, byWidth));

  return (
    <Panel>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        <span
          style={{
            fontFamily: MONO_FAMILY,
            fontSize: 26,
            color: colors.panelMuted,
            letterSpacing: '0.08em',
          }}
        >
          {language}
        </span>
        {caption ? (
          <span style={{ fontSize: 28, color: colors.panelMuted }}>{caption}</span>
        ) : null}
      </div>
      <div
        style={{
          background: colors.codeBg,
          borderRadius: 16,
          padding: '24px 28px',
          width: INNER_WIDTH,
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        {lines.map((line, index) => {
          const isHighlighted = highlighted.has(index + 1);
          return (
            <div
              key={`${index}-${line}`}
              style={{
                display: 'flex',
                gap: 20,
                fontFamily: MONO_FAMILY,
                fontSize,
                lineHeight: 1.5,
                color: colors.codeText,
                background: isHighlighted ? withAlpha(colors.accent, 0.28) : 'transparent',
                borderRadius: 6,
                padding: '0 8px',
                margin: '0 -8px',
                whiteSpace: 'pre',
              }}
            >
              <span
                style={{
                  color: 'rgba(230, 236, 247, 0.35)',
                  minWidth: `${gutter}ch`,
                  textAlign: 'right',
                  userSelect: 'none',
                }}
              >
                {index + 1}
              </span>
              <span>{line === '' ? ' ' : line}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// --- compare -----------------------------------------------------------------

interface CompareColumn {
  title: string;
  items: string[];
}

function CompareColumnView({
  column,
  accent,
  delay,
}: {
  column: CompareColumn;
  accent: string;
  delay: number;
}) {
  const frame = useCurrentFrame();
  const { colors } = useTheme();
  const appear = interpolate(frame, [delay, delay + FADE_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        opacity: appear,
        transform: `translateY(${(1 - appear) * 14}px)`,
      }}
    >
      <div
        style={{
          fontSize: 40,
          fontWeight: 700,
          color: '#ffffff',
          background: accent,
          borderRadius: 12,
          padding: '14px 24px',
          textAlign: 'center',
        }}
      >
        {column.title}
      </div>
      {column.items.map((item, index) => (
        <div
          key={`${index}-${item}`}
          style={{
            fontSize: 34,
            lineHeight: 1.4,
            padding: '14px 20px',
            borderRadius: 10,
            background: withAlpha(colors.panelText, 0.06),
          }}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

function CompareVisual({
  title,
  left,
  right,
}: {
  title?: string;
  left: CompareColumn;
  right: CompareColumn;
}) {
  const { colors } = useTheme();
  return (
    <Panel>
      {title ? (
        <div style={{ fontSize: 46, fontWeight: 700, marginBottom: 26 }}>{title}</div>
      ) : null}
      <div style={{ display: 'flex', gap: 40, alignItems: 'flex-start' }}>
        <CompareColumnView column={left} accent={colors.accent} delay={0} />
        <CompareColumnView column={right} accent={colors.accent2} delay={5} />
      </div>
    </Panel>
  );
}

// --- image -------------------------------------------------------------------

function ImageVisual({
  projectId,
  src,
  caption,
  fit,
}: {
  projectId: string;
  src: string;
  caption?: string;
  fit: 'contain' | 'cover';
}) {
  const INNER_HEIGHT = innerHeight(usePanel());
  const { colors } = useTheme();
  return (
    <Panel>
      <div
        style={{
          height: caption ? INNER_HEIGHT - 60 : INNER_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Img
          src={staticFile(STATIC.projectAsset(projectId, src))}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: fit }}
        />
      </div>
      {caption ? (
        <div
          style={{
            marginTop: 16,
            fontSize: 30,
            color: colors.panelMuted,
            textAlign: 'center',
          }}
        >
          {caption}
        </div>
      ) : null}
    </Panel>
  );
}

// --- 振り分け ----------------------------------------------------------------

export interface VisualViewProps {
  visual: Visual;
  projectId: string;
  format: Format;
  /** 縦動画など、形式の既定と違う寸法でパネルを描くとき。 */
  panel?: PanelGeometry;
}

export type { PanelGeometry };

export function VisualView({ visual, projectId, format, panel }: VisualViewProps) {
  return (
    <PanelContext.Provider value={panel ?? panelFor(format)}>
      <VisualBody visual={visual} projectId={projectId} />
    </PanelContext.Provider>
  );
}

function VisualBody({ visual, projectId }: { visual: Visual; projectId: string }) {
  switch (visual.type) {
    case 'none':
      return null;
    case 'title':
      return <TitleVisual text={visual.text} subtitle={visual.subtitle} />;
    case 'bullets':
      return (
        <BulletsVisual
          title={visual.title}
          items={visual.items}
          highlight={visual.highlight}
        />
      );
    case 'code':
      return (
        <CodeVisual
          language={visual.language}
          code={visual.code}
          highlightLines={visual.highlightLines}
          caption={visual.caption}
        />
      );
    case 'compare':
      return (
        <CompareVisual title={visual.title} left={visual.left} right={visual.right} />
      );
    case 'image':
      return (
        <ImageVisual
          projectId={projectId}
          src={visual.src}
          caption={visual.caption}
          fit={visual.fit}
        />
      );
  }
}
