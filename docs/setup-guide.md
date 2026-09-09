# OpenGreenTrack セットアップガイド

このガイドは、OpenGreenTrack をはじめて動かす人向けの手順書です。

セットアップ方法は 2 つあります。まず試すだけなら **A. ローカルで動かす**、チーム利用や本番運用なら **B. クラウドで運用する** を選びます。

## このファイルの開き方

このファイルは `.md` という形式の文章ファイルです。GitHub 上では、通常のWebページのように表示されます。

おすすめの読み方:

| 状況 | 開き方 |
|---|---|
| GitHub で見ている | `docs/setup-guide.md` をクリックして、そのままブラウザで読む |
| PC にダウンロード済み | リポジトリフォルダ内の `docs` → `setup-guide.md` を開く |
| VS Code を使っている | `docs/setup-guide.md` を開き、右上のプレビューアイコンを押す |
| メモ帳で開いたら読みにくい | GitHub 上で読むか、VS Code のプレビューで読む |

PC のファイルとして開く場合:

- macOS: `docs/setup-guide.md` をダブルクリックします。読みにくい場合は VS Code で開いてください。
- Windows: `docs\setup-guide.md` をダブルクリックします。メモ帳で読みにくい場合は VS Code で開いてください。

## このガイドの使い方

| 読む順番 | 読む場所 | 目的 |
|---:|---|---|
| 1 | **0. まず選ぶ** | ローカル方式かクラウド方式かを決める |
| 2 | **1. 共通の準備** | Git / Node.js / ファイル取得を済ませる |
| 3-A | **2-A. ローカルで動かす** | Docker を使って自分の PC だけで試す |
| 3-B | **2-B. クラウドで運用する** | Supabase のクラウドプロジェクトにつなぐ |
| 4 | **3. よくあるつまずき** | エラーが出たときに確認する |

> 迷った場合は、最初に **B. クラウドで運用する** を選ぶと Docker が不要なので進めやすいです。

| 経路 | 向いている人 | Supabase アカウント | 費用 | 主なコマンド |
|---|---|---:|---:|---|
| A. ローカルで動かす | まず手元で試したい人、開発者 | 不要 | 無料 | `npx supabase start` → `npm run db:reset:demo` → `npm run dev` |
| B. クラウドで運用する | チームで共有したい人、本番利用したい人 | 必要 | 無料枠から開始可能 | `npx supabase link --project-ref xxx` → `npx supabase db push --include-seed` → `npm run dev` |

---

## 事前に知っておくこと

- OpenGreenTrack は **Next.js アプリ** と **Supabase** で動きます。
- Supabase は、ログイン機能、データベース、ファイル保存場所をまとめて提供するサービスです。
- `.env.local` は接続先やキーを書くための個人用設定ファイルです。秘密情報を含むため、GitHub にコミットしてはいけません。
- `SUPABASE_SERVICE_ROLE_KEY` は管理者権限キーです。ブラウザ側のコードや `NEXT_PUBLIC_` の環境変数に入れてはいけません。

## 0. まず選ぶ

会社 PC の制限によって、使える経路が変わります。

| 質問 | はい | いいえ |
|---|---|---|
| Docker Desktop をインストールできますか？ | **A. ローカルで動かす** に進めます | **B. クラウドで運用する** を選びます |
| 管理者権限でアプリを入れられますか？ | Git / Node.js / Docker を通常手順で入れられます | 情報システム担当者に相談するか、クラウド方式を選びます |
| Supabase アカウントを作れますか？ | クラウド方式を使えます | ローカル方式を使います。ただし Docker が必要です |

選んだら、次の **1. 共通の準備** に進んでください。

## 1. 共通の準備

この章のゴールは、OpenGreenTrack のファイルを取得し、アプリを動かすための基本ツールをそろえることです。

| 順番 | 作業 | 完了の目安 |
|---:|---|---|
| 1 | ターミナルを開く | コマンドを入力できる画面が開いている |
| 2 | Git を確認する | `git --version` でバージョンが表示される |
| 3 | Node.js / npm を確認する | `node -v` と `npm -v` で数字が表示される |
| 4 | リポジトリを取得する | `package.json`、`src`、`supabase` が見える |
| 5 | パッケージを入れる | `npm install` がエラーなく終わる |

### 1. ターミナルを開く

このガイドでは、黒い画面や白い画面に文字を入力して操作します。この画面を **ターミナル** と呼びます。

macOS の場合:

1. 画面右上の検索、または `command + space` を押します。
2. `Terminal` または `ターミナル` と入力します。
3. 表示された **ターミナル** アプリを開きます。

Windows の場合:

1. 画面下のスタートメニューを開きます。
2. `PowerShell` または `Terminal` と入力します。
3. **Windows PowerShell** または **Windows Terminal** を開きます。

コマンドの入力方法:

- このガイドの灰色の枠にある文字をコピーして、ターミナルに貼り付けます。
- 貼り付けたら `Enter` キーを押します。
- 先頭に `$` や `>` が表示されていても、それは入力しません。
- `Do you want to continue?` のように聞かれたら、内容を確認して `y` を入力し、`Enter` を押します。

### 2. Git を用意する

Git は、GitHub から OpenGreenTrack のファイル一式を取得するための道具です。

まず確認します。

```bash
git --version
```

`git version ...` のように表示されれば OK です。

<details>
<summary>Git が入っていない場合だけ開く</summary>

macOS で Git が入っていない場合:

1. `git --version` を実行したときに「コマンドライン開発者ツールをインストールしますか？」のような画面が出たら、インストールを選びます。
2. インストール後、ターミナルを開き直します。
3. もう一度 `git --version` を実行します。

Windows で Git が入っていない場合:

1. [Git for Windows](https://git-scm.com/download/win) を開きます。
2. インストーラをダウンロードして実行します。
3. 途中の選択肢は、基本的に初期設定のままで進めます。
4. インストール後、PowerShell または Windows Terminal を開き直します。
5. もう一度 `git --version` を実行します。

Git をインストールできない場合:

- GitHub の **Code** → **Download ZIP** から ZIP ファイルをダウンロードして、展開したフォルダで作業する方法もあります。
- ただし、今後の更新を取り込むには Git の方が安全です。会社 PC で Git を入れられない場合は、情報システム担当者に相談してください。

</details>

### 3. Node.js を用意する

このプロジェクトは Node.js 24 以上を前提にしています。

```bash
node -v
npm -v
```

`node -v` で `v24.x.x` 以上が表示され、`npm -v` でも数字が表示されれば OK です。

<details>
<summary>Node.js が入っていない場合だけ開く</summary>

Node.js が入っていない場合:

1. [Node.js 公式サイト](https://nodejs.org/) を開きます。
2. Node.js 24 以上のインストーラをダウンロードします。
3. macOS は `.pkg`、Windows は `.msi` のインストーラを実行します。
4. インストール後、ターミナルを開き直します。
5. もう一度 `node -v` と `npm -v` を実行します。

`node` は使えるのに `npm` が使えない場合は、Node.js のインストールが不完全な可能性があります。Node.js を入れ直してください。

</details>

### 4. リポジトリを取得する

GitHub のリポジトリ画面で **Code** ボタンを押し、**HTTPS** の URL をコピーします。その URL を `<リポジトリURL>` の部分に入れてください。

```bash
git clone <リポジトリURL>
cd OpenGreenTrack
```

`cd` は「このフォルダに移動する」という意味です。以降のコマンドは、必ず `OpenGreenTrack` フォルダの中で実行してください。

<details>
<summary>Git を使わず ZIP で取得した場合だけ開く</summary>

ZIP でダウンロードした場合:

1. GitHub の **Code** → **Download ZIP** で ZIP ファイルをダウンロードします。
2. ZIP ファイルを展開します。
3. ターミナルで `cd ` と入力します。`cd` の後ろに半角スペースを入れてください。
4. 展開したフォルダをターミナルにドラッグ＆ドロップします。
5. `Enter` を押します。

</details>

今いる場所を確認する方法:

macOS / Linux:

```bash
pwd
ls
```

Windows:

```powershell
Get-Location
dir
```

`package.json`、`src`、`supabase` という名前が表示されれば、正しいフォルダにいます。

### 5. 必要なパッケージを入れる

```bash
npm install
```

`npm install` が成功すると、`node_modules` というフォルダが作られます。時間がかかることがありますが、エラーで止まらなければ OK です。

---

## 2-A. ローカルで動かす（推奨・まず試す人向け）

ローカル方式では、自分の PC の中に Supabase と同じ構成を Docker で起動します。Supabase アカウント登録は不要で、無料で試せます。

Docker を使えない PC ではローカル Supabase を起動できません。その場合は、この章を飛ばして **B. クラウドで運用する** の手順で進めてください。

この章のゴール:

| 作業 | 完了の目安 |
|---|---|
| Docker を起動する | `docker info` で情報が表示される |
| Supabase CLI を用意する | `supabase --version` または `npx supabase --version` が動く |
| ローカル Supabase を起動する | `npx supabase start` が成功する |
| `.env.local` を設定する | ローカル URL / anon key / service_role key が入っている |
| DB を作る | `npx supabase db reset`（デモデータも入れるなら `npm run db:reset:demo`）が成功する |
| アプリを起動する | [http://localhost:3000](http://localhost:3000) が開く |

### A-1. Docker を起動する

まず、Docker がすでに入っているか確認します。

macOS / Windows / Linux 共通:

```bash
docker --version
```

`Docker version ...` のように表示されれば、Docker は入っています。

次に、Docker アプリが起動しているか確認します。

```bash
docker info
```

情報が表示されれば OK です。`Cannot connect to the Docker daemon` のようなエラーが出る場合は、Docker アプリが起動していません。Docker Desktop を開き、画面上で **Docker Desktop is running** のような状態になるまで待ってから、もう一度実行してください。

#### Docker が入っていない場合

Docker が入っていない場合、選択肢は 2 つです。

| 選択肢 | 向いているケース | 対応 |
|---|---|---|
| Docker を入れてローカルで動かす | 自分の PC だけで無料検証したい | このまま A の手順を続ける |
| Docker を入れずクラウドで動かす | 会社 PC の制限で Docker を入れられない、管理者権限がない | **B. クラウドで運用する** へ進む |

<details>
<summary>Docker をインストールする場合だけ開く</summary>

macOS で Docker を入れる:

1. [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/) を開きます。
2. 自分の Mac に合うインストーラをダウンロードします。
   - Apple メニュー → **この Mac について** で `Apple` 系チップか `Intel` か確認できます。
3. ダウンロードした `Docker.dmg` を開き、Docker アイコンを Applications フォルダに移動します。
4. Applications から Docker を起動します。
5. 利用規約を確認し、Docker が起動完了するまで待ちます。

Windows で Docker を入れる:

1. [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) を開きます。
2. インストーラをダウンロードします。
3. `Docker Desktop Installer.exe` をダブルクリックして実行します。
4. 途中で **Use WSL 2 instead of Hyper-V** の選択肢が出た場合は、基本的には WSL 2 を選びます。
5. インストール完了後、Docker Desktop を起動します。
6. 再起動を求められた場合は、PC を再起動します。

Windows で WSL 2 や仮想化に関するエラーが出る場合は、PC 側の設定や会社のセキュリティ制限が関係していることがあります。その場合は情報システム担当者に相談するか、Docker 不要のクラウド方式を使ってください。

Linux で Docker を入れる:

- Docker Desktop または Docker Engine を使います。
- Linux はディストリビューションごとに手順が異なるため、[Docker Desktop for Linux](https://docs.docker.com/desktop/setup/install/linux/) または利用中ディストリビューション向けの Docker Engine 手順を確認してください。
- Linux 操作に不慣れな場合は、クラウド方式の方が迷いにくいです。

</details>

### A-2. Supabase CLI を用意する

Supabase CLI は、Supabase をターミナルから操作するための道具です。

#### macOS で Homebrew を使っている場合

```bash
brew install supabase/tap/supabase
```

確認:

```bash
supabase --version
```

> `npm run db:reset` などの npm scripts は `npx supabase` を呼びます。Homebrew 版と併用する場合は、`supabase --version` と `npx supabase --version` のメジャーバージョンを揃えてください（ローカルスタックを起動した CLI と `db reset` を実行する CLI の版がずれると動作が不安定になります）。

#### Windows / Linux / Homebrew を使わない macOS の場合

Node.js が入っていれば、`npx` で Supabase CLI を実行できます。

確認:

```bash
npx supabase --version
```

初回だけ、次のように聞かれることがあります。

```text
Need to install the following packages:
supabase@...
Ok to proceed? (y)
```

この場合は `y` を入力して `Enter` を押してください。

`npx` を使う場合、このガイドで `supabase` と書かれているコマンドは、先頭に `npx` を付けて実行してください。

例:

```bash
npx supabase start
npx supabase db reset
npx supabase status
```

クラウド方式でも同じです。

```bash
npx supabase login
npx supabase link --project-ref <Project Ref>
npx supabase db push
```

どちらを使うか迷った場合:

- macOS で Homebrew が分かる人: `supabase` コマンド
- Windows の人: `npx supabase ...`
- Linux の人: `npx supabase ...`
- Homebrew が分からない macOS の人: `npx supabase ...`

以降の説明では、読みやすくするため `supabase` と書きます。`npx` を使う人は `npx supabase` に読み替えてください。

### A-3. ローカル Supabase を起動する

```bash
supabase start
```

初回は Docker イメージをダウンロードするため、数分かかることがあります。

起動が成功すると、次のような値が表示されます。

```text
API URL: http://127.0.0.1:54321
Studio URL: http://127.0.0.1:54323
anon key: ...
service_role key: ...
```

閉じてしまった場合は、次のコマンドで再表示できます。

```bash
supabase status
```

### A-4. `.env.local` を作る

```bash
cp .env.example .env.local
```

`.env.local` を開き、ローカル Supabase の値に書き換えます。

`.env.local` を開く方法:

macOS:

```bash
open -e .env.local
```

Windows:

```powershell
notepad .env.local
```

VS Code を使っている場合:

```bash
code .env.local
```

`.env.local` は先頭に `.` が付くため、通常のファイル一覧に見えないことがあります。見つからない場合は、上のコマンドで開いてください。

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase start で表示された anon key>
SUPABASE_SERVICE_ROLE_KEY=<supabase start で表示された service_role key>
```

注意:

- `NEXT_PUBLIC_SUPABASE_URL` は `http://127.0.0.1:54321` です。
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` には `anon key` を入れます。
- `SUPABASE_SERVICE_ROLE_KEY` には `service_role key` を入れます。
- `.env.local` は絶対にコミットしません。

### A-5. データベースを作る

```bash
supabase db reset
```

このコマンドは、ローカル DB を作り直し、`supabase/migrations/` の SQL（テーブル定義などのスキーマ）と `supabase/seeds/production/` の公式排出係数マスタを順番に入れます。

ログインして画面を試すには、デモ組織・デモユーザー入りのデモデータ（`supabase/seeds/demo/demo.sql`）も必要です。次のどちらかで入れてください。

```bash
npm run db:reset:demo   # 上の db reset の代わりに実行: DB を作り直し、公式排出係数 + デモデータまで入れる
npm run db:seed:demo    # db reset 済みの DB に、デモデータだけを追加で入れる
```

デモデータを入れると、次のログイン情報が使えます（架空の会社「架空精密工業株式会社」の管理者。2023〜2026 年度のデータ入り）。

```text
メール: org-a@example.com
パスワード: password123
```

別組織の見え方を確認する場合（架空の会社「架空ロジスティクス株式会社」）:

```text
メール: org-b@example.com
パスワード: password123
```

デモデータを入れずに始める場合は、`supabase db reset` のあと A-6 でアプリを起動し、ログイン画面下部の **初期セットアップ** リンク（`/signup`）から自分の組織と管理者ユーザーを作成してください。

### A-6. アプリを起動する

```bash
npm run dev
```

ブラウザで開きます。

[http://localhost:3000](http://localhost:3000)

ログインでき、拠点管理やデータ入力画面まで進めればセットアップ完了です。

### A-7. Supabase Studio を確認する

Studio は、ローカル Supabase の管理画面です。

[http://127.0.0.1:54323](http://127.0.0.1:54323)

ここでテーブルや認証ユーザーを確認できます。

---

## 2-B. クラウドで運用する（チーム利用・本番向け）

クラウド方式では、supabase.com にプロジェクトを作り、OpenGreenTrack からそのプロジェクトへ接続します。MVP の配布形態である「ユーザーが git clone して自分の Supabase アカウントで動かす」場合はこちらです。

この章のゴール:

| 作業 | 完了の目安 |
|---|---|
| Supabase アカウントを作る | Dashboard にログインできる |
| Supabase プロジェクトを作る | Project Ref / API URL / API keys を確認できる |
| 本番向け設定を確認する | パスワードポリシーを確認済み |
| CLI でプロジェクトに接続する | `supabase link --project-ref ...` が成功する |
| DB に反映する | `supabase db push --include-seed` が成功する |
| `.env.local` を設定する | クラウド URL / anon key / service_role key が入っている |
| アプリを起動する | [http://localhost:3000](http://localhost:3000) が開く |

### B-1. Supabase アカウントを作る

[https://supabase.com](https://supabase.com) でアカウントを作成します。

無料枠から開始できます。チームや本番で使う場合は、利用量や運用方針に合わせてプランを選んでください。

### B-2. Supabase プロジェクトを作る

Supabase Dashboard で **New project** を選び、次の項目を設定します。

| 項目 | 入力例 | 補足 |
|---|---|---|
| Organization | 自社またはチーム名 | 既存 Organization があれば選択 |
| Project name | `opengreentrack` | 任意の名前で OK |
| Database Password | 強いパスワード | 後から必要になるため安全に保管 |
| Region | `Northeast Asia` など | 利用者に近い地域を選ぶ |
| Pricing plan | Free | まず検証する場合は無料枠で OK |

プロジェクト作成には数分かかることがあります。

スクリーンショットを追加する場合は、この手順に次の 2 枚があると迷いにくくなります。

- Supabase Dashboard の **New project** 画面
- Project Settings で Project Ref / API URL / API keys を確認する画面

### B-3. 本番向けのパスワードポリシーを設定する

`supabase/config.toml` の `minimum_password_length = 6` は、ローカル開発で試しやすくするための値です。本番・チーム利用では、より強いポリシーにしてください。

推奨:

- 最小文字数は **8 文字以上**、可能なら 12 文字以上
- 英字と数字を含める
- 可能であれば大文字、小文字、数字、記号の組み合わせを要求する
- デモ用の `password123` は本番では使わない

Supabase Dashboard の Auth 設定で、プロジェクトの運用方針に合わせて設定してください。

### B-3-2. Auth のレート制限を確認する

ログイン総当たり対策は Supabase Auth 側で設定します。ローカル Supabase では `supabase/config.toml` の `[auth.rate_limit]` に次の目安を入れています。

| 対象 | 推奨値 |
|---|---:|
| サインアップ・サインイン | `sign_in_sign_ups = 30`（5分あたり / IP） |
| トークン検証 | `token_verifications = 30`（5分あたり / IP） |
| セッション更新 | `token_refresh = 150`（5分あたり / IP） |

クラウドで本番運用する場合は、Supabase Dashboard の Auth rate limit 設定で同等以上に厳しい値になっているか確認してください。攻撃が多い環境では CAPTCHA の有効化も検討してください。

### B-3-3. 自己サインアップを無効にし、パスワード変更の再認証を有効にする

OpenGreenTrack は招待制です。最初の管理者は初期セットアップ画面（`/signup`）が、以降のメンバーは「設定 → メンバー管理」の招待が、どちらもサーバー側（service_role の管理 API）でユーザーを作成します。Supabase Auth 自体の「新規ユーザー登録」は使いません。

ところが Supabase プロジェクトの既定では誰でも anon key だけで自己登録できるため、そのままにしておくと次の問題があります。

- 招待していない人でも anon key（画面のソースから分かります）で `authenticated` セッションを取得できる（RLS が守っているとはいえ、余計な入口になる）
- 招待予定のメールアドレスを第三者が先に登録し、招待の受諾を妨げることができる

ローカル用の `supabase/config.toml` では次の値にしてあります。クラウドでは Dashboard の設定が使われるため、**同じ設定を手で行ってください**。

| `config.toml` | Dashboard での操作 |
|---|---|
| `[auth] enable_signup = false` | **Authentication → Sign In / Providers**（環境によっては **Providers** / **Settings**）の **Allow new users to sign up** を **オフ** にする |
| `[auth.email] secure_password_change = true` | **Authentication → Sign In / Providers → Email** の **Secure password change** を **オン** にする（盗まれたセッションだけではパスワードを差し替えられなくなる。アプリのパスワード変更・再設定はサーバー側で行うので影響しません） |

注意:

- **Email プロバイダ自体（Enable Email provider）は必ずオンのまま** にしてください。オフにすると新規登録だけでなく、既存ユーザーのメール / パスワードによるログインも「Email logins are disabled」で拒否されます。
- 管理 API によるユーザー作成（初期セットアップ・招待受諾）はこの設定の影響を受けません。設定後も `/signup`（初期セットアップ）と招待リンクからの登録は通常どおり使えます。
- **Confirm email** は、アプリが作るユーザーが作成時点で確認済みになる（管理 API の `email_confirm: true`）ため、オン / オフのどちらでもアプリの動作は変わりません。

### B-4. Supabase CLI にログインする

`npx` を使う人は、ここでも `supabase` を `npx supabase` に読み替えてください。

```bash
supabase login
```

ブラウザが開き、Supabase アカウントとの連携を求められます。

### B-5. Project Ref を確認する

Project Ref は Supabase プロジェクトを識別する ID です。

確認方法:

- Supabase Dashboard の URL が `https://supabase.com/dashboard/project/xxxxx` の場合、`xxxxx` が Project Ref です。
- Dashboard の Project Settings からも確認できます。

### B-6. ローカルのリポジトリとクラウドプロジェクトを紐付ける

`npx` を使う人は、`npx supabase link --project-ref <Project Ref>` と入力します。

```bash
supabase link --project-ref <Project Ref>
```

例:

```bash
supabase link --project-ref abcdefghijklmnop
```

### B-7. マイグレーションをクラウド DB に反映する

`npx` を使う人は、`npx supabase db push --include-seed` と入力します。

```bash
supabase db push --include-seed
```

このコマンドは、`supabase/migrations/` の SQL（テーブル定義などのスキーマ）をクラウドの Supabase DB に反映し、続けて `supabase/seeds/production/` の公式排出係数マスタを投入します。OpenGreenTrack の算定には公式排出係数が必要なため、**初回は `--include-seed` 付きで実行することを推奨します。**

`--include-seed` を付けない `supabase db push` は、マイグレーション（スキーマ）だけを反映します。公式排出係数を後から入れる方法は B-8 を参照してください。

注意:

- `supabase db push` はクラウドプロジェクトへ反映するためのコマンドです。
- `supabase db reset` はローカル DB を作り直すためのコマンドです。本番 DB に対して不用意に実行しないでください。
- 本番データが入った後にマイグレーションする場合は、事前にバックアップを確認してください。
- `--include-seed` で流れるのは、`supabase/config.toml` の `[db.seed] sql_paths` に書かれた `seeds/production/*.sql`（公式排出係数マスタ）だけです。デモデータ（`seeds/demo/`）は流れません。

CLI が使えない場合は、Supabase Dashboard の SQL Editor から SQL を実行する方法もあります。その場合は、`supabase/migrations/` の 4 ファイルをタイムスタンプ順（`…_schema.sql` → `…_rls.sql` → `…_rpc.sql` → `…_storage.sql`）に開いて上から順に実行し、続けて `supabase/seeds/production/official_emission_factors.sql` を実行します。抜け漏れや順番間違いを避けるため、基本は CLI の `supabase db push --include-seed` を推奨します。

### B-8. 初期データを入れる

初期データは 2 種類あり、置き場所と扱いが異なります（詳細は [`supabase/README.md`](../supabase/README.md)）。

| 種類 | ファイル | 本番プロジェクト | 入れ方 |
|---|---|---|---|
| 公式排出係数マスタ | `supabase/seeds/production/official_emission_factors.sql` | **入れる** | B-7 の `supabase db push --include-seed` で自動投入 |
| デモデータ（架空のデモ組織 2 社・デモユーザー・2023〜2026 年度のサンプル活動量） | `supabase/seeds/demo/demo.sql` | **入れない** | 検証用プロジェクトにだけ、下の手順で手動投入 |

#### 公式排出係数マスタ（本番でも投入する）

B-7 を `--include-seed` 付きで実行していれば、すでに入っています。付け忘れた場合は、もう一度 `supabase db push --include-seed` を実行してください（シードは冪等なので、繰り返し実行しても同じ結果になります）。CLI が使えない場合は、Supabase Dashboard の SQL Editor で `supabase/seeds/production/official_emission_factors.sql` の内容を実行します。手元に `psql` がある場合は、Dashboard の **Connect** で確認できる接続文字列を指定して `npm run db:seed:production -- --db-url "<接続文字列>"` でも投入できます。

ローカル Supabase では `supabase db reset` で自動投入されます。起動中のローカル DB に入れ直す場合は `npm run db:seed:production` を使います。

#### デモデータ（検証用プロジェクトのみ）

動作確認用のクラウドプロジェクトにデモデータを入れる場合は、次のどちらかの方法で `supabase/seeds/demo/demo.sql` を実行します。

- Supabase Dashboard の **SQL Editor** に、ファイルの内容を貼り付けて実行する（追加のツールが不要なので、こちらを推奨します）
- 手元に `psql` がある場合は、Dashboard の **Connect** で確認できる接続文字列を指定して次を実行する。リモート DB へのデモデータ投入は、誤って本番へ流すことを防ぐため `--force` を付けないと拒否されます

```bash
npm run db:seed:demo -- --db-url "<接続文字列>" --force
```

注意:

- **本番プロジェクトにはデモデータを投入しないでください。** デモユーザー（`org-a@example.com` / `password123` など）のパスワードはリポジトリで公開されています。
- 実データ運用では、初期セットアップ画面（B-10 の `/signup`）や管理者作成フローで正式な組織・ユーザーを作ってください。

### B-9. クラウド用の `.env.local` を設定する

```bash
cp .env.example .env.local
```

Supabase Dashboard の Project Settings から、API URL とキーをコピーします。

`.env.local` を開く方法:

macOS:

```bash
open -e .env.local
```

Windows:

```powershell
notepad .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://<Project Ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<Supabase Dashboard の anon key>
SUPABASE_SERVICE_ROLE_KEY=<Supabase Dashboard の service_role key>
```

キーの扱い:

- `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` はブラウザで使う公開値です。
- `SUPABASE_SERVICE_ROLE_KEY` は管理者権限キーです。サーバー側だけで使い、画面側のコードには絶対に出しません。
- `.env.local` は GitHub にコミットしません。

### B-10. アプリを起動する

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開きます。

ログイン画面が表示されます（組織が1件も無い状態では自動的にはセットアップ画面へ遷移しません）。ログイン画面下部の **初期セットアップ** リンクから `/signup` を開き、最初の組織・管理者ユーザーを作成してください。

- `/signup` は組織が0件のときだけ使えます。作成が終わると2回目以降は `/login` に戻されます。
- セットアップ完了時に、組織・管理者ユーザー・拠点に加えて「今日が属する算定年度」（4月始まり）が1件自動で作られます。算定年度の開始月を変えたい場合や別の年度を足したい場合は「設定 → 企業・メンバー設定 → 算定年度の管理」で調整してください。
- B-8 でデモデータ（`supabase/seeds/demo/demo.sql`）を投入済みの場合は組織が既に存在するため、`/signup` は使えません。そのまま `/login` からデモユーザーのログイン情報、または管理者作成フローで作成したアカウントでログインしてください（公式排出係数マスタだけでは組織は作られないので、`/signup` はそのまま使えます）。

ログイン後、データ入力画面まで進めればセットアップ完了です。

---

## 2-C. 招待メールの設定（任意）

「設定 → メンバー管理」からメンバーを招待すると、招待リンクが発行されます。
この設定をすると、発行と同時に招待メール（招待者名・組織名・サインアップリンク入り）が相手へ自動送信されます。

**設定しなくてもメンバー招待は使えます。** 未設定の場合は、発行された招待リンクをコピーして、メールやチャットで自分で相手に共有してください。

メール送信には [Resend](https://resend.com) を使います。

1. Resend のアカウントを作成し、送信元にするドメインを **Domains** から追加・認証します（DNS レコードの追加が必要です）。
2. **API Keys** から API キー（`re_` で始まる文字列）を作成します。
3. `.env.local` に次の2行を追加します。

```env
RESEND_API_KEY=<Resend の API キー>
INVITE_EMAIL_FROM="OpenGreenTrack <noreply@認証したドメイン>"
```

4. `npm run dev`（本番では `npm run start`）を再起動すると有効になります。

キーの扱い:

- `RESEND_API_KEY` と `INVITE_EMAIL_FROM` はサーバー側だけで使う秘密情報です。`NEXT_PUBLIC_` を付けたり、画面側のコードやコミットするファイルに書いたりしないでください。
- 2つのうちどちらかが欠けている場合、メール送信は行われません（招待リンクの共有で運用できます）。
- 送信に失敗した場合も招待自体は成立しており、画面に表示される招待リンクを共有すれば招待できます。失敗の詳細はサーバーのログに出力されます（ドメイン未認証・キー無効が典型的な原因です）。
- リバースプロキシ配下で運用する場合は、メール内リンクの URL を正しく保つため `.env.local` に `APP_URL`（例: `APP_URL=https://ghg.example.com`）の設定を推奨します。

---

## 2-D. 本番運用時のセキュリティヘッダ

OpenGreenTrack は Next.js 側でセキュリティレスポンスヘッダを返し、CSP Report-Only の違反はサーバーログ（`[csp-report]`）に記録します。リバースプロキシや CDN 側でも同名ヘッダを設定する場合は、値が重複・矛盾しないよう片側を正本にしてください。

**HSTS（`Strict-Transport-Security`）** は本番ビルドのときだけ返します。既定値は `max-age=63072000`（2年）で、`includeSubDomains` は付けません。

| 環境変数 | 既定値 | 説明 |
|---|---|---|
| `HSTS_MAX_AGE` | `63072000` | 秒数。`0` を指定するとヘッダ自体を返しません |
| `HSTS_INCLUDE_SUBDOMAINS` | （無効） | `true` のときだけ `includeSubDomains` を付けます |

> ⚠️ `includeSubDomains` は、apex ドメイン（例: `example.com`）で配信している場合に**すべての兄弟サブドメイン**（社内ツールや HTTP のみの旧システムを含む）を `max-age` の期間 HTTPS 固定にします。この状態は各利用者のブラウザに保存されるため、サーバからヘッダを外しても即座には戻せません。全サブドメインが HTTPS 化済みであることを確認してから有効にしてください。
>
> 同様に、まず短い `max-age`（例: `HSTS_MAX_AGE=300`）で動作確認してから既定値へ引き上げる運用を推奨します。

**CSP の違反レポート送信先** は `APP_URL` から組み立てます。

- `APP_URL` 未設定でも、同一オリジンの `report-uri /api/csp-report` で受け取れます。
- `APP_URL` を設定し、かつ利用者が実際にアクセスするオリジンと一致する場合のみ、`Reporting-Endpoints`（Chrome などの Reporting API 経由）も併用します。オリジンが食い違うとレポート送信がクロスオリジンになり届かなくなるため、その場合は自動的に `report-uri` だけに切り替わります。
- `APP_URL` にパス（例: `https://example.com/ghg`）を含めた場合は、そのパスを保った送信先になります。
- レポート受信エンドポイント `/api/csp-report` は未ログインでも到達できる必要があるため認証の対象外です。代わりに本文サイズ（64KB）・1リクエストあたりの件数（20件）・送信元ごとと全体のレート制限（各 1 分あたり 30 件 / 1000 件）で保護しています。

> これらのヘッダは実行時の環境変数から組み立てます（`next build` 時の値には固定されません）。ビルド成果物を staging と本番で使い回す構成でも、起動時の `.env` の値が反映されます。
>
> ただし CSP の `connect-src` などに載る Supabase のオリジンだけは例外で、`NEXT_PUBLIC_` 付きの環境変数が Next.js の仕様上ビルド時にコードへ埋め込まれるため、ビルド時の `NEXT_PUBLIC_SUPABASE_URL` の値になります。これはアプリ本体が実際に接続する先と同じ値なので不整合は起きませんが、**ビルドの時点で本番の `NEXT_PUBLIC_SUPABASE_URL` を渡す必要があります**（プレースホルダーでビルドした成果物は、CSP 以前にアプリ自体が正しい Supabase に接続できません）。

---

## 2-E. 本番運用時のリクエスト制限

OpenGreenTrack のアプリ側では、重い認証済みAPIに DB ベースの制限を入れています。

| API | アプリ側の制限 | `Retry-After` |
|---|---|---:|
| `POST /api/calculations` | 組織あたり同時1件 | 30秒 |
| `POST /api/calculations` | 1分あたり10件 | 60秒 |

制限に達した場合は HTTP `429` と `Retry-After` ヘッダーを返します。「1分あたり」の制限は時間で必ず解けるため `Retry-After` は窓幅（60秒）と一致しますが、「同時N件」の制限は先行バッチの完了で解けるため、処理の実時間の目安を返しています。

データ入力画面の保存・編集後の自動算定は、`429` を受け取ると `Retry-After` の経過後に自動で再試行します（待機中に保存した分もまとめて再計算します）。画面を閉じるなどで再試行できなかった分は、入力履歴に「未算定 N 件」として表示され、「未算定分を再計算」ボタンから手動で再計算できます。

同時実行の判定には時間の上限（算定は開始から10分）を設けています。サーバ停止などで `pending` のまま残った行が、組織全体の実行を恒久的にブロックしないようにするためです。

リバースプロキシや CDN を置く本番環境では、アプリに届く前の入口でも同じAPIを対象に IP 単位の制限を設定してください。目安は `POST /api/calculations` をアプリ側の上限（1分あたり10件）と矛盾しない値にし、`/login` や Supabase Auth の認証エンドポイントは Supabase Auth の rate limit と矛盾しない値にします。上の `2-D` でプロキシ側にもヘッダを置く場合と同様、アプリ側と入口側で値が矛盾しないようにしてください。

---

## 2-F. IDEAデータベース取込（Scope3積上げ算定）のデプロイ前提

係数管理画面の「IDEAデータベース」取込（`POST /api/idea-imports`）は、利用者が SuMPO とライセンス契約して入手した IDEA の Excel ファイル（**数十MBになり得ます**）をそのままアップロードします。このため次の前提があります（`docs/idea-scope3-spec.md` §4.1）:

- **リクエストボディ制限のあるホスティングでは動きません。** 例えば Vercel の Serverless Functions はボディ 4.5MB 制限があるため、この API だけ確実に失敗します。**セルフホスト（またはボディ制限を十分大きく設定できる環境）を前提**にしてください。
- リバースプロキシ（nginx 等）を置く場合は、`/api/idea-imports` への `client_max_body_size`（または相当の設定）を **50MB 以上**にしてください。アプリ側の上限は 50MB です。
- xlsx の展開はメモリ上で行われ、**ファイルサイズの数十倍のヒープ**を一時的に使います（10,300行 × 約300列・13.7MBのダミーファイルで約1.3GBを実測）。Node プロセスに十分なメモリ（目安 2GB 以上、必要に応じて `NODE_OPTIONS=--max-old-space-size=4096`）を確保してください。

---

## 2-G. バックアップとリストア（誤削除からの復旧）

OpenGreenTrack の削除操作は、すべて**物理削除**です。特に拠点を削除すると、その拠点に紐づく活動量データ（`activity_records`）や算定結果（`emission_results`）まで連鎖して削除されます。アプリ内にゴミ箱や復元機能はありません。

GHG 排出量の算定結果は対外報告（SSBJ 等）の根拠になるため、誤削除に備えて**必ずバックアップを運用してください**。この章では、次の 4 つを説明します。

| 節 | 内容 |
|---|---|
| G-1 | Supabase クラウド利用時: 自動バックアップと PITR |
| G-2 | セルフバックアップ: DB の取得方法・頻度・保持期間 |
| G-3 | リストア: 全体復旧と、誤削除した行だけ戻す部分復旧 |
| G-4 | リストア検証: 定期的な復元テスト |

### G-1. Supabase クラウドを利用している場合

Supabase のクラウドプロジェクト（2-B の構成）では、プラットフォーム側のバックアップ機能を利用できます。

| 機能 | 概要 | 利用条件 |
|---|---|---|
| 自動バックアップ | 日次でデータベース全体をバックアップ。Dashboard の **Database → Backups** から一覧・復元 | Pro プラン以上（保持期間はプランによる） |
| PITR（Point-in-Time Recovery） | 任意の時点（分単位）へ巻き戻せる。誤削除の「直前」に戻せるため復旧に最も有効 | Pro プラン以上のアドオン。**Database → Backups** から有効化 |

運用の推奨:

- 本番運用では Pro プラン以上にして、**PITR の有効化を推奨**します。誤削除に気づいた時刻の直前へ戻せます。
- **無料（Free）プランには自動バックアップがありません。** 無料枠で実データを扱う場合は、G-2 のセルフバックアップを必ず定期実行してください。
- OpenGreenTrack はファイルを保存しない（Supabase Storage を使わない）ため、バックアップの対象はデータベースだけです。

> ⚠️ Dashboard からの復元は**プロジェクト全体**をその時点へ巻き戻します。誤削除の後に入力された正しいデータも失われます。「消してしまった数行だけ戻したい」場合は、本番を直接巻き戻すのではなく **G-3 の部分復旧**の手順を使ってください。

### G-2. セルフバックアップ（DB）

セルフホスト運用や無料プランでは、自分でバックアップを取得します。クラウドプランでも、Supabase の外に独自のバックアップを持っておくと、プラン変更やプロジェクト削除などの事故にも備えられます。

#### データベースのバックアップ

`supabase link` 済み（2-B の構成）なら、Supabase CLI でダンプを取得できます。`npx` を使う人は `npx supabase ...` に読み替えてください。

```bash
# スキーマ（テーブル定義など）
supabase db dump -f backup_schema.sql

# データ本体
supabase db dump -f backup_data.sql --data-only
```

または、PostgreSQL 標準の `pg_dump` を直接使います。接続文字列は Supabase Dashboard の **Project Settings → Database** で確認できます（セルフホスト時は自環境の接続情報）。

```bash
pg_dump "<接続文字列>" --format=custom --file=opengreentrack_backup.dump
```

- ファイル名には日付を入れて管理してください（例: `opengreentrack_20260810.dump`）。
- `--format=custom` 形式は `pg_restore` で復元でき、テーブル単位の取り出し（部分復旧）がしやすいためおすすめです。

#### 推奨頻度と保持期間

| 対象 | 頻度 | 保持期間の目安 |
|---|---|---|
| DB（日次バックアップ） | 毎日 | 30 日以上 |
| DB（月次バックアップ） | 毎月 | 1 年以上（報告年度の算定根拠として年度分を保持） |

- バックアップは、アプリが動いている環境とは**別の場所**（別のマシン・別のクラウドストレージ）に保管してください。
- バックアップファイルには**全組織のデータが含まれます**。`SUPABASE_SERVICE_ROLE_KEY` と同様に厳重に管理し、アクセスできる人を限定してください。

### G-3. リストア

#### 全体復旧（DB をまるごと戻す）

新しい（空の）データベースに対して復元します。

```bash
# custom 形式（pg_dump --format=custom）の場合
pg_restore --dbname="<接続文字列>" --clean --if-exists opengreentrack_backup.dump

# プレーン SQL（supabase db dump）の場合
psql "<接続文字列>" -f backup_schema.sql
psql "<接続文字列>" -f backup_data.sql
```

- ダンプにはスキーマも含まれるため、`supabase db push`（マイグレーション適用）と**混在させない**でください。空の DB へ「ダンプだけ」で戻すのが基本です。

#### 部分復旧（誤削除した行だけ戻す）

本番全体を巻き戻さずに、消してしまった行だけを戻す手順です。**本番とは別の環境**にバックアップを復元し、必要な行を抽出して本番へ INSERT します。

1. **別環境を用意してリストアする**

   ローカル Supabase（2-A の構成）を復旧作業用の別環境として使えます。`supabase start` で起動した後、ローカル DB（ポート `54322`）へバックアップを復元します。

   ```bash
   pg_restore --dbname="postgresql://postgres:postgres@127.0.0.1:54322/postgres" --clean --if-exists opengreentrack_backup.dump
   ```

2. **削除された行を抽出する**

   復元した別環境で、対象組織・対象データの行を CSV に書き出します（例: 削除してしまった拠点とその活動量データ）。

   ```bash
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
     -c "\copy (select * from locations where id = '<削除した拠点のID>') to 'restore_locations.csv' with csv header"
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
     -c "\copy (select * from activity_records where \"locationId\" = '<削除した拠点のID>') to 'restore_activity_records.csv' with csv header"
   ```

   OpenGreenTrack のカラム名は `"locationId"` のような**大文字混じり（camelCase）**のため、SQL 中では必ず二重引用符で囲みます（囲まないと `column "location_id" does not exist` エラーになります）。上の例のようにコマンド全体を二重引用符で囲んでいる場合は、カラム名の二重引用符を `\"locationId\"` とエスケープしてください。他のテーブル（`emission_results` など）を抽出する場合も同様です。

3. **本番へ INSERT する**

   抽出した行を本番 DB へ投入します。外部キーの制約があるため、**親テーブルから順に**戻します（例: `organizations` → `fiscal_years` → `locations` → `activity_records` → `emission_results`）。

   ```bash
   psql "<本番の接続文字列>" \
     -c "\copy locations from 'restore_locations.csv' with csv header"
   psql "<本番の接続文字列>" \
     -c "\copy activity_records from 'restore_activity_records.csv' with csv header"
   ```

注意:

- **RLS（行レベルセキュリティ）の回避が必要です。** OpenGreenTrack の各テーブルは RLS で保護されており、アプリが使う anon キーの接続では他ユーザー・他組織の行を書き込めません。復旧作業は、RLS の対象外となる接続 — Supabase Dashboard の **SQL Editor**、`postgres` ユーザーでの直接 DB 接続、または `SUPABASE_SERVICE_ROLE_KEY` を使ったサーバー側接続 — で行ってください。service_role キーの扱いは 2-B の注意（画面側に出さない・コミットしない）と同じです。
- 復元する行の `id` が本番の既存データと**重複しないか**を事前に確認してください。
- 拠点削除のように連鎖削除（cascade）で消えたデータは、子テーブル（`activity_records` / `emission_results` など）の行も忘れずに戻してください。
- 作業前に、**現時点の本番のバックアップ**をもう 1 つ取得してから始めると、INSERT を誤った場合もやり直せます。

### G-4. リストア検証（定期的な復元テスト）

バックアップは「復元できること」を確認して初めて意味を持ちます。次の運用を推奨します。

- **四半期に 1 回程度**、実際のバックアップファイルを別環境（ローカル Supabase など）へ復元するテストを行う
- 復元後、アプリをその環境に向けて起動し、ログイン → データ入力画面 → ダッシュボードの表示まで確認する
- 復元にかかった時間と手順のメモを残し、実際の障害時に参照できるようにする

### 今後の拡張（論理削除）

現時点の OpenGreenTrack には論理削除（`deletedAt` フラグ）やゴミ箱・復元 UI がなく、誤削除への備えは本章のバックアップ運用が正となります。論理削除の導入は、RLS ポリシーと全画面のクエリへ影響が広いため、監査ログ（「誰がいつ削除したか」の記録）と設計をセットにして将来のバージョンで検討します。

---

## 3. よくあるつまずき

まずは、今出ている症状に近いものを探してください。

| 症状 | 見る場所 |
|---|---|
| どのフォルダで操作するかわからない | 「どのフォルダでコマンドを実行すればよいかわからない」 |
| `git` / `node` / `npm` が見つからない | 「`git`、`node`、`npm` が見つからない」 |
| `supabase` が見つからない | 「`supabase` コマンドが見つからない」 |
| `supabase start` が失敗する | 「`supabase start` が失敗する」 |
| `.env.local` が見つからない | 「`.env.local` が見つからない、開けない」 |
| `localhost:3000` が開かない | 「`npm run dev` で `localhost:3000` が開けない」 |
| ログインできない | 「ログインできない」 |
| `/signup` を開いてもログイン画面に戻される | 「`/signup` を開いてもログイン画面に戻される」 |

### どのフォルダでコマンドを実行すればよいかわからない

`OpenGreenTrack` フォルダの中で実行します。

確認:

macOS / Linux:

```bash
pwd
ls
```

Windows:

```powershell
Get-Location
dir
```

`package.json`、`src`、`supabase` が見えれば正しい場所です。

### `git`、`node`、`npm` が見つからない

次のような表示が出る場合は、必要な道具が入っていません。

```text
command not found
is not recognized as the name of a cmdlet
```

対応:

- `git` が見つからない: このガイドの「Git を用意する」に戻ります。
- `node` / `npm` が見つからない: このガイドの「Node.js を用意する」に戻ります。
- インストール後も同じエラーが出る: ターミナルを閉じて、もう一度開き直します。

### `supabase` コマンドが見つからない

Homebrew で入れていない場合は、`supabase` の代わりに `npx supabase` と入力します。

例:

```bash
npx supabase start
npx supabase db reset
```

初回に `Ok to proceed?` と聞かれたら、`y` を入力して `Enter` を押します。

### `supabase start` が失敗する

Docker が起動しているか確認してください。

```bash
docker --version
```

Docker が起動していても失敗する場合は、ポート `54321`、`54322`、`54323` が他のアプリで使われていないか確認します。

Docker をインストールできない環境では、ローカル方式ではなくクラウド方式を使います。クラウド方式なら Docker は不要です。

### `.env.local` が見つからない、開けない

`.env.local` は先頭に `.` が付く隠しファイルです。ファイル一覧に見えないことがあります。

macOS:

```bash
open -e .env.local
```

Windows:

```powershell
notepad .env.local
```

それでも開けない場合は、先に次のコマンドを実行してファイルを作ってください。

```bash
cp .env.example .env.local
```

### `npm run dev` で `localhost:3000` が開けない

まず、ターミナルにエラーが出ていないか確認してください。

よくある原因:

- `.env.local` の値が間違っている
- `npm install` が完了していない
- すでに別のアプリが `3000` 番ポートを使っている

このプロジェクトでは開発サーバーは [http://localhost:3000](http://localhost:3000) を使います。別のアプリが使っている場合は、そのアプリを停止してから、もう一度 `npm run dev` を実行してください。

### ログインできない

次を確認してください。

- `.env.local` の URL とキーが正しい
- `supabase db reset` または `supabase db push` が完了している
- ローカルの場合はデモデータを投入済みで（`npm run db:reset:demo` または `npm run db:seed:demo`）、`org-a@example.com / password123` のようなデモユーザーが入っている。`supabase db reset` だけではデモユーザーは入りません
- クラウドの場合は Auth のユーザーが作成されている

### `/signup` を開いてもログイン画面に戻される

`/signup`（初期セットアップ画面）は、組織が1件も存在しないときだけ開ける画面です。すでにログイン画面へ戻される場合は、次のいずれかが理由です。

- すでに初期セットアップが完了していて、組織が作成済みである
- デモデータ（`supabase/seeds/demo/demo.sql`）を投入済みで、デモ組織（`org-a` / `org-b`）が存在する（ローカルなら `npm run db:reset:demo` / `npm run db:seed:demo`、クラウドなら B-8）

この場合は `/signup` ではなく `/login` から、作成済みのアカウント（デモユーザー、または初期セットアップで作った管理者アカウント）でログインしてください。

#### ローカルで初期セットアップ画面を試したい場合

開発中に `/signup` の動作を確認したいときは、`.env.local` に次の1行を足して `npm run dev` を再起動します。

```env
ALLOW_SETUP_WHEN_COMPLETED=true
```

シードのデモ組織を残したまま `/signup` が開けるようになり、新しい組織と管理者アカウントを追加で作成できます。

- 既にログイン中だと `/signup` は `/dashboard` へリダイレクトされます。先にログアウトしてください。
- 作成したアカウントは、シードのデモ組織とは**別の組織**に所属します（データは共有されません）。
- このフラグは本番ビルド（`NODE_ENV=production`）では値に関わらず必ず無効になります。本番環境で初期セットアップをやり直す用途には使えません。

#### 「セットアップ状態を確認できませんでした」と表示される

`/signup` を開いたとき、ログイン画面にこのメッセージが出る場合は、**組織の有無を判定するためのデータベース接続自体に失敗しています**。「セットアップ済み」とは別の状態で、環境側の設定を直す必要があります。

主な原因:

- `.env.local` の `SUPABASE_SERVICE_ROLE_KEY` が未設定、または値が間違っている
- `NEXT_PUBLIC_SUPABASE_URL` が間違っている（ローカルなら `http://127.0.0.1:54321`）
- ローカル Supabase が起動していない（`supabase status` で確認）
- マイグレーション未適用で `organizations` テーブルが存在しない（`supabase db reset` または `supabase db push`）

原因の詳細は**アプリを起動したターミナルのログ**に `初期セットアップ状態の判定に失敗しました` として出力されています。そちらを確認してください。

### `SUPABASE_SERVICE_ROLE_KEY` をどこに入れるかわからない

`.env.local` にだけ入れます。

```env
SUPABASE_SERVICE_ROLE_KEY=...
```

`NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` のような名前にしてはいけません。`NEXT_PUBLIC_` が付くとブラウザへ公開されるため危険です。

### `supabase db push` と `supabase db reset` の違いがわからない

| コマンド | 主な用途 | 使う場所 |
|---|---|---|
| `supabase db reset` | ローカル DB を作り直して migrations と公式排出係数マスタ（`seeds/production/`）を入れる | ローカル開発 |
| `npm run db:reset:demo` | 上に加えてデモデータ（`seeds/demo/`）も入れる | ローカル開発 |
| `npm run db:seed:demo` | 起動中のローカル DB にデモデータだけを追加する | ローカル開発 |
| `supabase db push` | 紐付け済みのクラウド DB に migrations を反映する | クラウド運用 |
| `supabase db push --include-seed` | 上に加えて公式排出係数マスタ（`seeds/production/`）も投入する | クラウド運用（初回推奨） |
| `npm run db:seed:production -- --db-url "<接続文字列>"` | 任意の DB（クラウド / 自前ホスト）に公式排出係数マスタを投入する（手元の `psql` を使う。B-8） | クラウド運用 / 自前ホスト |
| `npm run db:seed:demo -- --db-url "<接続文字列>" --force` | 検証用のクラウドプロジェクトにデモデータを投入する（`--force` 必須。本番プロジェクトでは使わない。B-8） | クラウド検証 |

まず試すだけなら、`npm run db:reset:demo` を使います。クラウドのプロジェクトへ反映する場合は、`supabase db push --include-seed` を使います。デモデータは本番プロジェクトには入れません。

---

## 4. 完了チェックリスト

最後に、選んだ経路のチェックリストだけ確認してください。全部チェックできればセットアップ完了です。

ローカルで動かす場合:

- [ ] Git が使える
- [ ] Node.js 24 以上と npm が使える
- [ ] Docker が起動している
- [ ] `supabase start` が成功している
- [ ] `.env.local` にローカルの URL / anon key / service_role key を入れた
- [ ] `supabase db reset` が成功している（デモデータでログインするなら `npm run db:reset:demo`）
- [ ] `npm run dev` で [http://localhost:3000](http://localhost:3000) が開く
- [ ] ログイン後、データ入力画面まで進める

クラウドで運用する場合:

- [ ] Git が使える、または ZIP でリポジトリを取得できている
- [ ] Node.js 24 以上と npm が使える
- [ ] Supabase プロジェクトを作成した
- [ ] 本番向けのパスワードポリシーを確認した
- [ ] Dashboard で **Allow new users to sign up** をオフ、**Secure password change** をオンにした（**B-3-3** を参照）
- [ ] `supabase link --project-ref <Project Ref>` が成功している
- [ ] `supabase db push --include-seed` が成功している（公式排出係数マスタまで入った）
- [ ] `.env.local` にクラウドの URL / anon key / service_role key を入れた
- [ ] 本番プロジェクトにデモデータ（`supabase/seeds/demo/demo.sql`）を投入していない（デモユーザーを本番で使わない）
- [ ] バックアップとリストアの運用方針を決めた（**2-G** を参照）
- [ ] ログイン後、データ入力画面まで進める

---

## 参考リンク

- [Supabase Local Development](https://supabase.com/docs/guides/local-development)
- [Supabase CLI Reference](https://supabase.com/docs/reference/cli)
- [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups)
- [supabase/README.md](../supabase/README.md)
- [AGENTS.md](../AGENTS.md)
