'use strict';

const { launchBrowser, launchBrowserFromState, saveStorageState, closeBrowser, SUNO_URL, PROFILES_DIR, STATES_DIR } = require('./browser');
const fs = require('fs-extra');

const PAGE_TIMEOUT = parseInt(process.env.PAGE_TIMEOUT || '60000', 10);
const NETWORK_IDLE_TIMEOUT = parseInt(process.env.NETWORK_IDLE_TIMEOUT || '10000', 10);

// Các tên cookie quan trọng của Suno
const IMPORTANT_COOKIES = [
  '__session',
  '__client',
  '__cf_bm',
  'cf_clearance',
  '__stripe_mid',
  '__stripe_sid',
];

/**
 * Lắng nghe request mạng để bắt client_api_version và token
 * @param {Page} page
 * @returns {object} capturedData
 */
function setupNetworkInterception(page) {
  const capturedData = {
    clientApiVersion: null,
    clerkSessionToken: null,
    creditsLeft: null, // Thêm credits_left
    sunoApiHeaders: {},
    capturedRequests: [],
  };

  page.on('request', (request) => {
    const url = request.url();
    const headers = request.headers();

    // Bắt request gửi tới Suno API
    const isSunoApi =
      url.includes('studio-api.prod.suno.com') ||
      url.includes('clerk.suno.com') ||
      url.includes('api.suno.com') ||
      (url.includes('suno.com') && url.includes('/api/'));

    if (isSunoApi) {
      // Tìm client_api_version từ nhiều vị trí có thể có
      const version =
        headers['client_api_version'] ||
        headers['x-client-version'] ||
        headers['x-api-version'] ||
        headers['api-version'];

      if (version && !capturedData.clientApiVersion) {
        capturedData.clientApiVersion = version;
      }

      // Bắt Authorization token nếu có
      const auth = headers['authorization'];
      if (auth && auth.startsWith('Bearer ') && !capturedData.clerkSessionToken) {
        capturedData.clerkSessionToken = auth.replace('Bearer ', '');
      }

      // Lưu tất cả header từ Suno API request
      if (url.includes('studio-api.prod.suno.com')) {
        Object.assign(capturedData.sunoApiHeaders, headers);
        capturedData.capturedRequests.push({
          url,
          method: request.method(),
          headers: { ...headers },
          timestamp: new Date().toISOString(),
        });
      }
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('api/billing/info')) {
      try {
        const json = await response.json();
        if (json && typeof json.total_credits_left !== 'undefined') {
          capturedData.creditsLeft = json.total_credits_left;
          console.log(`  💰 Bắt được số dư hiện tại: ${capturedData.creditsLeft} credits`);
        }
      } catch (_) {}
    }
  });

  return capturedData;
}

/**
 * Lấy client_api_version từ source code / Next.js build data
 * @param {Page} page
 * @returns {Promise<string|null>}
 */
async function extractVersionFromPage(page) {
  try {
    const result = await page.evaluate(() => {
      // 1. Thử lấy từ Next.js build data
      const nextData = window.__NEXT_DATA__;
      if (nextData) {
        const buildId = nextData.buildId;
        // Thử tìm trong props/pageProps
        const runtimeConfig = nextData.runtimeConfig;
        const apiVersion =
          runtimeConfig?.clientApiVersion ||
          nextData?.props?.pageProps?.clientApiVersion;

        return { buildId, apiVersion };
      }

      // 2. Thử lấy từ Local Storage
      const lsVersion = localStorage.getItem('client_api_version');
      const lsBuildId = localStorage.getItem('build_id');

      return { buildId: lsBuildId, apiVersion: lsVersion };
    });

    return result?.apiVersion || result?.buildId || null;
  } catch (_) {
    return null;
  }
}

/**
 * Fetch cookie từ một tài khoản đã đăng nhập
 * @param {string} profileName - Tên profile
 * @param {boolean} headless - Chạy ẩn hay không
 * @returns {Promise<object>} - Cookie data
 */
async function fetchCookiesForAccount(profileName, headless = true) {
  // Tự động chọn mode: Profile (nặng, chính xác) vs StorageState (nhẹ, cross-platform)
  const profileDir = require('path').join(PROFILES_DIR, profileName);
  const stateFile = require('path').join(STATES_DIR, `${profileName}.json`);
  const hasProfile = await fs.pathExists(profileDir);
  const hasState = await fs.pathExists(stateFile);

  let context, page, browser = null;

  if (hasProfile) {
    // Mode 1: Persistent Profile (máy Windows có sẵn Profile)
    console.log('  📁 Mode: Persistent Profile');
    ({ context, page } = await launchBrowser(profileName, headless));
  } else if (hasState) {
    // Mode 2: Storage State (file JSON 10KB - cross-platform)
    console.log('  📄 Mode: Storage State (cross-platform)');
    ({ context, page, browser } = await launchBrowserFromState(profileName, headless));
  } else {
    throw new Error(`Không tìm thấy Profile hoặc Storage State cho "${profileName}". Hãy chạy "npm run add-account" trước!`);
  }

  // Cài bộ lắng nghe mạng TRƯỚC khi mở trang
  const networkData = setupNetworkInterception(page);

  try {
    console.log(`  🌐 Đang mở trang Suno...`);

    // Mở trang Suno Create để kích hoạt các API call
    await page.goto(`${SUNO_URL}/create`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    // Đợi trang ổn định để các script tự refresh token chạy
    console.log(`  ⏳ Đợi trang load và tự refresh token...`);
    try {
      await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT });
    } catch (_) {
      // Timeout networkidle là bình thường với SPA, bỏ qua
    }

    // Thêm 2 giây để đảm bảo Clerk đã chạy xong việc refresh
    await page.waitForTimeout(3000);

    // Chủ động gọi billing/info nếu chưa bắt được qua network interception
    if (networkData.creditsLeft === null) {
      try {
        const billingJson = await page.evaluate(async () => {
          const res = await fetch('https://studio-api.prod.suno.com/api/billing/info/', {
            credentials: 'include',
          });
          return await res.json();
        });
        if (billingJson && typeof billingJson.total_credits_left !== 'undefined') {
          networkData.creditsLeft = billingJson.total_credits_left;
          console.log(`  💰 Bắt được số dư hiện tại: ${networkData.creditsLeft} credits`);
        }
      } catch (_) {}
    }

    // Lấy tất cả Cookie từ TẤT CẢ domain (không giới hạn URL)
    // __client có thể ở suno.com hoặc auth.suno.com
    const allCookies = await context.cookies();


    // Tách các cookie quan trọng
    const cookieMap = {};
    allCookies.forEach((c) => {
      cookieMap[c.name] = c.value;
    });

    // Tìm session cookie
    const sessionCookie = allCookies.find((c) => c.name === '__session');
    const clientCookie  = allCookies.find((c) => c.name === '__client' || c.name === '__client_Jnxw-muT');

    // Thử lấy version từ page nếu network interception chưa bắt được
    let clientApiVersion = networkData.clientApiVersion;
    if (!clientApiVersion) {
      clientApiVersion = await extractVersionFromPage(page);
    }

    // Lấy Authorization token từ Local Storage nếu network chưa bắt được
    let clerkToken = networkData.clerkSessionToken;
    if (!clerkToken) {
      try {
        clerkToken = await page.evaluate(() => {
          // Clerk thường lưu token trong indexedDB hoặc cookie __session
          const keys = Object.keys(localStorage);
          for (const key of keys) {
            if (key.includes('clerk') || key.includes('session')) {
              return localStorage.getItem(key);
            }
          }
          return null;
        });
      } catch (_) {}
    }

    // Tạo header Cookie string (dùng để gửi HTTP request thủ công)
    const cookieString = allCookies
      .filter((c) => IMPORTANT_COOKIES.includes(c.name) || c.domain.includes('suno.com'))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    // ✅ Luôn lưu Storage State sau khi fetch thành công (cho lần sau dùng)
    if (sessionCookie) {
      await saveStorageState(context, profileName);
    }

    const result = {
      profileName,
      fetchedAt: new Date().toISOString(),
      isLoggedIn: !!sessionCookie,
      session: sessionCookie?.value || null,
      clientToken: clientCookie?.value || null,  // __client - Refresh Token (sống 1 năm)
      clientApiVersion: clientApiVersion || 'unknown',
      clerkSessionToken: clerkToken || null,
      creditsLeft: networkData.creditsLeft, // Trả về credit
      cookieString,
      allCookies: cookieMap,
      capturedApiHeaders: networkData.sunoApiHeaders,
    };

    return result;
  } finally {
    await closeBrowser(context, browser);
  }
}

/**
 * Mở trình duyệt để người dùng đăng nhập thủ công
 * Dùng trình duyệt nhẹ (KHÔNG tạo thư mục Profile nặng 100MB+)
 * Chỉ lưu file states/*.json (~10KB)
 * @param {string} profileName
 * @returns {Promise<object>} - Cookie sau khi login
 */
async function manualLoginAndFetch(profileName) {
  console.log('\n🔓 Mở trình duyệt để đăng nhập...');
  console.log('👉 Vui lòng:');
  console.log('   1. Đăng nhập vào Suno bằng Google/Discord');
  console.log('   2. Đảm bảo bạn thấy giao diện tạo nhạc');
  console.log('   3. Sau đó quay lại đây và nhấn ENTER\n');

  // Dùng trình duyệt nhẹ (không tạo Profile nặng)
  const { context, page, browser } = await launchBrowserFromState(profileName, false);
  const networkData = setupNetworkInterception(page);

  try {
    await page.goto(SUNO_URL, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    // Đợi người dùng đăng nhập
    await new Promise((resolve) => {
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('✅ Nhấn ENTER sau khi đã đăng nhập thành công: ', () => {
        rl.close();
        resolve();
      });
    });

    // Đi đến trang Create để kích hoạt API calls
    console.log('\n🔄 Đang lấy cookie...');
    await page.goto(`${SUNO_URL}/create`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT,
    });

    try {
      await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT });
    } catch (_) {}

    await page.waitForTimeout(3000);

    // Lấy cookie từ TẤT CẢ domain
    const allCookies = await context.cookies();
    const cookieMap = {};
    allCookies.forEach((c) => { cookieMap[c.name] = c.value; });

    const sessionCookie = allCookies.find((c) => c.name === '__session');
    const clientCookie  = allCookies.find((c) => c.name === '__client' || c.name === '__client_Jnxw-muT');

    let clientApiVersion = networkData.clientApiVersion;
    if (!clientApiVersion) {
      clientApiVersion = await extractVersionFromPage(page);
    }

    const cookieString = allCookies
      .filter((c) => IMPORTANT_COOKIES.includes(c.name) || c.domain.includes('suno.com'))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    // ✅ Lưu Storage State sau khi login (file 10KB, dùng cho VPS)
    if (sessionCookie) {
      await saveStorageState(context, profileName);
      console.log('  📦 Storage State đã sẵn sàng để copy lên VPS!');
    }

    return {
      profileName,
      fetchedAt: new Date().toISOString(),
      isLoggedIn: !!sessionCookie,
      session: sessionCookie?.value || null,
      clientToken: clientCookie?.value || null,
      clientApiVersion: clientApiVersion || 'unknown',
      clerkSessionToken: networkData.clerkSessionToken || null,
      creditsLeft: networkData.creditsLeft, // Trả về credit
      cookieString,
      allCookies: cookieMap,
      capturedApiHeaders: networkData.sunoApiHeaders,
    };

  } finally {
    await closeBrowser(context, browser);
  }
}

module.exports = { fetchCookiesForAccount, manualLoginAndFetch };
