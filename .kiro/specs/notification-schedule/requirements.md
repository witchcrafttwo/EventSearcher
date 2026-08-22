# Requirements Document

## Introduction

現在のWeb Push通知は収集処理の中で即時送信されるため、収集を実行した時刻がそのまま通知時刻になり、深夜に通知が届く可能性がある。本仕様では収集処理と通知配信処理を分離し、日本時間22:00〜08:00を通知禁止時間帯として送信を抑止する。ホスティング構成は変更せず、現行のVercel、ローカル収集CLI、自宅サーバー用エントリのいずれでも同じ挙動となるよう共通処理として実装する。

## Glossary

- **収集処理**: 登録サイトからイベント候補を取得し、AI要約を経てDynamoDBへ保存する処理（`runIngest`）。
- **通知配信処理**: 未通知イベントを対象にWeb Pushを送信する処理。収集処理から分離する。
- **未通知イベント**: DynamoDBへ保存済みで、まだWeb Push送信されていないイベント。
- **通知禁止時間帯**: Web Pushを送信しない時間帯。日本時間22:00以降08:00未満とする。
- **保留**: 通知禁止時間帯などで送信できない未通知イベントを、破棄せず次回の配信対象として残すこと。

## Requirements

### Requirement 1: 収集処理と通知配信処理の分離
**User Story:** 運用者として、イベントを収集した時刻と利用者へ通知が届く時刻を切り離したい。

#### Acceptance Criteria
1. THE SYSTEM SHALL 収集処理と通知配信処理を独立して実行できる単位に分離する。
2. WHEN 収集処理が新規イベントを保存したとき THEN システム SHALL 当該イベントを未通知として記録する。
3. WHEN 収集処理が実行されたとき THEN システム SHALL 収集処理の中でWeb Pushを送信しない。
4. WHEN 通知配信処理が実行されたとき THEN システム SHALL 未通知イベントのみを送信対象とする。
5. THE SYSTEM SHALL 収集処理と通知配信処理を、ローカル収集CLI、現行のVercel環境、自宅サーバー用エントリのいずれからも同じ共通処理として呼び出せるようにする。

### Requirement 2: 通知禁止時間帯の抑止
**User Story:** 利用者として、深夜や早朝に通知で起こされたくない。

#### Acceptance Criteria
1. THE SYSTEM SHALL 通知禁止時間帯を日本時間22:00以降08:00未満とする。
2. IF 通知配信処理が通知禁止時間帯に実行された THEN システム SHALL Web Pushを送信しない。
3. WHEN 通知禁止時間帯のため送信を行わなかったとき THEN システム SHALL 対象イベントを未通知のまま保留する。
4. WHEN 通知禁止時間帯が明けた後に通知配信処理が実行されたとき THEN システム SHALL 保留していた未通知イベントを送信対象に含める。
5. WHEN 通知禁止時間帯に収集処理が実行されたとき THEN システム SHALL イベントの取得と保存を継続し、送信のみを抑止する。
6. THE SYSTEM SHALL 通知禁止時間帯の判定を実行環境のタイムゾーン設定に依存せず日本時間で行う。
7. THE SYSTEM SHALL 通知禁止時間帯の判定に使用した時刻と抑止した件数をログへ出力する。

### Requirement 3: 重複通知の防止
**User Story:** 利用者として、同じイベントの通知を何度も受け取りたくない。

#### Acceptance Criteria
1. WHEN イベントのWeb Push送信が成功したとき THEN システム SHALL 当該イベントを通知済みとして記録する。
2. WHEN 通知配信処理が再度実行されたとき THEN システム SHALL 通知済みイベントを送信対象に含めない。
3. IF 送信が失敗した THEN システム SHALL 当該イベントを未通知のまま保持し、次回の配信対象とする。
4. WHEN 複数の未通知イベントが同一の購読条件に一致したとき THEN システム SHALL それらをまとめて1件のWeb Pushとして送信する。
5. THE SYSTEM SHALL 送信対象の判定に、利用者プロフィールのエリアとカテゴリ条件を現行と同じ基準で適用する。

### Requirement 4: 通知対象イベントの鮮度
**User Story:** 利用者として、すでに終了したイベントの通知を受け取りたくない。

#### Acceptance Criteria
1. WHEN 通知配信処理が送信対象を選ぶとき THEN システム SHALL 開催終了済みのイベントを除外する。
2. IF 未通知イベントが長期間送信されないまま滞留した THEN システム SHALL 当該イベントを送信せず通知済みとして記録し、保留を解消する。
3. THE SYSTEM SHALL 滞留と判断する日数を設定値として変更可能にする。

### Requirement 5: 購読の健全性維持
**User Story:** 運用者として、無効な購読へ送信を繰り返したくない。

#### Acceptance Criteria
1. WHEN 送信先の購読が失効していた THEN システム SHALL 当該購読をDynamoDBから削除する。
2. IF 一部の購読への送信が失敗した THEN システム SHALL 残りの購読への送信を継続する。
3. THE SYSTEM SHALL 送信件数、失敗件数、削除した購読件数をログへ出力する。

### Requirement 6: 既存動作の維持
**User Story:** 運用者として、通知の変更によって既存の収集や画面表示が壊れないようにしたい。

#### Acceptance Criteria
1. THE SYSTEM SHALL `npm run ingest`、`--force`、`--source`によるローカルCLI収集を現行どおり動作させる。
2. THE SYSTEM SHALL 収集処理のAI処理をBedrock GLM-5の直列実行のまま維持する。
3. THE SYSTEM SHALL 利用者向け画面と管理画面の既存APIの応答内容を、通知関連の追加項目を除いて変更しない。
4. IF 通知設定が未構成である THEN システム SHALL 収集処理をエラーとせず継続する。
