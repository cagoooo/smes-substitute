/**
 * 🧰 石門國小空白模板初始化模組
 * 從試算表選單「📅 系統出單功能 → 🧰 初始化石門國小空白模板」執行。
 * 會清空並重建全部工作表，寫入「國小情境」的範例資料：
 *   - 12 個班級（一~六年級各 2 班：101/102 ~ 601/602）
 *   - 12 位導師 + 4 位科任（英語/音樂/體育/自然）
 *   - 低年級只排上午 4 節、中高年級含下午節次、週三下午全校空堂（教師進修）
 *   - 「排課資料庫」與「教師課表」由同一份排課結果自動生成，保證互相一致
 * 之後由教學組把範例資料換成全校真實課表即可上線。
 */

const SMES = {
  GRADE_NAMES: ["一", "二", "三", "四", "五", "六"],
  DAYS: ["一", "二", "三", "四", "五"],
  SEMESTER_START: "2026/08/31", // 學期第一週的週一（範例值，請依實際行事曆修改）
  WEEK_COUNT: 21
};

function setupSmesTemplate() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.alert(
    "初始化石門國小空白模板",
    "⚠️ 這會【清空並重建】所有工作表，改成國小情境的範例資料。\n既有資料將全部刪除，確定要執行嗎？",
    ui.ButtonSet.YES_NO
  );
  if (res !== ui.Button.YES) return;

  setupSmesTemplateCore_();

  ui.alert("✅ 完成", "石門國小空白模板已建立。\n請至「Email對照表」填入真實教師名單，並替換「教師課表」與「排課資料庫」的範例課表。", ui.ButtonSet.OK);
}

/** 核心初始化（無 UI，供選單與遠端端點共用） */
function setupSmesTemplateCore_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const plan = buildSamplePlan_();

  writeStartSheet_(ss);
  writeEmailSheet_(ss, plan);
  writeWeekSheet_(ss);
  writeClassDB_(ss, plan);
  writeTeacherScheduleSheet_(ss, plan);
  writeHoursSheet_(ss, plan);
  writeElasticSheets_(ss);
  writeRecordSheets_(ss);
  writeSettingsSheet_(ss);
  ensureAppToken_();

  return "已重建 " + ss.getSheets().length + " 張工作表（班級 " + plan.classes.length + "、教師 " + plan.teachers.length + "）";
}

/** 取得（或建立）並清空工作表 */
function resetSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clear();
  return sh;
}

/** 若尚未設定 APP_TOKEN，自動產生一組隨機 token（連結安全驗證用） */
function ensureAppToken_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("APP_TOKEN")) {
    props.setProperty("APP_TOKEN", Utilities.getUuid().replace(/-/g, ""));
  }
}

/**
 * 🎯 建立範例排課：回傳 { classes, teachers, assign }
 * assign[className][day+period] = { sub, teacher }
 */
function buildSamplePlan_() {
  const classes = [];
  SMES.GRADE_NAMES.forEach((g, gi) => {
    const grade = gi + 1;
    ["1", "2"].forEach(n => classes.push({ name: String(grade) + "0" + n, grade: grade }));
  });

  // 各年段可排課節次（週三下午全校空堂）
  function slotsForGrade(grade) {
    const slots = [];
    SMES.DAYS.forEach(d => {
      let maxP = 4; // 低年級整週上午 4 節
      if (grade >= 3 && grade <= 4) maxP = (d === "三") ? 4 : 6; // 中年級
      if (grade >= 5) maxP = (d === "三") ? 4 : 7;               // 高年級
      for (let p = 1; p <= maxP; p++) slots.push(d + p);
    });
    return slots;
  }

  // 科任需求（每班每週節數）
  function specialNeeds(grade) {
    if (grade <= 2) return { "英語": 1, "音樂": 1, "體育": 2 };
    if (grade <= 4) return { "英語": 2, "音樂": 1, "體育": 2, "自然": 2 };
    return { "英語": 2, "音樂": 1, "體育": 2, "自然": 3 };
  }

  // 導師課輪替科目
  function homeroomSubjects(grade) {
    if (grade <= 2) return ["國語", "國語", "數學", "生活", "國語", "數學", "生活", "綜合", "健康", "彈性學習"];
    if (grade <= 4) return ["國語", "國語", "數學", "社會", "國語", "數學", "社會", "綜合", "健康", "彈性學習", "閩南語"];
    return ["國語", "國語", "數學", "社會", "國語", "數學", "社會", "綜合", "健康", "彈性學習", "閩南語", "資訊"];
  }

  const specialTeachers = { "英語": "英語科任", "音樂": "音樂科任", "體育": "體育科任", "自然": "自然科任" };
  const busy = {}; // busy[teacher][slot] = true
  Object.keys(specialTeachers).forEach(s => busy[specialTeachers[s]] = {});

  const assign = {};
  classes.forEach(c => {
    assign[c.name] = {};
    const slots = slotsForGrade(c.grade);
    const used = {};

    // 1. 先塞科任課（避開科任教師已被別班占用的時段）
    const needs = specialNeeds(c.grade);
    Object.keys(needs).forEach(sub => {
      const tName = specialTeachers[sub];
      let remain = needs[sub];
      for (let i = 0; i < slots.length && remain > 0; i++) {
        const k = slots[i];
        if (used[k] || busy[tName][k]) continue;
        assign[c.name][k] = { sub: sub, teacher: tName };
        used[k] = true;
        busy[tName][k] = true;
        remain--;
      }
    });

    // 2. 其餘節次由導師輪替科目補滿
    const hrSubs = homeroomSubjects(c.grade);
    const hrTeacher = "導師" + c.name;
    let idx = 0;
    slots.forEach(k => {
      if (used[k]) return;
      assign[c.name][k] = { sub: hrSubs[idx % hrSubs.length], teacher: hrTeacher };
      idx++;
    });
  });

  const teachers = [];
  classes.forEach(c => teachers.push({ name: "導師" + c.name, subject: "級任", grade: c.grade, title: SMES.GRADE_NAMES[c.grade - 1] + "年級導師", isHomeroom: true }));
  Object.keys(specialTeachers).forEach(s => teachers.push({ name: specialTeachers[s], subject: s, grade: 0, title: "科任", isHomeroom: false }));

  return { classes: classes, teachers: teachers, assign: assign };
}

/** 📄 開始使用（說明頁） */
function writeStartSheet_(ss) {
  const sh = resetSheet_(ss, "開始使用");
  const rows = [
    ["🏫 石門國小線上調代課系統｜開始使用"],
    ["本系統改良自新北市中和高中教學組公開模板，已調整為國小情境（桃園市龍潭區石門國民小學）。"],
    [""],
    ["📌 上線前四步驟"],
    ["1. 到「Email對照表」填入全校教師姓名、Google 信箱與身分（管理員／行政／教師）。"],
    ["2. 到「週次對照表」依學校行事曆調整各週日期（格式 yyyy/MM/dd，遇假日該格留空）。"],
    ["3. 用真實課表取代「教師課表」與「排課資料庫」的範例資料（兩張表內容必須一致）。"],
    ["4. 由管理員帳號「擴充功能 → Apps Script → 部署 → 新增部署 → 網頁應用程式」取得系統網址。"],
    [""],
    ["📌 通知設定（指令碼屬性，選用）"],
    ["GOOGLE_CHAT_WEBHOOK：教學組 Google Chat 聊天室 webhook，設定後單據異動即時推播（免費、無則數上限）。"],
    ["ALLOWED_DOMAINS：限制登入網域，例如 smes.tyc.edu.tw,mail2.smes.tyc.edu.tw（留空 = 只靠名單管控）。"],
    ["APP_TOKEN：信件確認連結的安全代碼（初始化時已自動產生，勿外流）。"],
    ["SUB_FEE_PER_PERIOD：代課鐘點費單價（元/節），未設定時預設 320，請依現行支給標準修改。"],
    [""],
    ["📌 兼代課結算：選單「📅 系統出單功能 → 3. 💰 兼代課鐘點結算」輸入月份即可自動彙整，"],
    ["　 產出「代課教師應領總表＋自費代課對帳表＋逐筆明細」，不必再手動重複登打。"],
    [""],
    ["⚠️ 範例資料僅供展示流程：12 班（101~602）、12 位導師、4 位科任，週三下午為全校空堂。"],
    ["Made with ❤️ by 阿凱老師（桃園市龍潭區石門國民小學）"]
  ];
  sh.getRange(1, 1, rows.length, 1).setValues(rows);
  sh.getRange(1, 1).setFontSize(16).setFontWeight("bold");
  sh.getRange(4, 1).setFontWeight("bold");
  sh.getRange(10, 1).setFontWeight("bold");
  sh.setColumnWidth(1, 900);
}

/** 📧 Email對照表 */
function writeEmailSheet_(ss, plan) {
  const sh = resetSheet_(ss, "Email對照表");
  const rows = [["姓名", "信箱", "身分"]];
  rows.push(["阿凱老師", "ipad@mail2.smes.tyc.edu.tw", "管理員"]);
  rows.push(["系統維護", "cagooo@gmail.com", "管理員"]);
  rows.push(["教務主任", "director@mail2.smes.tyc.edu.tw", "行政"]);
  plan.teachers.forEach((t, i) => {
    rows.push([t.name, "teacher" + Utilities.formatString("%02d", i + 1) + "@mail2.smes.tyc.edu.tw", "教師"]);
  });
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
  sh.getRange(1, 1, 1, 3).setFontWeight("bold").setBackground("#e8f0fe");
  sh.setFrozenRows(1);
}

/** 📆 週次對照表 */
function writeWeekSheet_(ss) {
  const sh = resetSheet_(ss, "週次對照表");
  const rows = [["週次", "星期一", "星期二", "星期三", "星期四", "星期五"]];
  const start = new Date(SMES.SEMESTER_START.replace(/\//g, "-"));
  const tz = ss.getSpreadsheetTimeZone();
  for (let w = 0; w < SMES.WEEK_COUNT; w++) {
    const row = [w + 1];
    for (let d = 0; d < 5; d++) {
      const dt = new Date(start.getTime() + (w * 7 + d) * 86400000);
      row.push(Utilities.formatDate(dt, tz, "yyyy/MM/dd"));
    }
    rows.push(row);
  }
  // 全欄改為純文字，避免日期被自動轉型導致顯示格式與程式比對不一致
  sh.getRange(1, 1, rows.length, 6).setNumberFormat("@").setValues(rows);
  sh.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#e8f0fe");
  sh.setFrozenRows(1);
}

/** 🗂️ 排課資料庫（班級視角） */
function writeClassDB_(ss, plan) {
  const sh = resetSheet_(ss, "排課資料庫");
  const rows = [["班級", "星期", "節次", "課程名稱", "教師名稱", "備註"]];
  plan.classes.forEach(c => {
    SMES.DAYS.forEach(d => {
      for (let p = 1; p <= 8; p++) {
        const item = plan.assign[c.name][d + p];
        if (item) rows.push([c.name, d, p, item.sub, item.teacher, ""]);
      }
    });
  });
  sh.getRange(1, 1, rows.length, 6).setValues(rows);
  sh.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#e8f0fe");
  sh.setFrozenRows(1);
}

/** 📅 教師課表（教師視角，欄位配置與後端解析程式一致：2+80+40 欄） */
function writeTeacherScheduleSheet_(ss, plan) {
  const sh = resetSheet_(ss, "教師課表");
  const header = ["科目", "教師名稱"];
  SMES.DAYS.forEach(d => {
    for (let p = 1; p <= 8; p++) header.push(d + p + "課程", d + p + "班級");
  });
  SMES.DAYS.forEach(d => {
    for (let p = 1; p <= 8; p++) header.push(d + p + "屬性");
  });

  // 反轉 assign：teacher -> slot -> {sub, cls}
  const byTeacher = {};
  plan.classes.forEach(c => {
    const map = plan.assign[c.name];
    for (let k in map) {
      const t = map[k].teacher;
      if (!byTeacher[t]) byTeacher[t] = {};
      byTeacher[t][k] = { sub: map[k].sub, cls: c.name };
    }
  });

  const rows = [header, new Array(header.length).fill("")]; // 第 2 列為保留列（統計用，可留空）
  plan.teachers.forEach(t => {
    const row = [t.subject, t.name];
    const sched = byTeacher[t.name] || {};
    SMES.DAYS.forEach(d => {
      for (let p = 1; p <= 8; p++) {
        const item = sched[d + p];
        row.push(item ? item.sub : "", item ? item.cls : "");
      }
    });
    SMES.DAYS.forEach(d => {
      for (let p = 1; p <= 8; p++) row.push(""); // 屬性欄（兼課/輔導/實支）預設留空
    });
    rows.push(row);
  });
  sh.getRange(1, 1, rows.length, header.length).setValues(rows);
  sh.getRange(1, 1, 1, header.length).setFontWeight("bold").setBackground("#e8f0fe");
  sh.setFrozenRows(2);
  sh.setFrozenColumns(2);
}

/** 🧮 教學節數（欄位位置沿用原模板：index 8=基本節數、11=課後照顧、15=職稱、16=超鐘點） */
function writeHoursSheet_(ss, plan) {
  const sh = resetSheet_(ss, "教學節數");
  const header = ["教師姓名", "科目", "低年級", "中年級", "高年級", "彈性", "本土語", "合計節數", "基本節數", "減授節數", "原基本節數", "課後照顧", "導師", "行政", "職務", "職稱", "超鐘點節數", "備註"];

  // 由排課結果統計每位教師的實際節數
  const counts = {};
  plan.classes.forEach(c => {
    const map = plan.assign[c.name];
    for (let k in map) {
      const t = map[k].teacher;
      if (!counts[t]) counts[t] = { low: 0, mid: 0, high: 0, total: 0 };
      if (c.grade <= 2) counts[t].low++;
      else if (c.grade <= 4) counts[t].mid++;
      else counts[t].high++;
      counts[t].total++;
    }
  });

  const rows = [header];
  plan.teachers.forEach(t => {
    const c = counts[t.name] || { low: 0, mid: 0, high: 0, total: 0 };
    const base = t.isHomeroom ? 20 : 22; // 範例：導師基本節數 20、科任 22
    const over = Math.max(0, c.total - base);
    rows.push([t.name, t.subject, c.low, c.mid, c.high, 0, 0, c.total, base, 0, base, 0, t.isHomeroom ? "V" : "", "", t.isHomeroom ? "導師" : "專任", t.title, over, ""]);
  });
  sh.getRange(1, 1, rows.length, header.length).setValues(rows);
  sh.getRange(1, 1, 1, header.length).setFontWeight("bold").setBackground("#e8f0fe");
  sh.setFrozenRows(1);
}

/** 🌊 彈性師表（國小預設不使用，保留空骨架讓系統正常運作） */
function writeElasticSheets_(ss) {
  ["彈性師表", "彈性師表1"].forEach(name => {
    const sh = resetSheet_(ss, name);
    const rows = [["週次", "日期", "節次"]];
    for (let w = 1; w <= SMES.WEEK_COUNT; w++) {
      rows.push([w, "", "第3節"]);
      rows.push(["", "", "第4節"]);
    }
    sh.getRange(1, 1, rows.length, 3).setValues(rows);
    sh.getRange(1, 1, 1, 3).setFontWeight("bold").setBackground("#e8f0fe");
    sh.getRange(1, 4).setValue("← 若有全校彈性課程輪替需求，D 欄起每欄填一位教師姓名；否則整張留空即可");
    sh.setFrozenRows(1);
  });
}

/** ⚙️ 系統設定：代課鐘點費類別與費率（管理員可自行增刪修改） */
function writeSettingsSheet_(ss) {
  const sh = resetSheet_(ss, "系統設定");
  const rows = [
    ["代課類別", "單價(元/節)", "由誰支付", "啟用(Y/N)"],
    ["公費代課", "", "學校經費", "Y"],
    ["自費代課", "", "請假教師", "Y"],
    ["學校移撥", "", "學校經費", "Y"]
  ];
  sh.getRange(1, 1, rows.length, 4).setValues(rows);
  sh.getRange(1, 1, 1, 4).setFontWeight("bold").setBackground("#e8f0fe");
  sh.getRange("B2:B").setNumberFormat("@");
  // 說明列
  sh.getRange(6, 1).setValue("說明：");
  sh.getRange(7, 1).setValue("1. 「單價」請填國小實際代課鐘點費（元/節），空白視為 0，請依現行支給標準填寫。");
  sh.getRange(8, 1).setValue("2. 類別可自行增列或刪除；「由誰支付」填『請假教師』者會列入自費對帳表。");
  sh.getRange(9, 1).setValue("3. 「啟用」填 N 可暫時停用某類別（前端下拉不顯示、結算仍會用其費率）。");
  sh.getRange(6, 1, 4, 1).setFontColor("#64748b");
  sh.setColumnWidth(1, 160); sh.setColumnWidth(3, 120);
  sh.setFrozenRows(1);
}

/** 📋 代課／調課紀錄表（空白，只留表頭） */
function writeRecordSheets_(ss) {
  const subSh = resetSheet_(ss, "代課紀錄表");
  const subHeader = ["是否出單", "單號", "請假教師", "代課教師", "假別", "班級", "科目", "代課日期", "代課節次", "鐘點", "狀態", "備註"];
  subSh.getRange(1, 1, 1, subHeader.length).setValues([subHeader]).setFontWeight("bold").setBackground("#fde8e8");
  subSh.getRange("A2:A200").insertCheckboxes();
  subSh.getRange("H2:H200").setNumberFormat("@");
  subSh.setFrozenRows(1);

  const swapSh = resetSheet_(ss, "調課紀錄表");
  const swapHeader = ["是否出單", "單號", "請假教師", "調課教師", "假別", "班級", "日期A", "節次A", "科目A", "日期B", "節次B", "科目B", "狀態", "備註"];
  swapSh.getRange(1, 1, 1, swapHeader.length).setValues([swapHeader]).setFontWeight("bold").setBackground("#e8f0fe");
  swapSh.getRange("A2:A200").insertCheckboxes();
  swapSh.getRange("G2:G200").setNumberFormat("@");
  swapSh.getRange("J2:J200").setNumberFormat("@");
  swapSh.setFrozenRows(1);
}
