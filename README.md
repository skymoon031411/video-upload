# 幕映 MUYING

繁體中文影片網站，使用 React、TypeScript、Vite，搭配 Python 後端與網站端影片片庫。首頁的「網址匯入」會由伺服器取得影片檔；播放器再讀取網站上的檔案，沒有把影片另存至使用者裝置的操作。

## 貼網址，存進網站

1. 打開「網址匯入」，貼上公開影片頁或 HTTPS 影片檔網址，按「檢查來源」。
2. 若找到可匯入的影片來源，選擇來源、填寫片名與分類，設定最低影片長度（預設 10 分鐘）。已辨識的預告／試看片不能匯入。
3. 確認你有儲存授權，而且已確認來源是完整影片，按匯入按鈕。
4. 網站依序顯示排隊、下載、驗證與完成；成功後在網站片庫及「我的影片」播放。

後端支援公開 HTTPS MP4、WebM、Ogg／Ogv 影片檔，及 HTML `<video>`／`<source>`、`og:video`、JSON-LD `VideoObject` 中的公開原生影片來源。下載完成後，以 ffprobe 檢查真正的影片串流與片長，過短或無效的檔案不會加入片庫。預設單檔上限 1 GiB，可透過 `MUYING_MAX_BYTES` 調整。

片長只能排除過短的內容，不能證明是完整正片。因此仍需確認來源。一般商品頁可能只有預告，購買頁連結也不代表已取得正片。所有來源、影片 CDN 和重新導向目的地都必須列在 `MUYING_ALLOWED_HOSTS` 中；沒有允許的 CDN 時會停止並顯示錯誤，管理員應先確認該公開網域再加入設定。本版不執行網頁 JavaScript、不登入第三方網站，不使用第三方 Cookie、不解密 DRM，不繞過付費、登入或來源網站的存取限制；HLS／DASH、YouTube／Vimeo 頁面不是此下載器支援的原生檔案來源。YouTube／Vimeo 可以繼續使用原來的連結投稿播放器。

## 保存的位置

網站端片庫使用 SQLite 記錄和磁碟檔案，預設保存於專案的 `.muying-data/`；可透過 `MUYING_DATA_DIR` 指定其他持久磁碟。這個資料夾已列入忽略清單，不會納入程式碼與靜態資產。

匯入任務在背景執行，一次下載一部。重新整理可繼續查看進度，服務重啟會把中斷的任務標示為失敗。已完成的影片和紀錄在重啟後保留。完整影片檔案不會寫入 IndexedDB 或 localStorage；觀看時瀏覽器仍會正常接收播放串流。

目前網站片庫及影片播放是公開讀取。正式環境的匯入／任務管理需要管理員憑證；部署時只收錄你允許公開分享的影片。收藏和觀看紀錄仍保存於各自瀏覽器。

原來的「投稿管理」維持瀏覽器試用功能：YouTube／Vimeo／直接影片連結經「加入片庫」後顯示。右上角的本機上傳仍將檔案保存於目前瀏覽器，單檔上限 250 MB；兩者均不會轉成網站端檔案。清除瀏覽器資料會移除這些本機紀錄。

## 開發環境

需要 Node.js 24、npm、Python 3.12+，以及 PATH 中的 `ffprobe`（由 FFmpeg 提供）。不需要 pip 套件。

```bash
cd /workspace/video-upload
npm ci --cache /tmp/muying-npm-cache --no-audit --no-fund
npm test
npm run build
npm run dev
```

`npm run dev` 同時啟動 Vite（5173）和 Python 後端（僅綁定 loopback 3101），Vite 將 `/api` 轉送到後端。開發環境未設定管理員憑證時，允許本機操作；不要把此開發服務當正式公開部署。雲端任務已有隔離，使用現有 checkout，不需另建 Git worktree。

程序不會隨雲端環境快照保留，重新進入任務後需要再次執行啟動命令。內部可檢查 `/api/health`、`/api/library` 及首頁，不能把程序 PID 當成驗證結果。

## 正式部署

這次有後端，**只部署 `dist/` 到靜態網站服務，無法下載或保存影片**。需要能常駐 Python 程序、提供 HTTPS、連線到影片來源及掛載持久磁碟的主機或容器服務。使用 Python 後端可同時提供前端 `dist/` 和 API，不需另外架 Vite。

先建置前端，在部署服務的安全設定中提供 `MUYING_ADMIN_TOKEN`，並以 `MUYING_ALLOWED_HOSTS` 設定允許的公開來源網域（逗號分隔，僅主機名），然後啟動：

```bash
npm run build
npm start
```

`npm start` 預設綁定 `0.0.0.0:8000`，也可由 `HOST`／`PORT` 更改。公開綁定若缺少管理員憑證會拒絕啟動。請在部署平台的秘密設定提供你自行設定的長隨機憑證，不要寫進程式碼、網址、聊天或公開日誌。登入「網址匯入」時輸入該憑證，它只保留於目前頁面的記憶體。

也提供 Dockerfile 和 compose.yaml。以部署安全設定或本機未追蹤的 `.env` 提供憑證和允許的來源網域後：

```bash
docker compose up --build -d
```

Compose 將影片資料保存到 `muying-videos` volume。備份時需同時保留 SQLite 和影片檔；不要在更新版本時刪除 volume。容器設定已提供，容器建置與啟動的實測結果記錄於驗證檔案。

### Render 部署

專案提供 `render.yaml` Blueprint：一個 Docker 網站服務與 10 GB 持久磁碟。設定使用 Starter 方案及付費磁碟，實際費用請以 Render 建立服務時顯示的金額為準。

1. 將本專案推送到你的 GitHub repository。
2. 登入 Render，選擇新增 Blueprint，連接 `skymoon031411/video-upload`，確認分支及費用後建立。
3. Render 會產生管理員金鑰；在服務的環境設定中取得並保管，只在網站的管理員欄位輸入。
4. 部署完成且 Health Check 通過後，Render 服務頁面會顯示公開 HTTPS 網址。你可另外綁定網域。
5. 來源若使用其他公開 CDN，管理員需確認後，將該主機名加入 `MUYING_ALLOWED_HOSTS`，再重新部署。

不要在登入、付費或 DRM 來源失敗時嘗試用新增 CDN 取代來源授權。網站無法替你購買或登入取得正片。

目前沒有部署到公開網域。**Codex「雲端環境發佈」保存開發環境快照，與公開部署網站是不同操作**。設定草稿保存成功也不代表環境已發佈成功；平台發佈失敗仍需該次錯誤訊息才能診斷。

## 驗證與素材

`npm test` 執行網址解析測試與後端測試；`npm run build` 執行 TypeScript 檢查及正式建置。後端測試含測試用網路回應，不能等同任意第三方商品頁的正片能匯入。實際外部下載、瀏覽器播放與失敗情境的執行證據另存於 `/workspace/muying-artifacts`。

首頁 9 部影片為介面展示資料，片名、創作者、觀看數與卡片片長是示範值，播放同一段原創 8 秒影片；網站端匯入影片則顯示實際驗證過的片長。素材說明在 `public/media/CREDITS.txt`。
