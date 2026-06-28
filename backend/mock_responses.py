"""
牛马助手 — Mock 响应数据
当 API Key 未配置时返回模拟数据，方便无 Key 用户体验产品功能。
"""
from datetime import datetime as _dt_mock, timedelta as _td_mock


def mock_response(system_prompt: str, user_prompt: str) -> str:
    """根据 Prompt 特征返回对应的模拟数据"""
    if "文本摘要师" in system_prompt:
        length = "medium"
        if "摘要长度" in user_prompt:
            length = user_prompt.split("摘要长度:")[-1].strip().split()[0] if "摘要长度" in user_prompt else "medium"
        results = {
            "short": "项目面临人力紧缺：骨干流失、招聘滞后、客户压力叠加。需尽快制定保底方案，优先保障已承诺的交付节点。",
            "medium": "今天三场会核心就三件事。产品评审定了Q3的五个需求方向。技术方案确定拆单体为微服务，预计两个迭代完成。Bug复盘找到了登录超时的根因——session清理策略有缺陷。剩余都是细节讨论。",
            "bullets": "- 用户模块：开发+测试已完成\n- 支付模块：联调中，接口文档问题待解决\n- 管理后台：下周启动开发\n- 服务器续费：运维提醒到期，需尽快处理",
        }
        return results.get(length, results["medium"])

    if "商务邮件写手" in system_prompt:
        if "回信模式" in system_prompt or "reply" in system_prompt.lower():
            return (
                "张总，您好。\n\n"
                "关于您提到的接口联调进度问题，目前我们团队已经完成了80%的联调工作，"
                "剩余部分预计本周五前收尾。您关心的Q3排期表我也一并整理好了，稍后同步给您。\n\n"
                "另外关于资源配置的方案，我认同您的思路，已安排团队在评估。有任何新的进展我会及时同步。\n\n"
                "随时沟通。\n\n"
                "李明"
            )
        return (
            "张总，您好。\n\n"
            "关于近期项目进展情况，现向您做简要汇报。目前各模块按计划推进中，"
            "团队正积极协调资源以确保关键节点按时交付。\n\n"
            "更新排期表已附上。\n\n"
            "有任何问题随时找我。\n\n"
            "李明"
        )

    if "会议记录员" in system_prompt:
        return (
            "## 会议议题\n项目进度评审与下周计划\n\n"
            "## 讨论内容\n当前项目进度符合预期，第一阶段开发已完成。测试团队反馈了需要修复的几个问题。讨论了资源调配方案。\n\n"
            "## 决议事项\n- 本周五前完成所有Bug修复\n- 下周一启动第二阶段开发\n\n"
            "## 待办事项\n- [ ] 修复已反馈的问题 @开发组\n- [ ] 准备第二阶段测试用例 @测试组\n- [ ] 更新项目计划表 @PM"
        )

    if "文字编辑" in system_prompt:
        return (
            "当前用户反馈量偏低，产品方向判断缺少数据支撑。"
            "建议近期通过问卷或用户访谈补充需求洞察，用数据替代猜测。"
        )

    if "职场汇报教练" in system_prompt:
        return (
            "当前项目处于高频迭代阶段，需求调整在快速验证中收敛。"
            "为保障核心交付，已将精力集中在高优先级模块，"
            "同时建议后续缩减非关键同步会议，提升有效产出时间。"
        )

    if "需求分析师" in system_prompt:
        return (
            "## 需求文档\n\n"
            "### 背景与目标\n当前业务流程中存在效率瓶颈，需通过信息化手段优化。\n\n"
            "### 功能需求\n"
            "1. 用户管理模块：支持注册、登录、权限分配\n  验收：注册到登录成功不超过30秒\n"
            "2. 数据看板：实时展示关键业务指标\n  验收：数据延迟不超过5秒\n"
            "3. 消息通知：支持邮件和站内信两种方式\n  验收：消息发送到达率 ≥ 99%\n\n"
            "### 非功能需求\n- 系统可用性 ≥ 99.9%\n- 页面加载时间 < 2秒\n- 支持1000并发用户\n\n"
            "### 验收标准\n- 用户可在3步内完成核心操作\n- 所有数据变更可追溯\n- 移动端适配良好"
        )

    if "产品经理" in system_prompt:
        return (
            "## 智能工作台 · PRD（lean）\n\n"
            "**一句话定位**: 一站式团队协作效率工具\n\n"
            "**核心用户**:\n- 团队管理者：关注进度、资源分配\n- 一线成员：关注任务清晰度、沟通效率\n\n"
            "**用户旅程**:\n1. 打开工作台，查看今日任务和日历\n2. 创建/分配任务，设置截止日期\n3. 在团队日历中查看共享日程\n4. 协作编辑文档，实时同步\n\n"
            "**功能列表**:\n- P0 任务管理（创建/分配/追踪）\n- P0 团队日历（共享日程）\n- P1 文档协作（实时编辑）\n- P2 数据分析看板\n\n"
            "**成功指标**:\n- 团队日活跃率 ≥ 60%\n- 任务完成周期 ≤ 3天\n- 用户7日留存 ≥ 40%"
        )

    if "待办解析器" in system_prompt:
        tomorrow = (_dt_mock.now() + _td_mock(days=1)).strftime("%Y-%m-%dT09:00")
        return f'{{"task":"完成登录模块测试并提交报告","deadline":"{tomorrow}","assignee":"张三"}}'

    if "待办提取器" in system_prompt or "待办事项" in system_prompt:
        tomorrow = (_dt_mock.now() + _td_mock(days=1)).strftime("%Y-%m-%dT09:00")
        nxt_mon = (_dt_mock.now() + _td_mock(days=7)).strftime("%Y-%m-%dT18:00")
        return f'[{{"task":"完成登录模块测试并提交报告","deadline":"{tomorrow}","assignee":"张三"}},{{"task":"准备下周项目汇报材料","deadline":"{nxt_mon}","assignee":""}},{{"task":"跟进客户反馈并整理要点","deadline":"待定","assignee":"李四"}}]'

    if "前端开发专家" in system_prompt:
        return (
            "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"UTF-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1.0\">"
            "<title>智能工作台 Demo</title>\n"
            "<style>\n"
            "*{margin:0;padding:0;box-sizing:border-box}\n"
            "body{font-family:-apple-system,sans-serif;background:#f0f2f5;color:#1a1a2e;padding:20px}\n"
            ".header{background:linear-gradient(135deg,#1B3A4B,#2A5A6F);color:#fff;padding:20px 24px;border-radius:12px;margin-bottom:20px}\n"
            ".header h1{font-size:22px}\n"
            ".card{background:#fff;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.06)}\n"
            ".card h3{margin-bottom:8px;font-size:16px}\n"
            ".task{display:flex;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0;gap:8px}\n"
            ".btn{background:#3B82F6;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:14px}\n"
            ".btn:hover{background:#2563EB}\n"
            ".grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}\n"
            "@media(max-width:768px){.grid{grid-template-columns:1fr}}\n"
            "</style>\n</head>\n<body>\n"
            "<div class=\"header\"><h1>🚀 智能工作台</h1><p style=\"opacity:0.85;margin-top:4px;font-size:14px\">一站式团队协作效率工具</p></div>\n"
            "<div class=\"grid\">\n"
            "<div class=\"card\"><h3>📋 今日任务</h3>"
            "<div class=\"task\"><span>✅</span> 完成产品原型设计</div>"
            "<div class=\"task\"><span>🔄</span> 代码评审 - PR #234</div>"
            "<div class=\"task\"><span>📝</span> 撰写周报</div></div>\n"
            "<div class=\"card\"><h3>📅 团队日历</h3>"
            "<div class=\"task\">14:00 · 产品评审会议</div>"
            "<div class=\"task\">16:00 · 技术方案讨论</div></div>\n"
            "</div>\n"
            "<button class=\"btn\" style=\"margin-top:12px\">+ 新建任务</button>\n"
            "</body>\n</html>"
        )

    if "PPT策划师" in system_prompt:
        return (
            "## 第1页：Q3产品部门总结\n- 三个月，三个功能，20%增长\n- 汇报人：李明 · 2026年Q3\n\n"
            "## 第2页：核心数据\n- 新增用户12,000（同比+20%，目标10,000）\n- 三个新功能全部按时上线\n- NPS从3.8升至4.2\n\n"
            "## 第3页：功能一——智能推荐\n- 6月上线，首月点击率18%（目标15%）\n- 带动客单价提升8%\n- 上线后零故障运行\n\n"
            "## 第4页：Q4规划\n- 移动端适配（11月上线）\n- 开放API（12月Beta，已有5家意向客户）\n- 目标：用户再增长25%\n\n"
            "## 第5页：需要的支持\n- iOS开发：1名（移动端适配）\n- 市场预算：30万（API生态推广）\n- 服务器扩容：预计12月需要"
        )

    if "语音识别校对员" in system_prompt:
        return "功能开发已完成，当前有少量缺陷待修复，预计下周上线。"

    # 周报生成 Mock
    if "研究生科研周报撰写助手" in system_prompt:
        return (
            "导师您好，以下为本研究周的进展汇报。\n\n"
            "## 一、本周主要工作\n"
            "- **文献阅读**：精读了CVPR 2024的《EfficientViT》，该文提出的多尺度特征融合方法对课题中特征提取环节有直接参考价值\n"
            "- **实验推进**：修复了数据加载bug，在CIFAR-100上完成baseline运行；完成学习率衰减策略对比实验\n"
            "- **论文写作**：完成方法论章节初稿，模型架构图已出第一版\n\n"
            "## 二、问题与思考\n"
            "- 当前瓶颈：模型在大规模稀疏特征下收敛速度偏低，已查阅LayerNorm相关文献\n\n"
            "## 三、下周计划\n"
            "- 完成消融实验验证特征融合模块有效性\n"
            "- 撰写实验分析章节\n"
            "- 尝试引入LayerNorm优化收敛\n\n"
            "## 四、需导师确认事项\n"
            "- 归一化层引入方案恳请老师指导\n"
            "- 论文逻辑框架图请老师审阅"
        )

    if "高级项目经理" in system_prompt:
        return (
            "各位领导、同事，大家好！\n"
            "## 整体进展\n"
            "项目组本周继续推进V2.1版本上线及优化工作。系统开发完成订单模块编码及测试，测试上线完成华东区域灰度发布。\n"
            "## 推广情况\n"
            "目前产品已在12家区域推广上线（含8家成员公司），注册用户3,200名，覆盖约15万终端用户。\n\n"
            "## 运维情况\n"
            "本周共收到ITSM工单8项，办结8项，平均解决时间3.2小时。\n"
            "## 一、本周重点工作完成情况\n"
            "### 系统设计与开发测试\n"
            "（1）订单模块编码及单元测试（目标100%，完成100%，WBS第3.2.1行）；\n"
            "（2）用户中心接口联调（目标100%，完成80%，WBS第3.2.2行）。\n"
            "### 系统运维与推广支持\n"
            "（1）持续跟进ITSM运维情况，督促工单及时处理；\n"
            "（2）跟踪华东区域推广应用情况，开展技术支持。\n"
            "## 二、下周工作计划\n"
            "（1）完成用户中心接口联调（目标100%，WBS第3.2.2行）；\n"
            "（2）启动报表模块开发（目标30%，WBS第3.3.1行）。\n"
            "## 三、项目资源投入情况\n"
            "- 开发团队：8人\n- 测试团队：3人\n"
            "| 项目名称 | 总预算（万元） | 形象进度 | 已支付 | 使用率 |\n"
            "|----------|-------------|--------|------|------|\n"
            "| V2.1版本 | 500 | 65% | 280 | 56% |\n"
            "## 四、风险/问题/需协调事项\n"
            "风险/延迟事项：暂无\n需协调事项：暂无\n"
            "## 五、里程碑进展\n"
            "| 时间 | 工作内容 | 状态 |\n|------|---------|------|\n"
            "| 2026.06 | V2.1需求评审 | ✅ 已完成 |\n| 2026.07 | V2.1开发 | 🔄 进行中 |"
        )

    if "技术专家" in system_prompt:
        return (
            "## 一、调研方向\n"
            "面向实时推荐系统的流式计算引擎选型\n"
            "周期：2026.06.16 – 2026.06.22\n"
            "## 二、方案对比\n"
            "**方案A — Apache Flink**\n"
            "- 优势：原生支持事件时间语义和精确一次语义；背压机制成熟；社区活跃\n"
            "- 劣势：部署运维复杂度较高；内存占用偏大\n"
            "**方案B — Kafka Streams**\n"
            "- 优势：轻量级部署；与现有Kafka基础设施无缝集成\n"
            "- 劣势：不支持精确一次语义；大规模窗口聚合性能瓶颈明显\n"
            "## 三、概念验证\n"
            "- 测试环境：3节点集群（8C16G×3），导入500万条模拟交易数据\n"
            "- 关键指标：Flink吞吐量12.3万条/秒，P99延迟48ms；Kafka Streams 8.1万条/秒，P99延迟142ms\n"
            "- Flink吞吐量领先约52%，高并发下未出现数据积压\n"
            "## 四、初步结论与建议\n"
            "建议采用Apache Flink作为流式计算引擎。下周输出详细资源预估方案并组织内部技术分享。"
        )

    if "运维工程师" in system_prompt:
        return (
            "## 一、系统运行概况\n"
            "- 本周可用性：99.97%，无P0级别故障发生\n"
            "- 核心接口平均响应时间：124ms，较上周收窄约8.1%\n"
            "- 工单处理：接收34项，闭环31项，剩余3项已升级研发队列\n"
            "## 二、重点故障复盘\n"
            "**故障名称**：订单服务间歇性超时\n"
            "- 根因：数据库连接池上限偏低（max_connections=50），流量高峰时连接耗尽\n"
            "- 影响范围：订单创建接口18:23-18:41期间间歇超时，影响约1,200名用户\n"
            "- 应急措施：临时调高连接池上限至150，重启服务后恢复\n"
            "- 长期改进：将连接池配置纳入容量规划checklist；增加使用率监控告警（≥70%预警）\n"
            "## 三、例行巡检与优化\n"
            "- 完成日志服务器磁盘扩容及冗余日志清理，释放约42%存储空间\n"
            "- SSL证书自动续期脚本已上线\n"
            "- 数据库慢查询优化：orders表P99从2.3s降至0.4s"
        )

    # 自由对话 Mock：根据用户输入返回不同模拟回复
    user_lower = user_prompt.lower()
    if "周报" in user_prompt or "汇报" in user_prompt:
        return "好的，以下是一份本周工作周报模板：\n\n## 本周工作\n- 完成了 XX 功能开发\n- 修复了 N 个线上问题\n- 参与了 YY 项目评审\n\n## 下周计划\n- 启动 ZZ 模块设计\n- 跟进客户反馈\n\n你可以补充具体的工作内容，我会帮你进一步完善。"
    if "翻译" in user_prompt and ("英文" in user_prompt or "英语" in user_prompt or "english" in user_lower):
        return "好的，请把需要翻译的内容粘贴给我。\n\n例如：\n> 请把以下内容翻译成英文：今天天气真好\n\nEnglish: The weather is really nice today."
    if "润色" in user_prompt or "优化" in user_prompt or "改写" in user_prompt:
        return "好的，请把需要润色的文字粘贴给我。我会帮你：\n- 优化表达，让语句更流畅\n- 调整语气（正式/轻松）\n- 修正语法和拼写错误\n\n请把原始文本发给我。"
    if "代码" in user_prompt or "编程" in user_prompt or "bug" in user_lower or "debug" in user_lower:
        return "我是编程助手，可以帮你：\n- 编写代码片段\n- 调试 Bug\n- 解释代码逻辑\n- 优化算法\n\n请描述你的需求或粘贴代码。"
    if "你好" in user_prompt or "hello" in user_lower or "hi" in user_lower:
        return "你好！我是牛马助手的 AI 对话功能。我可以帮你写作、编程、翻译、分析文档等等。今天想聊点什么？"
    if len(user_prompt) < 10:
        return "你好！我是你的 AI 助手。你可以让我帮你：\n- 📝 写周报/邮件/文档\n- 🔍 分析/总结文本\n- 🌐 翻译内容\n- 💻 编写/调试代码\n- 💡 头脑风暴\n\n直接告诉我你的需求吧！"

    return "收到你的消息。在接入真实 API Key 后，我会根据你的问题给出有针对性的回答。你可以尝试问我：\n- 「帮我写一份周报」\n- 「把这段话翻译成英文」\n- 「解释一下 Python 的装饰器」\n- 「帮我润色这封邮件」"
