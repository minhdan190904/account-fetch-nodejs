'use strict';

const path = require('path');
const fs = require('fs-extra');
const { chromium } = require('playwright');
require('dotenv').config();

const PROFILES_DIR = path.resolve(process.env.PROFILES_DIR || './profiles');
const STATES_DIR = path.resolve(process.env.STATES_DIR || './states');
const SUNO_URL = process.env.SUNO_URL || 'https://suno.com';

/**
 * Mở trình duyệt với Persistent Context (có bộ nhớ - như hồ sơ Chrome)
 * @param {string} profileName - Tên thư mục profile (VD: 'account_01')
 * @param {boolean} headless - true: chạy ẩn | false: hiện giao diện
 * @returns {Promise<{context, page}>}
 */
async function launchBrowser(profileName, headless = true) {
  const userDataDir = path.join(PROFILES_DIR, profileName);
  await fs.ensureDir(userDataDir);

  // Khi login lần đầu (headless=false), PHẢI dùng Chrome thật
  // để Google không phát hiện là bot
  const launchOptions = {
    headless,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'Asia/Ho_Chi_Minh',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-plugins-discovery',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
    ignoreDefaultArgs: [
      '--enable-automation',
      '--enable-blink-features=IdleDetection',
    ],
    bypassCSP: true,
  };

  // Thử dùng Chrome thật trên máy (Google sẽ tin hơn)
  // Nếu không có Chrome thật thì fallback về Chromium bundled
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      ...launchOptions,
      channel: 'chrome', // Dùng Chrome thật đã cài trên máy
    });
    console.log('  🟢 Đang dùng Chrome thật (chế độ chống phát hiện tốt nhất)');
  } catch (_) {
    // Không tìm thấy Chrome thật → dùng Chromium bundled
    console.log('  🟡 Không tìm thấy Chrome thật, dùng Chromium tích hợp sẵn...');
    context = await chromium.launchPersistentContext(userDataDir, launchOptions);
  }

  // Ẩn TẤT CẢ dấu vết automation (chạy trên mọi trang mới)
  await context.addInitScript(() => {
    // Xóa webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // Giả lập Chrome thật có đầy đủ runtime
    window.chrome = {
      app: { isInstalled: false },
      webstore: { onInstallStageChanged: {}, onDownloadProgress: {} },
      runtime: {
        PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
        PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
        RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
        OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      },
    };

    // Giả lập permissions API như Chrome thật
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);

    // Ẩn Playwright/automation plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5], // Chrome thật có nhiều plugin
    });

    // Ẩn languages trống (dấu hiệu của bot)
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
  });

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  return { context, page };
}

/**
 * Mở trình duyệt bằng Storage State (file JSON ~10KB)
 * Không cần thư mục Profile nặng 100MB+
 * Hoạt động cross-platform (Windows → Linux)
 * @param {string} profileName - Tên profile (dùng để tìm file state)
 * @param {boolean} headless - true: chạy ẩn
 * @returns {Promise<{context, page, browser}>}
 */
async function launchBrowserFromState(profileName, headless = true) {
  await fs.ensureDir(STATES_DIR);
  const stateFile = path.join(STATES_DIR, `${profileName}.json`);
  const hasState = await fs.pathExists(stateFile);

  const launchOptions = {
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-plugins-discovery',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
    ignoreDefaultArgs: [
      '--enable-automation',
      '--enable-blink-features=IdleDetection',
    ],
  };

  let browser;
  try {
    browser = await chromium.launch({ ...launchOptions, channel: 'chrome' });
    console.log('  🟢 Đang dùng Chrome thật (chế độ Storage State)');
  } catch (_) {
    console.log('  🟡 Không tìm thấy Chrome thật, dùng Chromium tích hợp sẵn...');
    browser = await chromium.launch(launchOptions);
  }

  // Tạo context với storage state nếu có file
  const contextOptions = {
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'Asia/Ho_Chi_Minh',
    bypassCSP: true,
  };

  if (hasState) {
    contextOptions.storageState = stateFile;
    console.log(`  📂 Nạp Storage State từ: ${stateFile}`);
  } else {
    console.log('  ⚠️  Chưa có file Storage State - trình duyệt sẽ ở trạng thái mới');
  }

  const context = await browser.newContext(contextOptions);

  // Ẩn dấu vết automation (giống launchBrowser)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = {
      app: { isInstalled: false },
      webstore: { onInstallStageChanged: {}, onDownloadProgress: {} },
      runtime: {
        PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
        PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
        RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
        OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      },
    };
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });

  const page = await context.newPage();

  return { context, page, browser };
}

/**
 * Lưu Storage State (Cookie + LocalStorage) ra file JSON
 * File này chỉ nặng ~10KB và hoạt động cross-platform
 * @param {BrowserContext} context
 * @param {string} profileName
 */
async function saveStorageState(context, profileName) {
  await fs.ensureDir(STATES_DIR);
  const stateFile = path.join(STATES_DIR, `${profileName}.json`);
  await context.storageState({ path: stateFile });
  console.log(`  💾 Đã lưu Storage State → ${stateFile}`);
  return stateFile;
}

/**
 * Đóng trình duyệt an toàn
 * @param {BrowserContext} context
 * @param {Browser} [browser] - browser instance (dùng cho mode storageState)
 */
async function closeBrowser(context, browser = null) {
  try {
    await context.close();
  } catch (_) {
    // ignore
  }
  if (browser) {
    try {
      await browser.close();
    } catch (_) {
      // ignore
    }
  }
}

module.exports = {
  launchBrowser,
  launchBrowserFromState,
  saveStorageState,
  closeBrowser,
  SUNO_URL,
  PROFILES_DIR,
  STATES_DIR,
};
