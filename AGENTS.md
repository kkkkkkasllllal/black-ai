# 《BLACK AI》开发宪法（AGENTS.md · RPG Maker MV 版）

本文件是《BLACK AI》RPG Maker MV 工程的工程规范。策划和里程碑文档单独存放在桌面 [docs](../docs/) 中。

---

## 一、核心引擎与代码红线

1. **RPG Maker MV 1.6.x + ES2017 兼容 JavaScript 插件**
   - 工程根目录为标准 RPG Maker MV 工程（`Game.rpgproject` = `RPGMV 1.6.3`，1280×720 窗口），可直接用 `RPGMV.exe` 打开编辑并按 `Ctrl+R` 试玩。
   - **严禁直接篡改官方内核文件**（`js/rpg_core.js`、`js/rpg_managers.js`、`js/rpg_objects.js`、`js/rpg_scenes.js`、`js/rpg_sprites.js`、`js/rpg_windows.js` 与 `js/libs/*`）。全部自定义逻辑一律以模块化插件写入 `js/plugins/BlackAI_*.js` 并按依赖顺序注册于 `js/plugins.js`。
   - **严格保持 ES2017 语法兼容**（RPG Maker MV 1.6.x 内置 NW.js 0.29 / Chromium 65 / V8 6.5）：**严禁使用**可选链 `?.`、空值合并 `??`、`String.prototype.replaceAll`、私有类字段 `#field` 等 ES2020+ 语法。
2. **数据与代码彻底解耦**
   - 全部核心数值与配置（6 档显卡、5 武器、6 消耗品、6 机箱、5 散热、3 系统提示词、14 角色、6 怪物、7 AI 娘 Boss、技能、11 结局、全局平衡参数）统一存放在 `data/black_ai/*.json`，插件中仅通过 `BlackAI.Data` 读取，**禁止硬编码数值表**。
   - 原生 MV 数据库（`data/System.json`、`Items.json`、`Weapons.json`、`Armors.json`、`Enemies.json`、`Skills.json`、`States.json`、`Tilesets.json`、`Map001.json` 等）可通过 `python tools/build_mv_assets_and_db.py` 与 `data/black_ai/*.json` 保持同步。
   - 所有分支剧情与 NPC 对话一律以纯文本 `.dialogue` 文件存放在 `dialogue/` 目录，由 `BlackAI_Dialogue.js` 直接解析运行，禁止在插件中堆砌大段分支台词。
3. **地图与角色素材**
   - 地图源图放在 `.image/.map/`，角色行走图源图放在 `.image/.characters/`。
   - 新生成的角色以 `.image/.characters/claude.png` 为尺寸与站位参考，透明 PNG 整图 1086×1448，3 列 × 4 行，每帧 362×362。行的方向依次为下、左、右、上，角色脚底对齐参考图。
   - 导入的附件原图保存在 `.image/.characters/originals/`。`python tools/build_native_altar.py --characters-only` 按角色配置生成对齐后的源图、MV 行走图、头像和战斗图，并同步圣坛角色事件。
   - MV 运行时图块导入 `img/tilesets/`，角色行走图导入 `img/characters/`。当前大厅的角色导入图为 240×384，单帧 80×96。

---

## 二、工程目录与插件职责

| 路径 | 职责 |
| :--- | :--- |
| `data/black_ai/` | 《BLACK AI》单一真源 JSON 配置：`config.json`、`items.json`、`characters.json`、`monsters.json`、`skills.json`、`bosses.json`、`endings.json` |
| `data/` | RPG Maker MV 原生数据库与地图 JSON（`System.json`、`Map001.json` 等） |
| `dialogue/` | 纯文本 `.dialogue` 分支对话剧本（7 位核心 AI 娘及后续剧情） |
| `js/plugins/` | 当前启用 `BlackAI_Core.js`（数据/全局记忆/存档/自检）、`BlackAI_Dialogue.js`（对话解析）、`BlackAI_MVScenes.js`（地图事件/对话/PSU）、`BlackAI_MVBattle.js`（原生战斗与队伍数据桥接）。旧原型的纯逻辑仍用于无头回归测试。 |
| `.image/` | 地图与角色源图 |
| `img/` | MV 导入后的瓦片、行走图、战斗背景与立绘 |
| `tools/` | 资产/数据库同步脚本 `build_mv_assets_and_db.py`、无头回归测试 `test_black_ai_runtime.js`、总校验入口 `validate_project.py` |

---

## 三、自动化校验强制流程

- **每次修改或新增任意 `js/plugins/*.js`、`data/**/*.json`、`dialogue/*.dialogue`、`package.json` 或地图文件后，必须执行**：
  ```bash
  python tools/validate_project.py
  ```
- 校验脚本必须**零报错（Exit Code = 0）**才允许交付，覆盖：
  1. RPG Maker MV 工程结构、`Game.rpgproject`、`package.json`、`js/plugins.js` 与官方内核文件完整性；
  2. `data/black_ai/*.json` 与原生 MV `data/*.json` 语法、必需字段、ID 唯一性与跨表引用完整性；
  3. `dialogue/*.dialogue` 段落结构与跳转完整性；
  4. 全部 `js/plugins/BlackAI_*.js` 的 **ES2017 静态兼容扫描**（拦截 `?.` / `??` / `replaceAll`）与 `node --check` 语法检查；
  5. `node tools/test_black_ai_runtime.js` 无头核心逻辑端到端回归测试（覆盖 M1–M6 核心机制）。

---

## 四、里程碑迭代纪律（单步原子交付）

1. **后续开发每次只完成 [里程碑计划](../docs/milestones.md) 中的 1 个里程碑**（M7 起逐个推进），严禁跨里程碑堆砌无关功能。
2. 每个里程碑交付时，必须向用户输出：
   - 新增/修改文件清单与核心设计说明；
   - `python tools/validate_project.py` 的完整校验结果；
   - **可独立在 RPG Maker MV（`Ctrl+R` 试玩）执行的验收清单**。
3. 交付完成后**立即停止并等待用户试玩验证与 `git commit`**；确认通过后再进入下一里程碑。
