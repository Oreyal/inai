// ============================================================
// 出張寿司いない — ケータリング問合せフォーム受信用 GAS
// ============================================================
// ※ このファイルは Google Apps Script (GAS) エディタにコピー&ペーストして運用するテンプレートです。
//   ブラウザで動作するファイルではありません。Git ではデプロイ手順の原本として管理します。
//
// ---【デプロイ手順】-------------------------------------------
// 1. Google スプレッドシートを新規作成（「出張寿司いない 問合せ管理」等）。
//    既存の INAI 売上管理とは「別ブック」として作ること。
// 2. 拡張機能 → Apps Script を開き、このファイルの内容を全量コピー＆ペースト。
// 3. 下の CONFIG を埋める：
//      - NOTIFY_EMAIL        : 受信したいメールアドレス
//      - SLACK_WEBHOOK_URL   : Slack Incoming Webhook URL（未使用なら空文字でOK）
//      - SHEET_NAME          : 記録先シート名（初回実行時に自動作成）
// 4. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」を選択。
//      - 実行ユーザー: 自分
//      - アクセス権  : 全員（No-auth POST を受けるため）
//    デプロイ後に表示される URL（/exec で終わる）を控える。
// 5. catering/script.js の CATERING_FORM_ENDPOINT にその URL を貼り、コミット。
// ------------------------------------------------------------

var CONFIG = {
  NOTIFY_EMAIL: '',         // 例: 'chef@example.com'
  SLACK_WEBHOOK_URL: '',    // 例: 'https://hooks.slack.com/services/xxx/yyy/zzz'
  SHEET_NAME: '問合せ'
};

var HEADERS = [
  '受信日時', '会社名', '部署', '担当者名', 'メール', '電話',
  '希望日', '人数', '予算', '会場', 'シーン', '備考', 'User-Agent'
];

// ============================================================
// doPost — LP のフォームから POST を受けて記録・通知
// ============================================================
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents || '{}');
    var record = normalize(payload);

    writeToSheet(record);
    sendEmail(record);
    postSlack(record);

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error(err);
    return jsonResponse({ ok: false, error: String(err) });
  }
}

// ============================================================
// ヘルスチェック用（ブラウザで Web App URL を開くと使える）
// ============================================================
function doGet() {
  return jsonResponse({ ok: true, service: 'catering-form' });
}

// ------------------------------------------------------------
// 入力を正規化（未知のキーは無視、必須キーは空文字で埋める）
// ------------------------------------------------------------
function normalize(p) {
  var scenes = [];
  if (Array.isArray(p.scene)) scenes = p.scene;
  else if (typeof p.scene === 'string' && p.scene) scenes = [p.scene];

  return {
    receivedAt: new Date(),
    company:    String(p.company    || '').slice(0, 200),
    department: String(p.department || '').slice(0, 200),
    name:       String(p.name       || '').slice(0, 200),
    email:      String(p.email      || '').slice(0, 200),
    tel:        String(p.tel        || '').slice(0, 100),
    date:       String(p.date       || '').slice(0, 50),
    people:     String(p.people     || '').slice(0, 20),
    budget:     String(p.budget     || '').slice(0, 50),
    place:      String(p.place      || '').slice(0, 300),
    scene:      scenes.join(','),
    message:    String(p.message    || '').slice(0, 4000),
    userAgent:  String(p.userAgent  || '').slice(0, 500)
  };
}

// ------------------------------------------------------------
// スプレッドシートに追記
// ------------------------------------------------------------
function writeToSheet(r) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([
    r.receivedAt, r.company, r.department, r.name, r.email, r.tel,
    r.date, r.people, r.budget, r.place, r.scene, r.message, r.userAgent
  ]);
}

// ------------------------------------------------------------
// メール通知
// ------------------------------------------------------------
function sendEmail(r) {
  if (!CONFIG.NOTIFY_EMAIL) return;
  var subject = '[出張寿司いない] 新規お問合せ: ' + r.company + ' / ' + r.name + ' 様';
  var body = [
    '出張寿司いない LP より新規のお問合せを受信しました。',
    '',
    '会社名: '       + r.company,
    '部署: '         + r.department,
    '担当者名: '     + r.name,
    'メール: '       + r.email,
    '電話: '         + r.tel,
    '希望日: '       + r.date,
    '人数: '         + r.people,
    '予算: '         + r.budget,
    '会場: '         + r.place,
    'シーン: '       + r.scene,
    '',
    'ご要望・備考:',
    r.message,
    '',
    '---',
    '受信日時: ' + Utilities.formatDate(r.receivedAt, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'),
    'User-Agent: ' + r.userAgent
  ].join('\n');
  MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, subject, body);
}

// ------------------------------------------------------------
// Slack 通知
// ------------------------------------------------------------
function postSlack(r) {
  if (!CONFIG.SLACK_WEBHOOK_URL) return;
  var text = [
    ':sushi: *新規お問合せ* _出張寿司いない_',
    '*会社:* ' + r.company + '　*部署:* ' + r.department + '　*担当:* ' + r.name,
    '*希望日:* ' + r.date + '　*人数:* ' + r.people + '　*予算:* ' + r.budget,
    '*会場:* ' + r.place + '　*シーン:* ' + r.scene,
    '*メール:* ' + r.email + '　*電話:* ' + r.tel,
    '*備考:* ' + (r.message || '—')
  ].join('\n');
  UrlFetchApp.fetch(CONFIG.SLACK_WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ text: text }),
    muteHttpExceptions: true
  });
}

// ------------------------------------------------------------
// JSON レスポンスヘルパ
// ------------------------------------------------------------
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
