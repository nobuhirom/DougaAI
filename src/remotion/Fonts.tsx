import { useEffect, useState } from 'react';
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';

/**
 * フォントの読み込み。
 *
 * システムフォント名に依存すると、環境を変えた瞬間に無言で別の字形に
 * 化ける（docs/04_要件定義.md 5.3 / N4）。同梱した woff2 を明示的に読み、
 * 読み終わるまで delayRender でレンダリングを止める。
 *
 * 失敗したら cancelRender で落とす。フォントが当たっていない動画が
 * 成功扱いで出てくるのが一番まずい。
 */

export const FONT_FAMILY = 'Noto Sans JP';
export const MONO_FAMILY = 'Roboto Mono';

export interface FontPaths {
  regular: string;
  bold: string;
  mono: string;
}

export function useLoadFonts(fonts: FontPaths): void {
  const [handle] = useState(() => delayRender('フォントの読み込み'));

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const faces = [
        new FontFace(FONT_FAMILY, `url(${staticFile(fonts.regular)})`, {
          weight: '400',
          display: 'block',
        }),
        new FontFace(FONT_FAMILY, `url(${staticFile(fonts.bold)})`, {
          weight: '700',
          display: 'block',
        }),
        new FontFace(MONO_FAMILY, `url(${staticFile(fonts.mono)})`, {
          weight: '400',
          display: 'block',
        }),
      ];

      await Promise.all(
        faces.map(async (face) => {
          const loaded = await face.load();
          document.fonts.add(loaded);
        }),
      );

      if (!cancelled) continueRender(handle);
    };

    load().catch((error: unknown) => {
      cancelRender(
        new Error(
          `フォントを読み込めなかった: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [handle, fonts.regular, fonts.bold, fonts.mono]);
}
