const https = require('https');
const http = require('http');
const os = require('os');

const BOT_TOKEN = "8604073084:AAEY6-A0ICsRAeFvhFerYGOd8ngBAtAKOoA";
const CHAT_ID = "456554192";
const REPORT_INTERVAL = 4 * 60 * 60 * 1000; // 4시간

const ITEMS = [
  {
    url: "https://store.nintendo.co.kr/beeskb6aakor",
    name: "Nintendo Switch 2 본체",
    available: false
  },
  {
    url: "https://store.nintendo.co.kr/beeskb6nakor",
    name: "Nintendo Switch 2 + 마리오카트 월드 세트",
    available: false
  }
];

// 서버 환경 정보
const ENV = {
  hostname: os.hostname(),
  platform: os.platform() === 'win32' ? 'Windows' : os.platform() === 'darwin' ? 'macOS' : 'Linux',
  arch: os.arch(),
  node: process.version,
  ip: '조회 중...',
  isp: '조회 중...',
  location: '조회 중...'
};

function fetchIpInfo() {
  return new Promise((resolve) => {
    https.get('https://ipinfo.io/json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          ENV.ip = info.ip || '알 수 없음';
          ENV.isp = info.org || '알 수 없음';
          ENV.location = `${info.city || ''}, ${info.country || ''}`;
        } catch(e) {}
        resolve();
      });
    }).on('error', () => resolve());
  });
}

function getEnvText() {
  return `\n🖥 <b>실행 환경</b>\n` +
    `  • 호스트: ${ENV.hostname}\n` +
    `  • OS: ${ENV.platform} (${ENV.arch})\n` +
    `  • Node.js: ${ENV.node}\n` +
    `  • IP: ${ENV.ip}\n` +
    `  • ISP: ${ENV.isp}\n` +
    `  • 위치: ${ENV.location}`;
}

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 15000
    };
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPage(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function sendTelegram(message) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: 'HTML' });
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { console.log('  📨 텔레그램:', res.statusCode === 200 ? '전송 성공' : '전송 실패'); resolve(); });
    });
    req.on('error', (e) => { console.log('  ❌ 텔레그램 오류:', e.message); resolve(); });
    req.write(body);
    req.end();
  });
}

let checkCount = 0;
let lastReportTime = Date.now();
const startTime = new Date();

async function checkAll(forceReport = false) {
  checkCount++;
  const now = new Date().toLocaleTimeString('ko-KR');
  console.log(`\n[${now}] #${checkCount} 재고 체크 중...`);

  const results = [];

  for (const item of ITEMS) {
    try {
      const html = await fetchPage(item.url);
      const isSoldOut = html.includes('품절');
      const inStock = !isSoldOut;

      console.log(`  ${inStock ? '✅ 재고있음' : '❌ 품절'} - ${item.name}`);
      results.push({ item, inStock });

      // 품절 → 재고 생김
      if (inStock && !item.available) {
        const msg =
          `🚨🚨 재고 생겼어요!! 🚨🚨\n\n` +
          `🎮 <b>${item.name}</b>\n` +
          `🔗 ${item.url}\n\n` +
          `⏰ ${new Date().toLocaleString('ko-KR')}\n\n` +
          `지금 바로 구매하세요!!` +
          getEnvText();
        await sendTelegram(msg);
        item.available = true;
      }

      // 재고 → 다시 품절
      if (!inStock && item.available) {
        item.available = false;
        console.log(`  ⚠️  다시 품절됨`);
      }

    } catch (e) {
      console.log(`  ❌ 오류 (${item.name}): ${e.message}`);
      results.push({ item, inStock: null });
    }
  }

  // 4시간마다 정기 보고
  const now_ms = Date.now();
  if (forceReport || now_ms - lastReportTime >= REPORT_INTERVAL) {
    lastReportTime = now_ms;

    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const uptimeStr = uptime < 60 ? `${uptime}초`
      : uptime < 3600 ? `${Math.floor(uptime/60)}분`
      : `${Math.floor(uptime/3600)}시간 ${Math.floor((uptime%3600)/60)}분`;

    const lines = results.map(r => {
      if (r.inStock === null) return `⚠️ ${r.item.name}\n   └ 오류 발생`;
      return r.inStock
        ? `✅ ${r.item.name}\n   └ 재고 있음!`
        : `❌ ${r.item.name}\n   └ 품절`;
    }).join('\n\n');

    const report =
      `📊 <b>정기 재고 보고</b> (4시간마다)\n` +
      `⏰ ${new Date().toLocaleString('ko-KR')}\n` +
      `🔢 총 ${checkCount}회 체크 / 가동 ${uptimeStr}\n\n` +
      `${lines}` +
      getEnvText();

    await sendTelegram(report);
    console.log('  📊 정기 보고 전송 완료');
  }
}

async function main() {
  console.log('='.repeat(50));
  console.log('🎮 닌텐도 재고 모니터링 시작!');
  console.log('- 체크 간격: 1분');
  console.log('- 정기 보고: 4시간마다');
  console.log('='.repeat(50));

  await fetchIpInfo();
  console.log(`  IP: ${ENV.ip} / ${ENV.location}`);

  await sendTelegram(
    `🎮 <b>닌텐도 스위치2 재고 모니터링 시작!</b>\n` +
    `⏱ 1분마다 체크 / 4시간마다 정기 보고\n` +
    `재고 생기면 즉시 알림 드릴게요!\n` +
    getEnvText()
  );

  await checkAll(true);
  setInterval(() => checkAll(), 60 * 1000);
}

main();
