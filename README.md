# EC2版 県内イベントAI収集・通知PWA

EC2上のNode.jsサーバーで、Web/PWA配信、API、イベント定期収集、AI要約、Push通知を動かす構成です。

## 構成

```text
スマホ / PC
  ↓
EC2 Node.js/Express server
  ├─ Web/PWA配信
  ├─ プロフィール/API
  ├─ 定期イベント収集
  └─ AI要約(OpenAI API または Bedrock)
  ↓
DynamoDB / Secrets Manager
```

AWSリソース:

- EC2 Amazon Linux 2023
- VPC / Security Group
- DynamoDB profiles/events/subscriptions tables
- IAM Role for EC2
- Secrets Manager
- 任意でBedrock Runtime

## 初期セットアップ

```powershell
cd C:\Users\yunre\documents\.create\AWS
npm install
```

Web Push用のVAPIDキーを作成します。

```powershell
npx web-push generate-vapid-keys
```

OpenAI APIキーを使う場合、キーはファイルへ書かずSecrets Managerへ保存します。

```powershell
aws secretsmanager create-secret `
  --name prefecture-events-ai/openai-api-key `
  --secret-string "ここにOpenAI APIキー"
```

## デプロイ前の環境変数

```powershell
$env:VAPID_PUBLIC_KEY="生成したPublic Key"
$env:VAPID_PRIVATE_KEY="生成したPrivate Key"
$env:VAPID_SUBJECT="mailto:admin@example.com"

$env:AI_PROVIDER="openai"
$env:OPENAI_API_KEY_SECRET_NAME="prefecture-events-ai/openai-api-key"
$env:OPENAI_MODEL="gpt-5.5"

$env:EVENT_SOURCES_JSON=(Get-Content .\config\event-sources.sample.json -Raw)
$env:INGEST_INTERVAL_MINUTES="360"
$env:EC2_INSTANCE_TYPE="t3.micro"
```

SSHで入りたい場合だけ、既存のEC2 Key Pair名と許可CIDRを設定します。未設定でもSSM Session Managerで接続できます。

```powershell
$env:EC2_KEY_NAME="your-key-pair-name"
$env:EC2_SSH_CIDR="あなたのIP/32"
```

## EC2へデプロイ

```powershell
npm run infra:deploy
```

デプロイ後に `WebUrl` が表示されます。そのURLがWeb/PWAの入口です。

## ローカル確認

Webだけ:

```powershell
npm run web:dev
```

EC2と同じNode.jsサーバーをローカルで動かす場合は、DynamoDBテーブル名などの環境変数が必要です。

```powershell
npm run build
npm run server:dev
```

## AIの選択

OpenAI APIを使う場合:

```powershell
$env:AI_PROVIDER="openai"
$env:OPENAI_API_KEY_SECRET_NAME="prefecture-events-ai/openai-api-key"
$env:OPENAI_MODEL="gpt-5.5"
```

Bedrockを使う場合:

```powershell
$env:AI_PROVIDER="bedrock"
$env:BEDROCK_MODEL_ID="anthropic.claude-3-haiku-20240307-v1:0"
$env:AI_LANGUAGE="typescript"
```

## 注意

EC2のHTTP URLでもWeb表示はできます。ただしスマホのPush通知やPWAインストールを本番運用するにはHTTPSが必要です。独自ドメインをRoute 53に向け、ALB + ACM証明書、またはNginx + certbotなどでHTTPS化してください。
