/**
 * staticFile() に渡す相対パスの組み立て。
 *
 * このファイルは Remotion のバンドル（ブラウザ）と Node のパイプラインの
 * 両方から読まれる。node: 由来のモジュールを入れると webpack が解決できず
 * バンドルが壊れるため、ここには Node 依存を一切置かない。
 */

export const STATIC = {
  font: (file: string) => `fonts/${file}`,
  bgm: (file: string) => `bgm/${file}`,
  audio: (projectId: string, file: string) => `audio/${projectId}/${file}`,
  characterSprite: (characterId: string, file: string) =>
    `characters/${characterId}/${file}`,
  projectAsset: (projectId: string, file: string) => `projects/${projectId}/${file}`,
  manifest: (projectId: string) => `manifests/${projectId}.json`,
  shortManifest: (projectId: string, shortId: string) => `manifests/${projectId}.short.${shortId}.json`,
} as const;
