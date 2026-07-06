/**
 * 📅 桃園市龍潭區石門國民小學 全校課表與調代課管理系統 - 後端核心
 * （原創：新北市中和高中教學組 詩穎老師 線上調代課系統公開模板）
 * @version 5
 */
const CONFIG = {
  SCHOOL_NAME: "桃園市龍潭區石門國民小學", // 🏫 通知單抬頭
  SCHOOL_SHORT: "石門國小",               // 🏫 系統標題、信件主旨用簡稱
  // 允許登入的網域（逗號分隔）。留空字串 = 不限制網域（只靠 Email 對照表名單管控）。
  // 也可在「專案設定 → 指令碼屬性」設 ALLOWED_DOMAINS 覆寫。
  ALLOWED_DOMAINS: PropertiesService.getScriptProperties().getProperty("ALLOWED_DOMAINS") || "",
  // 🌐 GitHub Pages 前端網址（老師實際使用的介面；信件連結也指向這裡）
  FRONTEND_URL: PropertiesService.getScriptProperties().getProperty("FRONTEND_URL") || "https://cagoooo.github.io/smes-substitute/",
  // 🔑 Google 登入 OAuth Client ID（設定後會嚴格驗證 id_token 的 aud；未設定時僅驗 email）
  OAUTH_CLIENT_ID: PropertiesService.getScriptProperties().getProperty("OAUTH_CLIENT_ID") || "",
  sheetDB: "排課資料庫",
  sheetTeacher: "教師課表",
  sheetHours: "教學節數",
  elasticTeacherSheets: ["彈性師表", "彈性師表1"],
  sheetEmail: "Email對照表",
  sheetWeeks: "週次對照表",
  sheetSub: "代課紀錄表",
  sheetSwap: "調課紀錄表",
  sheetSettings: "系統設定",
  DAYS: ["一", "二", "三", "四", "五"],
  // 🎯 新增流程控制常量
  STATUS_PENDING: "待受邀人確認",
  STATUS_DONE: "教師皆確認可出單",
  STATUS_FAIL: "不成立",
  STATUS_ADMIN: "可出單",
  TOKEN: PropertiesService.getScriptProperties().getProperty("APP_TOKEN") || "DEMO_TEMPLATE_TOKEN" // 建議隨機設定，用於連結安全驗證
};

/**
 * 🎯 整理後的後端確認流程 (僅保留必要部分)
 */

// 1. 網頁入口：一律轉址到 GitHub Pages 前端（信件確認參數原樣帶過去）
function doGet(e) {
  let qs = "";
  if (e && e.parameter) {
    const keep = ["action", "serial", "token"];
    const parts = keep.filter(k => e.parameter[k]).map(k => k + "=" + encodeURIComponent(e.parameter[k]));
    if (parts.length) qs = "?" + parts.join("&");
  }
  const target = CONFIG.FRONTEND_URL + qs;
  const html = `<!DOCTYPE html><html><head><base target="_top"><meta http-equiv="refresh" content="0;url=${target}"></head>
    <body style="font-family:sans-serif;text-align:center;padding:60px;color:#475569;">
      正在前往${CONFIG.SCHOOL_SHORT}調代課系統…<br><br><a href="${target}">若未自動跳轉請點此</a>
      <script>window.top.location.replace(${JSON.stringify(target)});</script>
    </body></html>`;
  return HtmlService.createHtmlOutput(html).setTitle(CONFIG.SCHOOL_SHORT + "調代課系統");
}

/**
 * 🌐 2. JSON API 入口（GitHub Pages 前端專用）
 * 前端以 Content-Type: text/plain 直接 POST JSON（避免 CORS preflight）：
 *   { fn, args, idToken }
 * 身分由 Google 登入（GIS）的 id_token 驗證取得，不依賴 Session.getActiveUser()。
 */
function doPost(e) {
  let out, fn = "?", email = null;
  try {
    const req = JSON.parse(e.postData.contents);
    fn = req.fn || "?";
    email = verifyIdToken_(req.idToken);
    const args = req.args || [];
    const API = {
      "init":        function () { return getSystemInitDataFor_(email); },
      "weekly":      function () { return getWeeklyDynamicData(parseInt(args[0], 10)); },
      "submit":      function () { return processAdjustmentFor_(args[0], email); },
      "confirmInfo": function () { return getConfirmInfo_(args[0], args[1], email); },
      "confirm":     function () { return handleTeacherAdjustmentFor_(args[0], args[1], args[2], email); }
    };
    if (!API[req.fn]) throw new Error("未知的操作：" + req.fn);
    out = { result: API[req.fn]() };
  } catch (err) {
    out = { error: err.message };
    // 🔔 失敗通知（排除 UNAUTHENTICATED 這類正常的 token 過期，避免洗版）
    if (err.message !== "UNAUTHENTICATED") {
      pushChatCard_("error", "系統發生錯誤", [
        { label: "操作", text: fn },
        { label: "帳號", text: email || "（未驗證）" },
        { label: "錯誤訊息", text: err.message },
        { label: "時間", text: nowStr_() }
      ], "⚠️ 使用者操作時發生例外，請留意。");
    }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 🔑 驗證 Google 登入 id_token，回傳登入者 email（小寫）
 */
function verifyIdToken_(idToken) {
  if (!idToken) throw new Error("UNAUTHENTICATED");
  const res = UrlFetchApp.fetch(
    "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) throw new Error("UNAUTHENTICATED"); // 過期或偽造
  const info = JSON.parse(res.getContentText());
  if (CONFIG.OAUTH_CLIENT_ID && info.aud !== CONFIG.OAUTH_CLIENT_ID) throw new Error("UNAUTHENTICATED");
  if (String(info.email_verified) !== "true" || !info.email) throw new Error("UNAUTHENTICATED");
  return String(info.email).toLowerCase();
}

/**
 * 🔎 由 email 在 Email對照表 找出使用者（找不到回傳 null）
 */
function findUserByEmail_(email) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const emailData = getEmailData_();
  for (let i = 1; i < emailData.length; i++) {
    if (emailData[i][1].toLowerCase() === email) {
      return {
        email: email,
        name: emailData[i][0],
        role: emailData[i][2],
        isAdmin: (emailData[i][2] === "管理員"),
        isStaff: (emailData[i][2] === "行政")
      };
    }
  }
  return null;
}

/**
 * 📨 信件確認頁資訊（前端確認模式用）：驗 token、驗受邀人身分，回傳單據顯示資料
 */
function getConfirmInfo_(serial, token, email) {
  if (token !== CONFIG.TOKEN) return { error: "安全性驗證失敗" };
  const checkRes = getDocumentStatus(serial);
  if (checkRes.error) return { error: checkRes.error };

  const row = checkRes.rowData;
  const invitedTeacherName = row[3];
  const invitedTeacherEmails = getEmailByName(invitedTeacherName);
  const isInvited = !!(invitedTeacherEmails && invitedTeacherEmails.toLowerCase().includes(email));

  const isSwap = serial.startsWith("SWP");
  let info;
  if (!isSwap) {
    info = { date: row[7], time: formatTimeDisplay(row[8]), cls: row[5], subject: row[6], applicant: row[2] };
  } else {
    info = {
      cls: row[5], applicant: row[2],
      mine:   { date: row[9], time: formatTimeDisplay(row[10]), subject: row[11] },
      theirs: { date: row[6], time: formatTimeDisplay(row[7]),  subject: row[8] }
    };
  }
  return { serial: serial, isSwap: isSwap, status: checkRes.status, pending: (checkRes.status === CONFIG.STATUS_PENDING), isInvited: isInvited, invitedTeacherName: invitedTeacherName, info: info };
}

// （已停用，保留參考）舊版 GAS 內建頁面入口
function doGet_legacy_(e) {
  if (e && e.parameter.action && e.parameter.serial) {
    const serial = e.parameter.serial;
    const action = e.parameter.action;
    const token = e.parameter.token;

    if (token !== CONFIG.TOKEN) return HtmlService.createHtmlOutput("⚠️ 安全性驗證失敗");

    const checkRes = getDocumentStatus(serial);
    if (checkRes.error) return HtmlService.createHtmlOutput(`<h1>錯誤：${checkRes.error}</h1>`);

    // 🎯 新增：嚴格驗證登入者是否為「受邀教師」
    const currentUserEmail = Session.getActiveUser().getEmail().toLowerCase();
    const row = checkRes.rowData; // 👈 這裡宣告一次就好
    const invitedTeacherName = row[3]; // 代課(subTeacher)或調課(teacherB)的受邀人都在索引 3 (D欄)
    const invitedTeacherEmails = getEmailByName(invitedTeacherName);
    
    if (!invitedTeacherEmails || !invitedTeacherEmails.toLowerCase().includes(currentUserEmail)) {
      // 🎯 組合當下的完整網址 (包含 action, serial, token)，讓老師切換帳號後能自動跳回來
      const currentUrl = ScriptApp.getService().getUrl() + "?action=" + action + "&serial=" + serial + "&token=" + token;
      const switchUrl = "https://accounts.google.com/AccountChooser?continue=" + encodeURIComponent(currentUrl);
      
      const deniedHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <base target="_top">
            <meta name="viewport" content="width=device-width, initial-scale=1">
          </head>
          <body style="margin:0; background:#f8fafc;">
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; font-family:sans-serif; text-align:center; padding:20px;">
              <div style="background:white; padding:40px; border-radius:15px; box-shadow:0 10px 25px rgba(0,0,0,0.1); max-width:500px; width:100%; box-sizing:border-box;">
                <div style="font-size:60px; margin-bottom:20px;">🚫</div>
                <h2 style="color:#1e293b; margin-bottom:10px;">權限不足</h2>
                <p style="color:#64748b; font-size:16px; line-height:1.6;">
                  您目前登入的帳號：<b style="color:#ef4444;">${currentUserEmail}</b><br>
                  不是此單據的受邀教師，無法執行確認。
                </p>
                <hr style="margin:30px 0; border:0; border-top:1px solid #e2e8f0;">
                <a href="${switchUrl}" style="background:#2563eb; color:white; text-decoration:none; padding:15px 30px; border-radius:8px; font-weight:bold; display:inline-block; transition:background 0.2s;">
                  切換 Google 帳號
                </a>
              </div>
            </div>
          </body>
        </html>
      `;
      return HtmlService.createHtmlOutput(deniedHtml).setTitle("權限不足");
    }

    // 若已處理，顯示完結畫面
    if (checkRes.status !== CONFIG.STATUS_PENDING) {
      return HtmlService.createHtmlOutput(`
        <div style="font-family:sans-serif; text-align:center; padding:50px; color:#475569;">
          <h2>單據 ${serial} 已處理</h2>
          <p>目前的狀態為：<b>${checkRes.status}</b></p>
          <p>您可以直接關閉此視窗。</p>
        </div>
      `);
    }

    // 解析顯示資訊... (⚠️ 原本重複的 const row 已經刪除)
    const isSwap = serial.startsWith("SWP");
    let infoHtml = ""; 
    
    if (!isSwap) {
      infoHtml = `<div style="background:#f0fdf4; border:1px solid #bbf7d0; padding:15px; border-radius:8px; text-align:left;">
          <div><b>🗓️ 日期：</b> ${row[7]}</div>
          <div><b>⏰ 節次：</b> ${formatTimeDisplay(row[8])}</div>
          <div><b>🏫 班級：</b> ${row[5]} ${row[6]}</div>
          <div><b>👤 申請老師：</b> ${row[2]}</div>
        </div>`;
    } else {
      infoHtml = `<div style="background:#eff6ff; border:1px solid #bfdbfe; padding:15px; border-radius:8px; text-align:left;">
          <div style="margin-bottom:8px; border-bottom:1px dashed #3b82f6; padding-bottom:8px;"><b>🏫 班級：</b> ${row[5]}</div>
          <div><span style="color:#3b82f6; font-weight:bold;">[您的課節]</span><br>${row[9]} (${formatTimeDisplay(row[10])}) - ${row[11]}</div>
          <div style="text-align:center; color:#64748b; margin:5px 0;"> ⬇️ 互調 ⬇️ </div>
          <div><span style="color:#1e40af; font-weight:bold;">[對方的課節]</span><br>${row[6]} (${formatTimeDisplay(row[7])}) - ${row[8]}</div>
        </div>`;
    }

    const actionText = (action === "accept") ? "同意並確認" : "拒絕此申請";
    const btnColor = (action === "accept") ? "#22c55e" : "#ef4444";

    // 回傳包含精確 ID 控制的 HTML
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <base target="_top">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: sans-serif; background-color: #f1f5f9; margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
            .card { background: white; padding: 30px; border-radius: 15px; max-width: 400px; width: 90%; box-shadow: 0 10px 15px rgba(0,0,0,0.1); text-align: center; }
            .btn { background: ${btnColor}; color: white; padding: 16px; border: none; border-radius: 8px; font-size: 18px; cursor: pointer; width: 100%; font-weight: bold; }
            .spinner { border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; width: 20px; height: 20px; animation: spin 1s linear infinite; display: inline-block; vertical-align: middle; margin-right: 8px; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          </style>
        </head>
        <body>
          <div class="card">
            <div id="contentBlock">
              <h2 style="margin-top:0; color:#1e293b;">調代課確認</h2>
              <p>單號：<b>${serial}</b></p>
              <div style="font-size: 20px; font-weight: bold; color: ${btnColor}; margin-bottom:20px;">${actionText}</div>
              <div style="margin-bottom:20px;">${infoHtml}</div>
              <button class="btn" id="mainBtn" onclick="runServer()">確定執行</button>
            </div>
            <div id="statusMsg" style="display:none; padding:20px 0;">
              <h2 id="finalTitle"></h2>
              <p id="finalText" style="color:#475569;"></p>
              <br>
              <p style="color:#94a3b8; font-size:12px;" id="closeHint"></p>
              
            </div>
          </div>
          <script>
            function runServer() {
              const btn = document.getElementById('mainBtn');
              btn.disabled = true;
              btn.innerHTML = '<span class="spinner"></span> 處理中...';
              
              google.script.run
                .withSuccessHandler(function(res) {
                  document.getElementById('contentBlock').style.display = 'none';
                  document.getElementById('statusMsg').style.display = 'block';
                  if (res.success) {
                    document.getElementById('finalTitle').innerHTML = '✅ 操作成功';
                    document.getElementById('finalTitle').style.color = '#22c55e';
                    document.getElementById('finalText').innerHTML = '回覆已記錄，並已發信通知相關人員。可直接關閉視窗';
                  } else {
                    document.getElementById('finalTitle').innerHTML = '❌ 處理失敗';
                    document.getElementById('finalTitle').style.color = '#ef4444';
                    document.getElementById('finalText').innerHTML = res.error;
                  }
                })
                .handleTeacherAdjustment('${action}', '${serial}', '${token}');
            }
          </script>
        </body>
      </html>
    `;
    return HtmlService.createHtmlOutput(html).setTitle(CONFIG.SCHOOL_SHORT + "調代課確認系統");
  }

  // 進入主程式網頁
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle(CONFIG.SCHOOL_SHORT + '調代課系統')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// 3. 核心邏輯處理（舊版 google.script.run 相容入口）
function handleTeacherAdjustment(action, serial, token) {
  return handleTeacherAdjustmentFor_(action, serial, token, Session.getActiveUser().getEmail().toLowerCase());
}

// 核心邏輯處理：currentUserEmail 由 API 層以 id_token 驗證後帶入
function handleTeacherAdjustmentFor_(action, serial, token, currentUserEmail) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    if (token !== CONFIG.TOKEN) throw new Error("驗證失敗");

    const check = getDocumentStatus(serial);
    if (check.error) throw new Error(check.error);
    if (check.status !== CONFIG.STATUS_PENDING) throw new Error("單據已處理");

    // 🎯 後端驗證執行者身分（雙重防護）
    const invitedTeacherName = check.rowData[3];
    const invitedTeacherEmails = getEmailByName(invitedTeacherName);
    if (!invitedTeacherEmails || !invitedTeacherEmails.toLowerCase().includes(currentUserEmail)) {
      throw new Error("權限不足：您不是此單據的受邀教師，無法執行操作。");
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const isSwap = serial.startsWith("SWP");
    const sheet = ss.getSheetByName(isSwap ? CONFIG.sheetSwap : CONFIG.sheetSub);
    const data = sheet.getDataRange().getDisplayValues();
    
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] === serial) { rowIndex = i + 1; break; }
    }

    const teacherAEmail = getEmailByName(data[rowIndex-1][2]);

    if (action === "accept") {
      sheet.getRange(rowIndex, isSwap ? 13 : 11).setValue(CONFIG.STATUS_DONE);
      SpreadsheetApp.flush();
      if (teacherAEmail) sendResultEmail(true, serial, teacherAEmail, data[rowIndex-1]);
      // 🎯 新增：發送 LINE 推播通知
      notifyAdmin(`🔔【${CONFIG.SCHOOL_SHORT}調代課通知】\n教師已同意調代課申請！\n單號：${serial}\n狀態：可出單\n請有空至系統列印單據。`);
      return { success: true };
    } else {
      sheet.getRange(rowIndex, isSwap ? 13 : 11).setValue(CONFIG.STATUS_FAIL);
      sheet.getRange(rowIndex, isSwap ? 14 : 12).setValue("受邀教師已拒絕");
      SpreadsheetApp.flush();
      if (teacherAEmail) sendResultEmail(false, serial, teacherAEmail, data[rowIndex-1]);
      return { success: true };
    }
  } catch (e) {
    pushChatCard_("error", "調代課確認失敗", [
      { label: "單號", text: serial },
      { label: "動作", text: action === "accept" ? "同意" : "拒絕" },
      { label: "執行者", text: currentUserEmail || "?" },
      { label: "錯誤訊息", text: e.message },
      { label: "時間", text: nowStr_() }
    ], "⚠️ 受邀教師確認單據時失敗。");
    return { success: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}



/**
 * 🎯 輔助函式：快速查詢單據目前狀態
 */
function getDocumentStatus(serial) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const isSwap = serial.startsWith("SWP");
    const sheet = ss.getSheetByName(isSwap ? CONFIG.sheetSwap : CONFIG.sheetSub);
    if (!sheet) return { error: "找不到紀錄表" };

    const data = sheet.getDataRange().getDisplayValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] === serial) {
        return { 
          status: data[i][isSwap ? 12 : 10].trim(), // 🎯 加入 trim() 避免空格干擾
          rowData: data[i] 
        };
      }
    }
    return { error: "找不到單號" };
  } catch (e) {
    return { error: e.message };
  }
}



/**
 * 🎯 修改後的 getSystemInitData：除了 baseData，也回傳該老師的全量異動
 */
/**
 * 🎯 強化版身分驗證：限定網域與名單校核
 */
function getSystemInitData() {
  return getSystemInitDataFor_(Session.getActiveUser().getEmail());
}

// 初始資料：email 由 API 層以 id_token 驗證後帶入
function getSystemInitDataFor_(email) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. 網域檢查（CONFIG.ALLOWED_DOMAINS 有設定才啟用；多網域用逗號分隔）
  if (CONFIG.ALLOWED_DOMAINS) {
    const allowList = CONFIG.ALLOWED_DOMAINS.split(",").map(d => d.trim().toLowerCase()).filter(d => d);
    const userDomain = email.includes("@") ? email.split("@").pop().toLowerCase() : "";
    if (allowList.length > 0 && !allowList.includes(userDomain)) {
      maybeNotifyDenied_(email, "網域不符（非學校帳號）");
      return {
        error: "DOMAIN_WRONG",
        email: email,
        msg: "請切換至學校提供的 Google 帳號 (@smes.tyc.edu.tw / @mail2.smes.tyc.edu.tw)"
      };
    }
  }

  // 2. 名單校核 (Email對照表)
  const emailData = getEmailData_();
  let user = null;
  for (let i = 1; i < emailData.length; i++) {
    if (emailData[i][1].toLowerCase() === email.toLowerCase()) {
      user = { 
        email: email, 
        name: emailData[i][0], 
        role: emailData[i][2], 
        isAdmin: (emailData[i][2] === "管理員"), 
        isStaff: (emailData[i][2] === "行政") 
      };
      break;
    }
  }

  // 3. 如果 Email 正確但不在名單內
  if (!user) {
    maybeNotifyDenied_(email, "不在授權名單內");
    return {
      error: "NOT_IN_LIST",
      email: email,
      msg: "您的帳號不在授權名單內，請聯繫教學組確認權限。"
    };
  }

  // ✅ 成功通知：偵測到「首次登入」的新使用者才推播（避免每次登入洗版）
  maybeNotifyNewUser_(user);

  // --- 原有的週次與資料抓取邏輯 (保持不變) ---
  const timezone = ss.getSpreadsheetTimeZone();
let checkDate = new Date();
let day = checkDate.getDay(); // 0是週日，6是週六
if (day === 6) checkDate.setDate(checkDate.getDate() + 2); // 遇週六跳至下週一
if (day === 0) checkDate.setDate(checkDate.getDate() + 1); // 遇週日跳至下週一
const todayStr = Utilities.formatDate(checkDate, timezone, "yyyy/MM/dd");
  const weekData = ss.getSheetByName(CONFIG.sheetWeeks).getDataRange().getDisplayValues();
  let initialWeekIndex = 0;
  const weeks = weekData.slice(1).map((r, i) => {
    let weekDates = r.slice(1);
    let validDates = weekDates.filter(d => d.trim() !== "");
    let dateRange = validDates.length > 0 ? `${validDates[0]} - ${validDates[validDates.length-1]}` : "";
    if (weekDates.includes(todayStr)) initialWeekIndex = i;
    return { index: i, label: `第 ${r[0]} 週`, range: dateRange, dates: weekDates };
  });

  return {
    user,
    weeks,
    teacherList: getAllTeacherNames(),
    initialWeekIndex,
    baseData: getAllInitData(),
    feeCategories: getFeeSettings_(),   // 💰 代課鐘點費類別（前端下拉用）
    todayStr
  };
}

/**
 * 🎯 修改後的 getWeeklyDynamicData：回傳本週紀錄(供課表覆蓋) + 全量紀錄(供右側摘要)
 */
function getWeeklyDynamicData(weekIdx) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const weekNum = weekIdx + 1;
  const weekRow = ss.getSheetByName(CONFIG.sheetWeeks).getDataRange().getDisplayValues()[weekNum];
  const weekDates = weekRow.slice(1); 

  // 1. 全量讀取異動資料 (不篩選週次，給右側清單用)
  const allSubData = ss.getSheetByName(CONFIG.sheetSub).getDataRange().getDisplayValues().slice(1);
  const allSwapData = ss.getSheetByName(CONFIG.sheetSwap).getDataRange().getDisplayValues().slice(1);

  // 2. 篩選出本週資料 (給左側課表覆蓋用)
  const weeklySub = allSubData.filter(r => weekDates.includes(r[7]));
  const weeklySwap = allSwapData.filter(r => weekDates.includes(r[6]) || weekDates.includes(r[9]));

  return { 
    weekDates, 
    weeklyChanges: { allSub: weeklySub, allSwap: weeklySwap }, // 給課表用的本週紀錄
    fullChanges: { allSub: allSubData, allSwap: allSwapData } // 🎯 給右側摘要用的全量紀錄
  };
}

function getIntegratedWeeklySchedule(tName, weekIdx) {
  const initData = getAllInitData(); 
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const weekNum = weekIdx + 1;
  const weekRow = ss.getSheetByName(CONFIG.sheetWeeks).getDataRange().getDisplayValues()[weekNum];
  const weekDates = weekRow.slice(1); 
  const isEvenWeek = (weekNum % 2 === 0);

  const allSub = ss.getSheetByName(CONFIG.sheetSub).getDataRange().getDisplayValues().slice(1).filter(r => weekDates.includes(r[7]));
  const allSwap = ss.getSheetByName(CONFIG.sheetSwap).getDataRange().getDisplayValues().slice(1).filter(r => weekDates.includes(r[6]) || weekDates.includes(r[9]));

  let schedule = JSON.parse(JSON.stringify(initData.teacherSchedules[tName] || {}));
  // 🎯 空白日期隱藏（國小版：移除原高中「高三畢業動態隱藏」，
  //    因國小三年級班名同樣以 3 開頭，套用會誤刪課表）
  const days = ["一", "二", "三", "四", "五"];
  days.forEach((d, i) => {
    // 🎯 如果該天沒有日期，直接清空整天課表
    if (!weekDates[i] || weekDates[i].trim() === "") {
      for (let p = 1; p <= 8; p++) delete schedule[d + p];
      return;
    }
  });
  for (let key in schedule) {
    let item = schedule[key];
    // 🎯 國小版：不再強制把第 8 節標成「輔導」（那是高中第八節輔導課制度）。
    //    但保留「單／雙週」課程的解析，各節次皆適用。
    if (item.sub.includes("單") || item.sub.includes("雙")) {
      let p = parseSingleDouble(item.sub, item.cls, isEvenWeek);
      if (p) { item.sub = p.sub; item.cls = p.cls; } else { delete schedule[key]; }
    }
  }

  for (let sName in initData.elasticData.teacher) {
    let list = initData.elasticData.teacher[sName][tName] || [];
    list.forEach(item => {
      if (String(item.w) === String(weekNum)) {
        let val = item.val ? String(item.val).trim() : "";
        if (val !== "" && val !== "0") {
          schedule[item.d + item.p] = { sub: "彈性學習", cls: val, tag: '<span class="attr-tag tag-green">實支</span>', rawAttr: "實支", isElastic: true, rawP: item.rawP };
        } else {
          if (schedule[item.d + item.p] && (schedule[item.d + item.p].sub.includes("彈性") || schedule[item.d + item.p].sub.includes("輪流"))) {
            delete schedule[item.d + item.p];
          }
        }
      }
    });
  }

// 🎯 取得目前查詢老師的拆解陣列
  let tNameList = String(tName).split(/[&/]/).map(n => n.trim());

  // 🎯 修正：先處理調課 (Swap)
  allSwap.forEach(row => {
    let tA = row[2], tB = row[3], cls = row[5], dateA = row[6], perA = row[7], subA = row[8], dateB = row[9], perB = row[10], subB = row[11];
    
    let tAList = String(tA).split(/[&/]/).map(n => n.trim());
    let tBList = String(tB).split(/[&/]/).map(n => n.trim());
    
    // 只要 tNameList 裡面有任何一個名字出現在 tAList 裡，就算命中
    if (tNameList.some(n => tAList.includes(n))) {
      if (weekDates.includes(dateA)) schedule[perA] = { sub: subA, cls: cls, tag: '<span class="attr-tag tag-gray">調出</span>', rawAttr: "調出", type: 'swap_out' };
      if (weekDates.includes(dateB)) schedule[perB] = { sub: subA, cls: cls, tag: '<span class="attr-tag tag-green">調入</span>', rawAttr: "調入", type: 'in' };
    }
    if (tNameList.some(n => tBList.includes(n))) {
      if (weekDates.includes(dateB)) schedule[perB] = { sub: subB, cls: cls, tag: '<span class="attr-tag tag-gray">調出</span>', rawAttr: "調出", type: 'swap_out' };
      if (weekDates.includes(dateA)) schedule[perA] = { sub: subB, cls: cls, tag: '<span class="attr-tag tag-green">調入</span>', rawAttr: "調入", type: 'in' };
    }
  });

  // 🎯 修正：再處理代課 (Sub)
  allSub.forEach(row => {
    let leaveT = row[2], subT = row[3], cls = row[5], subName = row[6], date = row[7], timeKey = row[8];
    
    let leaveTList = String(leaveT).split(/[&/]/).map(n => n.trim());
    let subTList = String(subT).split(/[&/]/).map(n => n.trim());
    
    if (tNameList.some(n => leaveTList.includes(n))) schedule[timeKey] = { sub: subName, cls: cls, tag: '<span class="attr-tag tag-red">請假</span>', rawAttr: "請假", type: 'sub_out' };
    if (tNameList.some(n => subTList.includes(n))) schedule[timeKey] = { sub: subName, cls: cls, tag: '<span class="attr-tag tag-green">代課</span>', rawAttr: "代課", type: 'in' };
  });

  return { schedule, weekDates, baseData: initData, weeklyChanges: { allSub, allSwap } };
}

function parseSingleDouble(rawSub, rawCls, isEven) {
  const getVal = (str, type) => {
    const regex = type === 'even' ? /雙([^單雙\s/]+)/ : /單([^單雙\s/]+)/;
    const match = str.match(regex);
    return match ? match[1].trim() : null;
  };
  let tSub = getVal(rawSub, isEven ? 'even' : 'odd'), tCls = getVal(rawCls, isEven ? 'even' : 'odd');
  if (!tSub && !tCls) return null;
  if (!tSub) tSub = rawSub.replace(/[單雙]/g, "");
  if (!tCls) tCls = rawCls.replace(/[單雙]/g, "");
  return { sub: tSub, cls: tCls };
}

function getAllInitData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const getSafe = (n, isT = false) => {
    const cacheable = [CONFIG.sheetTeacher, CONFIG.sheetHours];
    if (cacheable.includes(n)) {
      const cacheKey = "smes_sub_cache_" + n;
      let cached = CacheHelper_.get(cacheKey);
      if (cached) return cached;
      
      let s = ss.getSheetByName(n); if (!s) return [];
      let data = isT ? s.getDataRange().getDisplayValues() : s.getDataRange().getDisplayValues().slice(1);
      CacheHelper_.put(cacheKey, data, 7200);
      return data;
    }
    let s = ss.getSheetByName(n); if (!s) return [];
    return isT ? s.getDataRange().getDisplayValues() : s.getDataRange().getDisplayValues().slice(1);
  };
  const dbData = getSafe(CONFIG.sheetDB), tData = getSafe(CONFIG.sheetTeacher, true), hoursData = getSafe(CONFIG.sheetHours);
  let teacherProfileMap = {};
  hoursData.forEach(r => { let name = r[0].trim(); if (name) teacherProfileMap[name] = `職稱: ${r[15]||"無"} | 基${r[8]||0} 兼${r[16]||0} 輔${r[11]||0}`; });
  let elasticData = { class: {}, teacher: {} };
  CONFIG.elasticTeacherSheets.forEach(s => { let m = fetchElasticSheet(ss.getSheetByName(s)); if(m) elasticData.teacher[s] = m; });
  let teacherSchedules = {};
  let teacherSubjectMap = {}; // 🎯 新增：儲存老師所屬科目 (A欄)
  for (let i = 2; i < tData.length; i++) {
    let tSubject = String(tData[i][0]).trim(); // 🎯 抓取 A 欄 (科目)
    let tName = String(tData[i][1]).trim(); if (!tName) continue;
    teacherSubjectMap[tName] = tSubject;
    teacherSchedules[tName] = {};
    for (let d = 0; d < 5; d++) {
      for (let p = 1; p <= 8; p++) {
        let sub = String(tData[i][2+(d*16)+((p-1)*2)]).trim();
        let cls = String(tData[i][2+(d*16)+((p-1)*2)+1]).trim();
        let attr = String(tData[i][82+(d*8)+(p-1)] || "").trim();
        if (sub && !["N", "n", "0", "", "(會議)"].includes(sub)) {
           // 🎯 修正：基礎課表同時存 HTML 標籤與純文字屬性
           teacherSchedules[tName][CONFIG.DAYS[d]+p] = { sub, cls, tag: createAttrTag(attr), rawAttr: attr };
        }
      }
    }
  }
  let classData = {};
  dbData.forEach(r => {
    let c = r[0].trim(), d = r[1], p = r[2], s = r[3];
    if (!classData[c]) classData[c] = { schedule: {} };
    classData[c].schedule[d+p] = `${s}<br><small>${r[4]}</small>`;
  });
  return { classData, teacherSchedules, teacherProfileMap, elasticData, teacherSubjectMap };
}

function fetchElasticSheet(sheet) {
  if (!sheet) return null;
  const sheetName = sheet.getName();
  const cacheKey = "smes_sub_cache_" + sheetName;
  let cached = CacheHelper_.get(cacheKey);
  if (cached) return cached;

  const data = sheet.getDataRange().getDisplayValues();
  const headers = data[0].map(h => h.trim());
  let sheetMap = {};
  for (let col = 3; col < data[0].length; col++) {
    let name = headers[col]; if (!name) continue;
    let list = [], curW = "", curD = "";
    for (let row = 1; row < data.length; row++) {
      if (data[row][0] !== "") curW = data[row][0];
      if (data[row][1] !== "") curD = data[row][1];
      let dayKey = curD.slice(-1), periodKey = data[row][2].replace(/[^\d]/g, ""); 
      list.push({ w: curW, d: dayKey, p: periodKey, rawP: data[row][2], val: data[row][col].trim() });
    }
    sheetMap[name] = list;
  }
  
  CacheHelper_.put(cacheKey, sheetMap, 7200);
  return sheetMap;
}

function createAttrTag(attr) {
  if (!attr) return "";
  let c = attr.includes("實支") ? "tag-green" : (attr.includes("輔導") ? "tag-blue" : "tag-red");
  return `<span class="attr-tag ${c}">${attr}</span>`;
}

function getAllTeacherNames() {
  const s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.sheetTeacher);
  return s ? s.getDataRange().getDisplayValues().slice(2).map(r => r[1].trim()).filter(n => n) : [];
}

/**
 * 🎯 修改後的 processAdjustment：提交後自動發信
 */
function processAdjustment(data) {
  return processAdjustmentFor_(data, Session.getActiveUser().getEmail().toLowerCase());
}

// 提交申請：email 由 API 層以 id_token 驗證後帶入
function processAdjustmentFor_(data, email) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userAuth = findUserByEmail_(email); // 🎯 取得目前操作者身份
  if (!userAuth) return { success: false, error: "您的帳號不在授權名單內" };
  try {
    const isSwap = (data.mode === 'swap');
    const sheetName = isSwap ? CONFIG.sheetSwap : CONFIG.sheetSub;
    const sheet = ss.getSheetByName(sheetName);
    
    const bValues = sheet.getRange("B:B").getValues();
    let nextRow = 2;
    for (let i = 1; i < bValues.length; i++) { if (bValues[i][0] === "") { nextRow = i + 1; break; } }
    
    const serial = getNextSerial(isSwap ? '調課' : '代課');
    
    // 🎯 邏輯：管理員提交直接設為「可出單」，否則為「待確認」
    const status = userAuth.isAdmin ? CONFIG.STATUS_ADMIN : CONFIG.STATUS_PENDING;
    
    let rowData = !isSwap 
      ? ["FALSE", serial, data.leaveTeacher, data.subTeacher, data.reason, data.cls, data.subject, data.date, data.timeKey, data.subFee, status, data.note]
      : ["FALSE", serial, data.teacherA, data.teacherB, data.reason, data.cls, data.dateA, data.timeA, data.subA, data.dateB, data.timeB, data.subB, status, data.note];
    
    sheet.getRange(nextRow, 1, 1, rowData.length).setValues([rowData]);

    // --- 🎯 寄信邏輯分流 ---
    if (userAuth.isAdmin) {
      // 管理員提交：直接寄通知信給 A 與 B
      sendAdminDirectEmail(data, serial);
       // 🎯 新增：發送 LINE 推播通知
      notifyAdmin(`🔔【${CONFIG.SCHOOL_SHORT}調代課通知】\n教學組已直接確認一筆新單據！\n單號：${serial}\n請有空至系統列印單據。`);
    } else {
      // 一般教師提交：寄邀請信給 B
      const teacherBName = isSwap ? data.teacherB : data.subTeacher;
      const teacherBEmail = getEmailByName(teacherBName);
      if (teacherBEmail) {
         sendInviteEmail(data, serial, teacherBEmail, teacherBName);
      }
    }

    // ✅ 成功通知：有人成功送出一筆調代課申請
    pushChatCard_("success", (data.mode === 'swap' ? "新調課申請" : "新代課申請"), [
      { label: "單號", text: serial },
      { label: "申請人", text: (data.mode === 'swap' ? data.teacherA : data.leaveTeacher) + "（" + userAuth.name + "）" },
      { label: "狀態", text: status },
      { label: "時間", text: nowStr_() }
    ], userAuth.isAdmin ? "🟢 教學組直接確認，可出單。" : "🟡 已寄邀請信給受邀教師，待對方確認。");

    return { success: true, serial: serial };
  } catch (e) {
    pushChatCard_("error", "調代課申請失敗", [
      { label: "操作者", text: email },
      { label: "錯誤訊息", text: e.message },
      { label: "時間", text: nowStr_() }
    ], "⚠️ 使用者送出調代課申請時失敗。");
    return { success: false, error: e.message };
  }
}

function getNextSerial(type) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const prefix = (type === '代課') ? "SUB" : "SWP";
  const sheet = ss.getSheetByName(type === '代課' ? CONFIG.sheetSub : CONFIG.sheetSwap);
  const bValues = sheet.getRange("B:B").getValues();
  
  let maxNum = 1000; // 🎯 預設從 1000 開始，第一筆會是 1001
  
  // 掃描整欄，找出目前最大的序號
  for (let i = 1; i < bValues.length; i++) {
    let val = String(bValues[i][0]).trim();
    if (val.startsWith(prefix)) {
      let num = parseInt(val.replace(prefix, ""), 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }
  
  return prefix + (maxNum + 1);
}



/**
 * 🎯 輔助函式：將 timeKey (例如 "五4") 轉換為更易讀的格式 (例如 "週五 第4節")
 */
function formatTimeDisplay(timeKey) {
  if (!timeKey || timeKey.length < 2) return timeKey;
  const day = timeKey[0];
  const period = timeKey.slice(1);
  return `週${day} 第${period}節`;
}

/**
 * 🎯 輔助函式：發送初始邀請信
 */
function sendInviteEmail(data, serial, email, name) {
  const isSwap = (data.mode === 'swap');
  const webUrl = CONFIG.FRONTEND_URL; // 🌐 確認連結指向 GitHub Pages 前端
  const acceptUrl = `${webUrl}?action=accept&serial=${serial}&token=${CONFIG.TOKEN}`;
  const declineUrl = `${webUrl}?action=decline&serial=${serial}&token=${CONFIG.TOKEN}`;

  let body = "";
  if (!isSwap) {
    // --- 代課信件模板 ---
    body = `
      <div style="font-family: 'Microsoft JhengHei', sans-serif; line-height: 1.6; color: #333;">
        <h3 style="color: #2c3e50;">【代課申請確認通知】</h3>
        您好，<b>${data.leaveTeacher}</b> 教師向您提出一項 [代課] 申請：<br><br>
        <b>日期：</b> ${data.date}<br>
        <b>節次：</b> ${formatTimeDisplay(data.timeKey)}<br>
        <b>班級科目：</b> ${data.cls} ${data.subject}<br><br>
        ✅ 系統初步核對：您該時段為 [空堂]。<br><br>
        <p><b>[ 您是否同意此項代課？ ]</b></p>
        <a href="${acceptUrl}" style="background:#22c55e; color:white; padding:12px 25px; text-decoration:none; border-radius:5px; display: inline-block; font-weight: bold; margin-bottom: 10px;">Ｏ 我同意並送交確認至教學組</a><br>
        <a href="${declineUrl}" style="background:#ef4444; color:white; padding:12px 25px; text-decoration:none; border-radius:5px; display: inline-block; font-weight: bold;">Ｘ 我不同意/有困難</a>
        <p style="color: #888; font-size: 13px; margin-top: 25px;">(此為系統自動發送，請勿直接回覆，若有代課疑問請洽申請教師)</p>
      </div>
    `;
  } else {
    // --- 調課信件模板 ---
    body = `
      <div style="font-family: 'Microsoft JhengHei', sans-serif; line-height: 1.6; color: #333;">
        <h3 style="color: #2c3e50;">【調課申請確認通知】</h3>
        您好，<b>${data.teacherA}</b> 教師向您提出一項 [調課] 申請：<br><br>
        <div style="background-color: #f8f9fa; padding: 15px; border-left: 5px solid #3b82f6;">
          <div style="margin-bottom: 8px;"><b>原節次：</b> ${data.dateB} ${formatTimeDisplay(data.timeB)} </div>
          <div style="margin-bottom: 8px;"><b>班級科目：</b> ${data.cls} ${data.subB}</div>
          <div style="margin-bottom: 0;"><b>調至節次：</b> ${data.dateA} ${formatTimeDisplay(data.timeA)} </div>
        </div>
        <br>
        ✅ 經系統初步核對，您在該調動時段為空堂。<br><br>
        <p><b>[ 您是否同意此項調課？ ]</b></p>
        <a href="${acceptUrl}" style="background:#3b82f6; color:white; padding:12px 25px; text-decoration:none; border-radius:5px; display: inline-block; font-weight: bold; margin-bottom: 10px;">Ｏ 我同意並送交確認至教學組</a><br>
        <a href="${declineUrl}" style="background:#6b7280; color:white; padding:12px 25px; text-decoration:none; border-radius:5px; display: inline-block; font-weight: bold;">Ｘ 我不同意/有困難</a>
        <p style="color: #888; font-size: 13px; margin-top: 25px;">(此為系統自動發送，請勿直接回覆，若有調課疑問請洽申請教師)</p>
      </div>
    `;
  }

  MailApp.sendEmail({
    to: email,
    subject: `【${CONFIG.SCHOOL_SHORT}調代課申請】${name} 教師請確認一項調課／代課申請 (${serial})`,
    htmlBody: body
  });
}

/**
 * 🎯 輔助函式：發送結果通知信給老師 A (申請人)
 */
/**
 * 🎯 修正版：發送結果通知信給老師 A (請假教師)
 * 根據代課或調課類型產出詳盡的對照內容
 */
function sendResultEmail(isAccepted, serial, email, rowData) {
  const isSwap = serial.startsWith("SWP");
  let detailsHtml = "";
  let subjectStr = "";

  // --- 1. 根據類型解析資料與產出主旨資訊 ---
  if (!isSwap) {
    // 代課(Sub)索引: [2]請假人A, [3]代課人B, [5]班級, [6]科目, [7]日期, [8]節次
    const nameA = rowData[2];
    const nameB = rowData[3];
    const date = rowData[7];
    const time = formatTimeDisplay(rowData[8]);
    const cls = rowData[5];
    const sub = rowData[6];

    subjectStr = `${date} ${time} ${cls}${sub} 代課`;
    detailsHtml = `
      <b>日期：</b> ${date}<br>
      <b>節次：</b> ${time}<br>
      <b>班級科目：</b> ${cls} ${sub}<br>
      <b>代課教師：</b> ${nameB} (原授課：${nameA})
    `;
  } else {
    // 調課(Swap)索引: [2]師A, [3]師B, [5]班級, [6]日A, [7]時A, [8]科A, [9]日B, [10]時B, [11]科B
    const nameA = rowData[2];
    const nameB = rowData[3];
    const cls = rowData[5];
    const dateA = rowData[6], timeA = formatTimeDisplay(rowData[7]), subA = rowData[8];
    const dateB = rowData[9], timeB = formatTimeDisplay(rowData[10]), subB = rowData[11];

    subjectStr = `${dateA} ${timeA} 與 ${dateB} ${timeB} 調課`;
    detailsHtml = `
      <b>原節次：</b> ${nameA} 老師 ${dateA} ${timeA} <br>
      <b>與</b> ${nameB} 老師 ${dateB} ${timeB} <b>互調</b><br>
      <b>班級科目：</b> ${cls} ${subA} ←→ ${cls} ${subB}
    `;
  }

  // --- 2. 根據是否成立設定樣式與文字 ---
  const statusTitle = isAccepted ? "【調代課已確認】" : "【調代課不成立】";
  const themeColor = isAccepted ? "#15803d" : "#b91c1c";
  const bgColor = isAccepted ? "#f0fdf4" : "#fff1f2";
  const borderColor = isAccepted ? "#22c55e" : "#f43f5e";

  const htmlBody = `
    <div style="font-family: 'Microsoft JhengHei', sans-serif; line-height: 1.6; color: #333;">
      <h3 style="color: ${themeColor};">${isAccepted ? "✅ 您的調代課申請已獲對方同意" : "❌ 您的調代課申請已被拒絕"}</h3>
      您好，關於您發起的申請結果如下：<br><br>
      <div style="background-color: ${bgColor}; padding: 15px; border-left: 5px solid ${borderColor};">
        <b>單號：</b> ${serial}<br>
        ${detailsHtml}<br>
        <b>結果：</b> <span style="color: ${themeColor}; font-weight: bold;">${isAccepted ? "教師皆已確認" : "申請不成立"}</span>
      </div>
      
      ${isAccepted 
        ? `<p style="margin-top: 15px;">本申請已送交教學組，將由教學組<b>直接出單</b>，請依照異動後的時間準時上課。</p>` 
        : `<p style="margin-top: 15px; color: #b91c1c; font-weight: bold;">💡 提醒：受邀教師回報有困難，請您另尋其他教師調代課並重新提交申請。</p>`
      }
      
      <p style="color: #888; font-size: 13px; margin-top: 20px;">(此為系統自動發送，請勿直接回覆)</p>
    </div>
  `;

  // --- 3. 發送郵件 ---
  MailApp.sendEmail({
    to: email,
    subject: `【${CONFIG.SCHOOL_SHORT}】${statusTitle} ${subjectStr} (${serial})`,
    htmlBody: htmlBody
  });
}

/**
 * 🎯 輔助函式：根據人名找 Email (支援協同教學與過濾教室名稱)
 */
function getEmailByName(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = ss.getSheetByName(CONFIG.sheetEmail).getDataRange().getDisplayValues();
  
  // 將 "簡正育 & 音樂教室1" 拆解成 ["簡正育", "音樂教室1"]
  let names = String(name).split(/[&/]/).map(n => n.trim());
  let emails = [];
  
  for (let n of names) {
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].trim() === n) {
        emails.push(data[i][1].trim());
        break; // 找到就換下一個名字
      }
    }
  }
  // 如果有找到信箱，用逗號串接回傳 (支援同時寄給多位老師)
  return emails.length > 0 ? emails.join(",") : null;
}

/**
 * 🎯 新增：管理員直接提交時的通知信 (免確認)
 */
function sendAdminDirectEmail(data, serial) {
  const isSwap = (data.mode === 'swap');
  
  // 找出 A 與 B 的 Email
  const nameA = isSwap ? data.teacherA : data.leaveTeacher;
  const nameB = isSwap ? data.teacherB : data.subTeacher;
  const emailA = getEmailByName(nameA);
  const emailB = getEmailByName(nameB);
  
  const subjectStr = isSwap 
    ? `${data.dateA} ${formatTimeDisplay(data.timeA)} 與 ${data.dateB} ${formatTimeDisplay(data.timeB)} 調課`
    : `${data.date} ${formatTimeDisplay(data.timeKey)} ${data.cls} 代課`;

  let detailsHtml = "";
  if (!isSwap) {
    detailsHtml = `
      <b>日期：</b> ${data.date}<br>
      <b>節次：</b> ${formatTimeDisplay(data.timeKey)}<br>
      <b>班級科目：</b> ${data.cls} ${data.subject}<br>
      <b>代課教師：</b> ${data.subTeacher} (原授課：${data.leaveTeacher})
    `;
  } else {
    detailsHtml = `
      <b>原節次：</b> ${data.teacherA} 老師${data.dateA} ${formatTimeDisplay(data.timeA)} <br>
      <b>與</b> ${data.teacherB} 老師${data.dateB} ${formatTimeDisplay(data.timeB)} <b>互調</b><br>
      <b>班級科目：</b> ${data.cls} ${data.subA} ←→ ${data.cls} ${data.subB} 
    `;
  }

  const htmlBody = `
    <div style="font-family: 'Microsoft JhengHei', sans-serif; line-height: 1.6; color: #333;">
      <h3 style="color: #15803d;">【調課確認通知】</h3>
      教師們好，教學組已為您們確認以下調代課：<br><br>
      <div style="background-color: #f0fdf4; padding: 15px; border-left: 5px solid #22c55e;">
        <b>單號：</b> ${serial}<br>
        ${detailsHtml}<br>
        <b>狀態：</b> <span style="color: #15803d; font-weight: bold;">教學組可出單</span>
      </div>
      <p style="color: #d97706; font-weight: bold; margin-top: 15px;">※ 本信件由教學組直接確認，僅供通知使用，無需另行點選同意。</p>
      <p style="color: #888; font-size: 13px;">(此為系統自動發送，請勿直接回覆)</p>
    </div>
  `;

  // 同時寄給 A 與 B
  const recipients = [emailA, emailB].filter(e => e).join(",");
  if (recipients) {
    MailApp.sendEmail({
      to: recipients,
      subject: `【${CONFIG.SCHOOL_SHORT}調代課已確認】 ${subjectStr} 已確認 (${serial})`,
      htmlBody: htmlBody
    });
  }
}

/**
 * 🎯 行政通知統一入口：優先 Google Chat（免費無上限），LINE 為備援
 * 兩者皆未設定時靜默略過，不影響主流程。
 */
function notifyAdmin(message) {
  sendGoogleChatMessage(message);
  sendLineBotMessage(message);
}

/**
 * 💰 讀「系統設定」工作表的代課類別與費率。找不到表時退回預設兩類別。
 * 回傳 [{ name, rate, payer }]（只含啟用的）。
 */
function getFeeSettings_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.sheetSettings);
  const def = typeof getSubFeePerPeriod_ === "function" ? getSubFeePerPeriod_() : 0;
  const fallback = [
    { name: "公費代課", rate: def, payer: "學校經費" },
    { name: "自費代課", rate: def, payer: "請假教師" }
  ];
  if (!sh) return fallback;
  const data = sh.getDataRange().getDisplayValues();
  const list = [];
  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][0] || "").trim();
    if (!name) continue;
    if (String(data[i][3] || "Y").trim().toUpperCase() === "N") continue; // 未啟用
    const rate = parseInt(String(data[i][1] || "").replace(/[^\d]/g, ""), 10) || 0;
    list.push({ name: name, rate: rate, payer: String(data[i][2] || "").trim() });
  }
  return list.length ? list : fallback;
}

/**
 * 🧰 批次重建 Email對照表：2 位管理員 + 傳入的教師名單（身分=教師），並逐人產生登入代碼。
 * rows: [[姓名, 信箱], ...]
 */
function importRoster_(rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.sheetEmail) || ss.insertSheet(CONFIG.sheetEmail);
  sh.clear();
  // 三欄即可（身分驗證讀 姓名/信箱/身分；Google 登入不需登入代碼欄）
  const out = [["姓名", "信箱", "身分"]];
  out.push(["阿凱老師", "ipad@mail2.smes.tyc.edu.tw", "管理員"]);
  out.push(["系統維護", "cagooo@gmail.com", "管理員"]);
  (rows || []).forEach(function (r) {
    out.push([String(r[0]).trim(), String(r[1]).trim(), "教師"]);
  });
  sh.getRange(1, 1, out.length, 3).setValues(out);
  sh.getRange(1, 1, 1, 3).setFontWeight("bold").setBackground("#e8f0fe");
  sh.setFrozenRows(1);
  return { ok: true, teachers: (rows || []).length, totalRows: out.length - 1 };
}

/**
 * 🔔 送 cardsV2 狀態卡到 Google Chat（success/error/info）。best-effort，不擋主流程。
 * @param status  'success' | 'error' | 'info'
 * @param title   卡片標題
 * @param rows    [{label, text}] 明細
 * @param note    底部說明段落
 */
function pushChatCard_(status, title, rows, note) {
  const webhook = PropertiesService.getScriptProperties().getProperty("GOOGLE_CHAT_WEBHOOK");
  if (!webhook) return;
  const icon = status === "success" ? "✅" : (status === "error" ? "❌" : "ℹ️");
  const widgets = (rows || []).map(function (r) {
    return { decoratedText: { topLabel: r.label, text: String(r.text == null ? "" : r.text), wrapText: true } };
  });
  if (note) widgets.push({ textParagraph: { text: note } });
  
  // P0-1: 組合手機端推播通知的 fallback 預覽文字 text
  let fallbackText = icon + " " + title;
  if (rows && rows.length > 0) {
    const details = rows.slice(0, 2).map(function (r) { return r.label + ": " + r.text; }).join(", ");
    fallbackText += " (" + details + ")";
  }
  if (note) fallbackText += " — " + note;

  const payload = {
    text: fallbackText,
    cardsV2: [{ cardId: "c-" + Date.now(), card: {
      header: { title: icon + " " + title, subtitle: CONFIG.SCHOOL_SHORT + "調代課系統" },
      sections: [{ widgets: widgets }]
    } }]
  };
  try {
    UrlFetchApp.fetch(webhook, {
      method: "post", contentType: "application/json; charset=UTF-8",
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
  } catch (e) { console.log("Google Chat 卡片傳送失敗：" + e.message); }
}

/** 目前時間字串（Asia/Taipei） */
function nowStr_() {
  return Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy/MM/dd HH:mm");
}

/** 只在「首次登入」推播新使用者成功通知（KNOWN_USERS 去重，避免每次登入洗版） */
function maybeNotifyNewUser_(user) {
  try {
    const props = PropertiesService.getScriptProperties();
    const known = props.getProperty("KNOWN_USERS") || "\n";
    const mark = "\n" + user.email.toLowerCase() + "\n";
    if (known.indexOf(mark) !== -1) return;              // 已通知過
    props.setProperty("KNOWN_USERS", known + user.email.toLowerCase() + "\n");
    pushChatCard_("success", "新使用者首次登入", [
      { label: "姓名", text: user.name },
      { label: "身分", text: user.role },
      { label: "帳號", text: user.email },
      { label: "時間", text: nowStr_() }
    ], "🎉 有新使用者成功註冊並開始使用調代課系統。");
  } catch (e) { console.log(e.message); }
}

/** 有帳號嘗試登入但無權限（網域不符／不在名單）→ 推播一次（去重，方便管理員決定是否加入名單） */
function maybeNotifyDenied_(email, reason) {
  try {
    const props = PropertiesService.getScriptProperties();
    const seen = props.getProperty("DENIED_SEEN") || "\n";
    const mark = "\n" + String(email).toLowerCase() + "\n";
    if (seen.indexOf(mark) !== -1) return;
    props.setProperty("DENIED_SEEN", seen + String(email).toLowerCase() + "\n");
    pushChatCard_("info", "有帳號嘗試登入但無權限", [
      { label: "帳號", text: email },
      { label: "原因", text: reason },
      { label: "時間", text: nowStr_() }
    ], "👉 若為本校教師，請至「Email對照表」加入名單。");
  } catch (e) { console.log(e.message); }
}

/**
 * 🎯 Google Chat incoming webhook 推播模組
 * 在「專案設定 → 指令碼屬性」設 GOOGLE_CHAT_WEBHOOK（Chat 聊天室的 webhook 網址）即啟用。
 */
function sendGoogleChatMessage(message) {
  const webhook = PropertiesService.getScriptProperties().getProperty("GOOGLE_CHAT_WEBHOOK");
  if (!webhook) {
    console.log("Google Chat 通知未設定，已略過。");
    return;
  }
  try {
    UrlFetchApp.fetch(webhook, {
      method: "post",
      contentType: "application/json; charset=UTF-8",
      payload: JSON.stringify({ text: message }),
      muteHttpExceptions: true
    });
  } catch (e) {
    console.log("Google Chat 傳送失敗：" + e.message);
  }
}

/**
 * 🎯 LINE Messaging API 推播模組（備援，預設不啟用）
 */
function sendLineBotMessage(message) {
  const props = PropertiesService.getScriptProperties();
  const channelAccessToken = props.getProperty("LINE_CHANNEL_ACCESS_TOKEN");
  const targetId = props.getProperty("LINE_TARGET_ID");

  // 公開模板預設不啟用 LINE；由各校自行在 Script Properties 設定。
  if (!channelAccessToken || !targetId) {
    console.log("LINE 通知未設定，已略過。");
    return;
  }

  const url = "https://api.line.me/v2/bot/message/push";
  const payload = {
    to: targetId,
    messages: [{ type: "text", text: message }]
  };
  const options = {
    method: "post",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + channelAccessToken
    },
    payload: JSON.stringify(payload)
  };

  try {
    UrlFetchApp.fetch(url, options);
  } catch (e) {
    console.log("LINE Bot 傳送失敗：" + e.message);
  }
}

/**
 * 📦 記憶體快取輔助模組 (CacheHelper_) (P0-2)
 */
const CacheHelper_ = {
  get: function(key) {
    try {
      const cache = CacheService.getScriptCache();
      const val = cache.get(key);
      if (val) return JSON.parse(val);
    } catch (e) {
      console.log("快取讀取失敗：" + e.message);
    }
    return null;
  },
  put: function(key, obj, ttlSeconds) {
    try {
      const cache = CacheService.getScriptCache();
      const str = JSON.stringify(obj);
      if (str.length < 90000) {
        cache.put(key, str, ttlSeconds || 7200); // 預設快取 2 小時
      } else {
        console.log("快取資料過大，略過寫入：" + key + " (長度: " + str.length + ")");
      }
    } catch (e) {
      console.log("快取寫入失敗：" + e.message);
    }
  }
};

/**
 * 🔎 讀取或載入 Email 對照表快取資料 (P0-2)
 */
function getEmailData_() {
  const cacheKey = "smes_sub_cache_" + CONFIG.sheetEmail;
  let cached = CacheHelper_.get(cacheKey);
  if (cached) return cached;
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const s = ss.getSheetByName(CONFIG.sheetEmail);
  if (!s) return [];
  const data = s.getDataRange().getDisplayValues();
  CacheHelper_.put(cacheKey, data, 7200);
  return data;
}

