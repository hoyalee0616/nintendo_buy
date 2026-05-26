process.env.TZ = 'Asia/Seoul';
const https = require("https");
const http = require("http");
const os = require("os");
const nodemailer = require("nodemailer");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8604073084:AAEY6-A0ICsRAeFvhFerYGOd8ngBAtAKOoA";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "456554192";
const EMAIL = process.env.EMAIL || "dgkpgo@gmail.com";
const EMAIL_PASS = process.env.EMAIL_PASS || "afllqojnjytfudmy";
const REPORT_INTERVAL = 4 * 60 * 60 * 1000;

const ITEMS = [
  { url: "https://store.nintendo.co.kr/beeskb6aakor", name: "Nintendo Switch 2 본체", available: false },
  { url: "https://store.nintendo.co.kr/beeskb6nakor", name: "Nintendo Switch 2 + 마리오카트 월드 세트", available: false }
];

const ENV = {
  hostname: os.hostname(),
  platform: os.platform() === "win32" ? "Windows" : os.platform() === "darwin" ? "macOS" : "Linux",
  arch: os.arch(),
  node: process.version,
  ip: "조회 중...", isp: "조회 중...", location: "조회 중..."
};

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: EMAIL, pass: EMAIL_PASS }
});

function fetchIpInfo() {
  return new Promise((resolve) => {
    https.get("https://ipinfo.io/json", (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const info = JSON.parse(data);
          ENV.ip = info.ip || "알 수 없음";
          ENV.isp = info.org || "알 수 없음";
          ENV.location = (info.city || "") + ", " + (info.country || "");
        } catch(e) {}
        resolve();
      });
    }).on("error", () => resolve());
  });
}

function getEnvText() {
  return "\n[ENV] " + ENV.hostname + " / " + ENV.platform + " / Node " + ENV.node + " / IP: " + ENV.ip + " / " + ENV.location;
}

function getEnvHtml() {
  return "<hr><p style='color:#888;font-size:12px;'>" + ENV.hostname + " / " + ENV.platform + " / Node.js " + ENV.node + "<br>IP: " + ENV.ip + " / " + ENV.isp + " / " + ENV.location + "</p>";
}

// 스트리밍 조기 차단: 품절 확인 후 즉시 연결 종료 (트래픽 절약)
const MAX_BYTES = 100000; // 100KB (품절 텍스트는 90KB 지점에 위치)
function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9"
      },
      timeout: 15000
    };
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPage(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      let totalBytes = 0;
      let resolved = false;
      res.on("data", chunk => {
        data += chunk;
        totalBytes += chunk.length;
        // 품절 발견 즉시 OR 100KB 도달 시 연결 종료
        if (!resolved && (data.includes("품절") || totalBytes >= MAX_BYTES)) {
          resolved = true;
          req.destroy();
          resolve(data);
        }
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
    const options = {
      hostname: "api.telegram.org",
      path: "/bot" + BOT_TOKEN + "/sendMessage",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => { console.log("  [TG]", res.statusCode === 200 ? "전송 성공" : "전송 실패"); resolve(); });
    });
    req.on("error", (e) => { console.log("  [TG] 오류:", e.message); resolve(); });
    req.write(body);
    req.end();
  });
}

async function sendEmail(subject, htmlBody) {
  try {
    await transporter.sendMail({ from: '"Nintendo Stock Bot" <' + EMAIL + ">" , to: EMAIL, subject: subject, html: htmlBody });
    console.log("  [EMAIL] 전송 성공");
  } catch (e) {
    console.log("  [EMAIL] 오류:", e.message);
  }
}

let checkCount = 0;
let lastReportTime = Date.now();
const startTime = new Date();

async function checkAll(forceReport) {
  checkCount++;
  const now = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log("\n[" + now + "] #" + checkCount + " 재고 체크 중...");
  const results = [];

  for (const item of ITEMS) {
    try {
      const html = await fetchPage(item.url);
      const inStock = !html.includes("품절");
      console.log("  " + (inStock ? "[O] 재고있음" : "[X] 품절") + " - " + item.name);
      results.push({ item, inStock });

      if (inStock && !item.available) {
        const timeStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        await sendTelegram("[재고알림] " + item.name + "\n" + item.url + "\n\n시간: " + timeStr + "\n\n지금 바로 구매하세요!!" + getEnvText());
        await sendEmail(
          "[닌텐도 재고알림] " + item.name + " 재고 생겼어요!",
          "<div style='font-family:sans-serif;max-width:600px;margin:0 auto;'><h2 style='color:#e60012;'>닌텐도 재고 알림!</h2><h3>" + item.name + "</h3><p>재고가 생겼습니다! 지금 바로 구매하세요!</p><a href='" + item.url + "' style='display:inline-block;background:#e60012;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;font-size:16px;font-weight:bold;'>지금 바로 구매하기</a><p style='color:#666;'>시간: " + timeStr + "</p>" + getEnvHtml() + "</div>"
        );
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
    await sendTelegram("[정기보고]\n" + new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + "\n총 " + checkCount + "회 체크 / 가동 " + uptimeStr + "\n\n" + lines + getEnvText());
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
  console.log("=".repeat(50));
  await fetchIpInfo();
  console.log("  IP:", ENV.ip, "/", ENV.location);
  await sendTelegram("[시작] 닌텐도 스위치2 재고 모니터링!\n1분마다 체크 / 4시간마다 정기 보고\n재고 생기면 즉시 알림!" + getEnvText());
  await sendEmail(
    "[닌텐도 재고봇] 모니터링 시작 - 이메일 테스트",
    "<div style='font-family:sans-serif;max-width:600px;margin:0 auto;'><h2 style='color:#e60012;'>Nintendo Switch 2 재고 모니터링 시작!</h2><p>이메일 알림이 정상적으로 설정되었습니다.</p><ul><li>Nintendo Switch 2 본체</li><li>Nintendo Switch 2 + 마리오카트 월드 세트</li></ul><p>1분마다 체크 / 재고 생기면 이메일 즉시 발송</p><p style='color:#666;'>시작 시간: " + (new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })) + "</p>" + getEnvHtml() + "</div>"
  );
  await checkAll(true);
  setInterval(() => checkAll(false), 60 * 1000);
}

main();


