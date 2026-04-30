/**
 * kitene_auto.js
 * GitHub Actions上でPuppeteerを使ってキテね！ボタンを自動クリック
 */

import puppeteer from "puppeteer";
import https from "https";
import { URL } from "url";

// ========== 設定 ==========
const LOGIN_URL   = "https://girls.ranking-deli.jp/login/";
const KITENE_BASE = "https://girls.ranking-deli.jp/info/kitene/list/";
const TARGET      = 50;
const CLICK_DELAY = 2000;
const PAGE_WAIT   = 2500;
const BTN_WAIT    = 6000;
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

async function humanClick(page, element) {
  const box = await element.boundingBox();
  if (!box) throw new Error("boundingBox取得失敗");
  const x = box.x + box.width / 2 + (Math.random() * 6 - 3);
  const y = box.y + box.height / 2 + (Math.random() * 6 - 3);
  await page.mouse.move(x, y, { steps: 5 });
  await wait(100 + Math.random() * 200);
  await page.mouse.click(x, y);
}

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
    headless: true,
    protocolTimeout: 60000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.setUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
  );

  let clicked = 0;

  try {
    // ---- ログイン ----
    console.log(`[${STAFF_NAME}] ログイン中...`);
    await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 30000 });
    await page.type('input[name="username"]', USERNAME, { delay: 80 });
    await wait(500);
    await page.type('input[name="password"]', PASSWORD, { delay: 80 });
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

      const userIds = await page.$$eval(
        ".client_detail_btn_on",
        els => els.map(el => el.getAttribute("data-userid"))
      );
      console.log(`[${STAFF_NAME}] ページ${pageNum}: 押せるボタン ${userIds.length}個`);

      if (userIds.length === 0) {
        const hasNext = await page.$(`a.pager_anchor[href*="page=${pageNum + 1}"]`);
        if (!hasNext) {
          console.log(`[${STAFF_NAME}] ⚠️ ボタンなし (${clicked}個で終了)`);
          break;
        }
        pageNum++;
        continue;
      }

      for (const userId of userIds) {
        if (clicked >= TARGET) break;

        try {
          const btn = await page.$(`.client_detail_btn_on[data-userid="${userId}"]`);
          if (!btn) continue;

          await btn.scrollIntoView();
          await wait(300 + Math.random() * 400);
          await humanClick(page, btn);

          // ボタンが_onから変わるまで待つ
          await page.waitForFunction(
            (uid) => !document.querySelector(`.client_detail_btn_on[data-userid="${uid}"]`),
            { timeout: BTN_WAIT },
            userId
          ).catch(() => {});

          const stillOn = await page.$(`.client_detail_btn_on[data-userid="${userId}"]`);
          if (stillOn) {
            console.log(`[${STAFF_NAME}] userid:${userId} 未反映→スキップ`);
            continue;
          }

          await closeModal(page);
          clicked++;
          console.log(`[${STAFF_NAME}] クリック ${clicked}/${TARGET} (userid:${userId})`);
          await wait(CLICK_DELAY + Math.random() * 1000);

        } catch (e) {
          console.log(`[${STAFF_NAME}] userid:${userId} スキップ: ${e.message}`);
        }
      }

      if (clicked < TARGET) {
        const hasNext = await page.$(`a.pager_anchor[href*="page=${pageNum + 1}"]`);
        if (!hasNext) {
          console.log(`[${STAFF_NAME}] ⚠️ 次ページなし (${clicked}個で終了)`);
          break;
        }
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

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
