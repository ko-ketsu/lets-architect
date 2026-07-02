# 作業タスク & 進捗記録

このファイルは作業の中断・再開に備えた状態記録。**作業を進めたら必ずここを更新すること。**

最終更新: 2026-07-02

## 現在の状態

- コンセプト確定済み → [CONCEPT.md](CONCEPT.md)
- git リポジトリ初期化・ディレクトリ構成作成済み
- 次のアクション: 仕様書(design/SPEC.md)とエピソード1を作成し、サブエージェント2体に実装・シナリオ執筆を委譲する

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
- [ ] T2: design/SPEC.md(データスキーマ・画面仕様・エンジン仕様)
- [ ] T3: data/episodes/s1e1.json(エピソード1本体)
- [ ] T4: data/index.json(エピソード一覧)
- [ ] T5: .github/workflows/deploy.yml(GitHub Pages 自動デプロイ)
- [ ] T6: 初回コミット

### フェーズ2: 実装(サブエージェント並列)
- [ ] T7: ゲームエンジン+UI 実装(Sonnet エージェント①)
  - index.html / css/style.css / js/*.js / scripts/smoke-test.mjs
- [ ] T8: エピソード2・3 シナリオ執筆(Sonnet エージェント②)
  - data/episodes/s1e2.json(テーマ: 優先順位付け)
  - data/episodes/s1e3.json(テーマ: 性能要件の具体化)

### フェーズ3: 統合・検証(Fable 担当)
- [ ] T9: 成果物レビュー・スモークテスト実行・修正
- [ ] T10: ローカルサーバーで動作確認(全エピソード通し)
- [ ] T11: コミット・完了報告(GitHub リポジトリ作成と Pages 有効化は手順を案内)

### 将来(初期リリース後)
- [ ] シーズン2〜4 のエピソード追加
- [ ] 用語集の独立ページ
- [ ] バッジ・実績システム
