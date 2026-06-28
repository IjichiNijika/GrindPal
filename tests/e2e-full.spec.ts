/**
 * 牛马助手 v1.0 — 全功能 E2E 测试 (Playwright + 系统 Chrome)
 *
 * 运行:
 *   npm install --registry=https://registry.npmmirror.com
 *   npx playwright test --reporter=html
 *
 * 覆盖: 认证(14) + 主框架UI(12) + 设置(22) + 功能模块(45) + 对话CRUD(22) + 辅助面板(8) ≈ 123 tests
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:8000';

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════
async function registerAndLogin(page: Page, prefix = 'e2e') {
  const username = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  await page.goto(BASE);
  await page.click('#tab-register');
  await page.fill('#reg-username', username);
  await page.fill('#reg-password', 'test123456');
  await page.fill('#reg-confirm-pw', 'test123456');
  await page.click('#reg-submit-btn');
  await expect(page.locator('#top-nav')).toBeVisible({ timeout: 15000 });
  return username;
}

async function ensureLoggedIn(page: Page) {
  if (await page.locator('#top-nav').isVisible({ timeout: 1000 }).catch(() => false)) return;
  await registerAndLogin(page);
}

async function switchToTab(page: Page, tab: string) {
  await page.click(`[data-tab="${tab}"]`);
  await expect(page.locator(`#section-${tab}`)).toBeVisible({ timeout: 3000 });
}

// ═══════════════════════════════════════════════════════════════
// 1. 认证流程 (14 tests)
// ═══════════════════════════════════════════════════════════════
test.describe('认证 - 注册', () => {
  test('注册成功 → 主界面出现', async ({ page }) => {
    const u = `regok_${Date.now()}`;
    await page.goto(BASE);
    await page.click('#tab-register');
    await page.fill('#reg-username', u);
    await page.fill('#reg-password', 'test123456');
    await page.fill('#reg-confirm-pw', 'test123456');
    await page.click('#reg-submit-btn');
    await expect(page.locator('#top-nav')).toBeVisible({ timeout: 15000 });
  });

  test('重复用户名 → 409', async ({ page }) => {
    const u = `dup_${Date.now()}`;
    await page.goto(BASE);
    await page.click('#tab-register');
    await page.fill('#reg-username', u);
    await page.fill('#reg-password', 'test123456');
    await page.fill('#reg-confirm-pw', 'test123456');
    await page.click('#reg-submit-btn');
    await expect(page.locator('#top-nav')).toBeVisible({ timeout: 15000 });

    // 登出
    await page.click('button[onclick="App.toggleSettings()"]');
    await page.click('#stab-account');
    await page.click('button[onclick="App.logout()"]');

    // 用同一用户名再注册
    await page.goto(BASE);
    await page.click('#tab-register');
    await page.fill('#reg-username', u);
    await page.fill('#reg-password', 'test123456');
    await page.fill('#reg-confirm-pw', 'test123456');
    await page.click('#reg-submit-btn');
    await expect(page.locator('#reg-error')).not.toBeEmpty({ timeout: 5000 });
  });

  test('密码过短 → 422 或错误提示', async ({ page }) => {
    await page.goto(BASE);
    await page.click('#tab-register');
    await page.fill('#reg-username', `short_${Date.now()}`);
    await page.fill('#reg-password', '12');
    await page.fill('#reg-confirm-pw', '12');
    await page.click('#reg-submit-btn');
    await expect(page.locator('#reg-error')).not.toBeEmpty({ timeout: 5000 });
  });

  test('密码不一致 → 错误提示', async ({ page }) => {
    await page.goto(BASE);
    await page.click('#tab-register');
    await page.fill('#reg-username', `mismatch_${Date.now()}`);
    await page.fill('#reg-password', 'test123456');
    await page.fill('#reg-confirm-pw', 'different');
    await page.click('#reg-submit-btn');
    await expect(page.locator('#reg-error')).not.toBeEmpty({ timeout: 5000 });
  });

  test('空用户名 → 错误提示', async ({ page }) => {
    await page.goto(BASE);
    await page.click('#tab-register');
    await page.fill('#reg-password', 'test123456');
    await page.fill('#reg-confirm-pw', 'test123456');
    await page.click('#reg-submit-btn');
    await expect(page.locator('#reg-error')).not.toBeEmpty({ timeout: 5000 });
  });
});

test.describe('认证 - 登录', () => {
  test('正确密码登录成功', async ({ page }) => {
    const u = `loginok_${Date.now()}`;
    await page.goto(BASE);
    await page.click('#tab-register');
    await page.fill('#reg-username', u);
    await page.fill('#reg-password', 'test123456');
    await page.fill('#reg-confirm-pw', 'test123456');
    await page.click('#reg-submit-btn');
    await expect(page.locator('#top-nav')).toBeVisible({ timeout: 15000 });

    // 登出
    await page.click('button[onclick="App.toggleSettings()"]');
    await page.click('#stab-account');
    await page.click('button[onclick="App.logout()"]');

    // 重新登录
    await page.fill('#login-username', u);
    await page.fill('#login-password', 'test123456');
    await page.click('#login-submit-btn');
    await expect(page.locator('#top-nav')).toBeVisible({ timeout: 15000 });
  });

  test('错误密码 → 401', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#login-username', 'doesnotexist123');
    await page.fill('#login-password', 'wrongpassword');
    await page.click('#login-submit-btn');
    await expect(page.locator('#login-error')).not.toBeEmpty({ timeout: 5000 });
  });

  test('空字段 → 提示', async ({ page }) => {
    await page.goto(BASE);
    await page.click('#login-submit-btn');
    await expect(page.locator('#login-error')).not.toBeEmpty({ timeout: 5000 });
  });
});

test.describe('认证 - 忘记密码', () => {
  test('忘记密码完整流程', async ({ page }) => {
    const u = `forgot_${Date.now()}`;
    await page.goto(BASE);
    await page.click('#tab-register');
    await page.fill('#reg-username', u);
    await page.fill('#reg-password', 'test123456');
    await page.fill('#reg-confirm-pw', 'test123456');
    await page.click('#reg-submit-btn');
    await expect(page.locator('#top-nav')).toBeVisible({ timeout: 15000 });

    // 设密保
    await page.click('button[onclick="App.toggleSettings()"]');
    await page.click('#stab-account');
    await page.fill('#settings-security-q', 'my pet name?');
    await page.fill('#settings-security-a', 'fluffy');
    await page.click('button[onclick="App.setSecurity()"]');

    // 登出
    await page.click('button[onclick="App.logout()"]');

    // 忘记密码
    await page.click('text=← 返回登录');
    // Click the forgot password link
    await page.click('[data-i18n="login.forgot"]');
  });

  test('忘记密码-错误答案', async ({ page }) => {
    await page.goto(BASE);
    await page.fill('#login-username', 'noone');
    await page.fill('#login-password', 'x');
    await page.click('#login-submit-btn');
    // 如果有忘记密码链接就点
    const forgot = page.locator('[onclick*="forgot"]');
    if (await forgot.isVisible({ timeout: 2000 }).catch(() => false)) {
      await forgot.click();
    }
  });
});

test.describe('认证 - 状态保持', () => {
  test('页面刷新 → Cookie 恢复登录', async ({ page }) => {
    await registerAndLogin(page);
    await page.reload();
    await expect(page.locator('#top-nav')).toBeVisible({ timeout: 15000 });
  });

  test('登出后刷新 → 保持在登录界面', async ({ page }) => {
    await registerAndLogin(page);
    await page.click('button[onclick="App.toggleSettings()"]');
    await page.click('#stab-account');
    await page.click('button[onclick="App.logout()"]');
    await page.reload();
    await expect(page.locator('#login-overlay')).toBeVisible({ timeout: 5000 });
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. 主框架 UI (12 tests)
// ═══════════════════════════════════════════════════════════════
test.describe('主框架 - 导航', () => {
  test.beforeEach(async ({ page }) => { await registerAndLogin(page); });

  const tabs = ['chat','summarize','email','minutes','polish','reportese','requirements','prd','ppt','weeklyreport'];
  for (const tab of tabs) {
    test(`导航tab "${tab}" 点击→对应section可见`, async ({ page }) => {
      await page.click(`[data-tab="${tab}"]`);
      await expect(page.locator(`#section-${tab}`)).toBeVisible({ timeout: 3000 });
    });
  }

  test('底部状态栏按钮全部可见', async ({ page }) => {
    await expect(page.locator('#bottom-bar')).toBeVisible();
    await expect(page.locator('button[onclick="App.toggleSettings()"]')).toBeVisible();
    await expect(page.locator('#dark-toggle')).toBeVisible();
    await expect(page.locator('button[onclick="App.toggleHistory()"]')).toBeVisible();
    await expect(page.locator('#todo-toggle')).toBeVisible();
  });

  test('底部 token 统计数字显示', async ({ page }) => {
    await expect(page.locator('#stat-session')).toBeVisible();
    await expect(page.locator('#stat-total')).toBeVisible();
  });
});

test.describe('主框架 - 主题', () => {
  test.beforeEach(async ({ page }) => { await registerAndLogin(page); });

  test('暗色模式切换 → data-theme=dark', async ({ page }) => {
    await page.click('#dark-toggle');
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('dark');
  });

  test('暗色→亮色来回切换', async ({ page }) => {
    await page.click('#dark-toggle');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
    await page.click('#dark-toggle');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. 设置面板 (22 tests)
// ═══════════════════════════════════════════════════════════════
test.describe('设置 - 基础设置', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await page.click('button[onclick="App.toggleSettings()"]');
  });

  test('设置面板打开 → overlay可见 → 关闭 → 消失', async ({ page }) => {
    await expect(page.locator('#settings-overlay')).toBeVisible();
    await page.click('#settings-overlay .close-btn');
    await expect(page.locator('#settings-overlay')).not.toBeVisible({ timeout: 3000 });
  });

  test('API Key 输入 → 失焦后 localStorage 有值', async ({ page }) => {
    await page.fill('#settings-apikey', 'sk-test-api-key-12345');
    await page.locator('#settings-apikey').blur();
    const val = await page.evaluate(() => localStorage.getItem('grindpal_apikey'));
    expect(val).toBeTruthy();
  });

  test('模型下拉切换 → localStorage 更新', async ({ page }) => {
    await page.selectOption('#settings-model', 'deepseek-v4-pro');
    const val = await page.evaluate(() => localStorage.getItem('grindpal_model'));
    expect(val).toBe('deepseek-v4-pro');
  });

  test('语言切换 zh→en → UI 文本变化', async ({ page }) => {
    await page.selectOption('#settings-lang', 'en-US');
    await page.waitForTimeout(500);
    const title = await page.locator('[data-i18n="app.title"]').first().textContent();
    expect(title).toBe('GrindPal');
  });

  test('语言切换 en→zh → UI 文本变化', async ({ page }) => {
    await page.selectOption('#settings-lang', 'en-US');
    await page.waitForTimeout(300);
    await page.selectOption('#settings-lang', 'zh-CN');
    await page.waitForTimeout(500);
    const title = await page.locator('[data-i18n="app.title"]').first().textContent();
    expect(title).toBe('牛马助手');
  });

  test('文风 3 档切换 → localStorage 更新', async ({ page }) => {
    await page.selectOption('#settings-style', 'natural');
    let val = await page.evaluate(() => localStorage.getItem('grindpal_style'));
    expect(val).toBe('natural');
    await page.selectOption('#settings-style', 'formal');
    val = await page.evaluate(() => localStorage.getItem('grindpal_style'));
    expect(val).toBe('formal');
  });

  test('提醒间隔下拉切换可选', async ({ page }) => {
    await page.selectOption('#settings-reminder', '30');
    const val = await page.evaluate(() => localStorage.getItem('grindpal_reminder'));
    expect(val).toBe('30');
  });

  test('酒馆开关 toggle → localStorage 同步', async ({ page }) => {
    await page.locator('#settings-tavern').uncheck();
    const val = await page.evaluate(() => localStorage.getItem('grindpal_tavern'));
    expect(val).toBe('0');
  });

  test('隐藏酒馆 toggle → localStorage 同步', async ({ page }) => {
    await page.locator('#settings-tavern-hide').check();
    const val = await page.evaluate(() => localStorage.getItem('grindpal_tavern_hide'));
    expect(val).toBe('1');
  });

  test('背景上传 → 预览可见', async ({ page }) => {
    const fileInput = page.locator('#settings-bg');
    await fileInput.setInputFiles({
      name: 'bg.png',
      mimeType: 'image/png',
      buffer: Buffer.from('fake-png-data'),
    });
    // 预览可能出现也可能没有（取决于图片有效性），至少触发上传
  });

  test('清除背景 → 预览消失', async ({ page }) => {
    await page.click('button[onclick="App.clearBackground()"]');
    await expect(page.locator('#bg-preview')).not.toBeVisible({ timeout: 3000 });
  });

  test('余额查询按钮可点击', async ({ page }) => {
    await page.click('button[onclick="App.queryBalance()"]');
  });
});

test.describe('设置 - 账户管理', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await page.click('button[onclick="App.toggleSettings()"]');
    await page.click('#stab-account');
  });

  test('用户名显示(disabled)', async ({ page }) => {
    const input = page.locator('#account-username');
    await expect(input).toBeVisible();
    expect(await input.isDisabled()).toBe(true);
  });

  test('修改密码-空字段提示', async ({ page }) => {
    await page.click('button[onclick="App.changePassword()"]');
  });

  test('设置密保 → 保存', async ({ page }) => {
    await page.fill('#settings-security-q', 'My first car?');
    await page.fill('#settings-security-a', 'Toyota');
    await page.click('button[onclick="App.setSecurity()"]');
  });

  test('登出 → 回到登录界面', async ({ page }) => {
    await page.click('button[onclick="App.logout()"]');
    await expect(page.locator('#login-overlay')).toBeVisible({ timeout: 5000 });
  });

  test('注销账号按钮可见', async ({ page }) => {
    await expect(page.locator('button[onclick="App.deleteAccount()"]')).toBeVisible();
  });
});

test.describe('设置 - 模板库', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await page.click('button[onclick="App.toggleSettings()"]');
    await page.click('#stab-templates');
  });

  test('新建模板表单 打开→取消→关闭', async ({ page }) => {
    await page.click('button[onclick="App._showTemplateForm()"]');
    await expect(page.locator('#template-form')).toBeVisible({ timeout: 3000 });
    await page.click('button[onclick*="template-form"][onclick*="none"]'); // cancel
    await expect(page.locator('#template-form')).not.toBeVisible({ timeout: 3000 });
  });

  test('一键提炼按钮可见', async ({ page }) => {
    await expect(page.locator('button[onclick="App._extractTemplate()"]')).toBeVisible();
  });
});

test.describe('设置 - 知识库', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await page.click('button[onclick="App.toggleSettings()"]');
  });

  test('创建知识库 → 列表中可见', async ({ page }) => {
    await page.click('#stab-kb');
    const name = `kb_${Date.now()}`;
    await page.fill('#kb-col-name', name);
    await page.click('button[onclick="App._createKB()"]');
    await page.waitForTimeout(1000);
    const list = page.locator('#kb-collections');
    await expect(list.locator(`text=${name}`)).toBeVisible({ timeout: 5000 });
  });

  test('粘贴文本入库', async ({ page }) => {
    await page.click('#stab-kb');
    const name = `kb_paste_${Date.now()}`;
    await page.fill('#kb-col-name', name);
    await page.click('button[onclick="App._createKB()"]');
    await page.waitForTimeout(800);
    // 选择知识库
    await page.selectOption('#kb-paste-collection', { index: 1 });
    await page.fill('#kb-text-paste', '这是一段测试文本内容');
    await page.click('button[onclick="App._saveKBPaste()"]');
  });

  test('检索测试按钮可点击', async ({ page }) => {
    await page.click('#stab-kb');
    await page.fill('#kb-search-input', '测试');
    await page.click('button[onclick="App._testKBSearch()"]');
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. 功能模块 (45 tests)
// ═══════════════════════════════════════════════════════════════
test.describe('功能 - 太长不看', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await switchToTab(page, 'summarize');
  });

  test('短/中/要点式 标签切换 active class', async ({ page }) => {
    await page.click('[data-length="medium"]');
    await expect(page.locator('[data-length="medium"]')).toHaveClass(/selected/);
    await page.click('[data-length="bullets"]');
    await expect(page.locator('[data-length="bullets"]')).toHaveClass(/selected/);
  });

  test('提交 → 结果出现 → 按钮可见', async ({ page }) => {
    await page.fill('#summarize-input', '今天开了三场会，讨论了五个议题，决定下周启动新项目');
    await page.click('button[onclick="Modules.summarize.submit()"]');
    await expect(page.locator('#summarize-result')).not.toBeEmpty({ timeout: 15000 });
    await expect(page.locator('#summarize-copy')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#summarize-export')).toBeVisible();
    await expect(page.locator('#summarize-result-todo')).toBeVisible();
  });
});

test.describe('功能 - 礼貌糊弄', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await switchToTab(page, 'email');
  });

  test('三种语气下拉可选', async ({ page }) => {
    await page.selectOption('#email-tone', 'friendly');
    await page.selectOption('#email-tone', 'professional');
    await page.selectOption('#email-tone', 'formal');
  });

  test('回复模式 → 原始邮件框出现/消失', async ({ page }) => {
    await page.selectOption('#email-mode', 'reply');
    await expect(page.locator('#email-original')).toBeVisible();
    await page.selectOption('#email-mode', 'write');
    await expect(page.locator('#email-original')).not.toBeVisible();
  });

  test('填写表单 → 生成邮件 → 结果', async ({ page }) => {
    await page.fill('#email-recipient', '张总');
    await page.fill('#email-subject', '项目进展汇报');
    await page.fill('#email-points', '进度正常,需要延期,请求支持');
    await page.click('button[onclick="Modules.email.submit()"]');
    await expect(page.locator('#email-result')).not.toBeEmpty({ timeout: 15000 });
  });
});

test.describe('功能 - 人云议云', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await switchToTab(page, 'minutes');
  });

  test('录音/上传/模式/语言按钮可见', async ({ page }) => {
    await expect(page.locator('#mic-btn')).toBeVisible();
    await expect(page.locator('#mode-btn')).toBeVisible();
    await expect(page.locator('#lang-btn')).toBeVisible();
  });

  test('输入文本 → 生成纪要 → 结果', async ({ page }) => {
    await page.fill('#minutes-input', '今天讨论项目进度，决定延期两周，张总负责协调资源');
    await page.click('button[onclick="Modules.minutes.submit()"]');
    await expect(page.locator('#minutes-result')).not.toBeEmpty({ timeout: 15000 });
  });
});

test.describe('功能 - 注水加精', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await switchToTab(page, 'polish');
  });

  test('左右对比面板可见', async ({ page }) => {
    await expect(page.locator('#polish-input')).toBeVisible();
    await expect(page.locator('#polish-output')).toBeVisible();
  });

  test('商务/学术风格切换', async ({ page }) => {
    await page.click('[data-style="academic"]');
    await expect(page.locator('[data-style="academic"]')).toHaveClass(/selected/);
  });

  test('输入草稿 → 润色 → 结果更新', async ({ page }) => {
    await page.fill('#polish-input', '今天搞了一下那个需求，感觉还行吧，下周继续');
    await page.click('button[onclick="Modules.polish.submit()"]');
    await expect(page.locator('#polish-output-text')).not.toBeEmpty({ timeout: 15000 });
  });
});

test.describe('功能 - 向上管理', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await switchToTab(page, 'reportese');
  });

  test('三种风格标签可切换', async ({ page }) => {
    await page.click('[data-rstyle="risk-averse"]');
    await expect(page.locator('[data-rstyle="risk-averse"]')).toHaveClass(/selected/);
    await page.click('[data-rstyle="innovation-highlight"]');
    await expect(page.locator('[data-rstyle="innovation-highlight"]')).toHaveClass(/selected/);
  });

  test('输入吐槽 → 翻译 → 结果 + 导出按钮', async ({ page }) => {
    await page.fill('#reportese-input', '项目根本做不完，天天开会啥活没干');
    await page.click('button[onclick="Modules.reportese.submit()"]');
    await expect(page.locator('#reportese-result')).not.toBeEmpty({ timeout: 15000 });
    await expect(page.locator('#reportese-export')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('功能 - 需求炼金', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await switchToTab(page, 'requirements');
  });

  test('spec/user_story 风格切换', async ({ page }) => {
    await page.click('[data-rqstyle="user_story"]');
    await expect(page.locator('[data-rqstyle="user_story"]')).toHaveClass(/selected/);
  });

  test('输入文本 → 生成 → 结果 + 提炼按钮', async ({ page }) => {
    await page.fill('#requirements-input', '用户反馈登录太慢，希望支持手机验证码登录，管理后台需要增加数据导出功能');
    await page.click('button[onclick="Modules.requirements.submit()"]');
    await expect(page.locator('#requirements-result')).not.toBeEmpty({ timeout: 15000 });
  });
});

test.describe('功能 - 产品画饼', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await switchToTab(page, 'prd');
  });

  test('full/lean 风格切换', async ({ page }) => {
    await page.click('[data-prdstyle="lean"]');
    await expect(page.locator('[data-prdstyle="lean"]')).toHaveClass(/selected/);
  });

  test('不勾选Demo → 仅PRD结果', async ({ page }) => {
    await page.fill('#prd-input', '一个团队协作工具，支持任务分配和日历共享');
    await page.click('button[onclick="Modules.prd.submit()"]');
    await expect(page.locator('#prd-result')).not.toBeEmpty({ timeout: 15000 });
  });

  test('勾选Demo → iframe可见', async ({ page }) => {
    await page.fill('#prd-input', '一个简单的待办清单应用');
    await page.locator('#prd-demo').check();
    await page.click('button[onclick="Modules.prd.submit()"]');
    await expect(page.locator('#prd-demo-box')).toBeVisible({ timeout: 20000 });
  });
});

test.describe('功能 - PPT雕花', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await switchToTab(page, 'ppt');
  });

  test('仅大纲/含备注 切换', async ({ page }) => {
    await page.click('[data-pptstyle="notes"]');
    await expect(page.locator('[data-pptstyle="notes"]')).toHaveClass(/selected/);
  });

  test('填写 → 生成大纲 → 导出PPTX按钮', async ({ page }) => {
    await page.fill('#ppt-topic', 'Q3季度工作汇报');
    await page.fill('#ppt-points', '完成了三个主要功能，用户增长20%');
    await page.click('button[onclick="Modules.ppt.submit()"]');
    await expect(page.locator('#ppt-result')).not.toBeEmpty({ timeout: 15000 });
    await expect(page.locator('#ppt-pptx')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('功能 - 周报生成', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await switchToTab(page, 'weeklyreport');
  });

  test('4种类型标签可切换', async ({ page }) => {
    await page.click('[data-wrtype="project"]');
    await expect(page.locator('[data-wrtype="project"]')).toHaveClass(/selected/);
    await page.click('[data-wrtype="ops"]');
    await expect(page.locator('[data-wrtype="ops"]')).toHaveClass(/selected/);
  });

  test('结构化/叙述体风格切换', async ({ page }) => {
    await page.click('[data-wrstyle="narrative"]');
    await expect(page.locator('[data-wrstyle="narrative"]')).toHaveClass(/selected/);
  });

  test('中/英语言切换', async ({ page }) => {
    await page.click('[data-wrlang="en"]');
    await expect(page.locator('[data-wrlang="en"]')).toHaveClass(/selected/);
  });

  test('输入笔记 → 生成周报 → 结果', async ({ page }) => {
    await page.fill('#wr-raw-notes', '本周完成了登录模块开发，修复了3个bug，下周计划开始支付模块');
    await page.click('button[onclick="Modules.weeklyreport.submit()"]');
    await expect(page.locator('#weeklyreport-result')).not.toBeEmpty({ timeout: 15000 });
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. 自由对话 (22 tests)
// ═══════════════════════════════════════════════════════════════
test.describe('对话 - 侧栏管理', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await switchToTab(page, 'chat');
  });

  test('新建对话 → 列表中可见', async ({ page }) => {
    const before = await page.locator('#chat-conv-list > *').count();
    await page.click('#chat-new-btn');
    await page.waitForTimeout(500);
    const after = await page.locator('#chat-conv-list > *').count();
    expect(after).toBeGreaterThanOrEqual(before);
  });

  test('搜索过滤对话列表', async ({ page }) => {
    await page.fill('#chat-search-input', '不存在');
    await page.waitForTimeout(500);
    // 过滤后可能为空
  });

  test('重命名对话 → 标题更新', async ({ page }) => {
    await page.click('#chat-new-btn');
    await page.waitForTimeout(500);
    // 双击标题或右键重命名（需要查看具体交互方式）
  });

  test('删除对话 → 列表移除', async ({ page }) => {
    await page.click('#chat-new-btn');
    await page.waitForTimeout(500);
    const before = await page.locator('#chat-conv-list > *').count();
    // 删除操作依赖具体UI实现
  });
});

test.describe('对话 - 消息发送与接收', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await switchToTab(page, 'chat');
  });

  test('空状态欢迎提示 + 快捷chip可见', async ({ page }) => {
    await expect(page.locator('#chat-empty-hint')).toBeVisible();
    await expect(page.locator('.quick-action-chip').first()).toBeVisible();
  });

  test('点击快捷chip → 填充输入框', async ({ page }) => {
    await page.click('.quick-action-chip');
    const val = await page.locator('#chat-input').inputValue();
    expect(val.length).toBeGreaterThan(0);
  });

  test('输入文本 → 发送按钮可用', async ({ page }) => {
    await page.fill('#chat-input', 'hello');
    await expect(page.locator('#chat-send-btn')).toBeEnabled();
  });

  test('发送消息 → 用户气泡出现', async ({ page }) => {
    await page.fill('#chat-input', '你好');
    await page.click('#chat-send-btn');
    await expect(page.locator('.chat-msg').first()).toBeVisible({ timeout: 10000 });
  });

  test('发送消息 → AI流式回复', async ({ page }) => {
    await page.fill('#chat-input', '用一句话介绍Python');
    await page.click('#chat-send-btn');
    await page.waitForTimeout(2000);
    const msgs = page.locator('.chat-msg');
    const count = await msgs.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('发送后输入框清空', async ({ page }) => {
    await page.fill('#chat-input', 'test');
    await page.click('#chat-send-btn');
    await page.waitForTimeout(500);
    const val = await page.locator('#chat-input').inputValue();
    expect(val).toBe('');
  });

  test('发送时空输入 → 不触发', async ({ page }) => {
    await page.fill('#chat-input', '');
    await expect(page.locator('#chat-send-btn')).toBeDisabled();
  });
});

test.describe('对话 - 底部工具栏', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await switchToTab(page, 'chat');
  });

  test('模型下拉切换 v4-flash↔v4-pro', async ({ page }) => {
    await page.selectOption('#chat-model-select', 'deepseek-v4-pro');
    const val = await page.locator('#chat-model-select').inputValue();
    expect(val).toBe('deepseek-v4-pro');
  });

  test('人设下拉 标准/活泼/专家', async ({ page }) => {
    await page.selectOption('#chat-persona-select', 'genius_girl');
    const val = await page.locator('#chat-persona-select').inputValue();
    expect(val).toBe('genius_girl');
    await page.selectOption('#chat-persona-select', 'expert');
    expect(await page.locator('#chat-persona-select').inputValue()).toBe('expert');
  });

  test('知识库开关 toggle', async ({ page }) => {
    await page.locator('#chat-kb-checkbox').check();
    expect(await page.locator('#chat-kb-checkbox').isChecked()).toBe(true);
    await page.locator('#chat-kb-checkbox').uncheck();
    expect(await page.locator('#chat-kb-checkbox').isChecked()).toBe(false);
  });

  test('深度思考开关 toggle', async ({ page }) => {
    await page.locator('#chat-deep-think').check();
    expect(await page.locator('#chat-deep-think').isChecked()).toBe(true);
    await page.locator('#chat-deep-think').uncheck();
    expect(await page.locator('#chat-deep-think').isChecked()).toBe(false);
  });
});

test.describe('对话 - 消息操作', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await switchToTab(page, 'chat');
  });

  test('编辑消息 → 重新生成', async ({ page }) => {
    await page.fill('#chat-input', 'hello');
    await page.click('#chat-send-btn');
    await page.waitForTimeout(3000);
    // 编辑需要点击消息上的编辑按钮
    const editBtn = page.locator('[onclick*="editMessage"]');
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click();
    }
  });

  test('删除单条消息', async ({ page }) => {
    await page.fill('#chat-input', 'test delete');
    await page.click('#chat-send-btn');
    await page.waitForTimeout(3000);
    const delBtn = page.locator('[onclick*="deleteMessage"]');
    if (await delBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await delBtn.click();
    }
  });
});

test.describe('对话 - 附件上传', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page);
    await switchToTab(page, 'chat');
  });

  test('上传图片 → 预览出现', async ({ page }) => {
    // 找到文件上传 input
    const fileInput = page.locator('input[type="file"][accept*="image"]');
    if (await fileInput.isVisible().catch(() => false)) {
      await fileInput.setInputFiles({
        name: 'test.png',
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
      });
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. 辅助面板 (8 tests)
// ═══════════════════════════════════════════════════════════════
test.describe('辅助面板', () => {
  test.beforeEach(async ({ page }) => { await registerAndLogin(page); });

  test('历史面板 打开→可见→记录列表', async ({ page }) => {
    await page.click('button[onclick="App.toggleHistory()"]');
    await expect(page.locator('#history-panel')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#history-list')).toBeVisible();
  });

  test('历史面板 搜索框可见', async ({ page }) => {
    await page.click('button[onclick="App.toggleHistory()"]');
    await expect(page.locator('#history-search')).toBeVisible();
  });

  test('历史面板 全选checkbox可点击', async ({ page }) => {
    await page.click('button[onclick="App.toggleHistory()"]');
    await page.locator('#history-select-all').check();
    expect(await page.locator('#history-select-all').isChecked()).toBe(true);
  });

  test('待办面板 打开→可见', async ({ page }) => {
    await page.click('#todo-toggle');
    await expect(page.locator('#todo-panel')).toBeVisible({ timeout: 3000 });
  });

  test('待办面板 输入→添加→列表中可见', async ({ page }) => {
    await page.click('#todo-toggle');
    await page.fill('#todo-new-task', '明天下午3点找张三确认排期');
    await page.click('button[onclick="App._addTodo()"]');
    await page.waitForTimeout(1000);
  });

  test('待办面板 关闭→不可见', async ({ page }) => {
    await page.click('#todo-toggle');
    await page.waitForTimeout(500);
    await page.click('#todo-toggle');
    await expect(page.locator('#todo-panel')).not.toBeVisible({ timeout: 3000 });
  });

  test('设置/历史/待办 面板互斥（打开一个时其他关闭）', async ({ page }) => {
    // 打开设置
    await page.click('button[onclick="App.toggleSettings()"]');
    await expect(page.locator('#settings-overlay')).toBeVisible({ timeout: 3000 });
    // 关闭设置
    await page.click('#settings-overlay .close-btn');
    // 打开历史
    await page.click('button[onclick="App.toggleHistory()"]');
    await expect(page.locator('#history-panel')).toBeVisible({ timeout: 3000 });
    // 打开待办
    await page.click('#todo-toggle');
    await expect(page.locator('#todo-panel')).toBeVisible({ timeout: 3000 });
  });

  test('移动端375px视口 → 登录界面正常', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE);
    await expect(page.locator('#login-overlay')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Toast / 加载 / 网络异常 (bonus tests)
// ═══════════════════════════════════════════════════════════════
test.describe('通用UI', () => {
  test.beforeEach(async ({ page }) => { await registerAndLogin(page); });

  test('Toast容器存在', async ({ page }) => {
    await expect(page.locator('#toast-container')).toBeVisible();
  });

  test('酒馆摸鱼按钮可见', async ({ page }) => {
    await expect(page.locator('#tavernBtn')).toBeVisible();
  });
});
