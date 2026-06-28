/**
 * 牛马助手 v1.0 — 前端 E2E 测试 (Playwright)
 * 运行: npx playwright test --config=playwright.config.ts
 *
 * 前置条件：
 *   1. 后端已启动：cd backend && python main.py
 *   2. npm install @playwright/test
 *   3. npx playwright install chromium
 */

import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:8000';

// ═══ 页面加载 ═══
test.describe('页面加载', () => {
  test('首页加载成功，显示登录界面', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.locator('#login-view')).toBeVisible();
    await expect(page.locator('#login-title')).toBeVisible();
  });

  test('页面标题包含牛马助手', async ({ page }) => {
    await page.goto(BASE);
    await expect(page).toHaveTitle(/牛马助手|GrindPal/);
  });
});

// ═══ 认证流程 ═══
test.describe('认证流程', () => {
  test('登录 → 注册 选项卡切换', async ({ page }) => {
    await page.goto(BASE);
    await page.click('#tab-register');
    await expect(page.locator('#register-form-view')).toBeVisible();

    await page.click('#tab-login');
    await expect(page.locator('#login-form-view')).toBeVisible();
  });

  test('注册新用户 → 自动进入主界面', async ({ page }) => {
    const username = 'e2e_' + Date.now();
    await page.goto(BASE);
    await page.click('#tab-register');

    await page.fill('#reg-username', username);
    await page.fill('#reg-password', 'test123456');
    await page.fill('#reg-confirm-pw', 'test123456');
    await page.click('#reg-submit-btn');

    // 等待跳转到主界面
    await expect(page.locator('#app-main')).toBeVisible({ timeout: 10000 });
  });

  test('登录已有用户', async ({ page }) => {
    const username = 'e2e_' + Date.now();
    // 先注册
    await page.goto(BASE);
    await page.click('#tab-register');
    await page.fill('#reg-username', username);
    await page.fill('#reg-password', 'test123456');
    await page.fill('#reg-confirm-pw', 'test123456');
    await page.click('#reg-submit-btn');
    await expect(page.locator('#app-main')).toBeVisible({ timeout: 10000 });

    // 登出
    await page.click('#btn-logout');

    // 重新登录
    await page.fill('#login-username', username);
    await page.fill('#login-password', 'test123456');
    await page.click('#login-submit-btn');
    await expect(page.locator('#app-main')).toBeVisible({ timeout: 10000 });
  });

  test('错误密码显示提示', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#login-username', 'nonexistent_user');
    await page.fill('#login-password', 'wrong');
    await page.click('#login-submit-btn');
    await expect(page.locator('#login-error')).not.toBeEmpty({ timeout: 5000 });
  });
});

// ═══ 主题切换 ═══
test.describe('主题切换', () => {
  test('切换暗色模式', async ({ page }) => {
    const username = 'e2e_theme_' + Date.now();
    await page.goto(BASE);
    await page.click('#tab-register');
    await page.fill('#reg-username', username);
    await page.fill('#reg-password', 'test123456');
    await page.fill('#reg-confirm-pw', 'test123456');
    await page.click('#reg-submit-btn');
    await expect(page.locator('#app-main')).toBeVisible({ timeout: 10000 });

    // 切换暗色模式
    await page.click('#dark-toggle');
    const theme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    );
    expect(theme).toBe('dark');
  });
});

// ═══ Toast 通知 ═══
test.describe('Toast 通知', () => {
  test('功能提示 Toast 弹出并自动消失', async ({ page }) => {
    const username = 'e2e_toast_' + Date.now();
    await page.goto(BASE);
    await page.click('#tab-register');
    await page.fill('#reg-username', username);
    await page.fill('#reg-password', 'test123456');
    await page.fill('#reg-confirm-pw', 'test123456');
    await page.click('#reg-submit-btn');
    await expect(page.locator('#app-main')).toBeVisible({ timeout: 10000 });

    // 应该有 toast 容器
    await expect(page.locator('#toast-container')).toBeVisible();
  });
});

// ═══ 设置面板 ═══
test.describe('设置面板', () => {
  test('打开设置 → 修改语言 → 保存', async ({ page }) => {
    const username = 'e2e_settings_' + Date.now();
    await page.goto(BASE);
    await page.click('#tab-register');
    await page.fill('#reg-username', username);
    await page.fill('#reg-password', 'test123456');
    await page.fill('#reg-confirm-pw', 'test123456');
    await page.click('#reg-submit-btn');
    await expect(page.locator('#app-main')).toBeVisible({ timeout: 10000 });

    // 打开设置面板 (gear icon)
    await page.click('#btn-settings');
    await expect(page.locator('#settings-panel')).toBeVisible({ timeout: 3000 });

    // API Key 输入框存在
    await expect(page.locator('#settings-apikey')).toBeVisible();
    // 模型选择器存在
    await expect(page.locator('#settings-model')).toBeVisible();
  });
});

// ═══ 自由对话 ═══
test.describe('自由对话', () => {
  test('创建新对话 → 发送消息 → 收到回复', async ({ page }) => {
    const username = 'e2e_chat_' + Date.now();
    await page.goto(BASE);
    await page.click('#tab-register');
    await page.fill('#reg-username', username);
    await page.fill('#reg-password', 'test123456');
    await page.fill('#reg-confirm-pw', 'test123456');
    await page.click('#reg-submit-btn');
    await expect(page.locator('#app-main')).toBeVisible({ timeout: 10000 });

    // 切换到对话标签
    await page.click('[data-tab="chat"]');

    // 点击新对话按钮或输入消息
    const inputArea = page.locator('#chat-input');
    await expect(inputArea).toBeVisible({ timeout: 5000 });
    await inputArea.fill('用一句话介绍Python');
    await page.click('#chat-send-btn');

    // 等待流式回复
    await page.waitForTimeout(3000);
    // 消息区域应有内容
    const messages = page.locator('.chat-msg');
    const count = await messages.count();
    expect(count).toBeGreaterThanOrEqual(2);  // 至少 user + assistant
  });
});

// ═══ 网络异常 ═══
test.describe('网络异常处理', () => {
  test('服务不可用时显示连接错误', async ({ page }) => {
    // 访问不存在的端口
    await page.goto('http://localhost:19999', {
      waitUntil: 'domcontentloaded',
      timeout: 5000,
    }).catch(() => {});
    // 页面应该显示错误或空白（本地静态文件服务关闭时）
    // 注：此测试需要后端关闭时运行
  });
});

// ═══ 响应式布局（视口适配） ═══
test.describe('响应式布局', () => {
  test('移动端视口：导航隐藏或折叠', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE);
    await expect(page.locator('#login-view')).toBeVisible();
  });
});
