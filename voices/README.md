# 声のライブラリ

`library.json` に声を登録し、キャラクター（`characters/<id>/character.json` の `voice.id`）や
紙芝居のナレーターから ID で参照する。キャラ声・アナウンサー風・ナレーターを同じ仕組みで扱う。

## 参照音声

`voices/<id>.wav` を置き、`library.json` の `reference` に `"<id>.wav"` と書く。
Irodori-TTS-Server はこのディレクトリを直接走査する（`tools/irodori/.env` の `IRODORI_VOICES_DIR`）。
サーバーへの登録操作は要らない。置いたら再起動するか、`GET /v1/audio/voices` で確認する。

- 同一話者の**短くきれいなクリップを複数**（合計30秒程度で効果の大半が出る。上限120秒）
- **権利がクリアな音源に限る**。実在人物の声を本人の同意なくクローンしない（モデルカードの倫理ガイドライン）

参照音声が無い声は `caption`（VoiceDesign）だけで指定する。`seed` を固定しているので、
同じテキストからは同じ音声が出る。

## 現在の登録

| id | 用途 | 参照音声 |
| --- | --- | --- |
| kaede / tsumugi | キャラクター | なし（キャプションのみ） |
| announcer-f / announcer-m | 紙芝居のナレーション | なし（キャプションのみ） |
