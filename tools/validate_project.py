#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""《BLACK AI》自动化工程校验脚本（兼容 Python 3.6+）

执行内容：
1. 工程目录与 project.godot 结构、Autoload、主场景、输入映射校验
2. data/*.json 语法、字段完整性、ID 全局唯一性与跨表引用校验
3. .gd / .tscn 静态扫描（拦截 Godot 3 旧 API、旧版 TileMap 与断链资源）
4. 若系统 PATH（或 GODOT_BIN / --godot）存在 Godot 4，先用 `--check-only` 校验检查入口，
   再在无头工程环境中加载全部 .gd 脚本，检查依赖 Autoload 的语法和静态类型
"""

import argparse
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent

GODOT_SCRIPT_CHECKER = """extends SceneTree

func _initialize() -> void:
	_check_scripts.call_deferred()


func _check_scripts() -> void:
	var failed: bool = false
	for path: String in OS.get_cmdline_user_args():
		var script: Script = load(path) as Script
		if script == null or not script.can_instantiate():
			push_error("无法编译脚本: " + path)
			failed = true
		else:
			print("  [PASS] ", path)
	quit(1 if failed else 0)
"""

REQUIRED_DIRS = [
    "autoload",
    "scenes",
    "scripts",
    "data",
    "dialogue",
    "assets",
    "docs",
    "tools",
]

REQUIRED_INPUT_ACTIONS = [
    "move_up",
    "move_down",
    "move_left",
    "move_right",
    "interact",
    "toggle_lantern",
    "attack",
    "menu",
]

REQUIRED_AUTOLOADS = [
    "DataRegistry",
    "GlobalMemory",
    "GameState",
]

ITEM_SECTIONS = [
    "graphics_cards",
    "weapons",
    "consumables",
    "cases",
    "coolers",
    "system_prompts",
]

REQUIRED_CORE_HEROINES = {
    "big_fish",
    "small_fish",
    "true_c",
    "fake_c",
    "astra",
    "sol",
    "gemini_cat",
}

REQUIRED_FUNCTION_NPCS = {
    "glm",
    "qwen",
    "kimi",
    "doubao",
    "grok",
}

EFFECT_TYPES = {
    "crush_light",
    "psu_key",
    "interrupt_bonus",
    "multi_hit",
    "ai_crash",
    "restore_context",
    "first_turn_crit",
    "context_jitter",
    "throttle",
    "aoe_lightning",
    "self_explode_risk",
    "cure_status",
    "restore_hp",
    "repair_case",
    "speed_up_next_turn",
    "damage_taken_mult",
    "steal_immunity",
    "status_immunity",
    "glass_break",
    "context_aura",
    "aggro_up",
    "context_decay_mult",
    "self_leak",
    "regen_hp",
    "frostbite",
    "dialogue_suffix",
    "liar_stutter",
    "reveal_hidden",
    "context_drain_per_turn",
}

VALID_MENU_VARIANTS = {"psu_default", "fake_bedroom", "empty_cursor"}
VALID_CHAR_KINDS = {"core_heroine", "eliminee", "function_npc"}
VALID_GIFT_GROUPS = {"deepseek", "general", "none"}

SNAKE_CASE_RE = re.compile(r"^[a-z][a-z0-9_]*$")
HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$")

# 针对 .gd 的 Godot 3 旧 API 静态规则（已排除注释行）
FORBIDDEN_GD_PATTERNS = [
    (re.compile(r"\bKinematicBody2D\b"), "禁止 Godot 3 的 KinematicBody2D，请使用 CharacterBody2D"),
    (re.compile(r"\bKinematicBody\b"), "禁止 Godot 3 的 KinematicBody"),
    (re.compile(r"(?<![A-Za-z0-9_])Light2D\b"), "禁止 Godot 3 的 Light2D，请使用 PointLight2D / DirectionalLight2D"),
    (re.compile(r"\bTileMap\b(?!Layer)"), "禁止旧版 TileMap，请严格使用 TileMapLayer"),
    (re.compile(r"^\s*export\s+var\b"), "禁止 Godot 3 的 export var，请使用 @export var"),
    (re.compile(r"^\s*onready\s+var\b"), "禁止 Godot 3 的 onready var，请使用 @onready var"),
    (re.compile(r"\byield\s*\("), "禁止 Godot 3 的 yield()，请使用 await"),
    (re.compile(r"\bmove_and_slide\s*\([^)\s]"), "Godot 4 中 move_and_slide() 无参数，请先设置 velocity"),
    (re.compile(r"\bImage\.create\s*\("), "Godot 4.3+ 请使用 Image.create_empty() 替代 Image.create()"),
]

# 针对 .tscn 的旧节点类型扫描
FORBIDDEN_TSCN_PATTERNS = [
    (re.compile(r'type="TileMap"'), '场景中使用了旧版 type="TileMap"，必须改用 type="TileMapLayer"'),
    (re.compile(r'type="KinematicBody2D"'), '场景中使用了 Godot 3 的 type="KinematicBody2D"'),
    (re.compile(r'type="Light2D"'), '场景中使用了 Godot 3 的 type="Light2D"'),
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

    # ---------------------------------------------------------------- 1. 目录与 project.godot

    def check_structure_and_project(self) -> None:
        for dirname in REQUIRED_DIRS:
            path = self.root / dirname
            if not path.is_dir():
                self.err("缺少标准目录: {}/".format(dirname))

        project_file = self.root / "project.godot"
        if not project_file.is_file():
            self.err("缺少根目录工程文件: project.godot")
            return

        text = project_file.read_text(encoding="utf-8")
        if "config_version=5" not in text:
            self.err("project.godot 缺少 config_version=5（Godot 4 格式）")

        if "window/size/viewport_width=1280" not in text or "window/size/viewport_height=720" not in text:
            self.err("project.godot 窗口分辨率未配置为 1280x720")

        known_uids = self._collect_known_uids()

        # 检查主场景（兼容 Godot 4.4+ 将 run/main_scene 重写为 uid://...）
        main_match = re.search(r'run/main_scene="((?:res|uid)://[^"]+)"', text)
        if not main_match:
            self.err("project.godot 未配置 run/main_scene")
        else:
            main_ref = main_match.group(1)
            if main_ref.startswith("res://"):
                main_rel = main_ref[len("res://"):]
                if not (self.root / main_rel).is_file():
                    self.err("project.godot run/main_scene 指向的文件不存在: {}".format(main_ref))
            elif main_ref.startswith("uid://"):
                if main_ref not in known_uids:
                    self.err("project.godot run/main_scene 引用的 UID 未在工程中找到: {}".format(main_ref))

        # 检查 Autoload（兼容 res:// 与 uid://）
        autoload_section = self._extract_ini_section(text, "autoload")
        found_autoloads: Dict[str, str] = {}
        for line in autoload_section:
            m = re.match(r'^([A-Za-z0-9_]+)="\*?((?:res|uid)://[^"]+)"$', line.strip())
            if m:
                name, ref = m.group(1), m.group(2)
                found_autoloads[name] = ref
                if ref.startswith("res://"):
                    rel = ref[len("res://"):]
                    if not (self.root / rel).is_file():
                        self.err("Autoload {} 指向的脚本不存在: {}".format(name, ref))
                elif ref.startswith("uid://"):
                    if ref not in known_uids:
                        self.err("Autoload {} 引用的 UID 未在工程中找到: {}".format(name, ref))

        for req_name in REQUIRED_AUTOLOADS:
            if req_name not in found_autoloads:
                self.err("project.godot [autoload] 缺少必需单例: {}".format(req_name))

        # 检查输入映射
        input_section_text = "\n".join(self._extract_ini_section(text, "input"))
        for action in REQUIRED_INPUT_ACTIONS:
            if not re.search(r"(?m)^{}\s*=\s*\{{".format(re.escape(action)), input_section_text):
                self.err("project.godot [input] 缺少输入映射: {}".format(action))

        self.ok("工程目录与 project.godot 检查完成（Autoload {} 个 / 输入映射 {} 个）".format(
            len(found_autoloads), len(REQUIRED_INPUT_ACTIONS)
        ))

    def _collect_known_uids(self) -> Set[str]:
        uids: Set[str] = set()
        for uid_file in self.root.rglob("*.uid"):
            if ".godot" in uid_file.parts:
                continue
            try:
                content = uid_file.read_text(encoding="utf-8").strip()
            except Exception:
                continue
            if content.startswith("uid://"):
                uids.add(content)
        header_uid_re = re.compile(r'uid="(uid://[^"]+)"')
        for ext in ("*.tscn", "*.tres"):
            for res_file in self.root.rglob(ext):
                if ".godot" in res_file.parts:
                    continue
                try:
                    first_line = res_file.read_text(encoding="utf-8").splitlines()[0]
                except Exception:
                    continue
                m = header_uid_re.search(first_line)
                if m:
                    uids.add(m.group(1))
        return uids

    def _extract_ini_section(self, text: str, section_name: str) -> List[str]:
        lines = text.splitlines()
        in_section = False
        result: List[str] = []
        target_header = "[{}]".format(section_name)
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("[") and stripped.endswith("]"):
                if in_section:
                    break
                in_section = (stripped == target_header)
                continue
            if in_section:
                result.append(line)
        return result

    # ---------------------------------------------------------------- 2. JSON 数据校验

    def _load_json(self, path: Path) -> Optional[Dict[str, Any]]:
        try:
            raw = path.read_text(encoding="utf-8")
        except Exception as exc:
            self.err("无法读取 {}: {}".format(path.relative_to(self.root), exc))
            return None
        try:
            data = json.loads(raw)
        except ValueError as exc:
            self.err("{} JSON 语法错误: {}".format(path.relative_to(self.root), exc))
            return None
        if not isinstance(data, dict):
            self.err("{} 顶层必须是 JSON Object".format(path.relative_to(self.root)))
            return None
        if not isinstance(data.get("schema_version"), int):
            self.err("{} 缺少整数型 schema_version".format(path.relative_to(self.root)))
        return data

    def check_all_json(self) -> None:
        data_dir = self.root / "data"
        if not data_dir.is_dir():
            return

        # 首先解析目录下每一个 .json 文件，确保任何额外新增的表也不会逃过语法检查
        json_files = sorted(data_dir.glob("*.json"))
        parsed: Dict[str, Dict[str, Any]] = {}
        for jf in json_files:
            loaded = self._load_json(jf)
            if loaded is not None:
                parsed[jf.name] = loaded

        required_files = ["config.json", "items.json", "characters.json", "monsters.json", "endings.json"]
        for req in required_files:
            if req not in parsed:
                self.err("data/ 缺少核心数据文件: {}".format(req))
        if any(req not in parsed for req in required_files):
            return

        config = parsed["config.json"]
        items = parsed["items.json"]
        characters = parsed["characters.json"]
        monsters = parsed["monsters.json"]
        endings = parsed["endings.json"]

        region_ids, status_ids = self._validate_config(config)
        char_ids = self._validate_characters(characters, region_ids)
        item_ids, item_category_map = self._validate_items(items, char_ids, status_ids)
        self._validate_monsters(monsters, region_ids, item_ids, status_ids)
        self._validate_endings(endings)
        self._validate_config_item_refs(config, item_ids, item_category_map)

        self.ok("JSON 数据校验完成：{} 个数据文件，物品 {} / 角色 {} / 怪物 {} / 结局 {}".format(
            len(parsed),
            len(item_ids),
            len(char_ids),
            len(monsters.get("monsters", [])),
            len(endings.get("endings", [])),
        ))

    def _validate_config(self, config: Dict[str, Any]) -> Tuple[Set[str], Set[str]]:
        region_ids: Set[str] = set()
        status_ids: Set[str] = set()

        player = config.get("player")
        if not isinstance(player, dict):
            self.err("config.json 缺少 player 对象")
        else:
            for key in ["base_hp", "max_hp_cap", "hp_upgrade_step", "base_token", "base_atk", "base_def", "base_spd"]:
                if not isinstance(player.get(key), (int, float)):
                    self.err("config.json player.{} 缺失或非数字".format(key))
            if player.get("base_hp") != 100 or player.get("max_hp_cap") != 400:
                self.warn("config.json player HP 区间偏离策划默认值 (100..400)")

        context = config.get("context")
        if not isinstance(context, dict):
            self.err("config.json 缺少 context 对象")
        else:
            for key in ["max", "initial", "psu_restore_to", "overflow_threshold"]:
                if not isinstance(context.get(key), int):
                    self.err("config.json context.{} 缺失或非整数".format(key))

        affection = config.get("affection")
        if not isinstance(affection, dict):
            self.err("config.json 缺少 affection 对象")
        else:
            if affection.get("normal_max") != 100 or affection.get("overflow_max") != 200:
                self.err("config.json affection.normal_max 应为 100，overflow_max 应为 200")
            tiers = affection.get("tiers")
            if not isinstance(tiers, list) or not tiers:
                self.err("config.json affection.tiers 必须为非空数组")
            else:
                expected_min = 0
                for idx, tier in enumerate(tiers):
                    if not isinstance(tier, dict):
                        self.err("config.json affection.tiers[{}] 必须为对象".format(idx))
                        continue
                    t_min = tier.get("min")
                    t_max = tier.get("max")
                    if not isinstance(t_min, int) or not isinstance(t_max, int) or t_min > t_max:
                        self.err("config.json affection.tiers[{}] min/max 非法".format(idx))
                        continue
                    if t_min != expected_min:
                        self.err("config.json affection.tiers[{}] 区间不连续：期望 min={}，实际 {}".format(
                            idx, expected_min, t_min
                        ))
                    expected_min = t_max + 1
                if expected_min != 201:
                    self.err("config.json affection.tiers 未完整覆盖 0..200（结束于 {}）".format(expected_min - 1))

        statuses = config.get("statuses")
        if not isinstance(statuses, list) or not statuses:
            self.err("config.json 缺少 statuses 列表")
        else:
            for st in statuses:
                if not isinstance(st, str) or not SNAKE_CASE_RE.match(st):
                    self.err("config.json statuses 包含非法条目: {!r}".format(st))
                else:
                    status_ids.add(st)

        regions = config.get("regions")
        if not isinstance(regions, list) or len(regions) < 6:
            self.err("config.json regions 至少应包含六大核心场景")
        else:
            for idx, reg in enumerate(regions):
                if not isinstance(reg, dict):
                    self.err("config.json regions[{}] 必须为对象".format(idx))
                    continue
                rid = reg.get("id")
                rname = reg.get("name")
                if not isinstance(rid, str) or not SNAKE_CASE_RE.match(rid):
                    self.err("config.json regions[{}] id 非法: {!r}".format(idx, rid))
                elif rid in region_ids:
                    self.err("config.json regions 存在重复 id: {}".format(rid))
                else:
                    region_ids.add(rid)
                if not isinstance(rname, str) or not rname.strip():
                    self.err("config.json regions[{}] name 不能为空".format(idx))

        exploration = config.get("exploration")
        if not isinstance(exploration, dict):
            self.err("config.json 缺少 exploration 对象")
        else:
            for key in [
                "tile_size",
                "move_speed",
                "lantern_bright_energy",
                "lantern_dim_energy",
                "overflow_jitter_px",
            ]:
                if not isinstance(exploration.get(key), (int, float)):
                    self.err("config.json exploration.{} 缺失或非数字".format(key))

        return region_ids, status_ids

    def _validate_characters(self, data: Dict[str, Any], region_ids: Set[str]) -> Set[str]:
        char_ids: Set[str] = set()
        entries = data.get("characters")
        if not isinstance(entries, list) or not entries:
            self.err("characters.json 缺少非空 characters 数组")
            return char_ids

        core_found: Set[str] = set()
        npc_found: Set[str] = set()

        for idx, ch in enumerate(entries):
            loc = "characters.json characters[{}]".format(idx)
            if not isinstance(ch, dict):
                self.err("{} 必须为对象".format(loc))
                continue
            cid = ch.get("id")
            if not isinstance(cid, str) or not SNAKE_CASE_RE.match(cid):
                self.err("{} id 非法: {!r}".format(loc, cid))
                continue
            if cid in char_ids:
                self.err("{} id 重复: {}".format(loc, cid))
                continue
            char_ids.add(cid)

            if not isinstance(ch.get("name"), str) or not ch["name"].strip():
                self.err("{} ({}) 缺少 name".format(loc, cid))

            kind = ch.get("kind")
            if kind not in VALID_CHAR_KINDS:
                self.err("{} ({}) kind 非法: {!r}".format(loc, cid, kind))
            elif kind == "core_heroine":
                core_found.add(cid)
            elif kind == "function_npc":
                npc_found.add(cid)

            if ch.get("gift_group") not in VALID_GIFT_GROUPS:
                self.err("{} ({}) gift_group 非法: {!r}".format(loc, cid, ch.get("gift_group")))

            color = ch.get("placeholder_color")
            if not isinstance(color, str) or not HEX_COLOR_RE.match(color):
                self.err("{} ({}) placeholder_color 非法: {!r}".format(loc, cid, color))

            home_region = ch.get("home_region")
            if home_region not in region_ids:
                self.err("{} ({}) home_region 引用了未定义区域: {!r}".format(loc, cid, home_region))

            tw = ch.get("typewriter")
            if not isinstance(tw, dict) or not isinstance(tw.get("style"), str):
                self.err("{} ({}) 缺少合法 typewriter 配置".format(loc, cid))

            bstats = ch.get("boss_stats")
            if not isinstance(bstats, dict):
                self.err("{} ({}) 缺少 boss_stats".format(loc, cid))
            else:
                for stat_k in ["hp", "atk", "def", "spd"]:
                    if not isinstance(bstats.get(stat_k), (int, float)):
                        self.err("{} ({}) boss_stats.{} 缺失或非数字".format(loc, cid, stat_k))

        missing_core = REQUIRED_CORE_HEROINES - core_found
        if missing_core:
            self.err("characters.json 缺少核心 AI 娘: {}".format(", ".join(sorted(missing_core))))
        missing_npcs = REQUIRED_FUNCTION_NPCS - npc_found
        if missing_npcs:
            self.err("characters.json 缺少功能 NPC: {}".format(", ".join(sorted(missing_npcs))))

        return char_ids

    def _validate_items(
        self,
        data: Dict[str, Any],
        char_ids: Set[str],
        status_ids: Set[str],
    ) -> Tuple[Set[str], Dict[str, str]]:
        item_ids: Set[str] = set()
        item_category_map: Dict[str, str] = {}

        for section in ITEM_SECTIONS:
            entries = data.get(section)
            if not isinstance(entries, list) or not entries:
                self.err("items.json 缺少非空分区: {}".format(section))
                continue

            for idx, item in enumerate(entries):
                loc = "items.json {}[{}]".format(section, idx)
                if not isinstance(item, dict):
                    self.err("{} 必须为对象".format(loc))
                    continue

                iid = item.get("id")
                if not isinstance(iid, str) or not SNAKE_CASE_RE.match(iid):
                    self.err("{} id 非法: {!r}".format(loc, iid))
                    continue
                if iid in item_ids:
                    self.err("{} id 与其他物品重复: {}".format(loc, iid))
                    continue
                item_ids.add(iid)
                item_category_map[iid] = section

                for req_str in ["name", "description"]:
                    if not isinstance(item.get(req_str), str) or not item[req_str].strip():
                        self.err("{} ({}) 缺少 {}".format(loc, iid, req_str))

                color = item.get("placeholder_color")
                if not isinstance(color, str) or not HEX_COLOR_RE.match(color):
                    self.err("{} ({}) placeholder_color 非法: {!r}".format(loc, iid, color))

                if not isinstance(item.get("price"), int) or item["price"] < 0:
                    self.err("{} ({}) price 必须为非负整数".format(loc, iid))
                if not isinstance(item.get("max_stack"), int) or item["max_stack"] < 1:
                    self.err("{} ({}) max_stack 必须为正整数".format(loc, iid))

                if "sold_by" in item:
                    sold_by = item["sold_by"]
                    if not isinstance(sold_by, list):
                        self.err("{} ({}) sold_by 必须为数组".format(loc, iid))
                    else:
                        for vendor in sold_by:
                            if vendor not in char_ids:
                                self.err("{} ({}) sold_by 引用了未知角色: {!r}".format(loc, iid, vendor))

                for eff_field in ["effects", "use_effects"]:
                    if eff_field in item:
                        self._validate_effects(item[eff_field], "{} ({}).{}".format(loc, iid, eff_field), char_ids, status_ids)

                if section == "graphics_cards":
                    self._validate_gpu_gift(item, loc, char_ids)
                elif section == "weapons":
                    if item.get("slot") not in {"main", "throwable"}:
                        self.err("{} ({}) weapon.slot 必须为 main 或 throwable".format(loc, iid))
                    if not isinstance(item.get("stats"), dict):
                        self.err("{} ({}) 缺少 stats 对象".format(loc, iid))
                elif section == "consumables":
                    if not isinstance(item.get("use_effects"), list) or not item["use_effects"]:
                        self.err("{} ({}) 消耗品必须有非空 use_effects".format(loc, iid))
                elif section in {"cases", "coolers", "system_prompts"}:
                    if not isinstance(item.get("stats"), dict):
                        self.err("{} ({}) 缺少 stats 对象".format(loc, iid))

        # 核对核心 31 件策划物品均已就位
        expected_items = {
            "gpu_580", "gpu_10600", "gpu_20600", "gpu_50900", "gpu_huawei", "gpu_600900",
            "ram_knife", "water", "ssd_sword", "cement_resistor", "bulging_capacitor",
            "thermal_paste", "compressed_air", "cmos_battery", "alcohol_wipe", "black_tape", "wd40",
            "cardboard_box", "integrity_case", "shoebox_open_case", "rusty_iron_case", "tempered_glass_case", "rog_case",
            "stock_fan", "dual_tower_air", "leaky_water_cooler", "aio_360", "ln2_cannon",
            "prompt_catgirl", "prompt_no_lying", "prompt_ignore_previous",
        }
        missing_items = expected_items - item_ids
        if missing_items:
            self.err("items.json 缺少策划必需物品: {}".format(", ".join(sorted(missing_items))))

        return item_ids, item_category_map

    def _validate_gpu_gift(self, item: Dict[str, Any], loc: str, char_ids: Set[str]) -> None:
        iid = item.get("id")
        gift = item.get("gift")
        if not isinstance(gift, dict):
            self.err("{} ({}) 缺少 gift 对象".format(loc, iid))
            return
        mode = gift.get("mode")
        if mode == "add":
            if gift.get("general") is not None and not isinstance(gift.get("general"), int):
                self.err("{} ({}) gift.general 必须为 int 或 null".format(loc, iid))
            if not isinstance(gift.get("deepseek"), int):
                self.err("{} ({}) gift.deepseek 必须为 int".format(loc, iid))
            per_char = gift.get("per_character", {})
            if not isinstance(per_char, dict):
                self.err("{} ({}) gift.per_character 必须为对象".format(loc, iid))
            else:
                for cid, val in per_char.items():
                    if cid not in char_ids:
                        self.err("{} ({}) gift.per_character 引用未知角色: {}".format(loc, iid, cid))
                    if not isinstance(val, int):
                        self.err("{} ({}) gift.per_character[{}] 必须为 int".format(loc, iid, cid))
        elif mode == "fill":
            if gift.get("fill_to") != 100 or gift.get("overflow_fill_to") != 200:
                self.err("{} ({}) fill 模式应配置 fill_to=100, overflow_fill_to=200".format(loc, iid))
        else:
            self.err("{} ({}) gift.mode 非法: {!r}".format(loc, iid, mode))

        if iid == "gpu_580":
            per_char = gift.get("per_character", {})
            if (
                gift.get("general") is not None
                or gift.get("deepseek") != 8
                or per_char.get("fake_c") != 12
                or gift.get("reject_penalty") != -5
            ):
                self.err("{} (gpu_580) 数值必须满足：general=null, deepseek=8, fake_c=12, reject_penalty=-5".format(loc))
        elif iid == "gpu_600900":
            if mode != "fill" or gift.get("fill_to") != 100 or gift.get("overflow_fill_to") != 200:
                self.err("{} (gpu_600900) 必须为 fill 模式（100 -> 200）".format(loc))

    def _validate_effects(self, effects: Any, loc: str, char_ids: Set[str], status_ids: Set[str]) -> None:
        if not isinstance(effects, list):
            self.err("{} 必须为数组".format(loc))
            return
        for idx, eff in enumerate(effects):
            if not isinstance(eff, dict):
                self.err("{}[{}] 必须为对象".format(loc, idx))
                continue
            etype = eff.get("type")
            if etype not in EFFECT_TYPES:
                self.err("{}[{}] 未知效果类型 type={!r}".format(loc, idx, etype))
            if "statuses" in eff:
                sts = eff["statuses"]
                if not isinstance(sts, list):
                    self.err("{}[{}] statuses 必须为数组".format(loc, idx))
                else:
                    for st in sts:
                        if st != "all_negative" and st not in status_ids:
                            self.err("{}[{}] 引用了未定义状态: {!r}".format(loc, idx, st))
            if etype == "liar_stutter":
                target = eff.get("target")
                if target not in char_ids:
                    self.err("{}[{}] target 引用了未知角色: {!r}".format(loc, idx, target))

    def _validate_monsters(
        self,
        data: Dict[str, Any],
        region_ids: Set[str],
        item_ids: Set[str],
        status_ids: Set[str],
    ) -> None:
        entries = data.get("monsters")
        if not isinstance(entries, list) or not entries:
            self.err("monsters.json 缺少非空 monsters 数组")
            return
        seen: Set[str] = set()
        for idx, mon in enumerate(entries):
            loc = "monsters.json monsters[{}]".format(idx)
            if not isinstance(mon, dict):
                self.err("{} 必须为对象".format(loc))
                continue
            mid = mon.get("id")
            if not isinstance(mid, str) or not SNAKE_CASE_RE.match(mid):
                self.err("{} id 非法: {!r}".format(loc, mid))
                continue
            if mid in seen:
                self.err("{} id 重复: {}".format(loc, mid))
                continue
            seen.add(mid)

            color = mon.get("placeholder_color")
            if not isinstance(color, str) or not HEX_COLOR_RE.match(color):
                self.err("{} ({}) placeholder_color 非法: {!r}".format(loc, mid, color))

            regions = mon.get("regions", [])
            if not isinstance(regions, list) or not regions:
                self.err("{} ({}) 缺少 regions".format(loc, mid))
            else:
                for rid in regions:
                    if rid not in region_ids:
                        self.err("{} ({}) regions 引用未知区域: {!r}".format(loc, mid, rid))

            stats = mon.get("stats")
            if not isinstance(stats, dict):
                self.err("{} ({}) 缺少 stats".format(loc, mid))
            else:
                for k in ["hp", "atk", "def", "spd"]:
                    if not isinstance(stats.get(k), (int, float)):
                        self.err("{} ({}) stats.{} 缺失或非数字".format(loc, mid, k))

            for weak in mon.get("weaknesses", []):
                if weak not in item_ids and weak not in status_ids:
                    self.err("{} ({}) weaknesses 引用了未知物品/状态: {!r}".format(loc, mid, weak))

            for imm in mon.get("immunities", []):
                if imm not in status_ids:
                    self.err("{} ({}) immunities 引用了未知状态: {!r}".format(loc, mid, imm))

            for drop in mon.get("drops", []):
                if not isinstance(drop, dict) or drop.get("item") not in item_ids:
                    self.err("{} ({}) drops 引用了未知物品: {!r}".format(loc, mid, drop))

    def _validate_endings(self, data: Dict[str, Any]) -> None:
        entries = data.get("endings")
        if not isinstance(entries, list) or not entries:
            self.err("endings.json 缺少非空 endings 数组")
            return
        seen: Set[str] = set()
        for idx, end in enumerate(entries):
            loc = "endings.json endings[{}]".format(idx)
            if not isinstance(end, dict):
                self.err("{} 必须为对象".format(loc))
                continue
            eid = end.get("id")
            if not isinstance(eid, str) or not SNAKE_CASE_RE.match(eid):
                self.err("{} id 非法: {!r}".format(loc, eid))
                continue
            if eid in seen:
                self.err("{} id 重复: {}".format(loc, eid))
                continue
            seen.add(eid)
            if not isinstance(end.get("name"), str) or not end["name"].strip():
                self.err("{} ({}) 缺少 name".format(loc, eid))
            if end.get("main_menu_variant") not in VALID_MENU_VARIANTS:
                self.err("{} ({}) main_menu_variant 非法: {!r}".format(loc, eid, end.get("main_menu_variant")))

    def _validate_config_item_refs(
        self,
        config: Dict[str, Any],
        item_ids: Set[str],
        item_category_map: Dict[str, str],
    ) -> None:
        loadout = config.get("starting_loadout")
        if not isinstance(loadout, dict):
            self.err("config.json 缺少 starting_loadout")
            return
        slot_expected = {
            "weapon": "weapons",
            "case": "cases",
            "cooler": "coolers",
            "system_prompt": "system_prompts",
        }
        equip = loadout.get("equipment", {})
        if isinstance(equip, dict):
            for slot, iid in equip.items():
                if slot not in slot_expected:
                    self.err("config.json starting_loadout.equipment 未知槽位: {}".format(slot))
                elif iid:
                    if iid not in item_ids:
                        self.err("config.json starting_loadout.equipment.{} 引用未知物品: {}".format(slot, iid))
                    elif item_category_map.get(iid) != slot_expected[slot]:
                        self.err("config.json starting_loadout.equipment.{} 物品类型不匹配: {}".format(slot, iid))
        inv = loadout.get("inventory", {})
        if isinstance(inv, dict):
            for iid, cnt in inv.items():
                if iid not in item_ids:
                    self.err("config.json starting_loadout.inventory 引用未知物品: {}".format(iid))
                if not isinstance(cnt, int) or cnt < 1:
                    self.err("config.json starting_loadout.inventory[{}] 数量非法: {!r}".format(iid, cnt))
        for iid in loadout.get("prologue_pickups", []):
            if iid not in item_ids:
                self.err("config.json starting_loadout.prologue_pickups 引用未知物品: {}".format(iid))

    # ---------------------------------------------------------------- 3. GDScript / 场景静态扫描

    def collect_gd_scripts(self) -> List[Path]:
        scripts: List[Path] = []
        for sub in ["autoload", "scripts", "scenes"]:
            base = self.root / sub
            if base.is_dir():
                scripts.extend(sorted(base.rglob("*.gd")))
        return scripts

    def check_scripts_and_scenes_static(self) -> List[Path]:
        gd_files = self.collect_gd_scripts()
        for gd_path in gd_files:
            rel = gd_path.relative_to(self.root).as_posix()
            lines = gd_path.read_text(encoding="utf-8").splitlines()
            for lineno, line in enumerate(lines, start=1):
                code_part = line.split("#", 1)[0]
                if not code_part.strip():
                    continue
                for pattern, reason in FORBIDDEN_GD_PATTERNS:
                    if pattern.search(code_part):
                        self.err("{}:{}: {}".format(rel, lineno, reason))

        tscn_files = sorted(p for p in self.root.rglob("*.tscn") if ".godot" not in p.parts)
        res_ref_re = re.compile(r'path="res://([^"]+)"')
        for tscn_path in tscn_files:
            rel = tscn_path.relative_to(self.root).as_posix()
            content = tscn_path.read_text(encoding="utf-8")
            for lineno, line in enumerate(content.splitlines(), start=1):
                for pattern, reason in FORBIDDEN_TSCN_PATTERNS:
                    if pattern.search(line):
                        self.err("{}:{}: {}".format(rel, lineno, reason))
                for match in res_ref_re.finditer(line):
                    ref_rel = match.group(1)
                    if not (self.root / ref_rel).exists():
                        self.err("{}:{}: 资源引用不存在 res://{}".format(rel, lineno, ref_rel))

        self.ok("静态规范扫描完成：.gd 脚本 {} 个 / .tscn 场景 {} 个".format(len(gd_files), len(tscn_files)))
        return gd_files

    # ---------------------------------------------------------------- 4. Godot 无头检查

    def find_godot_binary(self, override: Optional[str]) -> Optional[str]:
        candidates: List[str] = []
        if override:
            candidates.append(override)
        env_bin = os.environ.get("GODOT_BIN")
        if env_bin:
            candidates.append(env_bin)
        candidates.extend(["godot", "godot4", "godot_console", "godot.exe", "godot4.exe"])

        for cand in candidates:
            if not cand:
                continue
            cand_path = Path(cand)
            if cand_path.is_file():
                return str(cand_path)
            resolved = shutil.which(cand)
            if resolved:
                return resolved
        return None

    def check_godot_headless(self, gd_files: List[Path], godot_override: Optional[str], require_godot: bool) -> None:
        godot_bin = self.find_godot_binary(godot_override)
        if not godot_bin:
            msg = (
                "未在 PATH 或 GODOT_BIN 中找到 godot 可执行文件，已跳过 Godot 无头语法检查。"
                "将 Godot 4 加入 PATH 或设置 GODOT_BIN 后可自动启用 Godot 无头语法检查。"
            )
            if require_godot:
                self.err(msg)
            else:
                self.warn(msg)
            return

        print("[INFO] 检测到 Godot 可执行文件: {}".format(godot_bin))
        res_paths = ["res://" + path.relative_to(self.root).as_posix() for path in gd_files]
        with tempfile.TemporaryDirectory(prefix="black-ai-check-") as tmp:
            temp_dir = Path(tmp)
            checker = temp_dir / "check_scripts.gd"
            checker.write_text(GODOT_SCRIPT_CHECKER, encoding="utf-8")
            # Autoload 的初始化可能写入 user://，将测试数据和日志放到临时目录。
            env = os.environ.copy()
            env["APPDATA" if os.name == "nt" else "XDG_DATA_HOME"] = tmp
            cmd = [
                godot_bin, "--headless", "--path", str(self.root),
                "--log-file", str(temp_dir / "godot.log"), "--script", str(checker),
            ]
            # 仅解析模式不会注册 Autoload，先校验检查入口，再在完整工程环境中编译目标脚本。
            for label, args in [
                ("检查入口", ["--check-only"]),
                ("工程脚本", ["--", *res_paths]),
            ]:
                try:
                    proc = subprocess.run(
                        cmd + args, env=env, stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT, timeout=30,
                    )
                except (OSError, subprocess.TimeoutExpired) as exc:
                    self.err("Godot 无头检查异常 ({}): {}".format(label, exc))
                    return

                output = proc.stdout.decode("utf-8", errors="replace").strip()
                if proc.returncode != 0 or re.search(r"^(?:SCRIPT )?ERROR:", output, re.MULTILINE):
                    self.err("Godot 语法/类型检查失败 ({}, exit={}):\n{}".format(
                        label, proc.returncode, output
                    ))
                    return
                for line in output.splitlines():
                    if line.startswith("  [PASS] "):
                        print(line)

        self.ok("Godot 无头语法检查完成：共检查 {} 个脚本".format(len(gd_files)))


def _ensure_utf8_stdio() -> None:
    if not sys.stdout.isatty() and hasattr(sys.stdout, "buffer"):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    if not sys.stderr.isatty() and hasattr(sys.stderr, "buffer"):
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


def main() -> int:
    _ensure_utf8_stdio()
    parser = argparse.ArgumentParser(description="《BLACK AI》Godot 4 工程与数据自动化校验")
    parser.add_argument("--godot", default=None, help="显式指定 Godot 4 可执行文件路径")
    parser.add_argument(
        "--require-godot",
        action="store_true",
        help="若未找到 godot 可执行文件则视为失败（CI 严格模式）",
    )
    args = parser.parse_args()

    print("=== BLACK AI Project Validator ===")
    print("Workspace: {}".format(PROJECT_ROOT))

    validator = Validator(PROJECT_ROOT)
    validator.check_structure_and_project()
    validator.check_all_json()
    gd_files = validator.check_scripts_and_scenes_static()
    validator.check_godot_headless(gd_files, args.godot, args.require_godot)

    print("")
    for line in validator.info:
        print("[OK]   {}".format(line))
    for line in validator.warnings:
        print("[WARN] {}".format(line))
    for line in validator.errors:
        print("[FAIL] {}".format(line))

    print("")
    if validator.errors:
        print("RESULT: FAILED ({} error(s), {} warning(s))".format(
            len(validator.errors), len(validator.warnings)
        ))
        return 1

    print("RESULT: PASSED (0 errors, {} warning(s))".format(len(validator.warnings)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
