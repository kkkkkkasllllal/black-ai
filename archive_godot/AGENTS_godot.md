# 《BLACK AI》开发宪法（AGENTS.md）

本文件是《BLACK AI》项目的最高工程规范。所有参与开发的 AI Agent 与开发者在编写任何代码、场景或数据前，必须无条件遵守本宪法。完整游戏策划以 [docs/black_ai.md](docs/black_ai.md) 为唯一设计真源。

---

## 一、核心引擎与代码红线

1. **Godot 4.7 + 静态类型 GDScript**
   - 严格使用 Godot 4.7（GL Compatibility 渲染器）。
   - 所有 `.gd` 脚本必须使用静态类型标注（成员变量、局部变量、函数参数与返回值均显式标注类型）。
   - **严禁使用 Godot 3 旧 API**：禁止 `KinematicBody2D`（用 `CharacterBody2D`）、禁止 `Light2D`（用 `PointLight2D` / `DirectionalLight2D`）、禁止 `yield()`（用 `await`）、禁止无 `@` 前缀的 `export` / `onready`、禁止旧版多参数 `move_and_slide(...)`、禁止 `Image.create()`（用 `Image.create_empty()`）。
   - Godot 4.4+ 自动生成的 `.uid` 伴生文件（如 `*.gd.uid`）必须保留并随脚本一并纳入 Git 版本控制，禁止删除或加入 `.gitignore`。
2. **地图强制使用 `TileMapLayer`**
   - 所有 2D 瓦片地图、地面、墙体与上下文溢出隐藏血字图层，一律使用 Godot 4.3+ 的 **`TileMapLayer`** 节点。
   - **严禁使用旧版 `TileMap` 节点**。
3. **数据与代码彻底解耦**
   - 所有装备、6 档显卡、武器、消耗品、机箱、散热、系统提示词、角色、怪物、结局、全局平衡参数一律存放在 `data/*.json`，脚本中仅通过 `DataRegistry` Autoload 读取，**禁止硬编码数值表**。
   - 所有分支剧情与 NPC 对话一律以纯文本 `.dialogue` 文件存放在 `dialogue/` 目录（预留适配 **Godot Dialogue Manager** 语法），禁止在脚本里堆砌大段分支台词。
4. **临时美术占位优先玩法**
   - 在核心玩法闭环完成前，所有角色、大 PSU 电源、怪物、墙体与道具一律使用纯色色块 / Programmatic Placeholder（优先复用 `scripts/utils/PlaceholderFactory.gd`）。
   - 严禁因等待外部美术或音频资源而阻塞任何里程碑的逻辑可运行性。

---

## 二、工程目录与 Autoload 职责

| 路径 | 职责 |
| :--- | :--- |
| `autoload/` | 全局常驻单例：`DataRegistry`（只读 JSON 数据中心）、`GlobalMemory`（跨存档 Meta 记忆 `user://global_memory.json`）、`GameState`（单局存档状态与核心规则） |
| `data/` | 纯 JSON 静态配置：`config.json`、`items.json`、`characters.json`、`monsters.json`、`endings.json` |
| `dialogue/` | Godot Dialogue Manager 格式的纯文本 `.dialogue` 分支对话剧本 |
| `scenes/` | 按模块组织的 `.tscn` 场景及其绑定脚本（如 `boot/`、`world/`、`battle/`、`ui/`、`prologue/`） |
| `scripts/` | 可复用系统脚本与工具类（如 `scripts/utils/PlaceholderFactory.gd`、战斗引擎、对话播放器） |
| `assets/` | 正式美术、字体、音频资源目录（当前以占位色块为主） |
| `docs/` | 策划文档 `black_ai.md` 与里程碑计划 `milestones.md` |
| `tools/` | 自动化校验与开发辅助脚本（`validate_project.py` 等） |

---

## 三、自动化校验强制流程

- **每次修改或新增任意 `.gd`、`.tscn`、`data/*.json` 或 `project.godot` 后，必须执行**：
  ```bash
  python tools/validate_project.py
  ```
- 校验脚本必须**零报错（Exit Code = 0）**才允许交付，覆盖：
  1. `data/*.json` 语法、必需字段、ID 全局唯一性与跨表引用完整性；
  2. `project.godot` Autoload、主场景与核心输入映射完整性；
  3. 全部 `.gd` / `.tscn` 静态扫描（拦截旧版 `TileMap` 与 Godot 3 废弃 API）；
  4. 若系统 PATH（或环境变量 `GODOT_BIN`）中存在 Godot 4 可执行文件，自动调用 `godot --headless --path . --check-only` 检查全部 `.gd` 脚本语法与静态类型。

---

## 四、里程碑迭代纪律（单步原子交付）

1. **每次只完成 `docs/milestones.md` 中的 1 个里程碑**，严禁跨里程碑私自提前堆砌无关功能或破坏未到期模块的接口。
2. 每个里程碑交付时，必须向用户输出：
   - 本里程碑新增/修改的文件清单与核心设计说明；
   - `python tools/validate_project.py` 的完整校验结果；
   - **可独立执行的试玩验收清单**（精确到按键、交互路径与预期结果）。
3. 交付完成后**立即停止并等待用户试玩验证与 `git commit`**；只有在用户明确确认通过后，才进入下一个里程碑。
