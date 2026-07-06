# 📅 石門國小線上調代課系統

桃園市龍潭區石門國民小學的全校課表與調代課管理系統。原創為[新北市中和高中教學組 詩穎老師 線上調代課系統](https://docs.google.com/spreadsheets/d/15xY1bGLeNaMg_t4GOjeDNje_R2goZI5uMKVMHnofFOA/copy)公開模板，由阿凱老師改良調整為國小情境。

🌐 **線上系統**：https://cagoooo.github.io/smes-substitute/

## 架構

```
老師瀏覽器 ──> GitHub Pages（docs/，純靜態前端 + Google 登入）
                │  fetch + id_token
                ▼
             Google Apps Script /exec（gas/，JSON API）
                │
                ▼
             Google 試算表（排課資料庫 / 紀錄表 / 名單）
```

- **前端**（`docs/index.html`）：GitHub Pages 靜態頁，Google Identity Services 登入，老師不需授權任何敏感權限
- **後端**（`gas/`）：Apps Script 以 `doPost` 提供 JSON API，驗證 id_token 後依「Email對照表」名單控管身分；透過 clasp 推送維護
- **試算表**：課表資料、調代課單據、教師名單的單一資料來源；出單（A5 三聯單）與兼代課鐘點結算由試算表選單執行

## 主要功能

- 教師視角週課表，點選節次即可媒合「代課」（同班/同科智慧排序）或「調課」（雙方空堂交叉比對）
- 提交後自動寄邀請信給受邀教師，一鍵同意/拒絕，狀態機控管（待確認 → 可出單 → 已出單）
- 管理員（教學組）可代任何教師直接建單，並以 Google Chat webhook 即時接收通知
- 代課／調課通知單 A5 三聯列印（教師聯、班級聯、留存聯，自動合併連續節次）
- 💰 兼代課鐘點結算：輸入月份自動產出「代課教師應領總表＋自費代課對帳表＋逐筆明細」

## 部署與維護

後端更新（保留同一 `/exec` 網址）：

```bash
cd gas
clasp push -f
clasp create-version "更新說明"
clasp update-deployment <deploymentId> -V <版本號> -d "更新說明"
```

前端更新：改 `docs/index.html` 後 push main 即自動部署。

## 📅 更新日誌與開發進度表

- **`[x]` (2026.07.06-3)**：在登入頁面疊層底部新增授權與原創聲明頁尾 (Footer)，解決登入前無法看到原創連結的問題。
- **`[x]` (2026.07.06-2)**：將原創新北市中和高中教學組詩穎老師的超連結更新為原創開源的起點複製模板連結，避免指向非開源版本，並修復 Service Worker 更新提示與版本同步機制。

---

Made with ❤️ by [阿凱老師](https://www.smes.tyc.edu.tw/modules/tadnews/page.php?ncsn=11&nsn=16#a5)

