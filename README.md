# TR Equity Monitor

Borsa Istanbul（トルコ株式市場）を日次で観察し、投資機会を探すためのダッシュボード。
Cloudflare スタック（Workers + D1 + Cron Triggers + Workers AI + Email Service）だけで動作し、GitHub Actions や CI は使わず
手元（またはクラウド開発環境）から `wrangler deploy` で直接デプロイします。

- 本番: https://tr-equity.0xkaz.com （workers.dev: https://tr-equity.sxg.workers.dev）
- データ: Yahoo Finance（終値ベース・遅延あり）。BIST 100 の主要銘柄（銀行、航空・防衛、鉄鋼・エネルギー、小売、持株会社など） 64 銘柄＋BIST 100。
- 姉妹サイト一覧: https://equity.0xkaz.com （ヘッダーのマーケット切替メニューからも移動できます）。構成は SG Equity Monitor と同一です。

## 機能

| ページ | 内容 |
| --- | --- |
| 概況 | BIST 100、ブレッドス（200/50日線上の比率、上昇/下落数、52週高安）、セクター騰落、値上がり/値下がり上位、本日のシグナル、日本語デイリーブリーフ、AI コメント |
| スクリーナー | プリセット（モメンタム上位・ブレイクアウト・出来高急増・押し目・反転候補・大幅調整・高配当低PER・ウォッチ中）＋セクター/シグナル/売買代金フィルタ、全列ソート |
| 銘柄詳細 | ローソク足＋SMA20/50/200＋出来高、テクニカル指標、ファンダメンタル（時価総額・PER・PBR・配当利回り・EPS・次回決算）、ウォッチリスト登録とメモ |
| セクター | 1日/1週/1ヶ月/3ヶ月のセクター・ヒートマップ |
| ウォッチリスト | 登録銘柄の指標一覧とメモ |
| 設定・通知 | Google ログイン後に、メール通知の ON/OFF、日次ブリーフ、ウォッチ銘柄アラートのしきい値、含めるシグナルを設定。テスト送信・プレビュー・送信履歴 |
| 状態 | 更新状況・取得エラー・ジョブ履歴・手動更新ボタン（管理者ログインまたは管理トークン） |

### 計算しているシグナル
52週高値/安値更新、20日高値ブレイク/安値割れ、ゴールデン/デッドクロス（SMA50×200、30日以内）、
RSI(14) 売られすぎ/買われすぎ、出来高急増（20日平均の2倍以上）、200日線回復/割れ、
高値から30%超下落、上昇/下降トレンド（終値>SMA50>SMA200）、急騰/急落（±5%超）。

### 通貨について
全銘柄 TRY 建てです。

## アーキテクチャ

```
Cron (平日 15:20–17:50 UTC = 現地 18:20〜20:50, 10分毎)
  └─ runRefresh(): stale な銘柄を最大25件ずつ Yahoo chart API から取得
       ├─ prices (D1) に upsert（初回は2年分、以降は1ヶ月分を重ねて修正）
       ├─ metrics (D1) を再計算
       └─ 全銘柄が更新済みになったら market_daily スナップショット＋breadth_daily
            ├─ Workers AI でマーケットコメント＋注目銘柄コメント
            ├─ 通知を有効にしたユーザーへメール送信
            └─ ファンダメンタル更新（1日1回）
Worker (Hono)
  ├─ /api/market, /api/screener, /api/stock/:code, /api/watchlist, /api/jobs, /api/meta, /api/me
  ├─ /api/admin/* （X-Admin-Token ヘッダまたは管理者ログイン）refresh / snapshot / fundamentals / recompute / breadth-backfill / ai / notify / email-test
  └─ /  静的ダッシュボード（public/ をビルド時に埋め込み）
```

- `src/universe.ts` 監視銘柄のリスト（Borsa Istanbul コード＋セクター。Yahoo シンボルは `コード.IS`）。追加・削除はここを編集して deploy するだけ。
- `src/metrics.ts` 指標・シグナル計算、`src/market.ts` ブレッドス・セクター集計とブリーフ文。
- `src/ai.ts` Workers AI コメント、`src/notify.ts` メール、`src/auth.ts` Google OAuth。
- `migrations/` D1 スキーマ。

## ウォッチリスト（★）と負荷対策

- スクリーナー・概況（値上がり/値下がり上位、注目銘柄コメント）・ウォッチリストの各行と、銘柄詳細の右上に ★ ボタン。未ログインで押すとログインへ誘導。指数（BIST100）には付けない。
- 一覧のデータ（`/api/screener`, `/api/market`, `/api/stock/:code`, `/api/universe`）は全員共通のレスポンスにして
  **Cache API でエッジに 5 分キャッシュ**（`X-Edge-Cache: HIT/MISS`）。これらのリクエストはセッション照会もしないので D1 を読まない。
- ★ の状態は `/api/watchlist/ids`（銘柄シンボルの配列だけ、主キー範囲の 1 クエリ、`private, no-store`）をページを開いたときに 1 回だけ取得してメモリに保持し、
  クライアント側で一覧に重ねる（行ごとのリクエストはしない）。切替は楽観的更新（即時反映、失敗時に戻す）。
- メモは ★ 済みの銘柄詳細を開いたときだけ `/api/watchlist/:code` で取得。`PUT {}` は既存メモを保持したまま追加、`PUT {note}` でメモ更新。
- 1 ユーザー最大 200 銘柄。管理操作でデータを再構築した場合、一覧への反映は最大 5 分遅れる。

## ログイン（Google OAuth）と通知

- ログインは Google OAuth 2.0 の認可コードフロー。セッションは D1 の `sessions` に保存し、HttpOnly Cookie（30日）で保持。
- ウォッチリストはユーザーごと（`user_watchlist`）。
- 通知メールは Cloudflare Email Service（`send_email` バインディング、送信元 `notifications@equity.0xkaz.com`）で、
  Cron が全銘柄を更新しスナップショットを作った直後に **通知を有効にしたユーザーだけ** に 1 日 1 通送信します
  （`notifications` テーブルでユーザー×日付の重複送信を防止）。内容: AI コメント、数値サマリー、ウォッチ銘柄のシグナル・急変動、選択したシグナルのダイジェスト。

必要な設定（いずれも Worker 側）:

| 名前 | 種類 | 内容 |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | var（wrangler.jsonc） | Google Cloud の OAuth クライアント ID（Web アプリケーション種別）。他の姉妹サイトと同じクライアントを共用 |
| `GOOGLE_CLIENT_SECRET` | secret | 同クライアントのシークレット。`npx wrangler secret put GOOGLE_CLIENT_SECRET` またはダッシュボード（Workers & Pages → tr-equity → Settings → Variables and Secrets） |
| `ALLOWED_EMAILS` | var（デプロイ時、任意） | ログインを許可するメール（カンマ区切り）。未設定なら誰でもログイン可（自分のデータのみ閲覧） |
| `ADMIN_EMAILS` | var（デプロイ時） | 管理操作を許可するメール。`ADMIN_EMAILS=you@example.com npm run deploy` のように環境変数で渡すと `--var` で設定され、`keep_vars` により以後のデプロイでも保持（リポジトリには残さない） |
| `ADMIN_TOKEN` | secret | API から管理操作するためのトークン（`X-Admin-Token` ヘッダ） |

Google Cloud Console → API とサービス → 認証情報 → OAuth クライアント（Web アプリケーション）で
**承認済みのリダイレクト URI** に `https://tr-equity.0xkaz.com/auth/google/callback` を追加してください。

送信ドメイン `tr-equity.0xkaz.com` は Email Service に登録済み（ゾーン API
`POST /zones/{zone_id}/email/sending/subdomains` で追加。MX/SPF/DKIM/DMARC は自動追加）。
別ドメインで使う場合はダッシュボード → Compute → Email Service → Email Sending → Onboard Domain か同 API で登録し、
`wrangler.jsonc` の `send_email.allowed_sender_addresses` と `EMAIL_FROM` を合わせてください。

## 管理者アラート（定期更新の監視）

Cron の各実行のあとに D1 の状態を確認し、問題があれば `ADMIN_EMAILS` 宛てにメールします（`src/alert.ts`）。同じ種類は 1 日 1 回まで。

| 種類 | 条件 |
| --- | --- |
| データ取得エラー | 直近 12 時間に取得失敗した銘柄が全体の 20% 以上（`ALERT_ERROR_RATIO` で変更可、最低 3 件） |
| データ停滞 | 最新のマーケットデータが 7 日より古い（`ALERT_STALE_DAYS` で変更可。長期休場で一度届くことがあります） |
| 更新処理の失敗 | 定期更新の処理自体が例外で停止した |

- `POST /api/admin/health-check` 現在の判定結果を返す（送信しない）。`?send=1` で送信も行う。
- `POST /api/admin/alert-test` 管理者宛てにテスト通知を送る。
- 送信履歴は状態ページのジョブ履歴に `alert:<種類>` として残ります。

## 開発・デプロイ

```bash
npm install
npm run typecheck
npm run db:migrate:local
npm run dev            # ローカル (wrangler dev)
npm run deploy         # マイグレーション適用 → wrangler deploy
```

認証: `CLOUDFLARE_API_TOKEN`（Workers Scripts / D1 / Zone DNS の編集権限）と `CLOUDFLARE_ACCOUNT_ID`。
Claude のクラウド開発環境では API 資格情報（Bearer, api.cloudflare.com）がプロキシで注入されるため、
`scripts/deploy.sh` はダミー値を設定して wrangler のトークン認証パスを通しています。
※ Workers Static Assets のアップロードは JWT 認証のためこの環境では使えず、静的ファイルは
`scripts/embed-static.mjs` で Worker にバンドルしています。
※ ローカルの `wrangler dev`（workerd）は環境のプロキシを経由しないため、クラウド開発環境では Yahoo への取得が 403 になります。
本番 Worker では問題ありません。

管理トークン（手動更新用）:

```bash
openssl rand -hex 24 | npx wrangler secret put ADMIN_TOKEN
```

ダッシュボードの「状態」ページで保存すると、そのブラウザから管理操作ができます。

## Workers AI コメント

`ai` バインディング（モデル `@cf/meta/llama-3.3-70b-instruct-fp8-fast`）で、スナップショット作成後に
1. 市場全体の日本語コメント（地合い・注目の動き・確認点、約 500 字）
2. 注目銘柄（52 週高値更新・ブレイク・ゴールデンクロス・出来高急増・売られすぎ・ウォッチ中など、最大 8 銘柄）への 2〜3 文のコメント

を生成し、概況ページ・銘柄ページ・通知メールに表示します。入力は計算済みの数値だけで、ニュース等は含みません。
再生成は状態ページの「AIコメント再生成」または `POST /api/admin/ai`。

## ブレッドス履歴

`breadth_daily` に日次のブレッドス（上昇/下落数、20/50/200 日線上の銘柄数、52 週高安更新数、指数終値）を保存し、
概況ページの推移チャートに使います。稼働初日に `POST /api/admin/breadth-backfill?days=260` で保存済み株価から過去分を再構成します。
以降は毎日のスナップショット作成時に 1 行ずつ追加されます。

## 初期データ投入

デプロイ直後は `POST /api/admin/refresh?limit=15` を残り stale が 0 になるまで繰り返すと、
2年分の日足と指標・ファンダメンタルが揃います（Cron でも自動的に埋まります）。

## 免責
Yahoo Finance の遅延データに基づく参考情報です。投資判断は自己責任でお願いします。

## ウォッチリストの条件（アラート）

★ を付けた銘柄ごとに、銘柄ページで条件を設定できます（すべて任意、空欄で解除）。

- 配当利回り X% 以上 / 株価 Y 以下 / 株価 Z 以上 / PER W 倍以下（配当利回りと PER は Yahoo のファンダメンタルズ、株価は直近終値）
- 毎営業日の確定処理で判定し、**新たに条件を満たした日だけ**、通知を有効にしているユーザーの日次メールの先頭に「設定した条件に到達」として載せます（件名に「条件到達 N 件」）。
  `user_watchlist.alert_state` に前回満たしていた条件を保存。保存時点ですでに満たしている条件はメールしません。送信に失敗した日は状態を更新せず、次回に再度通知します。
- ウォッチリストと銘柄ページでは、各条件の到達状況（✓）をその場で表示します。判定ロジックは `src/alerts.ts`、マイグレーションは `migrations/0003_watch_alerts.sql`。
