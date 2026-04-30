/**
 * kitene_auto.js
 * GitHub Actions上でPuppeteerを使ってキテね！ボタンを自動クリック
 *
 * 環境変数（GitHub Actions secrets/payload から受け取る）:
 *   STAFF_NAME : スタッフ名
 *   GIRL_ID    : 押す相手のガールID
 *   USERNAME   : ログインID
 *   PASSWORD   : パスワード
 *   GAS_URL    : 完了報告先GASのURL
 */

const puppeteer = require("puppeteer");
const https     = require("https");

// ========== 設定 ==========
const LOGIN_URL   = "https://girls.ranking-deli.jp/login/";
const KITENE_BASE = "https://girls.ranking-deli.jp/info/kitene/list/";
const TARGET      = 50;
const CLICK_DELAY = 3000;
const PAGE_WAIT   = 2500;
// ==========================

const STAFF_NAME = process.env.STAFF_NAME;
const GIRL_ID    = process.env.GIRL_ID;
const USERNAME   = process.env.USERNAME;
const PASSWORD   = process.env.PASSWORD;
const GAS_URL    = process.env.GAS_URL;

if (!STAFF_NAME || !GIRL_ID || !USERNAME || !PASSWORD) {
  console.error("❌ 環境変数が不足しています");
  process.exit(1);
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function closeModal(page) {
  try {
    const btn = await page.$(".js-postModalClose");
    if (btn) { await btn.click(); await wait(800); }
  } catch (_) {}
}

// 完了結果をGASに報告
function reportResult(result) {
  if (!GAS_URL) return Promise.resolve();
  return new Promise((resolve) => {
    const body = JSON.stringify({
      type: "kitene_result",
      staffName: result.name,
      results: [result],
    });
    const url = new URL(GAS_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, () => resolve());
    req.on("error", () => resolve());
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log(`\n🚀 キテね自動化開始`);
  console.log(`   スタッフ: ${STAFF_NAME}`);
  console.log(`   ガールID: ${GIRL_ID}\n`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  let clicked = 0;

  try {
    // ---- ログイン ----
    console.log(`[${STAFF_NAME}] ログイン中...`);
    await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 30000 });
    await page.type('input[name="username"]', USERNAME, { delay: 60 });
    await page.type('input[name="password"]', PASSWORD, { delay: 60 });
    await page.waitForFunction(
      () => !document.querySelector(".js-loginBtn")?.disabled,
      { timeout: 5000 }
    ).catch(() => {});
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => wait(3000)),
      page.click(".js-loginBtn"),
    ]);
    await wait(PAGE_WAIT);
    await closeModal(page);
    console.log(`[${STAFF_NAME}] ✅ ログイン完了`);

    // ---- ページをまたいで50個クリック ----
    let pageNum = 1;
    while (clicked < TARGET) {
      const url = `${KITENE_BASE}?tab=recommend&gender=0&girlid=${GIRL_ID}&page=${pageNum}`;
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      await wait(PAGE_WAIT);
      await closeModal(page);

      const btns = await page.$$(".client_detail_btn_on");
      console.log(`[${STAFF_NAME}] ページ${pageNum}: 押せるボタン ${btns.length}個`);

      if (btns.length === 0) {
        const hasNext = await page.$(`a.pager_anchor[href*="page=${pageNum + 1}"]`);
        if (!hasNext) { console.log(`[${STAFF_NAME}] ⚠️ ボタンなし (${clicked}個で終了)`); break; }
        pageNum++;
        continue;
      }

      // 常に最初のボタンをクリック（クリックするたびにDOMが変わるので0番目を取り続ける）
      let pageClicked = 0;
      while (clicked < TARGET && pageClicked < btns.length) {
        const fresh = await page.$$(".client_detail_btn_on");
        if (fresh.length === 0) break;
        try {
          await fresh[0].click();  // 常に最初のボタン
          clicked++;
          pageClicked++;
          console.log(`[${STAFF_NAME}] クリック ${clicked}/${TARGET}`);
          await wait(CLICK_DELAY);
          await closeModal(page);
        } catch (_) {
          console.log(`[${STAFF_NAME}] ボタンスキップ`);
          break;
        }
      }

      if (clicked < TARGET) {
        const hasNext = await page.$(`a.pager_anchor[href*="page=${pageNum + 1}"]`);
        if (!hasNext) { console.log(`[${STAFF_NAME}] ⚠️ 次ページなし (${clicked}個で終了)`); break; }
        pageNum++;
      }
    }

    // ---- ログアウト（必ず実行）----
    await page.goto("https://girls.ranking-deli.jp/mypage/", {
      waitUntil: "networkidle2", timeout: 20000
    }).catch(() => {});
    await wait(1500);
    await closeModal(page);
    const logoutBtn = await page.$("button.u-logoutBt");
    if (logoutBtn) {
      await logoutBtn.click();
      await wait(2000);
      console.log(`[${STAFF_NAME}] ✅ ログアウト完了`);
    }

  } catch (err) {
    console.error(`[${STAFF_NAME}] ❌ エラー: ${err.message}`);
    try {
      await page.goto("https://girls.ranking-deli.jp/mypage/", { timeout: 10000 }).catch(() => {});
      const lb = await page.$("button.u-logoutBt");
      if (lb) { await lb.click(); await wait(1500); }
    } catch (_) {}
  } finally {
    await page.close();
    await browser.close();
  }

  const result = { name: STAFF_NAME, clicked, success: clicked >= TARGET };
  console.log(`\n${result.success ? "✅" : "⚠️"} ${STAFF_NAME}: ${clicked}個完了`);

  await reportResult(result);
}

while (clicked < TARGET && pageClicked < btns.length) {
        const fresh = await page.$$(".client_detail_btn_on");
        if (fresh.length === 0) break;
        try {
          // ボタンが見える位置までスクロール
          await fresh[0].scrollIntoView();
          await wait(500);
          await fresh[0].click();
          clicked++;
          pageClicked++;
          console.log(`[${STAFF_NAME}] クリック ${clicked}/${TARGET}`);
          await wait(CLICK_DELAY);
          await closeModal(page);
        } catch (_) {
          console.log(`[${STAFF_NAME}] ボタンスキップ`);
          break;
        }
      }
main().catch(err => { console.error("Fatal:", err); process.exit(1); });
