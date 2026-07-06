/**
 * 💰 兼代課鐘點結算模組
 * 目的：教學組長不必把「老師線上調代課」與「月底結算兼代課鐘點」當成兩件事做。
 * 從「代課紀錄表」中已成立的單據（教師皆確認可出單／可出單／已出單）直接彙整出：
 *   1. 代課教師應領總表（公費／學校移撥／自費 分列節數與金額）
 *   2. 自費代課對帳表（請假教師 → 代課教師 應付明細）
 *   3. 逐筆明細（日期、節次、班級、單號，可回溯查核）
 *
 * 鐘點費單價：指令碼屬性 SUB_FEE_PER_PERIOD（未設定時預設 320 元/節）。
 * ⚠️ 預設值僅為佔位，實際支給標準請依現行「中小學兼任代課及代理教師聘任辦法」與縣府規定確認後修改。
 */

const SETTLE_VALID_STATUS = ["教師皆確認可出單", "可出單", "已出單"];

function getSubFeePerPeriod_() {
  const v = PropertiesService.getScriptProperties().getProperty("SUB_FEE_PER_PERIOD");
  const n = parseInt(v, 10);
  return (!isNaN(n) && n > 0) ? n : 320;
}

/**
 * 選單入口：詢問結算區間後產出報表
 */
function generateSettlementReport() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    "兼代課鐘點結算",
    "請輸入結算月份（例如 2026/09），或起訖日期（例如 2026/09/01-2026/09/30）：",
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;

  const input = res.getResponseText().trim();
  const range = parseSettleRange_(input);
  if (!range) {
    ui.alert("格式錯誤", "請輸入 yyyy/MM 或 yyyy/MM/dd-yyyy/MM/dd", ui.ButtonSet.OK);
    return;
  }

  const result = buildSettlement_(range.start, range.end);
  if (result.records.length === 0) {
    ui.alert("查無資料", `區間 ${range.label} 內沒有已成立的代課紀錄。`, ui.ButtonSet.OK);
    return;
  }
  writeSettlementSheet_(result, range);
  ui.alert("✅ 結算完成", `已產出工作表「${result.sheetName}」，共 ${result.records.length} 筆代課紀錄。`, ui.ButtonSet.OK);
}

/** 解析 "yyyy/MM" 或 "yyyy/MM/dd-yyyy/MM/dd" 為起訖時間 */
function parseSettleRange_(input) {
  let m = input.match(/^(\d{4})\/(\d{1,2})$/);
  if (m) {
    const y = parseInt(m[1], 10), mo = parseInt(m[2], 10);
    return {
      start: new Date(y, mo - 1, 1).getTime(),
      end: new Date(y, mo, 0, 23, 59, 59).getTime(),
      label: `${y}/${Utilities.formatString("%02d", mo)}`,
      tag: `${y}${Utilities.formatString("%02d", mo)}`
    };
  }
  m = input.match(/^(\d{4}\/\d{1,2}\/\d{1,2})\s*[-~]\s*(\d{4}\/\d{1,2}\/\d{1,2})$/);
  if (m) {
    const s = new Date(m[1].replace(/\//g, "-")).getTime();
    const e = new Date(m[2].replace(/\//g, "-")).getTime() + 86399000;
    if (isNaN(s) || isNaN(e) || s > e) return null;
    return { start: s, end: e, label: `${m[1]} ~ ${m[2]}`, tag: m[1].replace(/\//g, "") + "-" + m[2].replace(/\//g, "") };
  }
  return null;
}

/** 核心彙整：讀代課紀錄表 → 過濾區間與狀態 → 分組統計 */
function buildSettlement_(startMs, endMs) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = ss.getSheetByName(CONFIG.sheetSub).getDataRange().getDisplayValues();
  const fee = getSubFeePerPeriod_();

  // 代課紀錄表欄位: [0]是否出單 [1]單號 [2]請假教師 [3]代課教師 [4]假別 [5]班級 [6]科目 [7]日期 [8]節次 [9]鐘點 [10]狀態 [11]備註
  const records = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[1] || !String(r[1]).trim()) continue;
    const status = String(r[10] || "").trim();
    if (!SETTLE_VALID_STATUS.includes(status)) continue;
    const dMs = new Date(String(r[7]).replace(/\//g, "-")).getTime();
    if (isNaN(dMs) || dMs < startMs || dMs > endMs) continue;
    records.push({
      serial: r[1], leaveT: String(r[2]).trim(), subT: String(r[3]).trim(),
      reason: r[4], cls: r[5], subject: r[6], date: r[7], time: r[8],
      feeType: String(r[9] || "").trim(), status: status, note: r[11] || ""
    });
  }

  // 1. 代課教師應領總表
  const byTeacher = {};
  records.forEach(rec => {
    if (!byTeacher[rec.subT]) byTeacher[rec.subT] = { 公費代課: 0, 學校移撥: 0, 自費代課: 0, 其他: 0 };
    const key = byTeacher[rec.subT].hasOwnProperty(rec.feeType) ? rec.feeType : "其他";
    byTeacher[rec.subT][key]++;
  });

  // 2. 自費代課對帳（請假教師 → 代課教師）
  const selfPaid = {};
  records.filter(rec => rec.feeType === "自費代課").forEach(rec => {
    const key = rec.leaveT + "→" + rec.subT;
    if (!selfPaid[key]) selfPaid[key] = { leaveT: rec.leaveT, subT: rec.subT, count: 0 };
    selfPaid[key].count++;
  });

  return { records, byTeacher, selfPaid, fee, sheetName: "" };
}

/** 將結算結果寫入報表工作表 */
function writeSettlementSheet_(result, range) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = "兼代課結算_" + range.tag;
  result.sheetName = sheetName;
  let sh = ss.getSheetByName(sheetName);
  if (sh) sh.clear(); else sh = ss.insertSheet(sheetName);

  const fee = result.fee;
  const rows = [];
  rows.push([`💰 兼代課鐘點結算表（${range.label}）`, "", "", "", "", "", ""]);
  rows.push([`結算時間：${Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy/MM/dd HH:mm")}　鐘點費單價：${fee} 元/節（指令碼屬性 SUB_FEE_PER_PERIOD 可修改，請依現行支給標準確認）`, "", "", "", "", "", ""]);
  rows.push(["", "", "", "", "", "", ""]);

  // --- 表一：代課教師應領總表 ---
  rows.push(["【表一】代課教師鐘點統計", "", "", "", "", "", ""]);
  rows.push(["代課教師", "公費代課(節)", "學校移撥(節)", "自費代課(節)", "其他(節)", "合計節數", `應領金額(${fee}元/節)`]);
  const t1Start = rows.length + 1;
  const teacherNames = Object.keys(result.byTeacher).sort();
  teacherNames.forEach(t => {
    const c = result.byTeacher[t];
    const total = c.公費代課 + c.學校移撥 + c.自費代課 + c.其他;
    rows.push([t, c.公費代課, c.學校移撥, c.自費代課, c.其他, total, total * fee]);
  });
  const t1Sum = teacherNames.reduce((acc, t) => {
    const c = result.byTeacher[t];
    return acc + c.公費代課 + c.學校移撥 + c.自費代課 + c.其他;
  }, 0);
  rows.push(["合計", "", "", "", "", t1Sum, t1Sum * fee]);
  rows.push(["", "", "", "", "", "", ""]);

  // --- 表二：自費代課對帳表 ---
  rows.push(["【表二】自費代課對帳（由請假教師支付）", "", "", "", "", "", ""]);
  rows.push(["請假教師", "→ 代課教師", "節數", "應付金額", "", "", ""]);
  const spKeys = Object.keys(result.selfPaid).sort();
  if (spKeys.length === 0) {
    rows.push(["（本期無自費代課）", "", "", "", "", "", ""]);
  } else {
    spKeys.forEach(k => {
      const s = result.selfPaid[k];
      rows.push([s.leaveT, s.subT, s.count, s.count * fee, "", "", ""]);
    });
  }
  rows.push(["", "", "", "", "", "", ""]);

  // --- 表三：逐筆明細 ---
  rows.push(["【表三】逐筆明細（供查核）", "", "", "", "", "", ""]);
  rows.push(["日期", "節次", "班級/科目", "請假教師", "代課教師", "鐘點類別", "單號/假別"]);
  result.records
    .sort((a, b) => new Date(a.date.replace(/\//g, "-")) - new Date(b.date.replace(/\//g, "-")))
    .forEach(rec => {
      rows.push([rec.date, rec.time, `${rec.cls} ${rec.subject}`, rec.leaveT, rec.subT, rec.feeType, `${rec.serial}（${rec.reason}）`]);
    });

  sh.getRange(1, 1, rows.length, 7).setValues(rows);

  // 樣式
  sh.getRange(1, 1).setFontSize(14).setFontWeight("bold");
  rows.forEach((r, i) => {
    const v = String(r[0]);
    if (v.startsWith("【表")) sh.getRange(i + 1, 1, 1, 7).setFontWeight("bold").setBackground("#fff3cd");
    if (v === "代課教師" || v === "請假教師" || v === "日期") sh.getRange(i + 1, 1, 1, 7).setFontWeight("bold").setBackground("#e8f0fe");
    if (v === "合計") sh.getRange(i + 1, 1, 1, 7).setFontWeight("bold").setBackground("#dcfce7");
  });
  sh.setColumnWidth(1, 140); sh.setColumnWidth(3, 160); sh.setColumnWidth(7, 200);
  ss.setActiveSheet(sh);
}
