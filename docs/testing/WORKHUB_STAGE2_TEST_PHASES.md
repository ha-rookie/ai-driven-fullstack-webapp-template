# WORKHUB Stage 2 #346｜テスト工程の分離とシステムテスト引継ぎ

> 適用判断：2026-10-12、ユーザー指示「実機を単体テストに含めない。システムテストなどでまとめて行う」。
> 正本：[#132 Roadmap](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/132) → [#343 WBS](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/343) → [#346 Stage2](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/346)。
> これは**試験実施工程の区分**であり、WBS順序・Scope・品質基準・Human Gateの変更ではない。

## 1. 工程と実行境界

| 工程 | 目的・実施内容 | 実施タイミング / 環境 | 実機の扱い |
| --- | --- | --- | --- |
| **UT：単体テスト** | Status変換、権限・Scope Policy、期限/Version、Validation、Projectionなどの純粋な処理と失敗分岐 | 実装PR／ローカル・CI（`npm run test:unit`） | **含めない** |
| **IT：結合テスト** | Worker HTTP、認証・CSRF・D1、Workflow/通知/申請の境界・排他・失敗復旧をローカルで確認 | 実装PR／ローカルD1・CI、差分影響に応じた検証 | **含めない** |
| **自動ブラウザE2E** | 申請→差戻し→再申請→承認、Ren→Mei委任/取消、390px画面、キーボード、ARIA、印刷CSSとChromium PDFページ数 | 実装PR／ローカルPlaywright、デスクトップとモバイル**エミュレーション**。必要な操作はローカルFixtureのみ | **実機とは呼ばない** |
| **Preview非破壊Smoke** | 指定SHAのDeploy証拠、root/liveness/readiness/未認証境界、公開ShowcaseのPC・モバイル表示 | Previewコード反映が**別途承認された場合のみ**。HTTP GETなど読み取り専用 | 実機操作・ログイン済み業務検証の代わりにしない |
| **ST：システムテスト** | 実機Android Chrome等の表示・印刷、実際の端末のフォーカス/読み上げ、認証後の業務シナリオ、エラー復旧、最終の画面間整合 | **Stageの実装が揃った後にまとめて計画・実施**。環境/試験データ/人・担当・期間を決める | **ここで一括実施** |
| **受入 / リリース判定** | STで発見した欠陥の是正確認、残リスクと証拠、業務責任者による可否判断 | ST後。Production反映は別途Human Gate | 未実施をPASS扱いしない |

実機確認は、**UT・毎PRのCI完了条件に入れない**。ST未実施のみを理由に、既存WBSに沿った次の開発作業を無期限に停止させない。ただし「開発コードの検証完了」と「ST合格」「リリース可」を別の状態として記録し、未実施STを完了と偽らない。

## 2. Stage 2｜既存の自動検証と限界

- **Unit / IT:** [PR #635 Full-stack CI](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/38215948638) SUCCESS。既存のサーバー権限境界・Version排他・Domainのテストを維持。
- **Local Browser E2E:** [PR #635 Browser](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/38215948587) **59/59 PASS**。390pxはデスクトップChromiumの幅変更でありAndroid端末ではない。A4 1ページのPDF検証はChromium PDF出力でありAndroid Chromeの印刷証明ではない。
- **Preview Code Deploy:** [固定SHA `bf977baeb37b00e8b38fd39fd88e31f7ca6fc001`](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/38224832451) SUCCESS（承認済み）。
- **Preview Read-only:** [HTTP 4/4](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/38225033016)、[Showcase PC/Mobile 2/2](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/38225036355) SUCCESS。ログイン後の出張申請や委任・承認を操作していない。
- **System Test:** **未実施・後工程へ引継ぎ**。実機の表示改善、Androidの空白PDFページ、支援技術の読み上げ、ログイン後のPreview委任シナリオの完了証拠は存在しない。

上記の数字は各Runで実行した範囲の合否であって、品質全体の合格率ではない。

## 3. システムテストでまとめて確認する項目（未実施）

| ID | シナリオと観測点 | 準備・備考 |
| --- | --- | --- |
| ST-WH2-01 | Android Chromeで出張申請の「行先・開始日・終了日・目的」、補足・エラー表示・入力値が判読できる。狭い幅で横スクロール/重なりがない | 実機OS・ブラウザ版・文字倍率・端末名を記録。2026-10-12の実機指摘の再現・修正確認 |
| ST-WH2-02 | Android Chromeのブラウザ「印刷・PDF保存」で短い提出済み申請がA4 **1ページ**、文字欠落/白紙ページなし、免責が残る | **既存の提出済み申請**を用いてよい。ChromiumローカルPDFテストの結果を転記してPASSにしない |
| ST-WH2-03 | OS標準の読み上げ（例：Android TalkBack）でMY WORKのタスク目的・承認/差戻し・委任の有効/取消・処理後フォーカスが判断できる | 実機／OSの支援技術で記録。Playwright ARIA/Keyboardチェックは別証拠 |
| ST-WH2-04 | 利用可能な別ブラウザ・端末（例：iOS Safari）でも主要REQUESTS→MY REQUESTS→詳細と印刷を確認 | **用意できる端末を先に決める**。未実施を「対象外」扱いにするには理由/承認が必要 |
| ST-WH2-05 | 認証後Aoi申請→Ren承認・差戻し→再申請、通知/履歴・経費連携の状態整合、権限外操作を確認 | 環境・テスト用データ・ロール・戻し方を決めてから。**Remote D1への書込みは別途明示承認が必要** |
| ST-WH2-06 | Renの明示的24時間委任→Mei代理承認→取消/期限切れ→アクセス拒否、応答喪失・再取得時の安全な導線 | Reference限定・原承認者の帰属を維持。Remoteでmutationを使うなら個別Human Gate承認 |
| ST-WH2-07 | 画面レイアウト・視認性の総合評価（ナビゲーション圧迫、カード余白、補助テキスト、モバイル操作性） | 今回のスクリーンショットで指摘された読みやすさを中心に観察。好みと機能障害を区別 |
| ST-WH2-08 | Preview環境のログイン時HTTP 503や通信障害の扱い・再認証・再送抑止 | 別Issue [#521](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/521) の技術的解決/運用判定と混同しない |

STで試すケースを毎PRの単体テストへ持ち込まない。STを**行う予定**は証拠ではない。端末・環境・試験データ・時間・責任者が決まるまで実施を要求しない。

## 4. 実行・証拠・Human Gate

- PRレビューでは、対象Issueの変更契約、影響差分、必要最小限のUT/IT、該当ブラウザE2E、必須CI結果を確認する。毎回の全端末回帰テストやRemote Preview書込みを前提にしない。
- Preview/Production Code Deploy、Remote D1、Secret・Cloudflare設定/リソース変更はそれぞれの**ユーザー明示承認**が必要。コードをmainへマージしたこと、ST計画を作ったことは承認にならない。
- 既存の `preview-browser-smoke` はPreview業務データを変更し得るため、現時点では実行禁止。未承認で迂回しない。
- 過去のPreview D1 main-push自動適用の統制不備は [#632](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/632) に独立記録しており未解消。この計画によって解決したとは言わない。
- リリース時は、各ST-IDごとに **Not Run / Pass / Fail / Blocked**、実機/OS/ブラウザ版、対象ビルドSHA、実施日時、スクリーンショットの機密保護、Issue、再試験結果、承認者を紐づけて集計する。

### ST実施結果テンプレート（後工程で記入）

```text
test_id: ST-WH2-...
build_sha:
environment:
device_os_browser:
date:
result: Not Run | Pass | Fail | Blocked
observation:
expected_vs_actual:
evidence:
linked_issue:
retest:
approved_by:
```

## 5. 完了の意味を区別する

- **実装・自動検証:** #346のScope/Done（Intent、Request Detail/Journey、Source of Truth、Role/Scope/Assignment/Delegation、stale/duplicate/partial failure、Mobile/Accessibilityのコード及び自動検証）を証拠ごとに判断する。実機STの未実施はこれらの自動テストの失敗を意味しない。
- **ST準備:** ST仕様と保留シナリオは本書で追跡する。実機動作、Preview書込みシナリオは未検証として明示する。
- **ST/受入完了:** 全対象STケースの実施と欠陥/残リスク判断は**後工程**。これが完了するまで実機の合格やProduction-readyを宣言しない。

ST日程やWBS/Stageの移動をこの文書で独断決定しない。以降のStageにも「Unitに実機を含めず、System Testでまとめる」という工程原則を適用し、各Stageの試験項目は当該Issueで管理する。
