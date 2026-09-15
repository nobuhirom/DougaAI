# DougaAI

AI とプログラミングで解説動画を作るシステムを開発するリポジトリ。

編集ソフトや動画生成 AI に頼らず、**構造化データ（台本 JSON）から動画を決定的にレンダリングする**方式を採る。

## 作りたい動画

| 用途 | 内容 |
| --- | --- |
| 解説動画 | キャラクターの掛け合い＋スライドで技術・知識を解説する形式。公開を想定 |
| 自分専用の学習動画 | 知りたいことを動画にして学ぶ。非公開前提で量産する |
| 資料の動画化 | 手元のドキュメント（レポート・スライド等）を動画に変換する |

## 方式

| 要素 | 採用 |
| --- | --- |
| レンダリング | [Remotion](https://www.remotion.dev)（個人利用は商用含め無償） |
| 音声合成 | [Irodori TTS](https://github.com/Aratako/Irodori-TTS)（MIT・ローカル実行） |
| スキーマ検証 | zod |
| 動画生成 AI | 使わない（従量課金を持ち込まない） |

決定の根拠は [docs/03_方式決定.md](docs/03_方式決定.md) を参照。

## 使い方

```bash
npm install
npm run douga -- doctor   # 前提が揃っているか確認する
npm run douga -- ui       # 制作画面（http://127.0.0.1:4321）
```

### 制作の流れ

```
ネタ決め → 企画メモ → 調査 → 台本 → 音声 → 組み立て
 人間      エージェント        機械
```

| コマンド | 内容 |
| --- | --- |
| `douga idea add "<本文>"` | ネタを書き捨てる（起点は人間） |
| `douga idea list` | ネタの一覧 |
| `douga idea pick <ideaId> <projectId>` | ネタをプロジェクトにする |
| `douga status <id>` | 工程の現在地 |
| `douga next <id>` | 次にやることと手順書を出す |
| `douga check <id>` | いまの成果物を検証する |
| `douga projects` | プロジェクトの一覧 |
| `douga ui` | 制作画面を開く |

### 動画にする

| コマンド | 内容 |
| --- | --- |
| `douga validate <id>` | 台本を検証する（音声は作らない） |
| `douga build <id>` | 音声を生成してマニフェストを組む |
| `douga render <id>` | ビルドして `out/<id>.mp4` を書き出す |
| `douga preview <id>` | Remotion Studio を開く |
| `douga info <id>` | ビルド済みマニフェストの要約を出す |
| `douga doctor` | 実行環境を確認する |

主なオプション: `--tts irodori|macos-say` / `--force` / `--preset draft|final` / `--concurrency <n>`

公開用の音声には Irodori TTS のサーバーが要る（[docs/05_TTS導入.md](docs/05_TTS導入.md)）。
まだ用意していない場合は `--tts macos-say` で下書きを作れる。これは公開用の音声ではない。

## 台本の書き方

`projects/<id>/script.json` に書く。実例は [projects/sample/script.json](projects/sample/script.json)。

```jsonc
{
  "meta": { "id": "sample", "title": "…", "characters": ["kaede", "tsumugi"] },
  "sections": [
    {
      "type": "introduction",        // introduction | main | summary | outro
      "name": "導入",
      "lines": [
        {
          "id": "s0_intro_001",      // s{セクション番号}_{種別}_{3桁連番}
          "character": "kaede",
          "text": "セリフ本文。字幕にそのまま出る",
          "emotion": "explain",      // normal | explain | happy | surprised | thinking | trouble
          "visual": { "type": "bullets", "title": "…", "items": ["…"] }
        }
      ]
    }
  ]
}
```

- `visual` と `bgm` は省略すると**直前のセリフの状態を引き継ぐ**。消すときは `{"type":"none"}`
- ビジュアルは6型: `none` / `title` / `bullets` / `code` / `compare` / `image`
- 読み間違える語は `reading` で TTS 用の読みだけ上書きできる（字幕は `text` のまま）

キャラクターは `characters/<id>/character.json` で定義する。
立ち絵は画像がなくても動く（`appearance.kind: "placeholder"` が SVG で描く）。
実素材ができたら `sprite` に切り替える。

## AI 工程の動かし方

企画メモ・調査・台本の生成は、**コーディングエージェントがファイルを読み書きする形**で行う。
パイプラインは LLM を呼ばない。手順書は [prompts/](prompts/) にある。

```bash
npm run douga -- next kinsoku   # 次の工程と手順書を教えてくれる
# → エージェントに prompts/02_plan.md と idea.json を読ませて plan.md を書かせる
npm run douga -- check kinsoku  # 書けたものを機械的に検証する
```

こうしている理由は**従量課金を持ち込まないため**。LLM の API を叩く設計にすると
1本ごとに課金が乗り、「何本作っても定額」が崩れる（[docs/06_全体計画.md](docs/06_全体計画.md) 1章）。

制作画面も同じ方針で、**見る・選ぶ・直す**だけを担う。画面から AI は呼ばない。

## 状況

- 2026-09-15: 先行事例の調査を実施。`docs/` に調査メモと論点を整理
- 2026-09-15: 公式ドキュメントで裏を取り、レンダリング基盤と TTS を決定。要件定義を作成
- 2026-09-15: フェーズ1（MVP）を実装。`projects/sample` から `out/sample.mp4` が出るところまで到達
- 2026-09-15: 12工程すべてを作る方針に拡張。[docs/06_全体計画.md](docs/06_全体計画.md) を作成
- 2026-09-15: フェーズ2（ネタ→企画→調査→台本）と制作画面を実装
- 次: フェーズ3（レビューと改善ループ）、公開用音声への切り替え

## ドキュメント

- [docs/01_調査メモ.md](docs/01_調査メモ.md) — 先行事例2件の調査結果
- [docs/02_論点整理.md](docs/02_論点整理.md) — 決めるべきことの一覧
- [docs/03_方式決定.md](docs/03_方式決定.md) — レンダリング基盤と TTS の決定
- [docs/04_要件定義.md](docs/04_要件定義.md) — スコープ・データモデル・完成の定義
- [docs/05_TTS導入.md](docs/05_TTS導入.md) — Irodori TTS の接続と運用
- [docs/06_全体計画.md](docs/06_全体計画.md) — 12工程の全体像と実装順
- [prompts/](prompts/) — AI 工程の手順書
