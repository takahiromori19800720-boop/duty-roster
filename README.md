# 休日当番 Roster — 長崎医療センター

スタッフの希望をもとに公平に休日当番を自動振分し、Googleカレンダーに同期するチーム向けWebアプリです。

## 機能

- 全メンバーが自分の Google アカウントでログイン
- 4状態の希望入力（未入力 / 可能 / 是非やりたい / 不可能）をクリックで切替
- 公平な自動振分（提出者全員に最低1日を保証）
- 担当者ごとの色分けで一目で識別
- Googleカレンダー（指定カレンダー）への自動同期
- リアルタイムでチーム全員のデータが共有される

---

# セットアップ手順

このアプリを動かすには **3つの外部サービス** の設定が必要です。順番に進めてください。所要時間は合計で **30〜45分** ほどです。

## STEP 1: Firebase プロジェクトを作る（約15分）

Firebase は Google の無料データベースサービスです。チーム全員のデータをここに保管します。

### 1-1. プロジェクト作成

1. https://console.firebase.google.com/ にアクセス
2. Google アカウントでログイン（森さんのアカウントでOK）
3. 「**プロジェクトを追加**」をクリック
4. プロジェクト名: 例 `duty-roster-nmc`（自由）
5. Google アナリティクスは **無効** でOK（不要）
6. 「**プロジェクトを作成**」をクリック → 1分ほど待つ

### 1-2. Firestore データベース作成

1. 左メニューから「**構築**」→「**Firestore Database**」
2. 「**データベースの作成**」をクリック
3. **本番環境モード**を選択（後でルールを変更します）
4. ロケーション: `asia-northeast1`（東京）を選択
5. 「**有効にする**」をクリック

### 1-3. Firestore セキュリティルール設定

データベースが作成されたら、「**ルール**」タブを開いて、内容を以下に書き換えてください:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 当面は読み書き自由（運用開始後に厳密化推奨）
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

「**公開**」ボタンを押して保存。

> ⚠️ このルールは「誰でも読み書き可能」なので、**URLが知られると外部から書き込まれる可能性**があります。本格運用前に Firebase Authentication を組み合わせた厳密なルールに変更することを推奨します。当面は試験運用としてください。

### 1-4. Web アプリの登録と設定値の取得

1. プロジェクトトップに戻り、画面上部のアプリ追加で「**Web アプリ (`</>`)**」を選択
2. アプリのニックネーム: `duty-roster-web`（自由）
3. 「**Firebase Hosting も設定する**」のチェックは**外す**
4. 「**アプリを登録**」をクリック
5. 表示される設定値（`firebaseConfig` の中身）を**メモ**します。こんな形です:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "duty-roster-nmc.firebaseapp.com",
  projectId: "duty-roster-nmc",
  storageBucket: "duty-roster-nmc.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc..."
};
```

この6つの値を `config.js` に貼ります（後述）。

---

## STEP 2: Google Calendar API + OAuth 設定（約15分）

カレンダーへの書き込みに必要です。Firebase と同じ Google アカウントで進めます。

### 2-1. Google Cloud プロジェクトを開く

Firebase プロジェクトを作ると、同名の Google Cloud プロジェクトが自動作成されています。

1. https://console.cloud.google.com/ にアクセス
2. 上部のプロジェクト選択で先ほど作った Firebase プロジェクト（`duty-roster-nmc` など）を選択

### 2-2. Calendar API を有効化

1. 上部の検索バーに「**Calendar API**」と入力
2. 「**Google Calendar API**」を選択
3. 「**有効にする**」をクリック

### 2-3. OAuth 同意画面の設定

1. 左メニュー「**APIとサービス**」→「**OAuth 同意画面**」
2. User Type: 「**外部**」を選択 → 作成
3. アプリ情報入力:
   - アプリ名: `休日当番 Roster`
   - ユーザー サポートメール: 森さんのメール
   - デベロッパー連絡先: 森さんのメール
4. 「**保存して次へ**」
5. スコープ: そのまま「**保存して次へ**」
6. テストユーザー: 「**+ADD USERS**」で **チーム7名全員のGmailアドレス**を追加
7. 「**保存して次へ**」→「**ダッシュボードに戻る**」

### 2-4. OAuth クライアントID 作成

1. 左メニュー「**認証情報**」
2. 上部「**+ 認証情報を作成**」→「**OAuth クライアントID**」
3. アプリケーションの種類: 「**ウェブアプリケーション**」
4. 名前: `duty-roster-web`
5. **承認済みの JavaScript 生成元** に以下を追加（GitHub Pages のURL）:
   - `https://[GitHubユーザー名].github.io`
   - 例: `https://takahiromori19800720-boop.github.io`
6. 承認済みリダイレクトURI: **空欄でOK**
7. 「**作成**」をクリック
8. 表示されるクライアントID（`xxxx.apps.googleusercontent.com` の形式）をメモ

### 2-5. カレンダーの編集権限設定

「長崎医療センタースタッフ予定表」(`4v7p23of0rf03d2vj5sajckjkk@group.calendar.google.com`) を開き、**チーム全員（書き込みを行う人）に「予定の変更権限」を付与**してください。

手順:
1. https://calendar.google.com/ を開く
2. 左サイドバーで「長崎医療センタースタッフ予定表」にカーソルを合わせ「**︙ → 設定と共有**」
3. 「**特定のユーザーまたはグループと共有**」セクションでメンバーを追加
4. アクセス権限を「**予定の変更権限**」に設定

---

## STEP 3: コードを GitHub に上げて公開（約10分）

### 3-1. config.js を編集

`config.js` を開き、以下の値を**取得した実際の値**に置き換えます:

```javascript
firebase: {
  apiKey:            "AIzaSy...",                    // STEP 1-4 で取得
  authDomain:        "duty-roster-nmc.firebaseapp.com",
  projectId:         "duty-roster-nmc",
  storageBucket:     "duty-roster-nmc.appspot.com",
  messagingSenderId: "1234567890",
  appId:             "1:1234567890:web:abc...",
},
google: {
  clientId:   "xxxx.apps.googleusercontent.com",    // STEP 2-4 で取得
  calendarId: "4v7p23of0rf03d2vj5sajckjkk@group.calendar.google.com",
},
```

### 3-2. GitHub にアップロード

1. GitHub の `duty-roster` レポジトリを開く
2. 「**Add file**」→「**Upload files**」
3. `index.html`、`config.js`、`app.js`、`README.md` を**ドラッグ＆ドロップ**
4. 下部の「**Commit changes**」をクリック

### 3-3. GitHub Pages を有効化

1. レポジトリの「**Settings**」タブを開く
2. 左メニューから「**Pages**」を選択
3. Source: 「**Deploy from a branch**」
4. Branch: 「**main**」、フォルダ: 「**/ (root)**」
5. 「**Save**」をクリック
6. 1〜2分待つと、ページ上部に公開URLが表示されます:
   `https://[ユーザー名].github.io/duty-roster/`

### 3-4. チームに共有

URLをチーム全員に共有してください。各自:

1. URL を開く
2. 自分の名前をクリック（一発ログイン）
3. 当番日に希望を入力 → 提出

管理者は希望が揃ったら「自動振分」→「確定 & カレンダー転送」で完了です。

---

# トラブルシューティング

## 「読み込み中...」のまま画面が出ない
ブラウザの開発者ツール（F12）の Console タブを開いてエラーを確認してください。よくある原因:

- `config.js` の値が間違っている（特に `apiKey` や `projectId`）
- Firestore のルールが本番モードのままで読み書きが拒否されている

## カレンダー同期ボタンを押すと「失敗しました」
- OAuth クライアントID の「承認済みの JavaScript 生成元」に GitHub Pages のURLが登録されていない
- ログインしている Google アカウントがカレンダーの「予定の変更権限」を持っていない
- Calendar API が有効化されていない

Console（F12）のエラーログを見ると詳しい原因が分かります。

## チームメンバーがログインできない
- OAuth 同意画面の「テストユーザー」にそのメンバーのメールアドレスが登録されていない可能性
- メンバーが対象カレンダーへの権限を持っていない可能性

## データを最初からやり直したい
ログイン画面の右下「データをリセット」を押すと、全データ消去して初期スタッフに戻ります。

---

# よくある質問

**Q. このアプリは無料で使えますか？**
A. はい。Firebase の無料枠（Spark プラン）で10名程度のチームなら十分間に合います。Google Cloud の Calendar API も個人利用範囲なら無料です。GitHub Pages も Public レポジトリなら無料です。

**Q. データが消えることはありますか？**
A. Firestore のデータは森さんの Firebase プロジェクト内に永続的に保存されます。プロジェクトを削除しない限り消えません。心配なら定期的に Firebase コンソールからエクスポートできます。

**Q. 院内のセキュリティ規程を満たしていますか？**
A. このアプリは Google のインフラ（Firebase, Calendar）に職員のメールアドレスとシフト情報を保存します。患者情報は扱いませんが、職員情報の外部クラウド保存について院内規程の確認をお願いします。

**Q. 機能を追加・変更したい**
A. `app.js` を編集して GitHub にアップロードし直せば反映されます（数分かかる場合あり）。AIに頼んで改修するのが現実的です。

---

# ライセンス

このコードは長崎医療センターの内部利用を目的としています。
