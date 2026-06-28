# 牛马助手（GrindPal）

> 文山会海终结者 —— 为被报告、周报、会议、需求文档包围的"牛马"打工人量身打造的 AI 文字处理工具箱。

![版本](https://img.shields.io/badge/版本-1.0.0-blue)
![语言](https://img.shields.io/badge/前端-Vanilla%20JS-yellow)
![后端](https://img.shields.io/badge/后端-Python%20FastAPI-green)

---

## 功能总览

| # | 花名 | 功能 | 描述 |
|---|------|------|--------|
| 1 |  **太长不看** | 文本摘要 | 粘贴长文，AI 一键提取核心要点 |
| 2 |  **已读乱回** | 邮件撰写 | 根据要点生成正式/友好/专业邮件，支持回复模式 |
| 3 |  **人云议云** | 会议纪要 | 录音 → 语音转文字 → AI 自动生成会议纪要 |
| 4 |  **字斟句酌** | 报告润色 | 原文与润色结果左右对比，口语→商务/学术 |
| 5 |  **向上管理** | 汇报翻译 | 把吐槽翻译成老板爱看的语言（目标导向/风险预警/创新驱动） |
| 6 |  **需求炼金** | 需求文档 | 零散笔记 → 结构化需求（规格列表 或 用户故事） |
| 7 |  **产品画饼** | PRD 生成 | 产品构思 → 完整 PRD 或一页纸，甚至生成 HTML 演示原型 |
| 8 |  **PPT雕花** | PPT 大纲 | 主题+要点 → PPT 大纲 + 演讲备注，一键导出 .pptx |
| 9 |  **周报生成** | 周报助手 | 4 种模板 × 2 种风格 × 2 种语言，快速生成周报 |
| 10 |  **自由对话** | AI 聊天 | 多轮对话，支持文件上传、知识库检索、3 种人设切换 |

**其他能力：**
-  **待办提取** — 从任意文本中 AI 提取待办事项并管理
-  **知识库** — 上传文档建立私有知识库，对话中自动检索增强（RAG）
-  **模板管理** — 保存/复用自定义提示词模板
-  **历史记录** — 所有生成结果自动保存，支持搜索和导出
-  **多语言** — 中文/英文界面，自动检测浏览器语言
-  **文件导入** — 上传 .txt/.docx/.pdf 提取文字后处理
-  **导出** — 结果导出为 .docx / .pptx / Markdown / JSON

---

##  截图

启动后浏览器打开 `http://localhost:8000`，界面如下：


<img width="1920" height="922" alt="preview" src="https://github.com/user-attachments/assets/5ebdb61b-4d0b-44cb-8cc6-f23b5535f3c7" />


---

##  技术栈

| 层级 | 技术 |
|------|------|
| **前端** | 纯静态 HTML + CSS + JavaScript（SPA 架构，无框架依赖） |
| **UI 组件** | Material Icons、自定义 CSS 变量 |
| **国际化** |  i18n 引擎，支持 zh-CN / en-US |
| **后端** | Python 3.10+、FastAPI、uvicorn |
| **AI 接口** | OpenAI 兼容 API（默认 DeepSeek，可切换任意兼容服务） |
| **语音识别** | Whisper（OpenAI / pywhispercpp） |
| **数据库** | SQLite（历史记录、用户、知识库、聊天、待办） |
| **认证** | JWT + bcrypt，支持安全问答找回密码 |
| **文档导出** | python-docx（.docx）、python-pptx（.pptx） |

---

##  快速启动（开发模式）

### 前置要求

- Python 3.10+
- DeepSeek 或其他 OpenAI 兼容 API Key

###  安装后端依赖

```bash
cd backend
pip install -r requirements.txt
```

如需语音转文字功能，额外安装：

```bash
pip install pywhispercpp webrtcvad
```

###  配置

**方式 A：配置文件（推荐生产环境）**

```bash
# backend/ 下创建 .env 文件
echo DEEPSEEK_API_KEY=sk-your-key-here >> backend/.env
echo JWT_SECRET=your-random-secret >> backend/.env
```

**方式 B：前端设置页（推荐开发体验）**

启动后登录 → 右上角设置 → 填入 API Key，密钥仅加密存储在浏览器中，不落服务端。

###  启动服务

```bash
cd backend
python main.py
```

浏览器打开 **http://localhost:8000** 即可使用。

>  前端为纯静态文件，由 FastAPI 自动挂载。也可单独部署：
> ```bash
> cd frontend && python -m http.server 3000
> ```

###  注册账号

首次访问 → 点击登录 → 注册账号 → 进入主界面。

---

##  打包为 Windows 可执行文件（.exe）

将整个项目打包成一个独立的 `.exe` 文件，无需安装 Python 即可运行。

### 方法一：使用 PyInstaller

#### 1. 安装 PyInstaller

```bash
pip install pyinstaller
```

#### 2. 创建打包脚本 `build.py`

在项目根目录创建 `build.py`：

```python
"""
牛马助手 PyInstaller 打包脚本
用法: python build.py
"""
import os
import sys
import subprocess
import shutil

# === 配置 ===
APP_NAME = "牛马助手"
ENTRY_POINT = os.path.join("backend", "main.py")
FRONTEND_DIR = "frontend"
DIST_DIR = "dist"
ICON_FILE = "frontend/favicon.ico"  # 可选：需转换为 .ico 格式

# === 清理上次构建 ===
for d in ["build", DIST_DIR]:
    if os.path.isdir(d):
        shutil.rmtree(d)

# === 构建 .exe ===
cmd = [
    "pyinstaller",
    "--name", APP_NAME,
    "--onefile",              # 单文件模式（也可用 --onedir 加快启动）
    "--add-data", f"{FRONTEND_DIR}{os.pathsep}frontend",
    "--add-data", f"backend/version.py{os.pathsep}backend",
    "--hidden-import", "uvicorn.logging",
    "--hidden-import", "uvicorn.loops.asyncio",
    "--hidden-import", "uvicorn.loops.auto",
    "--hidden-import", "uvicorn.protocols.http.auto",
    "--hidden-import", "uvicorn.protocols.websockets.auto",
    "--hidden-import", "bcrypt",
    "--hidden-import", "bcrypt._bcrypt",
    "--collect-all", "bcrypt",
    "--noconfirm",
]
if os.path.isfile(ICON_FILE):
    cmd += ["--icon", ICON_FILE]

cmd.append(ENTRY_POINT)

print(" 开始打包...")
subprocess.run(cmd, check=True)
print(f"\n 打包完成！可执行文件位于: {DIST_DIR}/{APP_NAME}.exe")
```

#### 3. 运行打包

```bash
python build.py
```

#### 4. 使用 `.exe`

- 双击 `dist/牛马助手.exe` 启动服务
- 自动在 **http://localhost:8000** 打开浏览器
- 首次启动会自动创建 `uploads/` 目录和 `smarttext.db` 数据库

>  **注意**：单文件模式 (`--onefile`) 首次启动较慢（需解压），推荐改为 `--onedir` 模式加快启动速度。

### 方法二：一键安装脚本（Windows）

已有 `一键安装.bat`，适用于已安装 Python 的环境：

```bash
双击 一键安装.bat
```

脚本会自动检查 Python、安装依赖、初始化配置。

---

##  配置说明

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DEEPSEEK_BASE_URL` | API 地址 | `https://api.deepseek.com` |
| `DEEPSEEK_API_KEY` | API Key | （空，可前端设置） |
| `DEEPSEEK_MODEL` | 模型名称 | `deepseek-v4-flash` |
| `JWT_SECRET` | JWT 签名密钥 | （自动生成） |
| `HOST` | 监听地址 | `0.0.0.0` |
| `PORT` | 端口 | `8000` |
| `LOG_LEVEL` | 日志级别 | `INFO` |
| `CORS_ORIGINS` | CORS 允许源 | `http://localhost:8000` |
| `LLM_TIMEOUT` | API 超时（秒） | `60` |
| `LLM_STREAM_TIMEOUT` | 流式超时（秒） | `120` |
| `WHISPER_N_GPU_LAYERS` | Whisper GPU 层数 | （CPU 默认） |

### 前端设置

登录后右上角 ⚙️ → 可配置：

- API Key（浏览器加密存储）
- 默认模型
- 对话人设（标准/活泼/专家）
- 界面语言（中文/English）

---

##  项目结构

```
牛马助手v1.0/
├── backend/
│   ├── main.py              # FastAPI 应用入口 + 所有路由
│   ├── auth.py               # JWT 鉴权 + bcrypt 密码
│   ├── database.py           # SQLite 数据库操作
│   ├── llm.py                # LLM 调用 + 提示词构建
│   ├── backend_i18n.py       # 后端国际化
│   ├── logger.py             # 日志模块
│   ├── mock_responses.py     # 无 API Key 时的模拟响应
│   ├── version.py            # 版本号
│   ├── requirements.txt      # Python 依赖
│   ├── routers/
│   │   └── auth.py           # 认证路由（注册/登录/找回密码）
│   └── .env                  # 环境配置（不提交 Git）
├── frontend/
│   ├── index.html            # 主页面（SPA）
│   ├── js/app.js             # 前端逻辑（~290KB）
│   ├── css/                  # 样式文件
│   ├── i18n/                 # 国际化翻译文件
│   └── favicon.ico           # 网站图标
├── tests/                    # 测试用例
├── uploads/                  # 上传文件目录（运行时创建）
├── logs/                     # 日志目录（运行时创建）
├── start.sh                  # Linux/Mac 启动脚本
├── stop.sh                   # 停止脚本
├── restart.sh                # 重启脚本
├── 一键安装.bat              # Windows 一键安装
└── README.md                 # 本文件
```

---

##  常见场景

### 场景一：我需要快速总结一篇 5000 字文章

1. 点击「**太长不看**」
2. 粘贴文章内容
3. 选择摘要长度（简短/中等/要点列表）
4. 点击生成

### 场景二：写周报不知道怎么写

1. 点击「**周报生成**」
2. 选择周报类型（调研/项目/技术预研/运维）
3. 填入这周干了什么（几个关键词即可）
4. AI 自动生成完整周报，不满意可以继续生稿

### 场景三：会议录音整理

1. 点击「**人云议云**」
2. 上传录音文件（或直接录音）
3. AI 自动转文字 → 生成会议纪要（议题/结论/待办）
4. 导出为 .docx

### 场景四：让 AI 帮你吵架（不是）

1. 点击「**自由对话**」
2. 人设切换为「**专家**」
3. 输入对方的强词夺理，开始对话……

---

##  安全

- 密码使用 **bcrypt** 加盐哈希存储
- JWT Token 24 小时过期
- 登录失败 5 次锁定 15 分钟
- API Key 加密存储在服务端或浏览器 localStorage
- 所有 SQL 使用参数化查询，防止注入
- 文件上传路径经过穿越防护校验

---

##  国际化

- 自动检测浏览器语言，默认中文
- 右上角可手动切换中/英文
- 后端同样支持中英文错误消息（基于 `Accept-Language` 头）

---

##  许可证

MIT License — 自由使用、修改、分发。

---

##  致谢

- [FastAPI](https://fastapi.tiangolo.com/)
- [DeepSeek](https://deepseek.com/)
- 所有被文山会海折磨过的打工人 
