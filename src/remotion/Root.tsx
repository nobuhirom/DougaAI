import { Composition, staticFile } from 'remotion';
import { z } from 'zod';
import { manifestSchema, type Manifest } from '../schema/manifest.js';
import { STATIC } from '../shared/static.js';
import { DougaVideo } from './Video.js';

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

export function RemotionRoot() {
  return (
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
  );
}
