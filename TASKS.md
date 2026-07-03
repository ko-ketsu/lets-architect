# 作業タスク & 進捗記録

このファイルは作業の中断・再開に備えた状態記録。**作業を進めたら必ずここを更新すること。**

最終更新: 2026-07-02

## 現在の状態

- **MVP 完成**。エンジン+UI+エピソード3話+スモークテスト、すべて検証済み
- 検証内容: `node scripts/smoke-test.mjs` 全パス / 全27ルート総当たりでランク分布確認 / ローカル配信で全アセット200 / サブエージェントによる Playwright 実機通しプレイ(通しプレイ・用語ポップアップ・bestRank 保持・進捗リセット・中断confirm)
- 修正済みの問題:
  - ランク閾値が高すぎて S が到達不可能だった → S≥280/A≥240/B≥200 に変更(engine.js と SPEC.md 3.4)。各話 S はほぼ完璧なルート1本のみで到達可能
  - 選択肢ボタン内で用語ハイライト(button入れ子)によりテキストが分断される描画バグ → 選択肢内はプレーンテキスト化(コミット 30580e9)。教訓: glossary ハイライトは対話要素(button等)の中に入れないこと
- 残作業: GitHub リポジトリ作成 → push → Pages 有効化(Settings > Pages > Source: GitHub Actions)。これはユーザーのアカウント操作が必要

## 方針メモ(再開時に読む)

- **技術スタック: ビルドなしの素の HTML/CSS/JS(ES modules)**。GitHub Pages にそのまま置ける。npm 不要。
- シナリオは `data/episodes/*.json` のデータ駆動。スキーマは design/SPEC.md に定義。
- サイトは `/<リポジトリ名>/` 配下で配信されるため**相対パスのみ使用**。
- 進捗保存は localStorage(キー: `lets-architect:v1`)。
- 実装はサブエージェント(Sonnet)に委譲し、Fable はレビュー・統合・修正を担当。
- エピソード1(s1e1)は品質基準のお手本として Fable が執筆。2・3はサブエージェントが s1e1 を参照して執筆。

## タスクリスト

### フェーズ1: 土台(Fable 担当)
- [x] T1: git init + ディレクトリ構成
- [x] T2: design/SPEC.md(データスキーマ・画面仕様・エンジン仕様)
- [x] T3: data/episodes/s1e1.json(エピソード1本体)
- [x] T4: data/index.json(エピソード一覧)
- [x] T5: .github/workflows/deploy.yml(GitHub Pages 自動デプロイ)
- [x] T6: 初回コミット

### フェーズ2: 実装(サブエージェント並列)
- [x] T7: ゲームエンジン+UI 実装(Sonnet エージェント①)
  - index.html / css/style.css / js/*.js / scripts/smoke-test.mjs
- [x] T8: エピソード2・3 シナリオ執筆(Sonnet エージェント②)完了
  - s1e2: EC「フルフルマーケット」桜井マネージャー/MoSCoW仕分けとロードマップ合意
  - s1e3: ホテル予約システム 橋本主任/性能要件の数値化と早期負荷試験
  - エージェントによる検証済み(JSON妥当性・ノード参照整合・話者定義・glossary出現)。Fable の品質レビューは T9 で実施

### フェーズ3: 統合・検証(Fable 担当)
- [x] T9: 成果物レビュー・スモークテスト実行・修正
- [x] T10: ローカルサーバーで動作確認(全エピソード通し)
- [ ] T11: コミット・完了報告(GitHub リポジトリ作成と Pages 有効化は手順を案内)

### フェーズ4: シーズン2実装(2026-07-03 ユーザー承認済み・実装中)

コンセプトは design/SEASON2.md で**ユーザー承認済み**(レビュー1巡目反映済み: 質問制限の具体化・S1最終問題改稿方針)。SPEC 反映済み(3.1 difficulty / 4.2 ★表示 / 4.4 周回促し / 7 テスト拡張+check-routes / 8・9 実装中に変更 / 10.1 難易度設計)。

- [x] T12: SPEC.md 更新(Fable)
- [ ] T13: エンジン+UI拡張(Sonnet ①): image表示+拡大モーダル / portrait表示+行上書き / フィードバックカードに aoi-dry / 難易度★ / リザルト周回促し / smoke-test 拡張 / index.json の既存3話に difficulty:1
  - 担当ファイル: js/*, css/style.css, index.html, scripts/smoke-test.mjs, data/index.json
- [ ] T14: シーズン2エピソード3本+図解SVG+scripts/check-routes.mjs(Sonnet ②)
  - s2e1 戸田店長(ハルカワ商店)ER図 / s2e2 五十嵐(コネクタ)シーケンス図 / s2e3 志村課長(トリオ運輸)依存図
  - 担当ファイル: data/episodes/s2e*.json, data/diagrams/*, scripts/check-routes.mjs
- [ ] T15: シーズン1最終問題の改稿+s1へのportrait付与(Sonnet ③): 最終choiceを状況理解チェックに(外すとA落ち・Sルート1本維持)
  - 担当ファイル: data/episodes/s1e*.json
- [ ] T16: 新キャラ立ち絵3体(Sonnet ④): data/portraits/toda.svg / igarashi.svg / shimura.svg(既存サンプル複製改変、SPEC 9.2 厳守、スクショ自己検証)
- [ ] T17: 統合(Fable): data/index.json にシーズン2セクション+3話追加(difficulty:2)→ smoke-test / check-routes 全話 → Playwright+スクショで目視検証(立ち絵・図解・★表示)→ コミット
  - 注意: push は Pages デプロイ状況を確認してから

### 将来(シーズン2リリース後)
- [ ] **シーズン2: 図解出題+立ち絵の実装**(ユーザー決定済み 2026-07-02)
  - 図解: 手作りSVG(data/diagrams/)+「図を読んで選択肢で答える」形式。Mermaid・タップ間違い探し・D&Dは不採用。仕様は SPEC 第8章(image フィールド)
  - 立ち絵: 手描きSVG。**画風はユーザー承認済み、確定サンプル取り込み済み** → data/portraits/(aoi-normal / aoi-dry / marukawa)、情景サンプルは data/scenes/meeting-dusk.svg。仕様と制作ガイドライン(パーツ重なりルール等の教訓込み)は SPEC 第9章
  - 実装内容: エンジンの image/portrait 対応 / UI(立ち絵表示・図表示+拡大モーダル)/ smoke-test に SVG 存在チェック追加 / 図入りエピソード
  - デザイン検討の経緯は Artifact「イラスト方式サンプル」参照: https://claude.ai/code/artifact/3cc15c31-b76e-4f95-ae71-87fcb5bb8c56
- [ ] シーズン2〜4 のエピソード追加
- [ ] 用語集の独立ページ
- [ ] バッジ・実績システム
