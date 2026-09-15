import { Composition, staticFile } from 'remotion';
import { z } from 'zod';
import { manifestSchema, type Manifest } from '../schema/manifest.js';
import { STATIC } from '../shared/static.js';
import { DougaVideo } from './Video.js';
import { ShortVideo } from './ShortVideo.js';

/**
 * コンポジションの登録。
 *
 * props としてはプロジェクト ID だけを受け取り、マニフェストは
 * calculateMetadata の中で取りに行く。尺・解像度・fps もそこで確定させるため、
 * ここには動画ごとの数値を一切書かない。
 *
 * レンダリング:  npm run douga -- render <projectId>
 * プレビュー:    npm run studio
 */

export const propsSchema = z.object({
  projectId: z.string().min(1),
});

/** ビルドが public/manifests/<id>.json に置いたものを読む。 */
export const manifestUrl = (projectId: string) => staticFile(STATIC.manifest(projectId));

export const COMPOSITION_ID = 'Video';

type Props = z.infer<typeof propsSchema> & { manifest?: Manifest };

export const shortPropsSchema = z.object({
  projectId: z.string().min(1),
  shortId: z.string().min(1),
});
type ShortProps = z.infer<typeof shortPropsSchema> & { manifest?: Manifest };

async function fetchManifest(url: string, abortSignal: AbortSignal, hint: string): Promise<Manifest> {
  const response = await fetch(url, { signal: abortSignal });
  if (!response.ok) throw new Error(`マニフェストを読めなかった（${response.status}）。先に ${hint} を実行する`);
  return manifestSchema.parse(await response.json());
}

export function RemotionRoot() {
  return (
    <>
    <Composition<typeof shortPropsSchema, ShortProps>
      id="Short"
      component={ShortVideo}
      schema={shortPropsSchema}
      defaultProps={{ projectId: 'sample', shortId: 'why-json' }}
      durationInFrames={1}
      fps={30}
      width={1080}
      height={1920}
      calculateMetadata={async ({ props, abortSignal }) => {
        const manifest = await fetchManifest(
          staticFile(STATIC.shortManifest(props.projectId, props.shortId)),
          abortSignal,
          `npm run douga -- shorts ${props.projectId}`,
        );
        return {
          durationInFrames: manifest.totalDurationInFrames,
          fps: manifest.meta.fps,
          width: manifest.meta.width,
          height: manifest.meta.height,
          props: { ...props, manifest },
        };
      }}
    />
    <Composition<typeof propsSchema, Props>
      id={COMPOSITION_ID}
      component={DougaVideo}
      schema={propsSchema}
      defaultProps={{ projectId: 'sample' }}
      // 実際の値は calculateMetadata が上書きする。ここは登録に必要な初期値。
      durationInFrames={1}
      fps={30}
      width={1920}
      height={1080}
      calculateMetadata={async ({ props, abortSignal }) => {
        const response = await fetch(manifestUrl(props.projectId), { signal: abortSignal });
        if (!response.ok) {
          throw new Error(
            `マニフェストを読めなかった: ${props.projectId}（${response.status}）。` +
              `先に npm run douga -- build ${props.projectId} を実行する`,
          );
        }

        // 手書きされる余地はないが、バージョン違いの取り違えを防ぐため検証する
        const manifest = manifestSchema.parse(await response.json());

        return {
          durationInFrames: manifest.totalDurationInFrames,
          fps: manifest.meta.fps,
          width: manifest.meta.width,
          height: manifest.meta.height,
          props: { ...props, manifest },
        };
      }}
    />
    </>
  );
}
