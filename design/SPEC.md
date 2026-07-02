# Let's Architect! 技術仕様書

コンセプトは [CONCEPT.md](../CONCEPT.md) を参照。本書は実装者・シナリオ執筆者向けの仕様。

## 1. 技術方針

- **ビルドなし**。素の HTML / CSS / JavaScript(ES modules)。npm・外部ライブラリ・CDN・Web フォント禁止(システムフォントを使う)。
- GitHub Pages で `https://<user>.github.io/<repo>/` 配下に配信される。**すべてのパス参照は相対パス**(`./css/style.css` 等)。
- シナリオは `data/` 配下の JSON を `fetch` で読む。
- 対応ブラウザ: モダンブラウザのみ(ES2022 可)。モバイルファースト、レスポンシブ必須。

## 2. ファイル構成

```
index.html            エントリポイント(SPA、画面はJSで切り替え)
css/style.css         全スタイル
js/main.js            起動・画面遷移(ルータ相当)
js/engine.js          ゲームエンジン(純ロジック、DOM禁止 → Nodeでテスト可能に)
js/ui.js              描画(DOM操作はここに集約)
js/storage.js         localStorage ラッパー
data/index.json       シーズン・エピソード一覧
data/episodes/*.json  各エピソード
scripts/smoke-test.mjs Node で engine.js を通しプレイするスモークテスト
```

## 3. データスキーマ

### 3.1 data/index.json

```json
{
  "seasons": [
    { "id": 1, "title": "要件を聞く", "description": "曖昧な要望を要件に翻訳する力を鍛える" }
  ],
  "episodes": [
    {
      "id": "s1e1",
      "file": "episodes/s1e1.json",
      "season": 1,
      "order": 1,
      "title": "「絶対に落ちないシステム」の正体",
      "summary": "1〜2文の紹介文",
      "estimatedMinutes": 8
    }
  ]
}
```

### 3.2 エピソード JSON(data/episodes/*.json)

```json
{
  "id": "s1e1",
  "season": 1,
  "title": "エピソードタイトル",
  "summary": "紹介文",
  "estimatedMinutes": 8,
  "characters": {
    "player":   { "name": "あなた", "role": "player" },
    "senpai":   { "name": "アオイ先輩", "role": "mentor" },
    "customer": { "name": "丸川部長(マルカワ食品)", "role": "customer" }
  },
  "params": { "customer": 50, "quality": 50, "budget": 50, "trust": 50 },
  "start": "intro",
  "nodes": { "...": "..." },
  "glossary": [
    { "term": "SLA", "def": "説明文" }
  ]
}
```

- `characters` のキーが各ノードの `speaker` に対応する。`"narration"` は予約語(地の文)で定義不要。
- `params` は開始値。値は 0〜100 にクランプ。4軸固定:
  - `customer` 顧客満足 / `quality` システム品質 / `budget` 予算・納期 / `trust` 信頼

### 3.3 ノード種別

`nodes` はノードIDをキーとするオブジェクト。種別は `type` で判別。

**scene(会話・地の文)**
```json
{
  "type": "scene",
  "lines": [
    { "speaker": "narration", "text": "..." },
    { "speaker": "senpai", "text": "..." }
  ],
  "next": "次のノードID"
}
```

**choice(選択)**
```json
{
  "type": "choice",
  "prompt": "プレイヤーへの問いかけ",
  "options": [
    {
      "text": "選択肢の文(プレイヤーの発言や行動)",
      "effects": { "trust": 10, "budget": -5 },
      "flags": ["asked_impact"],
      "feedback": "選択直後に表示されるアオイ先輩の一言(なぜ良い/まずいか)",
      "next": "次のノードID"
    }
  ]
}
```
- `effects` / `flags` は省略可。フラグはエピソード内でのみ有効。

**ending(結末分岐)**
```json
{
  "type": "ending",
  "variants": [
    {
      "require": { "flags": ["asked_impact", "fit_sla"], "minTotal": 280 },
      "lines": [ { "speaker": "narration", "text": "..." } ]
    },
    {
      "default": true,
      "lines": [ ... ]
    }
  ],
  "next": "debrief"
}
```
- 上から順に評価し、最初に条件を満たした variant を再生。`require.flags`(全部保持)と `require.minTotal`(4パラメータ合計の下限)は片方だけでも可。最後は必ず `"default": true`。

**debrief(振り返り)**
```json
{
  "type": "debrief",
  "lines": [ { "speaker": "senpai", "text": "締めの会話" } ],
  "points": [
    "実務に持ち帰れる原則を1〜4個、1文ずつ"
  ]
}
```
- debrief の終了でエピソード完了 → リザルト画面へ。

### 3.4 ランク判定(engine.js に実装)

最終パラメータ合計(最大400)で判定: **S ≥ 300 / A ≥ 260 / B ≥ 220 / C はそれ未満**。

## 4. 画面仕様

SPA。`js/main.js` が画面を切り替える。URLハッシュ(`#/episode/s1e1` 等)で状態を持つとリロードにも耐えて良い。

### 4.1 タイトル画面
- ロゴ(テキストで可)「Let's Architect!」+キャッチコピー「設計の judgement は、体験で学べ。」程度
- ボタン: 「はじめる」(→エピソード選択)/「進捗をリセット」(confirm付き)

### 4.2 エピソード選択画面
- シーズンごとにグルーピングしてエピソードカードを一覧表示
- カード: タイトル / summary / 所要時間 / クリア済みなら最高ランクのバッジ
- ロックはなし(全エピソードいつでも遊べる)

### 4.3 プレイ画面(ノベルゲーム風)
- ヘッダー: エピソードタイトル+4パラメータのミニメーター(常時表示)
- メッセージエリア: 話者名ラベル+本文。タップ/クリック/Enterで1行ずつ送る
- choice ノード: 選択肢をカード型ボタンで縦に並べる
- 選択直後: **フィードバックカード**(アオイ先輩のコメント+パラメータ増減を `+10 信頼` のように表示)→タップで先へ
- 用語ハイライト: エピソードの `glossary` の `term` が本文に出現したら下線付きで表示し、タップでポップアップ定義を出す
- 中断: プレイ画面から出る場合は confirm(進捗はエピソード単位、途中セーブなしで良い)

### 4.4 リザルト画面
- 総合ランク(S/A/B/C を大きく)+4パラメータのバー表示
- debrief の points を「持ち帰りメモ」としてリスト表示
- ボタン: 「もう一度」「エピソード選択へ」

## 5. localStorage

キー `lets-architect:v1`。
```json
{ "episodes": { "s1e1": { "cleared": true, "bestRank": "A", "playCount": 2, "lastPlayedAt": "ISO8601" } } }
```
- ランクは今回結果が既存 bestRank より良い場合のみ更新。

## 6. ビジュアル方針

- ダーク基調(紺〜黒)+アクセント1色(シアン系)。ノベルゲーム風の落ち着いた画面。
- システムフォントスタック。本文は 16px 以上、行間広め。
- パラメータメーターは4色を固定割当(例: customer=橙 / quality=緑 / budget=黄 / trust=青)。
- スマホ(375px幅)で崩れないこと。

## 7. スモークテスト(scripts/smoke-test.mjs)

`node scripts/smoke-test.mjs` で実行。engine.js を import し、
1. data/index.json の全エピソード JSON を読み込みスキーマ必須項目を検証
2. 全ノードの `next` / `start` / ending の参照先が存在することを検証
3. 各エピソードを「常に最初の選択肢」「常に最後の選択肢」で機械的に通しプレイし、必ず debrief に到達しランクが算出されることを確認

## 8. シナリオ執筆ガイド(エピソード追加時)

- 世界観: プレイヤーは「ライトブリッジ株式会社」の新人。メンターは**アオイ先輩**(頼れる・少し辛口・説教くさくならない)。顧客キャラは各話ごとに設定。
- 1話 = scene と choice の連なりで **choice 3個前後**、プレイ5〜10分(総テキスト量はお手本 s1e1.json と同程度)。
- 選択肢の設計原則(CONCEPT.md 参照): 明らかな不正解を置かない。「若手がやりがちなもっともらしい罠」(確認せず着手 / 過剰設計 / 丸投げ / 銀の弾丸信仰)を混ぜる。
- feedback は「なぜ」を短く。正解の押しつけではなく視点の提供。
- ending は最低3 variant(良/中/悪)。良い結末は「数か月後にこう効いた」まで描くと学習効果が高い。
- 用語は本文で自然に使い、glossary で定義する(1話 4〜7語)。
