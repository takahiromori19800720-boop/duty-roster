// ============================================================
//  休日当番 Roster — 設定ファイル
// ============================================================
//  このファイルには Firebase と Google OAuth の設定値を入れます。
//  README.md の手順に従って各値を取得し、下の YOUR_xxx の部分を
//  実際の値で置き換えてください。
// ============================================================

window.APP_CONFIG = {

  // ─── Firebase の設定 ───────────────────────────────────
  // Firebase Console で取得した値をここに貼ってください
  firebase: {
    apiKey:            "AIzaSyBkX-QXRBcjGheIBiAPMn5iY3k_92yFGD4",
    authDomain:        "duty-roster-nmc.firebaseapp.com",
    projectId:         "duty-roster-nmc",
    storageBucket:     "duty-roster-nmc.firebasestorage.app",
    messagingSenderId: "193049272380",
    appId:             "1:193049272380:web:bbec3e1c0accce91d3e339",
  },

  // ─── Google OAuth + Calendar API ──────────────────────
  // Google Cloud Console で取得した OAuth クライアントID を入れてください
  google: {
    clientId:   "YOUR_OAUTH_CLIENT_ID.apps.googleusercontent.com",
    // 同期先カレンダーID（長崎医療センタースタッフ予定表）
    calendarId: "4v7p23of0rf03d2vj5sajckjkk@group.calendar.google.com",
  },

  // ─── 病院名（画面上に表示） ─────────────────────────────
  org: {
    name:      "長崎医療センター",
    nameRomaji: "NAGASAKI MEDICAL CENTER",
  },

  // ─── 初期スタッフ（最初の1回だけ Firestore に書き込まれます）─
  //   ・初期管理者と各メンバー
  //   ・status: 'active' = すぐ利用可能、'invited' = 招待中
  //   ・colorIndex: 0〜11（メンバーごとの担当カラー）
  seedStaff: [
    { id: 's1', name: '森 隆浩',     email: 'takahiromori19800720@gmail.com', role: 'admin', status: 'active', colorIndex: 0 },
    { id: 's2', name: '森 英毅',     email: 'hm0612@gmail.com',               role: 'staff', status: 'active', colorIndex: 1 },
    { id: 's3', name: '和泉 泰衛',   email: 'yasu.izu11@gmail.com',           role: 'staff', status: 'active', colorIndex: 2 },
    { id: 's4', name: '永井 友基',   email: 'yukinohana27@gmail.com',         role: 'staff', status: 'active', colorIndex: 3 },
    { id: 's5', name: '鳥巢 裕一',   email: 'ichiyu.woodstock@gmail.com',     role: 'staff', status: 'active', colorIndex: 4 },
    { id: 's6', name: '山中 萌奈美', email: 'monapipo.0929@gmail.com',        role: 'staff', status: 'active', colorIndex: 5 },
    { id: 's7', name: '野口 大気',   email: 'noguchi.taiki227@gmail.com',     role: 'staff', status: 'active', colorIndex: 6 },
  ],
};
