# `dialogue/` 对话脚本目录说明

本目录存放《BLACK AI》全部分支对话纯文本脚本，严格与 GDScript 玩法逻辑解耦，语法预留适配 **Godot Dialogue Manager（v2 / v3）** 插件规范：

- 扩展名统一为 `.dialogue`（UTF-8，LF 换行）。
- 段落标题：`~ <section_id>`
- 角色台词：`<角色名>: <台词内容>`
- 分支选项：`- <选项文本> => <target_section>`
- 条件判断：`if GameState.is_context_overflow():` / `if GlobalMemory.sl_count > 0:`
- 状态变更：`do GameState.add_affection("big_fish", 5)`

> M1 阶段仅提供格式占位样本 `sample_psu_altar.dialogue`；M4 将接入正式对话播放器（内置轻量解析器或直接挂载 Godot Dialogue Manager 插件）。
