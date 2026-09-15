# BGM

`meta.bgm` と `line.bgm` からファイル名で参照する。省略すると直前の BGM を継続する。

## 音量の取り決め

**音源は平均 -20dBFS 程度に正規化してから置く。**

`src/remotion/theme.ts` の `BGM_VOLUME` は全曲に一律で掛かる係数なので、
音源のレベルがバラバラだと、同じ設定でも曲によって聞こえたり聞こえなかったり
する。正規化しておけば `BGM_VOLUME` が「セリフに対してどれだけ下げるか」という
一つの意味だけを持つ。

```bash
# 現在のレベルを測る
ffmpeg -hide_banner -i <file> -af volumedetect -f null - 2>&1 | grep mean_volume

# -20dBFS へ寄せる（例: 現在 -31.8dB なら +11.8dB）
ffmpeg -y -i <in> -af "volume=11.8dB" -c:a libmp3lame -b:a 128k <out>
```

現状の設定（`BGM_VOLUME = 0.09` = -20.9dB）だと、混合後の BGM は平均 -40dB 前後、
セリフは平均 -25dB 前後で、差は 15dB ほどになる。

## calm-01.mp3

**仮の音源**。ffmpeg でサイン波を重ねて合成したもので、音楽として使う想定ではない。
音量バランスを検証するために置いている。実際に公開する動画では、権利がクリアな
音源に差し替える。

平均 -19.0dBFS / 最大 -9.8dBFS / 32秒。

## 差し替えるときの注意

- ファイルを `assets/bgm/` に置き、台本から**ファイル名で**参照する
- 存在しないファイルを指定すると `douga validate` が `missing-bgm` で止める
- ループ再生されるので、先頭と末尾が繋がる音源にする
- 上記のとおり平均 -20dBFS に正規化してから置く
