/**
 * 🖨️ 調代課通知單自動化產出模組 - 合併列印版
 * 功能：自動合併同一天、同一對教師、相同原因的連續節次至同一張單據
 */

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📅 系統出單功能')
      .addSubMenu(ui.createMenu('1. 代課通知單')
          .addItem('1-1. 生成「教師聯」', 'printSubTeacher')
          .addItem('1-2. 生成「班級聯」', 'printSubClass')
          .addItem('1-3. 生成「留存聯」', 'printSubArchive'))
      .addSeparator()
      .addSubMenu(ui.createMenu('2. 調課通知單')
          .addItem('2-1. 生成「教師聯」', 'printSwapTeacher')
          .addItem('2-2. 生成「班級聯」', 'printSwapClass')
          .addItem('2-3. 生成「留存聯」', 'printSwapArchive'))
      .addSeparator()
      .addItem('3. 💰 兼代課鐘點結算', 'generateSettlementReport')
      .addSeparator()
      .addItem('🌐 開啟管理網頁', 'openWebDialog')
      .addSeparator()
      .addItem('🧰 初始化石門國小空白模板', 'setupSmesTemplate')
      .addToUi();
}

function openWebDialog() {
  const url = CONFIG.FRONTEND_URL;
  const html = HtmlService.createHtmlOutput(
    `<div style="font-family:sans-serif; text-align:center; padding:30px;">
       <p style="font-size:15px; color:#475569;">管理網頁已搬遷至 GitHub Pages（免 GAS 授權、載入更快）</p>
       <a href="${url}" target="_blank" style="background:#2563eb; color:white; text-decoration:none; padding:12px 28px; border-radius:8px; font-weight:bold; display:inline-block;">開啟調代課系統</a>
       <p style="font-size:12px; color:#94a3b8; margin-top:16px;">${url}</p>
     </div>`
  ).setWidth(480).setHeight(220);
  SpreadsheetApp.getUi().showModalDialog(html, '石門國小調代課管理系統');
}

// --- 入口函數 ---
function printSubTeacher() { processForms('sub', 'Teacher', '代課單-教師聯'); }
function printSubClass() { processForms('sub', 'Class', '代課單-班級聯'); }
function printSubArchive() { processForms('sub', 'Archive', '代課單-留存聯'); }

function printSwapTeacher() { processForms('swap', 'Teacher', '調課單-教師聯'); }
function printSwapClass() { processForms('swap', 'Class', '調課單-班級聯'); }
function printSwapArchive() { processForms('swap', 'Archive', '調課單-留存聯'); }

function processForms(mode, formType, documentTitle) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = (mode === 'sub') ? CONFIG.sheetSub : CONFIG.sheetSwap;
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return SpreadsheetApp.getUi().alert(`找不到工作表: ${sheetName}`);
  
  const allData = sheet.getDataRange().getDisplayValues();
  const rows = allData.slice(1);
  // 🎯 嚴格過濾：未出單 + 有單號 + 狀態包含「出單」
  const dataToProcess = rows.filter(row => {
    const isNotPrinted = (row[0] !== 'TRUE' && row[0] !== 'true'); // A欄未打勾
    const hasSerial = row[1].trim() !== ''; // B欄有單號
    
    // 根據模式判斷狀態欄位 (代課是 K 欄 row[10]，調課是 M 欄 row[12])
    const statusStr = (mode === 'sub') ? (row[10] || "") : (row[12] || "");
    const isApproved = statusStr.includes("出單"); // 只要包含「出單」兩個字就放行
    
    return isNotPrinted && hasSerial && isApproved;
  });

  if (dataToProcess.length === 0) return SpreadsheetApp.getUi().alert(`沒有未出單的紀錄。`);

  // ============================================================
  // 🌟 新增：讀取「週次對照表」，建立快速查詢字典 (Date -> Week)
  // ============================================================
  const weekSheet = ss.getSheetByName(CONFIG.sheetWeeks);
  let dateToWeekMap = {};
  if (weekSheet) {
    const weekData = weekSheet.getDataRange().getDisplayValues();
    for (let i = 1; i < weekData.length; i++) {
      let weekNum = weekData[i][0]; // 週次 (例如 15)
      for (let j = 1; j <= 5; j++) {
        let dateStr = weekData[i][j]; // 該週的日期
        if (dateStr) dateToWeekMap[dateStr] = "W" + weekNum; // 建立對應，例如 "2026/05/18": "W15"
      }
    }
  }

  let groupedRecords =[];

  // ============================================================
  // 🎯 核心邏輯：資料分組 (Grouping)
  // ============================================================
  if (mode === 'sub') {
    let subGroups = {};
    dataToProcess.forEach(row => {
      // 🎯 改用對照表查週次！如果表裡找不到，才退回用原日期當 Key
      let weekKey = dateToWeekMap[row[7]] || row[7]; 
      
      let key = row[2] + "_" + row[3] + "_" + weekKey + "_" + row[4] + "_" + row[5];
      
      // 組合「節次 + 鐘點費」，例如 "一5" + "自費代課" => "一5自費代課"
      let periodKey = row[8] || "";
      let feeType = row[9] ? row[9].trim() : "";
      let feeDetail = periodKey + feeType;

      if (!subGroups[key]) {
        subGroups[key] = {
          serial: [row[1]], 
          leaveT: row[2], subT: row[3], reason: row[4], cls: row[5], 
          feeDetails: [feeDetail], 
          periods: {} 
        };
      } else {
        subGroups[key].serial.push(row[1]);
        subGroups[key].feeDetails.push(feeDetail);
      }
      subGroups[key].periods[row[8]] = { sub: row[6], date: row[7] }; 
    });
    
    groupedRecords = Object.values(subGroups).map(g => {
      // 過濾重複紀錄，並確保按照「星期與節次」排序
      const dayMap = {'一':1, '二':2, '三':3, '四':4, '五':5};
      let uniqueFees = Array.from(new Set(g.feeDetails)).filter(f => f);
      uniqueFees.sort((a, b) => {
        let dayA = dayMap[a.charAt(0)] || 0;
        let dayB = dayMap[b.charAt(0)] || 0;
        if (dayA !== dayB) return dayA - dayB;
        return (parseInt(a.charAt(1)) || 0) - (parseInt(b.charAt(1)) || 0);
      });
      
      g.feeStr = uniqueFees.join('、'); // 組合為 "一5自費代課、三1公費代課"
      return g;
    });
  } else {
    // 🎯 調課單分組：教師A + 教師B + 週次 + 原因 + 班級 為同一組
    let swapGroups = {};
    dataToProcess.forEach(row => {
      // 🎯 取得 A 老師原課程的日期 (row[6]) 來查對照表，決定週次
      let weekKey = dateToWeekMap[row[6]] || row[6]; 
      
      // 🎯 分組條件加入 weekKey
      let key = row[2] + "_" + row[3] + "_" + weekKey + "_" + row[4] + "_" + row[5];
      
      if (!swapGroups[key]) {
        swapGroups[key] = {
          serial:[row[1]],
          tA: row[2], tB: row[3], reason: row[4], cls: row[5],
          swapData:[] 
        };
      } else {
        swapGroups[key].serial.push(row[1]);
      }
      swapGroups[key].swapData.push({ dateA: row[6], timeA: row[7], subA: row[8], dateB: row[9], timeB: row[10], subB: row[11] });
    });
    groupedRecords = Object.values(swapGroups);
  }

  // ============================================================
  // 渲染 HTML
  // ============================================================
  let allFormsHtml = '';
  groupedRecords.forEach(r => {
    if (mode === 'sub') {
      if (formType === 'Teacher') {
        allFormsHtml += generateFormHtml(r, `教師聯 (給 ${r.leaveT} 老師)`, mode, 'Teacher');
        allFormsHtml += generateFormHtml(r, `教師聯 (給 ${r.subT} 老師)`, mode, 'Teacher');
      } else if (formType === 'Class') {
        allFormsHtml += generateFormHtml(r, '班級聯', mode, 'Class');
      } else {
        allFormsHtml += generateFormHtml(r, '教學組留存聯', mode, 'Archive');
      }
    } else {
      if (formType === 'Teacher') {
        allFormsHtml += generateFormHtml(r, `教師聯 (給 ${r.tA} 老師)`, mode, 'Teacher');
        allFormsHtml += generateFormHtml(r, `教師聯 (給 ${r.tB} 老師)`, mode, 'Teacher');
      } else if (formType === 'Class') {
        allFormsHtml += generateFormHtml(r, '班級聯', mode, 'Class');
      } else {
        allFormsHtml += generateFormHtml(r, '教學組留存聯', mode, 'Archive');
      }
    }
  });

  displayPrintableWebpage(allFormsHtml, documentTitle);
}

function generateFormHtml(r, linkTag, mode, formType) {
  const isSwap = (mode === 'swap');
  const titleText = isSwap ? "調課通知單" : "代課通知單";
  const cleanReason = r.reason.split('(')[0].trim();
  const serialText = r.serial.join(', '); // 合併單號

  let tableData = {};
  if (!isSwap) {
    // 🎯 代課：讀取每節課專屬的日期與科目
    for (let timeKey in r.periods) {
      let pData = r.periods[timeKey];
      tableData[timeKey] = { 
        date: pData.date, 
        text: `${formatDateShort(pData.date)}<br>${pData.sub}<br>${r.cls}<br>${r.subT}` 
      };
    }
  } else {
    // 調課：維持不變
    r.swapData.forEach(item => {
      tableData[item.timeA] = { date: item.dateA, text: `${formatDateShort(item.dateA)}<br>${item.subB}<br>${r.cls}<br>${r.tB}` };
      tableData[item.timeB] = { date: item.dateB, text: `${formatDateShort(item.dateB)}<br>${item.subA}<br>${r.cls}<br>${r.tA}` };
    });
  }
  const tableHtml = createFormTable(tableData);

  let desc = "";
  let remarks = "";
  let infoHtml = "";

  if (isSwap) {
    infoHtml = `<span class="info-item">班級：${r.cls}</span><span class="info-item">教師：${r.tA} ↔ ${r.tB}</span>`;
    
    // 🎯 針對不同聯單，決定是否顯示真實假別
    if (formType === 'Class') {
      desc = `${r.tA}老師因請假或其他原因，與 ${r.tB}老師調課。`; // 班級聯隱藏真實原因
      remarks = `<li>請實際上課老師於教室日誌簽名。</li><li>若為調課請注意日期是否跨週。</li>`;
    } else {
      desc = `${r.tA}老師因 ${cleanReason} ，與 ${r.tB}老師調課。`; // 教師聯與留存聯保持原樣
      if (formType === 'Teacher') {
        remarks = `<li>若因請假，請請假教師完成線上請假程序。</li><li>請實際上課老師於教室日誌簽名。</li>`;
      }
    }
  } else {
    if (formType === 'Class') {
       desc = `${r.leaveT}老師因請假由 ${r.subT}老師代課。`;
    } else {
       // 🎯 顯示合併後的鐘點費 (例如：自費代課、公費代課)
       desc = `${r.leaveT}老師因 ${cleanReason}，由 ${r.subT}老師代課。鐘點費：${r.feeStr}。`;
    }
    infoHtml = `<span class="info-item">班級：${r.cls}</span><span class="info-item">教師：${r.leaveT} → ${r.subT}</span>`;
    if (formType === 'Teacher') {
      remarks = `<li>請請假教師完成線上請假程序。</li><li>請實際上課老師於教室日誌簽名。</li><li>協請請假教師確實向代課教師轉達班級情況，<br>以利代課教師了解學生特質、掌握課程調整及情緒行為處理策略。</li>`;
    } else if (formType === 'Class') {
      remarks = `<li>請實際上課老師於教室日誌簽名。</li><li>若為調課請注意日期是否跨週。</li>`;
    }
  }

  return `
  <div class="substitute-form">
    <div class="form-tag">${linkTag}</div>
    <div class="header-block">
      <h1 class="title">${CONFIG.SCHOOL_NAME}${titleText}</h1>
      <span class="lesson-code">單號：${serialText}</span>
    </div>
    <div class="info-row">${infoHtml}</div>
    ${tableHtml}
    <div class="footer-block">
      <p class="desc">${desc}</p>
      <div class="remark-area">
        <span class="fw-bold">※ 備註：</span>
        <ol class="remark-list">${remarks}</ol>
      </div>
    </div>
    
  </div>
  <div class="page-break"></div>`;
}

function formatDateShort(dateStr) {
  if (!dateStr) return "";
  let parts = dateStr.split('/');
  return parts.length < 3 ? dateStr : parts[1] + '/' + parts[2];
}

function createFormTable(dataMap) {
  const days = ['一', '二', '三', '四', '五'];
  let html = '<table class="schedule-table"><thead><tr><th style="width:12%">節</th>';
  days.forEach(d => {
    let dayDate = "";
    for (let key in dataMap) { if (key.startsWith(d)) dayDate = dataMap[key].date; }
    let shortDate = dayDate ? formatDateShort(dayDate) : "";
    html += `<th>${shortDate}<br>${d}</th>`;
  });
  html += '</tr></thead><tbody>';
  for (let p = 1; p <= 8; p++) {
    let rowStyle = (p === 4) ? 'border-bottom: 2.5pt solid black !important;' : '';
    html += `<tr><td style="background:#f8f9fa; font-weight:bold; ${rowStyle}">${p}</td>`;
    days.forEach(d => {
      let content = dataMap[d + p] ? dataMap[d + p].text : "";
      let cellStyle = content ? 'background:#fff3cd; font-weight:bold;' : '';
      html += `<td style="${cellStyle} ${rowStyle}">${content}</td>`;
    });
    html += '</tr>';
  }
  return html + '</tbody></table>';
}

function displayPrintableWebpage(content, documentType) {
  const css = `
    @page { size: A5; margin: 3mm; }
    body { font-family: "Microsoft JhengHei", sans-serif; margin: 0; padding: 0; background: #555; }
    .substitute-form { width: 148mm; height: 210mm; padding: 5mm 8mm; margin: 5px auto; background: white; position: relative; box-sizing: border-box; border: none; }
    .header-block { margin-top: 18px; margin-bottom: 8px; text-align: center; }
    .title { font-size: 18pt; text-align: center; font-weight: bold; margin: 5px 0; border-bottom: 2px solid #000; padding-bottom: 5px; }
    .lesson-code { position: absolute; top: 5mm; right: 8mm; font-size: 10pt; }
    .info-row { display: flex; justify-content: space-between; margin: 8px 0; font-size: 13.5pt; font-weight: bold; }
    .info-item { flex: 1; }
    .schedule-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 8px; border: 1.5pt solid black; }
    .schedule-table th, .schedule-table td { border: 1px solid #000; text-align: center; font-size: 9.5pt; height: 52px; vertical-align: middle; line-height: 1.1; }
    .schedule-table th { background: #eee; font-size: 10.5pt; height: 32px; border-bottom: 1.5pt solid black; }
    .footer-block { font-size: 11.5pt; line-height: 1.3; }
    .desc { font-weight: bold; margin-bottom: 3px; }
    .remark-list { margin: 0; padding-left: 22px; }
    .remark-list li { margin-bottom: 1px; font-size: 10pt; }
    .form-tag { position: absolute; top: 3mm; left: 3mm; font-size: 9pt; border: 1px solid #000; padding: 1px 3px; background: #fff; }
    .stamp-img { position: absolute; bottom: 5mm; right: 10mm; width: 145px; opacity: 0.85; z-index: 10; }
    .page-break { page-break-after: always; }
    @media print { body { background: none; } .substitute-form { margin: 0; } }
  `;
  const html = `<html><head><style>${css}</style></head><body>${content}<script>window.onload=function(){setTimeout(function(){window.print();},500);}</script></body></html>`;
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(900).setHeight(600), `列印 ${documentType}`);
}