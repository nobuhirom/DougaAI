# TTS の導入 — Irodori TTS

作成日: 2026-09-15
前提: [03_方式決定.md](03_方式決定.md) 決定3

公開用の音声は [Irodori TTS](https://github.com/Aratako/Irodori-TTS) を使う。
本システムは [Irodori-TTS-Server](https://github.com/Aratako/Irodori-TTS-Server)
（OpenAI TTS 互換 API）に HTTP で接続する。

---

## なぜサーバー経由か

CLI（`infer.py`）を1セリフごとに叩くと、そのたびにモデルをロードし直すことになる。
10分の動画は100セリフ規模になるため、ロード時間が全体を支配してしまう。
サーバーを1つ立ててモデルを常駐させ、セリフごとに HTTP で投げる。

---

## 導入手順

**上流のリポジトリは活発に更新されている**（v4.1-Small が 2026-08-11 リリース、
本システムの構築時点で約1ヶ月前）。インストール手順は上流の README を正とし、
ここには本システム側が前提にしていることだけを書く。

1. 下記「セットアップ（このリポジトリでの手順）」でクローンと依存の導入をする
2. `./tools/irodori/start.sh` で起動する（`http://127.0.0.1:8088`）
3. 接続を確認する

```bash
npm run douga -- doctor
```

`Irodori TTS` の行が `OK` になっていれば接続できている。

---

## 本システムが前提にしていること

### 接続先

| 環境変数 | 既定値 | 用途 |
| --- | --- | --- |
| `IRODORI_BASE_URL` | `http://127.0.0.1:8088/v1` | API のベース URL（サーバーの既定ポートは 8088） |
| `IRODORI_MODEL` | `irodori-tts` | `model` フィールドに渡す値 |
| `IRODORI_API_KEY` | （未設定） | 設定すると `Authorization: Bearer` を付ける |

### リクエスト（サーバー README で確認済み）

`POST {IRODORI_BASE_URL}/audio/speech` に送る。

```json
{
  "model": "irodori-tts",
  "input": "セリフ本文😊",
  "voice": "kaede",
  "response_format": "wav",
  "speed": 1.0,
  "irodori": { "seed": 42, "caption": "落ち着いた、少し低めの女性話者" }
}
```

- `voice` はサーバーが `IRODORI_VOICES_DIR` から解決する ID（`voices/<id>.wav` → `"<id>"`）。
  参照音声の無い声は `"none"` を送り、`irodori.caption` だけで声質を指定する
- `irodori.seed` を固定し、同じテキストから同じ音声が出るようにしている（N1）
- `input` の末尾には `emotion` に対応する絵文字が付く（[04_要件定義.md](04_要件定義.md) 3.4）

声の定義は [voices/library.json](../voices/library.json)。キャラクターは `voice.id` で参照する。

### セットアップ（このリポジトリでの手順）

```bash
cd tools/irodori && git clone https://github.com/Aratako/Irodori-TTS-Server.git server
cd server && uv sync --extra cpu          # macOS では PyPI の PyTorch（MPS 対応）が入る
cd ../../.. && ./tools/irodori/start.sh   # tools/irodori/.env を読んで起動
```

`.env` では `IRODORI_HF_CHECKPOINT=Aratako/Irodori-TTS-v4.1-Small`（推奨・最新）、
`IRODORI_MODEL_DEVICE=mps`、`IRODORI_VOICES_DIR` をこのリポジトリの `voices/` に向けている。
初回はモデルを Hugging Face から取得する。

`~/.cache/huggingface/token` が古いと 401 になる（モデルは公開）。`.env` で
`HF_TOKEN_PATH` を存在しないパスに向け、サーバーにはトークンを読ませない。

---

## キャラクターの声を固定する

声は [voices/library.json](../voices/library.json) に登録し、キャラクターは `voice.id` で参照する
（[04_要件定義.md](04_要件定義.md) Q4-2）。キャラ声もアナウンサー風のナレーションも同じ仕組み。

```
voices/
├── library.json   # 声の定義（id / label / style / caption / reference / speed / seed）
└── kaede.wav      # 参照音声（あれば）。ファイル名が voice ID になる
```

```json
{ "id": "kaede", "label": "楓（説明役）", "style": "character",
  "reference": "kaede.wav", "caption": "落ち着いた、少し低めの女性話者", "speed": 1.0, "seed": 42 }
```

- 参照音声があればゼロショットクローンで声が固定される。無ければ `caption` だけで指定し、
  `seed` の固定で回ごとの揺れを抑える
- 参照音声のファイルサイズと更新時刻は音声キャッシュのキーに含まれる。
  差し替えると、その声を使うセリフだけが自動で再生成される
- 同一話者の短くきれいなクリップを複数（合計30秒程度で効果の大半が出る。上限120秒）

### 参照音声の用意について

モデルカードに次の倫理ガイドラインがある。

> Do not use this model to clone or impersonate the voice of any individual

**参照音声は自分で録音したもの、または権利がクリアな音源に限る。**
実在する人物の声を本人の同意なくクローンしない。

---

## 制約と運用での回避

[03_方式決定.md](03_方式決定.md) 決定3 に挙げた制約への対処。

### 1. 単語単位のタイムスタンプを返さない

音声全体の長さは `ffprobe` で取得できるため、尺の決定には支障がない。
口パクは音声の振幅から近似している（`src/pipeline/audio.ts`）。

カラオケ字幕や音素レベルの口パクが必要になったら、HyperFrames の
`transcribe`（whisper.cpp、単語タイムスタンプ付き）を足す。
そのときは `.en` の付かないモデルと `--language ja` を指定する
（`.en` 系モデルは日本語音声を英語へ翻訳してしまう）。

### 2. 読み方を指定する手段がない

台本側で吸収する。

- 読み間違える固有名詞・技術用語は `reading` フィールドで TTS 用の読みだけ上書きする
- 字幕には `text` がそのまま出るので、原綴りを保てる

```json
{
  "text": "Remotion を使います。",
  "reading": "リモーション を使います。"
}
```

読み辞書が本当に必要になったら、VOICEVOX / Style-Bert-VITS2 との併用を再検討する。

### 3. SilentCipher の電子透かし

生成音声に自動で付与される。収益化を妨げるものではないが、
YouTube の合成コンテンツ開示ポリシーとは別途向き合う必要がある。

---

## 下書き用のバックエンド

Irodori TTS を立ち上げる前でも、パイプライン全体（尺の計算・口パク・字幕・
レンダリング）を検証できるよう、macOS の `say` を使うバックエンドを用意している。

```bash
npm run douga -- build sample --tts macos-say
```

**これは公開する動画の音声ではない。** 使うと `douga build` が警告を出す。

自動では切り替わらない。`--tts` で明示的に選ばなければ `irodori` が使われ、
サーバーに繋がらなければ止まる。下書き音声で本番動画が焼けるのを防ぐため、
フォールバックは意図的に実装していない。

音声キャッシュのキーにはバックエンドの識別子が入っているので、下書き音声と
公開用音声がキャッシュ上で混ざることもない。`--tts irodori` に切り替えれば
全セリフが作り直される。
