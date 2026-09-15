import { Config } from '@remotion/cli/config';

/**
 * Remotion の設定。
 *
 * ソースは ESM の作法で `./foo.js` と拡張子付きで import している。Node 側
 * （tsx で動くパイプライン）はこれをそのまま解決できるが、Remotion が使う
 * webpack は既定では .js → .ts/.tsx の読み替えをしない。extensionAlias で
 * 明示する。
 */
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    },
  },
}));

Config.setEntryPoint('src/remotion/index.ts');

// ビルドが public/ を生成する。ここが staticFile() の基準になる。
Config.setPublicDir('public');

Config.setVideoImageFormat('jpeg');
Config.setCodec('h264');

// 決定性のため、レンダリングが黙って先へ進まないようにする。
Config.setDelayRenderTimeoutInMilliseconds(60000);
