# 方塊突擊 Block Strike（連線版）

可以和真人加好友、組隊、一起匹配對戰的方塊槍戰遊戲。

## 資料夾裡有什麼

```
server.js          遊戲伺服器（不需要安裝任何套件）
package.json       告訴主機怎麼啟動
public/index.html  遊戲本體
```

## 放上網（用 Render，免費）

### 1. 把檔案放到 GitHub
1. 到 https://github.com 註冊帳號並登入。
2. 右上角「+」→「New repository」，名字取 `block-strike`，按「Create repository」。
3. 在新的 repository 頁面點「uploading an existing file」，把 `server.js`、`package.json`、`.gitignore` 和整個 `public` 資料夾一起拖進去，按「Commit changes」。
   - 上傳後要看得到 `public/index.html` 這個路徑，`index.html` 不能直接放在最外層。

### 2. 在 Render 開一台伺服器
1. 到 https://render.com 用 GitHub 帳號登入。
2. 「New +」→「Web Service」→ 選剛剛的 `block-strike`。
3. 設定：
   - **Runtime**：Node
   - **Build Command**：`npm install`
   - **Start Command**：`node server.js`
   - **Instance Type**：Free
4. 按「Create Web Service」，等它顯示 **Live**（大約 1–3 分鐘）。
5. 上方會有一個網址，像 `https://block-strike-xxxx.onrender.com`。打開就能玩，把這個網址傳給朋友。

### 3. 和朋友一起玩
1. 大家都用同一個網址開遊戲。
2. 大廳右邊「我的好友 ID」是一組 6 位數字，把它告訴朋友。
3. 朋友在「輸入好友 ID」輸入你的 ID →「加好友」，你這邊按「接受」。
4. 好友在線時按「邀請」，對方按「接受」就進了你的隊伍。
5. 隊長選地圖、按「開始匹配」。同一張地圖的玩家會被湊在一起，最多等 6 秒，不足 4v4 的位置由 AI 補上（名字後面有 [AI]）。

## 要知道的事

- **免費方案會睡覺**：15 分鐘沒人連就會休眠，下次打開要等大約 1 分鐘才醒來。
- **伺服器重開後**：免費方案重開時存檔會清空，但每個人的瀏覽器有記住自己的帳號 ID 和好友名單，重新連上時會自動還原，所以通常不會掉好友。
- **金幣和皮膚**存在各自的瀏覽器裡，換裝置不會跟著走。
- **AI 由誰控制**：每場由第一位真人玩家的電腦負責跑 AI。他離開的話，會自動交給下一位。
- 對戰中的命中是由開槍的人判定，適合和朋友一起玩，不適合當正式比賽。

## 在自己電腦上試（可選）

1. 安裝 Node.js 18 以上：https://nodejs.org
2. 在這個資料夾打開終端機，輸入 `node server.js`
3. 瀏覽器打開 http://localhost:3000
4. 同一個 Wi-Fi 的朋友，可以用 `http://你的電腦IP:3000` 連進來。
