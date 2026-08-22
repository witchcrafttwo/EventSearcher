# Requirements Document

## Introduction

現在のユーザー画面はエリアとカテゴリでしか絞り込めず、イベント名や会場名から探すことができない。本仕様ではイベント一覧に対するキーワード検索を追加する。`/events`は既に全イベントを返しているため、検索はフロント側の絞り込みとして実装し、APIとDynamoDBへの追加負荷を発生させない。

## Glossary

- **キーワード検索**: 利用者が入力した文字列でイベント一覧を絞り込む機能。
- **検索対象フィールド**: 照合に使うイベントの項目。タイトル、要約本文、会場名、住所、エリア、カテゴリ。
- **OR一致**: 入力を空白で区切った各語のうち、いずれか1つでも一致すれば対象とする判定方式。
- **一致数**: 1件のイベントが、入力された語のうちいくつに一致したかを示す数。
- **一覧タブ**: イベントをカード形式で並べる表示。「すべてのイベント」「ブックマーク」「閲覧履歴」を含む。

## Requirements

### Requirement 1: キーワードによる絞り込み
**User Story:** 利用者として、イベント名や会場名を入力して目的のイベントを探したい。

#### Acceptance Criteria
1. THE SYSTEM SHALL イベント一覧の検索条件としてキーワード入力欄を提供する。
2. THE SYSTEM SHALL 検索対象フィールドをタイトル、要約本文、会場名、住所、エリア、カテゴリとする。
3. WHEN 利用者がキーワードを入力したとき THEN システム SHALL 検索対象フィールドのいずれかに一致するイベントのみを表示する。
4. WHEN 入力に複数の語が含まれるとき THEN システム SHALL 空白区切りで語を分割し、OR一致で判定する。
5. THE SYSTEM SHALL 語の区切りとして半角空白と全角空白の両方を扱う。
6. WHEN 入力が空のとき THEN システム SHALL キーワードによる絞り込みを行わない。
7. THE SYSTEM SHALL キーワード検索をサーバーへ追加のリクエストを送らずに実行する。

### Requirement 2: 入力の正規化
**User Story:** 利用者として、大文字小文字や全角半角の違いを気にせず検索したい。

#### Acceptance Criteria
1. THE SYSTEM SHALL 照合時に英字の大文字と小文字を区別しない。
2. THE SYSTEM SHALL 照合時に英数字の全角と半角を同一として扱う。
3. THE SYSTEM SHALL 入力の前後の空白を無視する。
4. WHEN 入力が空白のみのとき THEN システム SHALL 絞り込みを行わない。

### Requirement 3: 結果の並び順
**User Story:** 利用者として、入力した語により多く一致したイベントを先に見たい。

#### Acceptance Criteria
1. WHEN キーワードで絞り込んだとき THEN システム SHALL 一致数の多い順に並べる。
2. WHEN 一致数が同じとき THEN システム SHALL 既存の並び順を維持する。
3. WHEN キーワードが未入力のとき THEN システム SHALL 既存の並び順を変更しない。

### Requirement 4: 既存の絞り込みとの併用
**User Story:** 利用者として、地域やカテゴリを選んだうえでキーワードでも絞り込みたい。

#### Acceptance Criteria
1. WHEN 地域またはカテゴリが選択されている状態でキーワードを入力したとき THEN システム SHALL 両方の条件を満たすイベントのみを表示する。
2. THE SYSTEM SHALL 終了イベントの非表示切替をキーワード検索と併用できるようにする。
3. THE SYSTEM SHALL 表示OFFに設定されたソースのイベントを検索結果に含めない。
4. WHEN 検索条件をリセットしたとき THEN システム SHALL キーワードも解除する。

### Requirement 5: 適用範囲
**User Story:** 利用者として、キーワード検索が想定外の画面に影響しないでほしい。

#### Acceptance Criteria
1. THE SYSTEM SHALL キーワード検索を一覧タブに適用する。
2. THE SYSTEM SHALL 地図タブの表示内容にキーワード検索を適用しない。
3. THE SYSTEM SHALL カレンダータブの表示内容にキーワード検索を適用しない。
4. THE SYSTEM SHALL 「あなたにおすすめ」の選定にキーワード検索を適用しない。

### Requirement 6: 検索語を保持しない
**User Story:** 利用者として、次に開いたときは前回の検索語が残っていない状態から始めたい。

#### Acceptance Criteria
1. THE SYSTEM SHALL キーワードをlocalStorageその他の永続領域へ保存しない。
2. WHEN 画面を再読み込みしたとき THEN システム SHALL キーワードを未入力の状態にする。
3. THE SYSTEM SHALL キーワードをURLへ反映しない。

### Requirement 7: 結果が0件のときの表示
**User Story:** 利用者として、該当がないときはその旨がはっきり分かってほしい。

#### Acceptance Criteria
1. WHEN キーワードに一致するイベントが存在しないとき THEN システム SHALL 「見つかりませんでした」旨のメッセージを表示する。
2. WHEN 0件を表示するとき THEN システム SHALL 入力したキーワードを画面上で確認できるようにする。
3. WHEN 0件を表示するとき THEN システム SHALL キーワードを解除して一覧へ戻る操作を提供する。
4. THE SYSTEM SHALL 0件の表示を既存の空状態表示と同じ体裁で行う。

### Requirement 8: 既存動作の維持
**User Story:** 運用者として、検索の追加によって既存機能が壊れないようにしたい。

#### Acceptance Criteria
1. THE SYSTEM SHALL `/events`の要求パラメータと応答内容を変更しない。
2. THE SYSTEM SHALL ブックマーク、閲覧履歴、通知、イベント詳細の既存動作を変更しない。
3. THE SYSTEM SHALL 段階表示（続きを読み込む）の件数制御をキーワード検索後の結果に対して適用する。
4. THE SYSTEM SHALL スマートフォン表示で検索入力欄が既存の絞り込み操作と重ならないよう配置する。
