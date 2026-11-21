#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""《BLACK AI》RPG Maker MV 自动化工程校验脚本（兼容 Python 3.6+）

执行内容：
1. RPG Maker MV 工程结构、Game.rpgproject、package.json、核心内核文件与 js/plugins.js 校验
2. data/black_ai/*.json 全部 7 张真源配置语法、字段完整性、ID 唯一性与跨表引用校验
3. 原生 MV data/*.json（System / MapInfos / Map001 / Tilesets / Items / Enemies 等）与占位图片存在性校验
4. dialogue/*.dialogue 分支剧本段落与跳转校验
5. 全部 js/plugins/BlackAI_*.js 的 ES2017 兼容性静态扫描 + node --check 语法检查
6. 自动运行 node tools/test_black_ai_runtime.js 执行 M1–M6 核心逻辑无头回归测试
"""

import io
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent

REQUIRED_MV_DIRS = ["data", "data/black_ai", "dialogue", "docs", "fonts", "img", "js", "js/libs", "js/plugins", "tools"]
REQUIRED_MV_CORE_JS = [
    "js/main.js",
    "js/plugins.js",
    "js/rpg_core.js",
    "js/rpg_managers.js",
    "js/rpg_objects.js",
    "js/rpg_scenes.js",
    "js/rpg_sprites.js",
    "js/rpg_windows.js",
    "js/libs/pixi.js",
]
REQUIRED_BLACKAI_PLUGINS = [
    "BlackAI_Core",
    "BlackAI_BattleEngine",
    "BlackAI_Dialogue",
    "BlackAI_PSU",
    "BlackAI_BattleUI",
    "BlackAI_Explore",
    "BlackAI_AltarWorld",
]
REQUIRED_MV_JSON = [
    "System.json", "Actors.json", "Classes.json", "Items.json", "Weapons.json",
    "Armors.json", "Skills.json", "States.json", "Enemies.json", "Troops.json",
    "Tilesets.json", "MapInfos.json", "Map001.json",
]

ITEM_SECTIONS = ["graphics_cards", "weapons", "consumables", "cases", "coolers", "system_prompts"]
REQUIRED_CORE_HEROINES = {"big_fish", "small_fish", "true_c", "fake_c", "astra", "sol", "gemini_cat"}
REQUIRED_FUNCTION_NPCS = {"glm", "qwen", "kimi", "doubao", "grok"}
EFFECT_TYPES = {
    "crush_light", "psu_key", "interrupt_bonus", "multi_hit", "ai_crash", "restore_context",
    "first_turn_crit", "context_jitter", "throttle", "aoe_lightning", "self_explode_risk",
    "cure_status", "restore_hp", "repair_case", "speed_up_next_turn", "damage_taken_mult",
    "steal_immunity", "status_immunity", "glass_break", "context_aura", "aggro_up",
    "context_decay_mult", "self_leak", "regen_hp", "frostbite", "dialogue_suffix",
    "liar_stutter", "reveal_hidden", "context_drain_per_turn",
}
VALID_MENU_VARIANTS = {"psu_default", "fake_bedroom", "empty_cursor"}
VALID_CHAR_KINDS = {"core_heroine", "eliminee", "function_npc"}
VALID_GIFT_GROUPS = {"deepseek", "general", "none"}

SNAKE_CASE_RE = re.compile(r"^[a-z][a-z0-9_]*$")
HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$")

# 拦截 MV 1.6.x (NW.js 0.29 / Chromium 65) 不支持的 ES2020+ 语法
FORBIDDEN_JS_PATTERNS = [
    (re.compile(r"\?\."), "RPG Maker MV 1.6.x 不支持可选链 ?.（请保持 ES2017 语法）"),
    (re.compile(r"\?\?"), "RPG Maker MV 1.6.x 不支持空值合并 ??（请保持 ES2017 语法）"),
    (re.compile(r"\.replaceAll\s*\("), "RPG Maker MV 1.6.x 不支持 String.prototype.replaceAll（请用正则 replace）"),
]


class Validator:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.errors: List[str] = []
        self.warnings: List[str] = []
        self.info: List[str] = []

    def err(self, message: str) -> None:
        self.errors.append(message)

    def warn(self, message: str) -> None:
        self.warnings.append(message)

    def ok(self, message: str) -> None:
        self.info.append(message)

    # ---------------------------------------------------------------- 1. MV 结构与插件注册

    def check_mv_structure(self) -> None:
        for rel in REQUIRED_MV_DIRS:
            if not (self.root / rel).is_dir():
                self.err("缺少标准目录: {}/".format(rel))

        rpgproj = self.root / "Game.rpgproject"
        if not rpgproj.is_file():
            self.err("缺少 RPG Maker MV 工程入口文件: Game.rpgproject")
        else:
            ver = rpgproj.read_text(encoding="utf-8", errors="replace").strip()
            if not ver.startswith("RPGMV "):
                self.err("Game.rpgproject 格式异常: {!r}".format(ver))

        pkg = self.root / "package.json"
        if not pkg.is_file():
            self.err("缺少 package.json")
        else:
            try:
                pobj = json.loads(pkg.read_text(encoding="utf-8"))
                win = pobj.get("window", {})
                if win.get("width") != 1280 or win.get("height") != 720:
                    self.err("package.json 窗口分辨率应配置为 1280x720")
            except ValueError as exc:
                self.err("package.json JSON 语法错误: {}".format(exc))

        if not (self.root / "index.html").is_file():
            self.err("缺少 index.html")

        for js_rel in REQUIRED_MV_CORE_JS:
            if not (self.root / js_rel).is_file():
                self.err("缺少 RPG Maker MV 核心运行库: {}".format(js_rel))

        plugins_js = self.root / "js" / "plugins.js"
        if plugins_js.is_file():
            ptext = plugins_js.read_text(encoding="utf-8")
            registered: List[str] = re.findall(r'"name"\s*:\s*"([^"]+)"', ptext)
            for req_p in REQUIRED_BLACKAI_PLUGINS:
                if req_p not in registered:
                    self.err("js/plugins.js 未注册必需插件: {}".format(req_p))
                if not (self.root / "js" / "plugins" / (req_p + ".js")).is_file():
                    self.err("缺少插件文件: js/plugins/{}.js".format(req_p))

        self.ok("RPG Maker MV 工程结构与插件注册检查完成（已注册核心插件 {} 个）".format(len(REQUIRED_BLACKAI_PLUGINS)))

    # ---------------------------------------------------------------- 2. data/black_ai/*.json 校验

    def _load_json(self, path: Path) -> Optional[Any]:
        try:
            raw = path.read_text(encoding="utf-8")
            return json.loads(raw)
        except Exception as exc:
            self.err("读取/解析失败 {}: {}".format(path.relative_to(self.root).as_posix(), exc))
            return None

    def check_black_ai_json(self) -> None:
        ba_dir = self.root / "data" / "black_ai"
        if not ba_dir.is_dir():
            return
        parsed: Dict[str, Dict[str, Any]] = {}
        for jf in sorted(ba_dir.glob("*.json")):
            obj = self._load_json(jf)
            if isinstance(obj, dict):
                parsed[jf.name] = obj
            elif obj is not None:
                self.err("data/black_ai/{} 顶层必须为 JSON Object".format(jf.name))

        req_files = ["config.json", "items.json", "characters.json", "monsters.json", "endings.json", "skills.json", "bosses.json"]
        for rf in req_files:
            if rf not in parsed:
                self.err("data/black_ai/ 缺少核心数据文件: {}".format(rf))
        if any(rf not in parsed for rf in req_files):
            return

        region_ids, status_ids = self._validate_config(parsed["config.json"])
        char_ids = self._validate_characters(parsed["characters.json"], region_ids)
        item_ids, _item_cats = self._validate_items(parsed["items.json"], char_ids, status_ids)
        p_skills, e_skills = self._validate_skills(parsed["skills.json"], status_ids, item_ids)
        self._validate_monsters(parsed["monsters.json"], region_ids, item_ids, status_ids, e_skills)
        self._validate_bosses(parsed["bosses.json"], char_ids, item_ids, status_ids)
        self._validate_endings(parsed["endings.json"])

        self.ok("data/black_ai/*.json 校验完成：{} 份，物品 {} / 角色 {} / 怪物 {} / Boss {} / 技能 {} / 结局 {}".format(
            len(parsed), len(item_ids), len(char_ids),
            len(parsed["monsters.json"].get("monsters", [])),
            len(parsed["bosses.json"].get("bosses", [])),
            len(p_skills) + len(e_skills),
            len(parsed["endings.json"].get("endings", [])),
        ))

    def _validate_config(self, cfg: Dict[str, Any]) -> Tuple[Set[str], Set[str]]:
        rids: Set[str] = set()
        sids: Set[str] = set()
        for reg in cfg.get("regions", []):
            if isinstance(reg, dict) and isinstance(reg.get("id"), str):
                rids.add(reg["id"])
        for st in cfg.get("statuses", []):
            if isinstance(st, str) and SNAKE_CASE_RE.match(st):
                sids.add(st)
        if len(rids) < 6:
            self.err("config.json regions 少于 6 个核心区域")
        if not sids:
            self.err("config.json 缺少 statuses")
        return rids, sids

    def _validate_characters(self, data: Dict[str, Any], region_ids: Set[str]) -> Set[str]:
        char_ids: Set[str] = set()
        core: Set[str] = set()
        npcs: Set[str] = set()
        for idx, ch in enumerate(data.get("characters", [])):
            cid = ch.get("id")
            if not isinstance(cid, str) or cid in char_ids:
                self.err("characters.json[{}] id 非法或重复: {!r}".format(idx, cid))
                continue
            char_ids.add(cid)
            if ch.get("kind") == "core_heroine":
                core.add(cid)
            elif ch.get("kind") == "function_npc":
                npcs.add(cid)
            if ch.get("kind") not in VALID_CHAR_KINDS:
                self.err("characters.json ({}) kind 非法".format(cid))
            if ch.get("gift_group") not in VALID_GIFT_GROUPS:
                self.err("characters.json ({}) gift_group 非法".format(cid))
            if ch.get("home_region") not in region_ids:
                self.err("characters.json ({}) home_region 未定义".format(cid))
            if not HEX_COLOR_RE.match(str(ch.get("placeholder_color", ""))):
                self.err("characters.json ({}) placeholder_color 非法".format(cid))
        for miss in sorted(REQUIRED_CORE_HEROINES - core):
            self.err("characters.json 缺少核心 AI 娘: {}".format(miss))
        for miss in sorted(REQUIRED_FUNCTION_NPCS - npcs):
            self.err("characters.json 缺少功能 NPC: {}".format(miss))
        return char_ids

    def _validate_items(self, data: Dict[str, Any], char_ids: Set[str], status_ids: Set[str]) -> Tuple[Set[str], Dict[str, str]]:
        iids: Set[str] = set()
        cats: Dict[str, str] = {}
        for sec in ITEM_SECTIONS:
            entries = data.get(sec)
            if not isinstance(entries, list) or not entries:
                self.err("items.json 缺少分区: {}".format(sec))
                continue
            for item in entries:
                iid = item.get("id")
                if not isinstance(iid, str) or iid in iids:
                    self.err("items.json {} id 非法或重复: {!r}".format(sec, iid))
                    continue
                iids.add(iid)
                cats[iid] = sec
                for eff_field in ("effects", "use_effects"):
                    for eff in item.get(eff_field, []):
                        if isinstance(eff, dict) and eff.get("type") not in EFFECT_TYPES:
                            self.err("items.json ({}) 未知效果 type={!r}".format(iid, eff.get("type")))
                for vendor in item.get("sold_by", []):
                    if vendor not in char_ids:
                        self.err("items.json ({}) sold_by 未知角色: {!r}".format(iid, vendor))
        if len(iids) < 31:
            self.err("items.json 物品数量不足 31（当前 {}）".format(len(iids)))
        return iids, cats

    def _validate_skills(self, data: Dict[str, Any], status_ids: Set[str], item_ids: Set[str]) -> Tuple[Set[str], Set[str]]:
        pids: Set[str] = set()
        eids: Set[str] = set()
        for sk in data.get("player_skills", []):
            sid = sk.get("id")
            if isinstance(sid, str):
                pids.add(sid)
            if sk.get("apply_status") and sk["apply_status"] not in status_ids:
                self.err("skills.json ({}) 未知状态".format(sid))
        for sk in data.get("enemy_skills", []):
            sid = sk.get("id")
            if isinstance(sid, str):
                eids.add(sid)
            if sk.get("steal_item_id") and sk["steal_item_id"] not in item_ids:
                self.err("skills.json ({}) steal_item_id 未知物品".format(sid))
        return pids, eids

    def _validate_monsters(self, data: Dict[str, Any], region_ids: Set[str], item_ids: Set[str], status_ids: Set[str], enemy_skills: Set[str]) -> None:
        for mon in data.get("monsters", []):
            mid = mon.get("id", "?")
            for rid in mon.get("regions", []):
                if rid not in region_ids:
                    self.err("monsters.json ({}) 未知区域 {!r}".format(mid, rid))
            for sk in mon.get("skills", []):
                if sk not in enemy_skills:
                    self.err("monsters.json ({}) 未知技能 {!r}".format(mid, sk))
            for w in mon.get("weaknesses", []):
                if w not in item_ids and w not in status_ids:
                    self.err("monsters.json ({}) 未知弱点 {!r}".format(mid, w))
            for dr in mon.get("drops", []):
                if not isinstance(dr, dict) or dr.get("item") not in item_ids:
                    self.err("monsters.json ({}) drops 未知物品".format(mid))

    def _validate_bosses(self, data: Dict[str, Any], char_ids: Set[str], item_ids: Set[str], status_ids: Set[str]) -> None:
        seen: Set[str] = set()
        for boss in data.get("bosses", []):
            bid = boss.get("id")
            if bid not in char_ids or bid in seen:
                self.err("bosses.json id 非法或重复: {!r}".format(bid))
                continue
            seen.add(bid)
            for k in ("normal_drops", "overflow_drops"):
                for iid in boss.get(k, []):
                    if iid not in item_ids:
                        self.err("bosses.json ({}) {} 引用未知物品: {!r}".format(bid, k, iid))
            for w in boss.get("weaknesses", []):
                if w not in item_ids and w not in status_ids:
                    self.err("bosses.json ({}) weaknesses 引用未知条目: {!r}".format(bid, w))
        for miss in sorted(REQUIRED_CORE_HEROINES - seen):
            self.err("bosses.json 缺少核心 AI 娘 Boss 配置: {}".format(miss))

    def _validate_endings(self, data: Dict[str, Any]) -> None:
        for end in data.get("endings", []):
            if end.get("main_menu_variant") not in VALID_MENU_VARIANTS:
                self.err("endings.json ({}) main_menu_variant 非法".format(end.get("id")))

    # ---------------------------------------------------------------- 3. 原生 MV 数据库与占位图校验

    def check_mv_database_and_assets(self) -> None:
        data_dir = self.root / "data"
        for name in REQUIRED_MV_JSON:
            p = data_dir / name
            if not p.is_file():
                self.err("缺少 MV 原生数据文件: data/{}".format(name))
                continue
            obj = self._load_json(p)
            if name == "Map001.json" and isinstance(obj, dict):
                if obj.get("width") != 32 or obj.get("height") != 20:
                    self.err("data/Map001.json 尺寸应为 32x20")
                if len(obj.get("data", [])) != 32 * 20 * 6:
                    self.err("data/Map001.json data 数组长度与 32x20x6 不符")

        required_imgs = [
            "img/tilesets/BlackAI_Altar_A5.png",
            "img/tilesets/BlackAI_Altar_B.png",
            "img/characters/$BlackAI_Player.png",
            "img/characters/$BlackAI_GiantPSU.png",
            "img/characters/BlackAI_Heroines.png",
            "img/characters/BlackAI_Heroines_Overflow.png",
            "img/characters/BlackAI_Enemies.png",
            "img/titles1/BlackAI_Title_PSU.png",
        ]
        for rel in required_imgs:
            if not (self.root / rel).is_file():
                self.err("缺少必需占位图片: {}".format(rel))

        self.ok("原生 MV 数据库（{} 份）与自定义占位图片（{} 张）检查完成".format(len(REQUIRED_MV_JSON), len(required_imgs)))

    # ---------------------------------------------------------------- 4. dialogue/*.dialogue 校验

    def check_dialogue_files(self) -> None:
        d_dir = self.root / "dialogue"
        files = sorted(d_dir.glob("*.dialogue"))
        req_secs = {"start", "gift_accepted", "gift_rejected", "gift_forced", "gift_full_100", "gift_overflow_200"}
        special = {"END", "OPEN_GIFT"}
        stems: Set[str] = set()
        for df in files:
            stems.add(df.stem)
            sections: Set[str] = set()
            jumps: List[Tuple[int, str]] = []
            for lineno, raw in enumerate(df.read_text(encoding="utf-8").splitlines(), start=1):
                s = raw.strip()
                if not s or s.startswith("#"):
                    continue
                if s.startswith("~"):
                    sec = s[1:].strip()
                    sections.add(sec)
                elif s.startswith("=>"):
                    jumps.append((lineno, s[2:].strip()))
                elif s.startswith("- ") and "=>" in s:
                    jumps.append((lineno, s.rsplit("=>", 1)[1].strip()))
            for lineno, tgt in jumps:
                if tgt not in sections and tgt not in special:
                    self.err("dialogue/{}:{}: 未定义跳转目标 {!r}".format(df.name, lineno, tgt))
            if df.stem in REQUIRED_CORE_HEROINES:
                miss = req_secs - sections
                if miss:
                    self.err("dialogue/{}: 缺少必需段落 {}".format(df.name, ", ".join(sorted(miss))))
        for miss_h in sorted(REQUIRED_CORE_HEROINES - stems):
            self.err("dialogue/ 缺少核心 AI 娘剧本: {}.dialogue".format(miss_h))
        self.ok("对话剧本校验完成：.dialogue 文件 {} 个（7 位核心 AI 娘剧本完整）".format(len(files)))

    # ---------------------------------------------------------------- 5. JS 插件 ES2017 扫描 + node --check + 回归测试

    def check_js_plugins_and_runtime(self) -> None:
        plugin_files = sorted((self.root / "js" / "plugins").glob("BlackAI_*.js"))
        for pf in plugin_files:
            rel = pf.relative_to(self.root).as_posix()
            for lineno, line in enumerate(pf.read_text(encoding="utf-8").splitlines(), start=1):
                stripped = line.strip()
                if stripped.startswith("//") or stripped.startswith("*"):
                    continue
                for pat, msg in FORBIDDEN_JS_PATTERNS:
                    if pat.search(line):
                        self.err("{}:{}: {}".format(rel, lineno, msg))

        node_bin = shutil.which("node")
        if not node_bin:
            self.warn("未检测到 node 可执行文件，已跳过 JS 语法检查与无头回归测试。")
            return

        for pf in plugin_files:
            proc = subprocess.run([node_bin, "--check", str(pf)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            if proc.returncode != 0:
                out = proc.stdout.decode("utf-8", errors="replace").strip()
                self.err("JS 语法错误 ({}):\n{}".format(pf.name, out))

        plugins_reg = self.root / "js" / "plugins.js"
        proc_reg = subprocess.run([node_bin, "--check", str(plugins_reg)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if proc_reg.returncode != 0:
            self.err("js/plugins.js 语法错误:\n{}".format(proc_reg.stdout.decode("utf-8", errors="replace")))

        self.ok("JS 插件 ES2017 规范与 node --check 语法检查完成（{} 个插件）".format(len(plugin_files)))

        test_script = self.root / "tools" / "test_black_ai_runtime.js"
        if test_script.is_file():
            proc_t = subprocess.run([node_bin, str(test_script)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            out_t = proc_t.stdout.decode("utf-8", errors="replace").strip()
            if proc_t.returncode != 0:
                self.err("Node.js 无头回归测试失败:\n{}".format(out_t))
            else:
                self.ok(out_t)


def _ensure_utf8_stdio() -> None:
    if not sys.stdout.isatty() and hasattr(sys.stdout, "buffer"):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    if not sys.stderr.isatty() and hasattr(sys.stderr, "buffer"):
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


def main() -> int:
    _ensure_utf8_stdio()
    print("=== BLACK AI Project Validator (RPG Maker MV 1.6.x) ===")
    print("Workspace: {}".format(PROJECT_ROOT))

    v = Validator(PROJECT_ROOT)
    v.check_mv_structure()
    v.check_black_ai_json()
    v.check_mv_database_and_assets()
    v.check_dialogue_files()
    v.check_js_plugins_and_runtime()

    print("")
    for line in v.info:
        print("[OK]   {}".format(line))
    for line in v.warnings:
        print("[WARN] {}".format(line))
    for line in v.errors:
        print("[FAIL] {}".format(line))

    print("")
    if v.errors:
        print("RESULT: FAILED ({} error(s), {} warning(s))".format(len(v.errors), len(v.warnings)))
        return 1
    print("RESULT: PASSED (0 errors, {} warning(s))".format(len(v.warnings)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
