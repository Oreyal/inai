// ============================================================
// INAI 売上管理 — Google Apps Script（新シート構造対応）
// シート: 会員一覧, 入金, 来店
// ============================================================

var SHEET_MEMBERS = '会員一覧';
var SHEET_DEPOSITS = '入金';
var SHEET_VISITS = '来店';
var SHEET_GUESTS = '来客予定';

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

// ============================================================
// doGet — データ読み取り
// ============================================================
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'all';
  var result = {};

  try {
    if (action === 'all' || action === 'customers') {
      result.customers = readMembers();
    }
    if (action === 'all' || action === 'visits') {
      var month = (e && e.parameter) ? e.parameter.month : null;
      result.visits = readVisits(month);
    }
    if (action === 'all' || action === 'deposits') {
      result.deposits = readDeposits();
    }
    if (action === 'all' || action === 'guests') {
      result.guests = readGuests();
    }
  } catch (err) {
    result.error = err.toString();
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// doPost — データ書き込み
// ============================================================
function doPost(e) {
  var payload = JSON.parse(e.postData.contents);
  var action = payload.action;
  var data = payload.data;
  var result = { status: 'ok' };

  try {
    switch (action) {
      case 'addVisit': appendVisit(data); break;
      case 'addCustomer': appendMember(data); break;
      case 'updateCustomer': updateMember(data); break;
      case 'addDeposit': appendDeposit(data); break;
      case 'bulkAddDeposits': result.added = bulkAppendDeposits(data); break;
      case 'fixMakuakePreSale': result.fix = fixMakuakePreSaleRevenue(); break;
      case 'updateDeposits': result.updated = updateDepositsCustomerId(data); break;
      case 'deleteDeposits': result.deleted = deleteDeposits(data); break;
      case 'updateVisit': updateVisitRecord(data); break;
      case 'deleteVisit': result.deleted = deleteVisitRecord(data); break;
      case 'saveGuests': saveGuests(data); break;
      default: result.status = 'unknown action: ' + action;
    }
  } catch (err) {
    result.status = 'error';
    result.error = err.toString();
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// 会員一覧 読み取り
// 実際の列構造（15列）:
//   A(0)=顧客ID, B(1)=氏名, C(2)=せい, D(3)=めい,
//   E(4)=購入内容(ランク), F(5)=電話番号, G(6)=生年月日,
//   H(7)=空, I(8)=説明, J(9)=入会経路, K(10)=購入枚数,
//   L(11)=利用枚数, M(12)=残枚数, N(13)=来店回数, O(14)=合計利用金額
// ============================================================
function readMembers() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_MEMBERS);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  var members = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;

    members.push({
      id: String(row[0]),
      name: String(row[1] || ''),
      nameKana: ((row[2] || '') + ' ' + (row[3] || '')).trim(),
      rank: String(row[4] || ''),
      channel: String(row[9] || 'stripe').toLowerCase(),   // J列=入会経路
      phone: String(row[5] || ''),                          // F列=電話番号
      memo: String(row[8] || ''),                           // I列=説明
      ticketCount: Number(row[10]) || 0,                    // K列=購入枚数
    });
  }

  return members;
}

// ============================================================
// 入金 読み取り
// 列: A=入金ID, B=日付, C=会員ID, D=経路, E=金額, F=有効期限, G=メモ
// ============================================================
function readDeposits() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_DEPOSITS);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  var deposits = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;

    deposits.push({
      id: String(row[0]),
      date: fmtDate(row[1]),
      customerId: String(row[2] || ''),
      channel: String(row[3] || 'stripe').toLowerCase(),
      amount: Number(row[4]) || 0,
      expiresAt: row[5] ? fmtDate(row[5]) : '',
      memo: String(row[6] || ''),
    });
  }

  return deposits;
}

// ============================================================
// 来店 読み取り
// 列: A=来店ID, B=日付, C=会員ID, D=プラン, E=利用人数, F=前売人数,
//     G=当日人数, H=コース単価, I=Airpay金額, J=当日ドリンク,
//     K=子供人数, L=子供料金, M=追加料金, N=前売売上, O=当日売上, P=メモ
// ============================================================
function readVisits(filterMonth) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_VISITS);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  var visits = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;

    var dateStr = fmtDate(row[1]);
    if (filterMonth && dateStr.slice(0, 7) !== filterMonth) continue;

    visits.push({
      id: String(row[0]),
      date: dateStr,
      customerId: String(row[2] || ''),
      plan: String(row[3] || ''),
      guestCount: Number(row[4]) || 0,
      preSaleGuests: Number(row[5]) || 0,
      sameDayGuests: Number(row[6]) || 0,
      unitPrice: Number(row[7]) || 0,
      airpayAmount: Number(row[8]) || 0,
      sameDayDrinks: Number(row[9]) || 0,
      childCount: Number(row[10]) || 0,
      childFee: Number(row[11]) || 0,
      additionalCharges: Number(row[12]) || 0,
      preSaleRevenue: Number(row[13]) || 0,
      sameDayRevenue: Number(row[14]) || 0,
      memo: String(row[15] || ''),
    });
  }

  return visits;
}

// ============================================================
// 書き込み
// ============================================================
function appendVisit(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_VISITS);
  var lastRow = sheet.getLastRow();
  var nextId = 'V' + String(lastRow).padStart(4, '0');

  sheet.appendRow([
    data.id || nextId,
    new Date(data.date),
    data.customerId || '',
    data.plan || '',
    data.guestCount || 0,
    data.preSaleGuests || 0,
    data.sameDayGuests || 0,
    data.unitPrice || 0,
    data.airpayAmount || 0,
    data.sameDayDrinks || 0,
    data.childCount || 0,
    data.childFee || 0,
    data.additionalCharges || 0,
    data.memo || '',
  ]);
}

function appendMember(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_MEMBERS);

  var kanaParts = (data.nameKana || '').split(/\s+/);

  sheet.appendRow([
    data.id || '',
    data.name || '',
    kanaParts[0] || '',
    kanaParts.slice(1).join(' ') || '',
    data.rank || '',
    (data.channel || 'stripe').toLowerCase(),
    data.phone || '',
    data.memo || '',
  ]);
}

function updateMember(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_MEMBERS);
  var allData = sheet.getDataRange().getValues();

  for (var i = 1; i < allData.length; i++) {
    if (String(allData[i][0]) === String(data.id)) {
      var row = i + 1;
      if (data.name) sheet.getRange(row, 2).setValue(data.name);          // B列
      if (data.rank) sheet.getRange(row, 5).setValue(data.rank);          // E列=購入内容
      if (data.channel) sheet.getRange(row, 10).setValue(data.channel.toLowerCase()); // J列=入会経路
      if (data.phone !== undefined) sheet.getRange(row, 6).setValue(data.phone);      // F列=電話番号
      if (data.memo !== undefined) sheet.getRange(row, 9).setValue(data.memo);        // I列=説明
      if (data.ticketCount !== undefined) sheet.getRange(row, 11).setValue(data.ticketCount); // K列=購入枚数
      break;
    }
  }
}

function appendDeposit(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_DEPOSITS);
  var lastRow = sheet.getLastRow();
  var nextId = 'D' + String(lastRow).padStart(4, '0');

  sheet.appendRow([
    data.id || nextId,
    new Date(data.date),
    data.customerId || '',
    (data.channel || 'stripe').toLowerCase(),
    data.amount || 0,
    data.expiresAt ? new Date(data.expiresAt) : '',
    data.memo || '',
  ]);
}

// ============================================================
// 一括入金登録
// ============================================================
function bulkAppendDeposits(rows) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_DEPOSITS);

  // 既存IDを取得（重複防止）
  var data = sheet.getDataRange().getValues();
  var existingIds = {};
  for (var i = 1; i < data.length; i++) {
    existingIds[String(data[i][0])] = true;
  }

  var newRows = [];
  for (var r = 0; r < rows.length; r++) {
    var d = rows[r];
    if (existingIds[d.id]) continue; // 重複スキップ
    newRows.push([
      d.id || '',
      new Date(d.date),
      d.customerId || '',
      (d.channel || 'stripe').toLowerCase(),
      d.amount || 0,
      d.expiresAt ? new Date(d.expiresAt) : '',
      d.memo || '',
    ]);
  }

  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 7).setValues(newRows);
  }
  return newRows.length;
}

// ============================================================
// Makuake来店の前売売上を一括修正
// 入金データから1人あたり単価を算出し、来店シートのH列(単価)とN列(前売売上)を更新
// ============================================================
function fixMakuakePreSaleRevenue() {
  var ss = getSpreadsheet();
  var custSheet = ss.getSheetByName(SHEET_MEMBERS);
  var depSheet = ss.getSheetByName(SHEET_DEPOSITS);
  var visitSheet = ss.getSheetByName(SHEET_VISITS);

  // --- 会員一覧: Makuake顧客のID→{ticketCount, channel} ---
  var custData = custSheet.getDataRange().getValues();
  var custMap = {}; // id → { channel, ticketCount }
  for (var i = 1; i < custData.length; i++) {
    var id = String(custData[i][0] || '').trim();
    if (!id) continue;
    var channel = String(custData[i][9] || '').toLowerCase(); // J列=入会経路
    var ticketCount = Number(custData[i][10]) || 0;           // K列=購入枚数
    var name = String(custData[i][1] || '');
    custMap[id] = { name: name, channel: channel, ticketCount: ticketCount };
  }

  // --- 入金: 顧客ごとのMakuakeコース入金合計 & メモ収集 ---
  var depData = depSheet.getDataRange().getValues();
  var depositByCustomer = {}; // customerId → totalAmount
  var depositMemos = {};      // customerId → [memo1, memo2, ...]
  for (var i = 1; i < depData.length; i++) {
    var cid = String(depData[i][2] || '').trim();
    var ch = String(depData[i][3] || '').toLowerCase();
    var amount = Number(depData[i][4]) || 0;
    var memo = String(depData[i][6] || '');
    if (!cid || !ch.match(/^makuake/)) continue;
    // デポジット（お食事券）は単価計算から除外
    if (memo.indexOf('お食事券') >= 0) continue;
    if (!depositByCustomer[cid]) {
      depositByCustomer[cid] = 0;
      depositMemos[cid] = [];
    }
    depositByCustomer[cid] += amount;
    if (memo) depositMemos[cid].push(memo);
  }

  // --- 顧客ごとの1人あたり単価を計算 ---
  var unitPriceMap = {}; // customerId → unitPrice
  for (var cid in depositByCustomer) {
    var cust = custMap[cid];
    if (!cust) continue;

    var ticketCount = cust.ticketCount;

    // ticketCountが0の場合、入金メモからチケット枚数をパース
    if (ticketCount <= 0 && depositMemos[cid]) {
      var memos = depositMemos[cid];
      for (var m = 0; m < memos.length; m++) {
        // 《2名分》《1名分》【2名】《2名》 などのパターン
        var match = memos[m].match(/[《【](\d+)名[分》】]/);
        if (match) {
          ticketCount += Number(match[1]);
        }
      }
    }

    if (ticketCount <= 0) {
      // デポジット顧客（メモに「デポジット」含む）→ 固定単価 ¥17,600
      var memos = depositMemos[cid] || [];
      var isDeposit = false;
      for (var m = 0; m < memos.length; m++) {
        if (memos[m].indexOf('デポジット') >= 0) { isDeposit = true; break; }
      }
      if (isDeposit) {
        unitPriceMap[cid] = 17600;
      }
      continue;
    }
    unitPriceMap[cid] = Math.round(depositByCustomer[cid] / ticketCount);
  }

  // --- 来店シートを更新 ---
  var visitData = visitSheet.getDataRange().getValues();
  var updated = 0;
  var skipped = 0;
  var noPrice = [];

  for (var i = 1; i < visitData.length; i++) {
    var row = visitData[i];
    var visitId = String(row[0] || '');
    var customerId = String(row[2] || '').trim();
    var cust = custMap[customerId];
    if (!cust || !cust.channel.match(/^makuake/)) continue;

    var guestCount = Number(row[4]) || 0;     // E列: 利用人数
    var preSaleGuests = Number(row[5]) || 0;   // F列: 前売人数
    var currentUnitPrice = Number(row[7]) || 0; // H列: コース単価
    var currentPreSaleRev = Number(row[13]) || 0; // N列: 前売売上
    var sameDayRev = Number(row[14]) || 0;     // O列: 当日売上

    // 確定値（旧シートから移行済みでsameDayRev>0）はスキップ
    if (sameDayRev > 0 && currentPreSaleRev > 0) {
      skipped++;
      continue;
    }

    var unitPrice = unitPriceMap[customerId];
    if (!unitPrice) {
      var depAmt = depositByCustomer[customerId] || 0;
      var depMemo = (depositMemos[customerId] || []).join(' / ');
      noPrice.push({
        visitId: visitId,
        customerId: customerId,
        name: cust.name || '',
        channel: cust.channel,
        ticketCount: cust.ticketCount,
        depositAmount: depAmt,
        depositMemo: depMemo
      });
      continue;
    }

    // 前売人数が未入力の場合: 利用人数をそのまま前売人数とする
    if (preSaleGuests === 0 && guestCount > 0) {
      preSaleGuests = guestCount;
      visitSheet.getRange(i + 1, 6).setValue(preSaleGuests); // F列更新
    }

    var newPreSaleRev = preSaleGuests * unitPrice;

    // H列: コース単価を更新
    if (currentUnitPrice === 0 || currentUnitPrice !== unitPrice) {
      visitSheet.getRange(i + 1, 8).setValue(unitPrice);
    }

    // N列: 前売売上を更新
    if (currentPreSaleRev !== newPreSaleRev) {
      visitSheet.getRange(i + 1, 14).setValue(newPreSaleRev);
    }

    updated++;
  }

  var msg = 'Makuake前売売上 修正完了\n\n';
  msg += '更新: ' + updated + '件\n';
  msg += 'スキップ(確定値あり): ' + skipped + '件\n';
  msg += '単価不明: ' + noPrice.length + '件\n';
  // 重複する顧客IDをまとめる（来店が複数ある場合）
  var noPriceUnique = {};
  for (var n = 0; n < noPrice.length; n++) {
    var np = noPrice[n];
    if (!noPriceUnique[np.customerId]) {
      noPriceUnique[np.customerId] = np;
      noPriceUnique[np.customerId].visitCount = 1;
    } else {
      noPriceUnique[np.customerId].visitCount++;
    }
  }
  var noPriceDetails = [];
  for (var cid in noPriceUnique) {
    noPriceDetails.push(noPriceUnique[cid]);
  }

  if (noPriceDetails.length > 0) {
    msg += '\n--- 単価不明 ---\n';
    for (var n = 0; n < noPriceDetails.length; n++) {
      var np = noPriceDetails[n];
      msg += np.name + ' (' + np.customerId + ') 入金:' + np.depositAmount + ' 来店:' + np.visitCount + '回\n';
    }
  }

  Logger.log(msg);
  return { updated: updated, skipped: skipped, noPrice: noPrice.length, noPriceDetails: noPriceDetails };
}

// ============================================================
// 入金の顧客ID一括更新
// data = [{ depositId: 'STR_D0001', customerId: 'S0042', amount: 120000 }, ...]
// customerId, amount, memo は任意（指定されたフィールドのみ更新）
// ============================================================
function updateDepositsCustomerId(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_DEPOSITS);
  var allData = sheet.getDataRange().getValues();

  // 入金IDと行番号のマップ
  var idToRow = {};
  for (var i = 1; i < allData.length; i++) {
    idToRow[String(allData[i][0])] = i + 1;
  }

  var updated = 0;
  for (var d = 0; d < data.length; d++) {
    var depId = data[d].depositId;
    var row = idToRow[depId];
    if (!row) continue;
    if (data[d].customerId) sheet.getRange(row, 3).setValue(data[d].customerId); // C列
    if (data[d].amount !== undefined) sheet.getRange(row, 5).setValue(data[d].amount); // E列
    if (data[d].memo !== undefined) sheet.getRange(row, 7).setValue(data[d].memo); // G列
    updated++;
  }
  return updated;
}

// ============================================================
// 来店レコード更新
// data = { visitId: 'V0001', unitPrice: 8000, sameDayRevenue: 16000, ... }
// ============================================================
function updateVisitRecord(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_VISITS);
  var allData = sheet.getDataRange().getValues();

  for (var i = 1; i < allData.length; i++) {
    if (String(allData[i][0]) === String(data.id || data.visitId)) {
      var row = i + 1;
      if (data.guestCount !== undefined) sheet.getRange(row, 5).setValue(data.guestCount);       // E列
      if (data.preSaleGuests !== undefined) sheet.getRange(row, 6).setValue(data.preSaleGuests); // F列
      if (data.sameDayGuests !== undefined) sheet.getRange(row, 7).setValue(data.sameDayGuests); // G列
      if (data.unitPrice !== undefined) sheet.getRange(row, 8).setValue(data.unitPrice);         // H列
      if (data.airpayAmount !== undefined) sheet.getRange(row, 9).setValue(data.airpayAmount);   // I列
      if (data.sameDayDrinks !== undefined) sheet.getRange(row, 10).setValue(data.sameDayDrinks);// J列
      if (data.childCount !== undefined) sheet.getRange(row, 11).setValue(data.childCount);       // K列
      if (data.childFee !== undefined) sheet.getRange(row, 12).setValue(data.childFee);           // L列
      if (data.additionalCharges !== undefined) sheet.getRange(row, 13).setValue(data.additionalCharges); // M列
      if (data.preSaleRevenue !== undefined) sheet.getRange(row, 14).setValue(data.preSaleRevenue); // N列
      if (data.sameDayRevenue !== undefined) sheet.getRange(row, 15).setValue(data.sameDayRevenue); // O列
      if (data.memo !== undefined) sheet.getRange(row, 16).setValue(data.memo);                   // P列
      break;
    }
  }
}

// ============================================================
// 来店レコード削除
// data = { id: 'TC_XXXXX' }
// ============================================================
function deleteVisitRecord(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_VISITS);
  var allData = sheet.getDataRange().getValues();

  for (var i = allData.length - 1; i >= 1; i--) {
    if (String(allData[i][0]) === String(data.id)) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

// ============================================================
// 入金レコード削除
// data = ['M3_0010', 'M3D_0010', ...] (入金IDの配列)
// ============================================================
function deleteDeposits(ids) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_DEPOSITS);
  var allData = sheet.getDataRange().getValues();

  // 削除対象の行を逆順で収集（下から削除しないと行番号がずれる）
  var rowsToDelete = [];
  for (var i = 1; i < allData.length; i++) {
    var depId = String(allData[i][0]);
    if (ids.indexOf(depId) >= 0) {
      rowsToDelete.push(i + 1);
    }
  }

  // 下から順に削除
  rowsToDelete.sort(function(a, b) { return b - a; });
  for (var r = 0; r < rowsToDelete.length; r++) {
    sheet.deleteRow(rowsToDelete[r]);
  }
  return rowsToDelete.length;
}

// ============================================================
// 来客予定 読み取り / 書き込み
// シート「来客予定」: A=type(today/tomorrow), B=JSON
// ============================================================
function ensureGuestsSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_GUESTS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_GUESTS);
    sheet.appendRow(['type', 'json']);
    sheet.appendRow(['today', '[]']);
    sheet.appendRow(['tomorrow', '[]']);
  }
  return sheet;
}

function readGuests() {
  var sheet = ensureGuestsSheet();
  var data = sheet.getDataRange().getValues();
  var result = { today: [], tomorrow: [] };
  for (var i = 1; i < data.length; i++) {
    var type = String(data[i][0]);
    var json = String(data[i][1] || '[]');
    try {
      if (type === 'today') result.today = JSON.parse(json);
      if (type === 'tomorrow') result.tomorrow = JSON.parse(json);
    } catch (e) {}
  }
  return result;
}

function saveGuests(data) {
  var sheet = ensureGuestsSheet();
  var allData = sheet.getDataRange().getValues();
  var todayRow = -1, tomorrowRow = -1;
  for (var i = 1; i < allData.length; i++) {
    if (String(allData[i][0]) === 'today') todayRow = i + 1;
    if (String(allData[i][0]) === 'tomorrow') tomorrowRow = i + 1;
  }
  if (data.today !== undefined) {
    var json = JSON.stringify(data.today);
    if (todayRow > 0) {
      sheet.getRange(todayRow, 2).setValue(json);
    } else {
      sheet.appendRow(['today', json]);
    }
  }
  if (data.tomorrow !== undefined) {
    var json = JSON.stringify(data.tomorrow);
    if (tomorrowRow > 0) {
      sheet.getRange(tomorrowRow, 2).setValue(json);
    } else {
      sheet.appendRow(['tomorrow', json]);
    }
  }
}

function fmtDate(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return String(val || '');
}
