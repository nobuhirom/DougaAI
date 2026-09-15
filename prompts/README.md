# 手順書

AI 工程でエージェントが従う手順（docs/06_全体計画.md 1章）。

パイプラインは LLM を呼ばない。`douga next <id>` が「次はこの手順書に従え」と
提示し、エージェントが入力の成果物を読んで出力の成果物を書く。
書いたあと `douga check <id>` が機械的に検証する。

この形にしている理由は従量課金を持ち込まないため。1本ごとに API 課金が乗ると
「何本作っても定額」が崩れる（docs/04_要件定義.md N6 / P1）。

| 手順書 | 工程 | 入力 | 出力 |
| --- | --- | --- | --- |
| [02_plan.md](02_plan.md) | 企画メモ | `idea.json` | `plan.md` |
| [03_research.md](03_research.md) | 調査 | `plan.md` | `research.md` |
| [04_script.md](04_script.md) | 台本 | `plan.md` `research.md` | `script.json` |

手順書を直したら、その理由を `logs/modifications.jsonl` に残す。
同じ修正を人間が二度やらないための仕組み（docs/06_全体計画.md 5章）。
