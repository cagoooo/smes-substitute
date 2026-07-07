/**
 * 📥 全校課表匯入模組（供「一鍵上傳課表」使用）
 * ------------------------------------------------------------
 * 輸入：classes = [{ code, className, homeroom, grade, cells:[{day,period,subject,teacher,room}] }, ...]
 *   （由前端 pdf.js 解析 6 份年級課表 PDF 產生，欄位與 scratchpad/parse.mjs 一致）
 * 產出：重建「排課資料庫」（班級視角）與「教師課表」（教師視角，122 欄），兩表保證一致。
 * 安全：寫入前自動把舊的兩張表複製成「_備份_yyyyMMdd_HHmm」分頁，可還原。
 *
 * 本土語文為全年級跨班分組，無法對應單一老師 → 老師欄填「本土語教師」、備註標「本土語跨班分組」，
 * 且不併入教師課表（避免同節多班衝突）。
 */

var SI_DAYS = ['一', '二', '三', '四', '五'];
var SI_BT_SUBJECT = '本土語文';
var SI_BT_PLACEHOLDER = '本土語文老師';

/** 由 classes 建出兩張表的二維陣列 { dbRows, teacherRows, stats } */
function buildScheduleSheets_(classes) {
  var homerooms = {};
  classes.forEach(function (c) { if (c.homeroom) homerooms[c.homeroom] = true; });

  // --- 排課資料庫 ---
  var dbRows = [['班級', '星期', '節次', '課程名稱', '教師名稱', '備註']];
  classes.forEach(function (c) {
    c.cells.forEach(function (x) {
      var isBT = (x.teacher === SI_BT_PLACEHOLDER || x.subject === SI_BT_SUBJECT);
      var note = [x.room || '', isBT ? '本土語跨班分組' : ''].filter(String).join('；');
      dbRows.push([c.code, x.day, x.period, x.subject, isBT ? '本土語教師' : x.teacher, note]);
    });
  });

  // --- 反轉成教師視角 ---
  var byTeacher = {}; // name -> { day+period : {sub, cls} }
  var collisions = [];
  classes.forEach(function (c) {
    c.cells.forEach(function (x) {
      if (x.teacher === SI_BT_PLACEHOLDER) return;
      var k = x.day + x.period;
      byTeacher[x.teacher] = byTeacher[x.teacher] || {};
      if (byTeacher[x.teacher][k]) {
        collisions.push(x.teacher + ' 星期' + x.day + '第' + x.period + '節 ' +
          byTeacher[x.teacher][k].cls + '(' + byTeacher[x.teacher][k].sub + ') vs ' + c.code + '(' + x.subject + ')');
      } else {
        byTeacher[x.teacher][k] = { sub: x.subject, cls: c.code };
      }
    });
  });
  var names = Object.keys(byTeacher).sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });

  function mainSubject(name) {
    if (homerooms[name]) return '級任';
    var cnt = {};
    Object.keys(byTeacher[name]).forEach(function (k) { var s = byTeacher[name][k].sub; cnt[s] = (cnt[s] || 0) + 1; });
    return Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0];
  }

  // --- 教師課表（科目 + 教師名稱 + 5×8×(課程,班級) + 5×8 屬性）---
  var header = ['科目', '教師名稱'];
  SI_DAYS.forEach(function (d) { for (var p = 1; p <= 8; p++) header.push(d + p + '課程', d + p + '班級'); });
  SI_DAYS.forEach(function (d) { for (var p = 1; p <= 8; p++) header.push(d + p + '屬性'); });
  var teacherRows = [header, header.map(function () { return ''; })];
  names.forEach(function (name) {
    var row = [mainSubject(name), name];
    var sched = byTeacher[name];
    SI_DAYS.forEach(function (d) {
      for (var p = 1; p <= 8; p++) { var it = sched[d + p]; row.push(it ? it.sub : '', it ? it.cls : ''); }
    });
    SI_DAYS.forEach(function (d) { for (var p = 1; p <= 8; p++) row.push(''); });
    teacherRows.push(row);
  });

  return {
    dbRows: dbRows,
    teacherRows: teacherRows,
    stats: {
      classes: classes.length,
      dbCells: dbRows.length - 1,
      teachers: names.length,
      btCells: dbRows.filter(function (r) { return r[4] === '本土語教師'; }).length,
      collisions: collisions
    }
  };
}

/** 把某張表複製成帶時間戳的備份分頁（若存在） */
function backupSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) return null;
  var stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyyMMdd_HHmm');
  var backupName = name + '_備份_' + stamp;
  // 若同名備份已存在先刪除，避免衝突
  var old = ss.getSheetByName(backupName);
  if (old) ss.deleteSheet(old);
  var copy = sh.copyTo(ss);
  copy.setName(backupName);
  return backupName;
}

/** 把二維陣列寫進指定工作表（清空重建，凍結表頭） */
function writeSheet_(ss, name, rows, frozenRows, frozenCols) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sh.getRange(1, 1, 1, rows[0].length).setFontWeight('bold').setBackground('#e8f0fe');
  if (frozenRows) sh.setFrozenRows(frozenRows);
  if (frozenCols) sh.setFrozenColumns(frozenCols);
}

/** 主流程：備份 → 重建兩張表。回傳結果摘要物件。 */
function importScheduleWithBackup_(classes) {
  if (!classes || !classes.length) throw new Error('沒有可匯入的課表資料。');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var built = buildScheduleSheets_(classes);

  var backups = [
    backupSheet_(ss, '排課資料庫'),
    backupSheet_(ss, '教師課表')
  ].filter(String);

  writeSheet_(ss, '排課資料庫', built.dbRows, 1, 0);
  writeSheet_(ss, '教師課表', built.teacherRows, 2, 2);

  // 🧹 課表已重建 → 清掉舊快取，否則前端仍讀到舊的範例課表（導致查得到老師卻課表空白）
  try {
    var keys = ['smes_sub_cache_' + CONFIG.sheetEmail, 'smes_sub_cache_' + CONFIG.sheetTeacher, 'smes_sub_cache_' + CONFIG.sheetHours];
    (CONFIG.elasticTeacherSheets || []).forEach(function (s) { keys.push('smes_sub_cache_' + s); });
    CacheService.getScriptCache().removeAll(keys);
  } catch (e) { /* 快取清除失敗不擋匯入 */ }

  return {
    ok: true,
    backups: backups,
    classes: built.stats.classes,
    dbCells: built.stats.dbCells,
    teachers: built.stats.teachers,
    btCells: built.stats.btCells,
    collisions: built.stats.collisions
  };
}
