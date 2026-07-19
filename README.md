# クローゼット

写真から服を切り出して、かわいく整理するローカルファーストな AI クローゼット。

[![License: MIT](https://img.shields.io/badge/license-MIT-e87a8a?style=flat-square)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-22%2B-e87a8a?style=flat-square)](package.json)

> 元プロジェクト: [tandpfun/wardrobe](https://github.com/tandpfun/wardrobe)（MIT）をベースにした日本版です。

## できること

- 写真から服を検出して切り出し
- きれいな商品カット画像を生成
- 着用イメージ（モデリング）の生成
- データはすべてローカルの `data/` に保存

## はじめ方

```bash
git clone https://github.com/ShoheiAsogawa/closet.git
cd closet
npm install
cp .env.example .env
npm run dev
```

⚠️ インポート機能は、`.env` に `OPENAI_API_KEY` を入れ、自分の参考写真 PNG を `data/model-reference.png` に置くまで無効です。

ブラウザで [localhost:5173](http://localhost:5173) を開いてください。

## 設定

| 変数 | デフォルト |
| --- | --- |
| `OPENAI_API_KEY` | 必須 |
| `OPENAI_VISION_MODEL` | `gpt-5.4-mini` |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` |
| `OPENAI_IMAGE_QUALITY` | `high` |
| `WARDROBE_MODEL_REFERENCE` | `data/model-reference.png` |
| `WARDROBE_DATA_DIR` | `data` |

## ライセンス

[MIT](LICENSE) — オリジナル Wardrobe の著作権表示を維持しています。
