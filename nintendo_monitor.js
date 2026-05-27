process.env.TZ = "Asia/Seoul";
const https = require("https");
const http = require("http");
const os = require("os");
const fs = require("fs");
const nodemailer = require("nodemailer");
const puppeteer = require("puppeteer");
const { ImapFlow } = require("imapflow");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8604073084:AAEY6-A0ICsRAeFvhFerYGOd8ngBAtAKOoA";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "456554192";
const EMAIL = process.env.EMAIL || "dgkpgo@gmail.com";
const EMAIL_PASS = process.env.EMAIL_PASS || "afllqojnjytfudmy";
const NINTENDO_EMAIL = process.env.NINTENDO_EMAIL || "dgkpgo@gmail.com";
const NINTENDO_PASSWORD = process.env.NINTENDO_PASSWORD || "";
const COOKIES_FILE = "./nintendo_cookies.json";
const REPORT_INTERVAL = 4 * 60 * 60 * 1000;
const MAX_BYTES = 100000;

const ITEMS = [
  { url: "https://store.nintendo.co.kr/beeskb6aakor", name: "Nintendo Switch 2 본체", available: false },
  { url: "https://store.nintendo.co.kr/beeskb6nakor", name: "Nintendo Switch 2 + 마리오카트 월드 세트", available: false }
];

const ENV = {
  hostname: os.hostname(),
  platform: os.platform() === "win32" ? "Windows" : os.platform() === "darwin" ? "macOS" : "Linux",
  arch: os.arch(), node: process.version,
  ip: "조회 중...", isp: "조회 중...", location: "조회 중..."
};

const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: EMAIL, pass: EMAIL_PASS } });

function fetchIpInfo() {
  return new Promise((resolve) => {
    https.get("https://ipinfo.io/json", (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { const info = JSON.parse(data); ENV.ip = info.ip; ENV.isp = info.org; ENV.location = info.city + ", " + info.country; } catch(e) {}
        resolve();
      });
    }).on("error", () => resolve());
  });
}

function getEnvText() {
  return "\n[ENV] " + ENV.hostname + " / " + ENV.platform + " / Node " + ENV.node + " / IP: " + ENV.ip + " / " + ENV.location;
}
function getEnvHtml() {
  return "<hr><p style='color:#888;font-size:12px;'>" + ENV.hostname + " / " + ENV.platform + " / " + ENV.node + "<br>IP: " + ENV.ip + " / " + ENV.isp + " / " + ENV.location + "</p>";
}

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const options = { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept-Language": "ko-KR,ko;q=0.9" }, timeout: 15000 };
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return fetchPage(res.headers.location).then(resolve).catch(reject);
      let data = "", totalBytes = 0, resolved = false;
      res.on("data", chunk => {
        data += chunk; totalBytes += chunk.length;
        if (!resolved && (data.includes("품절") || totalBytes >= MAX_BYTES)) { resolved = true; req.destroy(); resolve(data); }
      });
      res.on("end", () => { if (!resolved) resolve(data); });
    });
    req.on("error", (e) => { if (e.code !== "ECONNRESET") reject(e); });
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function sendTelegram(message) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: "HTML" });
    const options = { hostname: "api.telegram.org", path: "/bot" + BOT_TOKEN + "/sendMessage", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } };
    const req = https.request(options, (res) => { let data = ""; res.on("data", c => data += c); res.on("end", () => { console.log("  [TG]", res.statusCode === 200 ? "전송 성공" : "전송 실패"); resolve(); }); });
    req.on("error", (e) => { console.log("  [TG] 오류:", e.message); resolve(); });
    req.write(body); req.end();
  });
}

async function sendEmail(subject, htmlBody) {
  try {
    await transporter.sendMail({ from: '"Nintendo Stock Bot" <' + EMAIL + ">" , to: EMAIL, subject, html: htmlBody });
    console.log("  [EMAIL] 전송 성공");
  } catch (e) { console.log("  [EMAIL] 오류:", e.message); }
}

// Gmail IMAP에서 닌텐도 OTP 읽기
async function getNintendoOTP(maxWaitMs = 90000) {
  console.log("  [OTP] Gmail에서 OTP 대기 중...");
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const client = new ImapFlow({
      host: "imap.gmail.com", port: 993, secure: true,
      auth: { user: EMAIL, pass: EMAIL_PASS }, logger: false
    });
    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const since = new Date(Date.now() - 5 * 60 * 1000);
        const uids = await client.search({ from: "nintendo", since }, { uid: true });
        if (uids.length > 0) {
          for await (const msg of client.fetch(uids.slice(-1), { source: true })) {
            const text = msg.source.toString();
            const match = text.match(/\b([0-9]{6})\b/);
            if (match) {
              console.log("  [OTP] 코드 발견:", match[1]);
              lock.release();
              await client.logout();
              return match[1];
            }
          }
        }
      } finally { lock.release(); }
      await client.logout();
    } catch(e) { console.log("  [OTP] IMAP 오류:", e.message); }

    await new Promise(r => setTimeout(r, 5000));
  }
  console.log("  [OTP] 시간 초과");
  return null;
}

// Puppeteer로 로그인 + 장바구니 담기
async function loginAndAddToCart(item) {
  console.log("  [CART] 브라우저 시작...");
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    headless: true
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    await page.setViewport({ width: 1280, height: 800 });

    // 저장된 쿠키 로드
    if (fs.existsSync(COOKIES_FILE)) {
      const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf8"));
      await page.setCookie(...cookies);
      console.log("  [CART] 저장된 쿠키 로드됨");
    }

    // 상품 페이지 이동
    await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    // 장바구니 버튼 확인 (로그인 여부 체크)
    const addToCartBtn = await page.$("#product-addtocart-button");
    const isDisabled = addToCartBtn ? await page.$eval("#product-addtocart-button", el => el.disabled) : true;

    if (!addToCartBtn || isDisabled) {
      console.log("  [CART] 로그인 필요 - 로그인 시작...");

      // 닌텐도 로그인 페이지로 이동
      const loginUrl = "https://accounts.nintendo.com/login?post_login_redirect_uri=" +
        encodeURIComponent("https://store.nintendo.co.kr/customer/account/authorize");
      await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      // 이메일 입력
      await page.waitForSelector("input[name='username'], #accountId, input[type='email']", { timeout: 15000 });
      const emailInput = await page.$("input[name='username']") || await page.$("#accountId") || await page.$("input[type='email']");
      await emailInput.click({ clickCount: 3 });
      await emailInput.type(NINTENDO_EMAIL, { delay: 50 });

      // 다음 버튼 클릭
      const nextBtn = await page.$("button[type='submit'], .submit-btn, #continueButton");
      await nextBtn.click();
      await new Promise(r => setTimeout(r, 2000));

      // 비밀번호 입력
      await page.waitForSelector("input[name='password'], #password, input[type='password']", { timeout: 15000 });
      const pwInput = await page.$("input[name='password']") || await page.$("#password") || await page.$("input[type='password']");
      await pwInput.click({ clickCount: 3 });
      await pwInput.type(NINTENDO_PASSWORD, { delay: 50 });

      // 로그인 버튼 클릭
      const loginBtn = await page.$("button[type='submit'], .submit-btn, #loginButton");
      await loginBtn.click();
      await new Promise(r => setTimeout(r, 3000));

      // OTP 페이지 확인
      const currentUrl = page.url();
      if (currentUrl.includes("otp") || currentUrl.includes("verify") || currentUrl.includes("authenticate")) {
        console.log("  [CART] OTP 페이지 감지됨");
        const otp = await getNintendoOTP(90000);
        if (!otp) throw new Error("OTP 수신 실패");

        // OTP 입력 (단일 필드 또는 분리된 필드 처리)
        const otpInputs = await page.$$("input[type='number'], input[type='tel'], input.otp, input[maxlength='1'], input[name*='otp'], input[id*='otp']");
        if (otpInputs.length === 6) {
          // 6개 분리 필드
          for (let i = 0; i < 6; i++) {
            await otpInputs[i].type(otp[i], { delay: 100 });
          }
        } else {
          // 단일 필드
          const otpField = otpInputs[0] || await page.$("input[type='text']");
          await otpField.click({ clickCount: 3 });
          await otpField.type(otp, { delay: 100 });
        }

        // OTP 제출
        const submitBtn = await page.$("button[type='submit'], .submit-btn");
        await submitBtn.click();
        await page.waitForNavigation({ timeout: 30000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 3000));
      }

      // 쿠키 저장
      const cookies = await page.cookies();
      fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies));
      console.log("  [CART] 로그인 성공 + 쿠키 저장");

      // 상품 페이지로 재이동
      await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));
    }

    // 장바구니 담기
    await page.waitForSelector("#product-addtocart-button:not([disabled])", { timeout: 15000 });
    await page.click("#product-addtocart-button");
    await new Promise(r => setTimeout(r, 3000));

    console.log("  [CART] 장바구니 담기 성공!");
    return true;

  } catch(e) {
    console.log("  [CART] 오류:", e.message);
    return false;
  } finally {
    await browser.close();
  }
}

let checkCount = 0, lastReportTime = Date.now();
const startTime = new Date();

async function checkAll(forceReport) {
  checkCount++;
  const now = new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" });
  console.log("\n[" + now + "] #" + checkCount + " 재고 체크 중...");
  const results = [];

  for (const item of ITEMS) {
    try {
      const html = await fetchPage(item.url);
      const inStock = !html.includes("품절");
      console.log("  " + (inStock ? "[O] 재고있음" : "[X] 품절") + " - " + item.name);
      results.push({ item, inStock });

      if (inStock && !item.available) {
        const timeStr = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

        await sendTelegram("[재고알림] " + item.name + "\n" + item.url + "\n\n시간: " + timeStr + "\n\n장바구니 자동 담기 시도 중..." + getEnvText());
        await sendEmail(
          "[닌텐도 재고알림] " + item.name + " 재고 생겼어요!",
          "<div style='font-family:sans-serif;max-width:600px;margin:0 auto;'><h2 style='color:#e60012;'>닌텐도 재고 알림!</h2><h3>" + item.name + "</h3><p>재고 감지! 장바구니 자동 담기 시도 중...</p><a href='" + item.url + "' style='display:inline-block;background:#e60012;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;font-size:16px;'>지금 바로 구매하기</a><p style='color:#666;'>시간: " + timeStr + "</p>" + getEnvHtml() + "</div>"
        );

        // 장바구니 자동 담기
        if (NINTENDO_PASSWORD) {
          const cartSuccess = await loginAndAddToCart(item);
          if (cartSuccess) {
            await sendTelegram("[장바구니 완료] " + item.name + " 장바구니에 담겼습니다!\n지금 바로 결제하세요!\n" + item.url);
          } else {
            await sendTelegram("[장바구니 실패] " + item.name + " 자동 담기 실패\n직접 구매하세요!\n" + item.url);
          }
        }

        item.available = true;
      }

      if (!inStock && item.available) { item.available = false; console.log("  [!] 다시 품절됨"); }
    } catch (e) {
      console.log("  [ERR]", item.name, e.message);
      results.push({ item, inStock: null });
    }
  }

  const now_ms = Date.now();
  if (forceReport || now_ms - lastReportTime >= REPORT_INTERVAL) {
    lastReportTime = now_ms;
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const uptimeStr = uptime < 60 ? uptime + "초" : uptime < 3600 ? Math.floor(uptime/60) + "분" : Math.floor(uptime/3600) + "시간 " + Math.floor((uptime%3600)/60) + "분";
    const lines = results.map(r => (r.inStock === null ? "[!] " : r.inStock ? "[O] " : "[X] ") + r.item.name).join("\n");
    await sendTelegram("[정기보고]\n" + new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) + "\n총 " + checkCount + "회 체크 / 가동 " + uptimeStr + "\n\n" + lines + getEnvText());
    console.log("  [REPORT] 정기 보고 전송 완료");
  }
}

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "running", uptime: Math.floor((Date.now() - startTime) / 1000) + "s", checkCount, items: ITEMS.map(i => ({ name: i.name, available: i.available })) }));
}).listen(PORT, () => { console.log("  [HTTP] 헬스체크 서버: http://localhost:" + PORT); });

async function main() {
  console.log("=".repeat(50));
  console.log("Nintendo Switch 2 재고 모니터링 시작!");
  console.log("장바구니 자동화:", NINTENDO_PASSWORD ? "활성화" : "비활성화 (NINTENDO_PASSWORD 미설정)");
  console.log("=".repeat(50));
  await fetchIpInfo();
  await sendTelegram("[시작] 닌텐도 스위치2 재고 모니터링!\n30초마다 체크 / 4시간마다 정기 보고\n장바구니 자동화: " + (NINTENDO_PASSWORD ? "ON" : "OFF") + getEnvText());
  await sendEmail("[닌텐도 재고봇] 모니터링 시작", "<div style='font-family:sans-serif;'><h2 style='color:#e60012;'>Nintendo Switch 2 모니터링 시작!</h2><p>장바구니 자동화: " + (NINTENDO_PASSWORD ? "ON" : "OFF") + "</p>" + getEnvHtml() + "</div>");
  await checkAll(true);
  setInterval(() => checkAll(false), 30 * 1000);
}

main();
