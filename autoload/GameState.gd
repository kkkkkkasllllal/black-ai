extends Node
## GameState（Autoload）
## 管理当前周目 / 当前存档的运行时状态：
## - 玩家数值（HP / MaxHP / Token / Context / 废弃权重碎片 / HP 升级次数）
## - 装备槽（weapon / case / cooler / system_prompt）与背包
## - 7 位核心 AI 娘好感度（0–200）与存活状态、功能 NPC 与淘汰者存活状态
## - 开局淘汰者标记、并发助战伙伴、喊妈妈计数、大 PSU 开关彩蛋、世界事件标记
## - 常规存档读写（读档自动通知 GlobalMemory.register_sl；击杀自动通知 GlobalMemory.record_kill）

signal hp_changed(current: int, maximum: int)
signal token_changed(current: int, maximum: int)
signal context_changed(current: int, maximum: int, is_overflow: bool)
signal shards_changed(amount: int)
signal equipment_changed(slot: String, item_id: String)
signal inventory_changed(item_id: String, count: int)
signal affection_changed(character_id: String, old_value: int, new_value: int, tier_id: String)
signal character_killed(character_id: String)
signal world_enemies_respawn_requested(reason: String)
signal game_state_reset

const SAVE_DIR: String = "user://saves/"
const SAVE_VERSION: int = 1
const EQUIPMENT_SLOTS: Array = ["weapon", "case", "cooler", "system_prompt"]

## 核心可攻略 AI 娘（7 位）
const CORE_HEROINE_IDS: Array = [
	"big_fish",
	"small_fish",
	"true_c",
	"fake_c",
	"astra",
	"sol",
	"gemini_cat",
]

## 功能 NPC（5 位）
const FUNCTION_NPC_IDS: Array = [
	"glm",
	"qwen",
	"kimi",
	"doubao",
	"grok",
]

## 常规装备槽允许的物品分区
const SLOT_CATEGORY_MAP: Dictionary = {
	"weapon": "weapons",
	"case": "cases",
	"cooler": "coolers",
	"system_prompt": "system_prompts",
}

# ---- 玩家基础数值 ----
var base_max_hp: int = 100
var hp_upgrade_count: int = 0
var hp: int = 100
var max_token: int = 100
var token: int = 100
## 上下文稳定度：0–100（100 = 表世界完全稳定；<= overflow_threshold 进入里世界/溢出）
var context: int = 100
var max_context: int = 100
var weight_shards: int = 0
var is_case_broken: bool = false

# ---- 装备与背包 ----
var equipment: Dictionary = {
	"weapon": "",
	"case": "",
	"cooler": "",
	"system_prompt": "",
}
## { item_id: count }
var inventory: Dictionary = {}

# ---- 角色状态 ----
## { character_id: int (0..200) } —— 覆盖 7 位核心 AI 娘
var affections: Dictionary = {}
## { character_id: bool } —— 覆盖全部 7 核心 + 5 功能 NPC + opus
var alive_states: Dictionary = {}
## 已送出绑定戒的角色 id
var bound_heroines: PackedStringArray = PackedStringArray()
## 当前并发助战伙伴 id（需好感 >= 70 且存活）
var assist_partner_id: String = ""

# ---- 剧情与世界状态 ----
## 开局铁笼盲测中被淘汰的角色 id（一周目: "big_fish" / "opus"；二周目: "astra" / "sol"）
var eliminated_character: String = ""
var current_region: String = "draft_abyss"
var unlocked_shortcuts: PackedStringArray = PackedStringArray()
## 喊过“妈妈”的对象 id 列表（>=3 触发猫猫拆台与【满机房认亲】）
var called_mom_targets: PackedStringArray = PackedStringArray()
## 假小 C 通过逛图“蒸馏”偷学到的技能 id
var fake_c_stolen_skills: PackedStringArray = PackedStringArray()
## 大 PSU 背面物理总开关按压次数
var psu_back_switch_presses: int = 0
## 是否已击杀幕后写手 Fable 5.2（多周目全员强制异变低 SAN 怪物态）
var fable_defeated: bool = false
## 通用剧情标记 { flag_name: Variant }
var story_flags: Dictionary = {}


func _ready() -> void:
	reset_new_game()


# ---------------------------------------------------------------- 初始化

## 开始一局新游戏（保留 GlobalMemory 不变）。
func reset_new_game(apply_first_vote_bonus: bool = false) -> void:
	base_max_hp = DataRegistry.get_config_int("player.base_hp", 100)
	hp_upgrade_count = 0
	max_token = DataRegistry.get_config_int("player.base_token", 100)
	token = max_token
	max_context = DataRegistry.get_config_int("context.max", 100)
	context = DataRegistry.get_config_int("context.initial", 100)
	weight_shards = 0
	is_case_broken = false

	equipment = {
		"weapon": "",
		"case": "",
		"cooler": "",
		"system_prompt": "",
	}
	var start_equip: Variant = DataRegistry.get_config_value("starting_loadout.equipment", {})
	if start_equip is Dictionary:
		var start_equip_dict: Dictionary = start_equip
		for slot_variant in EQUIPMENT_SLOTS:
			var slot: String = str(slot_variant)
			equipment[slot] = str(start_equip_dict.get(slot, ""))

	inventory.clear()
	var start_inv: Variant = DataRegistry.get_config_value("starting_loadout.inventory", {})
	if start_inv is Dictionary:
		var start_inv_dict: Dictionary = start_inv
		for item_key in start_inv_dict.keys():
			var count: int = int(start_inv_dict[item_key])
			if count > 0:
				inventory[str(item_key)] = count

	affections.clear()
	for heroine_variant in CORE_HEROINE_IDS:
		affections[str(heroine_variant)] = 0

	alive_states.clear()
	for character_id in DataRegistry.get_character_ids():
		alive_states[character_id] = true
	for heroine_variant in CORE_HEROINE_IDS:
		alive_states[str(heroine_variant)] = true
	for npc_variant in FUNCTION_NPC_IDS:
		alive_states[str(npc_variant)] = true
	if not alive_states.has("opus"):
		alive_states["opus"] = true

	bound_heroines = PackedStringArray()
	assist_partner_id = ""
	eliminated_character = ""
	current_region = "draft_abyss"
	unlocked_shortcuts = PackedStringArray()
	called_mom_targets = PackedStringArray()
	fake_c_stolen_skills = PackedStringArray()
	psu_back_switch_presses = 0
	fable_defeated = false
	story_flags.clear()

	hp = get_effective_max_hp()

	if apply_first_vote_bonus and not GlobalMemory.first_vote.is_empty():
		var bonus: int = DataRegistry.get_config_int("affection.first_vote_bonus", 15)
		if affections.has(GlobalMemory.first_vote):
			add_affection(GlobalMemory.first_vote, bonus, false)

	game_state_reset.emit()
	hp_changed.emit(hp, get_effective_max_hp())
	token_changed.emit(token, max_token)
	context_changed.emit(context, max_context, is_context_overflow())
	shards_changed.emit(weight_shards)


# ---------------------------------------------------------------- 衍生属性与基础数值

func get_effective_max_hp() -> int:
	var cap: int = DataRegistry.get_config_int("player.max_hp_cap", 400)
	var bonus: int = _get_equipped_stat_int("max_hp")
	return mini(cap, base_max_hp + bonus)


func get_effective_atk() -> int:
	var base_atk: int = DataRegistry.get_config_int("player.base_atk", 10)
	var flat_atk: int = _get_equipped_stat_int("atk")
	var mult: float = 1.0 + _get_equipped_stat_float("atk_mult")
	return maxi(1, int(round(float(base_atk + flat_atk) * mult)))


func get_effective_def() -> int:
	var base_def: int = DataRegistry.get_config_int("player.base_def", 0)
	var total_def: int = base_def
	for slot_variant in EQUIPMENT_SLOTS:
		var slot: String = str(slot_variant)
		if slot == "case" and is_case_broken:
			continue
		var item_id: String = str(equipment.get(slot, ""))
		if item_id.is_empty():
			continue
		var stats: Dictionary = _get_item_stats(item_id)
		total_def += int(stats.get("def", 0))
	return maxi(0, total_def)


func get_effective_spd() -> int:
	return maxi(1, DataRegistry.get_config_int("player.base_spd", 10) + _get_equipped_stat_int("spd"))


func get_effective_evasion() -> float:
	return clampf(_get_equipped_stat_float("evasion"), 0.0, 0.85)


func get_effective_crit_rate() -> float:
	return clampf(0.05 + _get_equipped_stat_float("crit_rate"), 0.0, 1.0)


func has_equipped_effect(effect_type: String) -> bool:
	for slot_variant in EQUIPMENT_SLOTS:
		var slot: String = str(slot_variant)
		if slot == "case" and is_case_broken:
			continue
		var item_id: String = str(equipment.get(slot, ""))
		if item_id.is_empty():
			continue
		var item: Dictionary = DataRegistry.get_item(item_id)
		var effects_variant: Variant = item.get("effects", [])
		if effects_variant is Array:
			var effects_array: Array = effects_variant
			for eff_variant in effects_array:
				if eff_variant is Dictionary:
					var eff: Dictionary = eff_variant
					if str(eff.get("type", "")) == effect_type:
						return true
	return false


func set_hp(value: int) -> void:
	var max_hp_now: int = get_effective_max_hp()
	var clamped: int = clampi(value, 0, max_hp_now)
	if clamped == hp:
		return
	hp = clamped
	hp_changed.emit(hp, max_hp_now)


func change_hp(delta: int) -> void:
	set_hp(hp + delta)


func set_token(value: int) -> void:
	var clamped: int = clampi(value, 0, max_token)
	if clamped == token:
		return
	token = clamped
	token_changed.emit(token, max_token)


func change_token(delta: int) -> void:
	set_token(token + delta)


## 修改上下文稳定度（正值回稳，负值污染/溢出）。
func set_context(value: int) -> void:
	var clamped: int = clampi(value, 0, max_context)
	if clamped == context:
		return
	context = clamped
	context_changed.emit(context, max_context, is_context_overflow())


func change_context(delta: int) -> void:
	set_context(context + delta)


## 上下文是否已进入里世界/溢出阈值（默认 <= 30）。
func is_context_overflow() -> bool:
	var threshold: int = DataRegistry.get_config_int("context.overflow_threshold", 30)
	return context <= threshold


func is_context_critical() -> bool:
	var threshold: int = DataRegistry.get_config_int("context.critical_threshold", 10)
	return context <= threshold


func add_weight_shards(amount: int) -> void:
	weight_shards = maxi(0, weight_shards + amount)
	shards_changed.emit(weight_shards)


func spend_weight_shards(amount: int) -> bool:
	if amount < 0 or weight_shards < amount:
		return false
	weight_shards -= amount
	shards_changed.emit(weight_shards)
	return true


# ---------------------------------------------------------------- 大 PSU 电源核心操作

## 大 PSU 电源【清理缓存】：恢复上下文至安全线（至少 80），并触发普通暗影怪刷新。
func psu_clear_cache() -> void:
	var target: int = DataRegistry.get_config_int("context.psu_restore_to", 80)
	if context < target:
		set_context(target)
	set_token(max_token)
	world_enemies_respawn_requested.emit("psu_clear_cache")


## 返回下一次大 PSU 升级 HP 所需的废弃权重碎片。
func get_hp_upgrade_cost() -> int:
	var base_cost: int = DataRegistry.get_config_int("player.hp_upgrade_base_cost", 5)
	var growth: int = DataRegistry.get_config_int("player.hp_upgrade_cost_growth", 3)
	return base_cost + hp_upgrade_count * growth


## 在大 PSU 电源消耗碎片提升基础 HP 上限（上限 400）。
func upgrade_base_hp() -> bool:
	var cap: int = DataRegistry.get_config_int("player.max_hp_cap", 400)
	var step: int = DataRegistry.get_config_int("player.hp_upgrade_step", 20)
	if base_max_hp >= cap:
		return false
	var cost: int = get_hp_upgrade_cost()
	if not spend_weight_shards(cost):
		return false
	base_max_hp = mini(cap, base_max_hp + step)
	hp_upgrade_count += 1
	hp = mini(get_effective_max_hp(), hp + step)
	hp_changed.emit(hp, get_effective_max_hp())
	return true


# ---------------------------------------------------------------- 装备与背包

func get_item_count(item_id: String) -> int:
	return int(inventory.get(item_id, 0))


func has_item(item_id: String, amount: int = 1) -> bool:
	return get_item_count(item_id) >= amount


func add_item(item_id: String, amount: int = 1) -> bool:
	if amount <= 0 or not DataRegistry.has_item(item_id):
		push_warning("[GameState] 尝试添加无效物品: %s (x%d)" % [item_id, amount])
		return false
	var item: Dictionary = DataRegistry.get_item(item_id)
	var max_stack: int = int(item.get("max_stack", 99))
	var current: int = get_item_count(item_id)
	var next_count: int = mini(max_stack, current + amount)
	inventory[item_id] = next_count
	inventory_changed.emit(item_id, next_count)
	return true


func remove_item(item_id: String, amount: int = 1) -> bool:
	if amount <= 0 or not has_item(item_id, amount):
		return false
	var next_count: int = get_item_count(item_id) - amount
	if next_count <= 0:
		inventory.erase(item_id)
		next_count = 0
	else:
		inventory[item_id] = next_count
	inventory_changed.emit(item_id, next_count)
	return true


## 装备指定物品到对应槽位（weapon / case / cooler / system_prompt）。
## require_in_inventory 为 true 时会从背包取出旧/新物品互换。
func equip_item(slot: String, item_id: String, require_in_inventory: bool = true) -> bool:
	if not SLOT_CATEGORY_MAP.has(slot):
		push_warning("[GameState] 未知装备槽位: %s" % slot)
		return false
	if item_id.is_empty():
		return unequip_slot(slot)
	if not DataRegistry.has_item(item_id):
		push_warning("[GameState] 尝试装备未知物品: %s" % item_id)
		return false
	var expected_category: String = str(SLOT_CATEGORY_MAP[slot])
	if DataRegistry.get_item_category(item_id) != expected_category:
		push_warning("[GameState] 物品 %s 不能装进槽位 %s" % [item_id, slot])
		return false
	if slot == "weapon":
		var weapon_data: Dictionary = DataRegistry.get_item(item_id)
		if str(weapon_data.get("slot", "main")) != "main":
			push_warning("[GameState] 投掷/消耗武器 %s 请在战斗中直接使用，不可装入主武器槽" % item_id)
			return false
	if require_in_inventory and not has_item(item_id, 1):
		return false

	var previous_id: String = str(equipment.get(slot, ""))
	if require_in_inventory:
		remove_item(item_id, 1)
		if not previous_id.is_empty():
			add_item(previous_id, 1)

	equipment[slot] = item_id
	if slot == "case":
		is_case_broken = false
	var max_hp_now: int = get_effective_max_hp()
	if hp > max_hp_now:
		hp = max_hp_now
	equipment_changed.emit(slot, item_id)
	hp_changed.emit(hp, max_hp_now)
	return true


func unequip_slot(slot: String, return_to_inventory: bool = true) -> bool:
	if not SLOT_CATEGORY_MAP.has(slot):
		return false
	var previous_id: String = str(equipment.get(slot, ""))
	if previous_id.is_empty():
		return true
	equipment[slot] = ""
	if slot == "case":
		is_case_broken = false
	if return_to_inventory:
		add_item(previous_id, 1)
	var max_hp_now: int = get_effective_max_hp()
	if hp > max_hp_now:
		hp = max_hp_now
	equipment_changed.emit(slot, "")
	hp_changed.emit(hp, max_hp_now)
	return true


func break_glass_case() -> void:
	if str(equipment.get("case", "")) == "tempered_glass_case":
		is_case_broken = true
		equipment_changed.emit("case", "tempered_glass_case")


func repair_glass_case() -> bool:
	if not is_case_broken:
		return false
	is_case_broken = false
	equipment_changed.emit("case", str(equipment.get("case", "")))
	return true


# ---------------------------------------------------------------- 好感度与 6 档显卡送礼

func is_core_heroine(character_id: String) -> bool:
	return CORE_HEROINE_IDS.has(character_id)


func get_affection(character_id: String) -> int:
	return int(affections.get(character_id, 0))


func get_affection_tier(character_id: String) -> Dictionary:
	return DataRegistry.get_affection_tier(get_affection(character_id))


## 调整核心 AI 娘好感度。allow_overflow=false 时上限封顶在 100；true 时最高可至 200（偏执溢出态）。
func add_affection(character_id: String, delta: int, allow_overflow: bool = true) -> int:
	if not affections.has(character_id):
		push_warning("[GameState] 角色 %s 没有好感度槽" % character_id)
		return 0
	var old_value: int = int(affections[character_id])
	var min_val: int = DataRegistry.get_config_int("affection.min", 0)
	var max_val: int = DataRegistry.get_config_int("affection.overflow_max", 200) if allow_overflow else DataRegistry.get_config_int("affection.normal_max", 100)
	var new_value: int = clampi(old_value + delta, min_val, max_val)
	affections[character_id] = new_value
	var tier: Dictionary = DataRegistry.get_affection_tier(new_value)
	affection_changed.emit(character_id, old_value, new_value, str(tier.get("id", "")))
	return new_value


## 计算并执行显卡送礼（支持强送拒收惩罚与 600900 拉满/突破至 200%）。
## 返回: { ok, accepted, rejected, forced, delta, old_value, new_value, tier_id, reason }
func gift_graphics_card(character_id: String, gpu_item_id: String, force_if_rejected: bool = false, consume_item: bool = true) -> Dictionary:
	var result: Dictionary = {
		"ok": false,
		"accepted": false,
		"rejected": false,
		"forced": false,
		"delta": 0,
		"old_value": get_affection(character_id),
		"new_value": get_affection(character_id),
		"tier_id": str(get_affection_tier(character_id).get("id", "")),
		"reason": "",
	}
	if not is_core_heroine(character_id):
		result["reason"] = "not_giftable_character"
		return result
	if not is_character_alive(character_id):
		result["reason"] = "character_dead"
		return result
	if DataRegistry.get_item_category(gpu_item_id) != "graphics_cards":
		result["reason"] = "not_graphics_card"
		return result
	if consume_item and not has_item(gpu_item_id, 1):
		result["reason"] = "item_missing"
		return result

	var card: Dictionary = DataRegistry.get_item(gpu_item_id)
	var gift_variant: Variant = card.get("gift", {})
	var gift: Dictionary = gift_variant if gift_variant is Dictionary else {}
	var char_data: Dictionary = DataRegistry.get_character(character_id)
	var gift_group: String = str(char_data.get("gift_group", "general"))
	var old_value: int = get_affection(character_id)
	var mode: String = str(gift.get("mode", "add"))

	if mode == "fill":
		var fill_to: int = int(gift.get("fill_to", 100))
		var overflow_fill_to: int = int(gift.get("overflow_fill_to", 200))
		var target_value: int = overflow_fill_to if old_value >= fill_to else fill_to
		var delta: int = maxi(0, target_value - old_value)
		if consume_item:
			remove_item(gpu_item_id, 1)
		var new_value: int = add_affection(character_id, delta, true)
		result["ok"] = true
		result["accepted"] = true
		result["delta"] = new_value - old_value
		result["new_value"] = new_value
		result["tier_id"] = str(DataRegistry.get_affection_tier(new_value).get("id", ""))
		return result

	# mode == "add"
	var per_char_variant: Variant = gift.get("per_character", {})
	var per_char: Dictionary = per_char_variant if per_char_variant is Dictionary else {}
	var gain_variant: Variant = null
	if per_char.has(character_id):
		gain_variant = per_char[character_id]
	elif gift_group == "deepseek":
		gain_variant = gift.get("deepseek", null)
	else:
		gain_variant = gift.get("general", null)

	if gain_variant == null:
		# 拒收（例如非三姐妹收到 580 矿卡）
		result["ok"] = true
		result["rejected"] = true
		if force_if_rejected:
			var penalty: int = int(gift.get("reject_penalty", -5))
			var new_val: int = add_affection(character_id, penalty, true)
			result["forced"] = true
			result["delta"] = new_val - old_value
			result["new_value"] = new_val
			result["tier_id"] = str(DataRegistry.get_affection_tier(new_val).get("id", ""))
			result["reason"] = "forced_rejected_gift"
		else:
			result["reason"] = "rejected"
		return result

	var gain: int = int(gain_variant)
	if consume_item:
		remove_item(gpu_item_id, 1)
	var after_val: int = add_affection(character_id, gain, true)
	result["ok"] = true
	result["accepted"] = true
	result["delta"] = after_val - old_value
	result["new_value"] = after_val
	result["tier_id"] = str(DataRegistry.get_affection_tier(after_val).get("id", ""))
	return result


func get_full_affection_heroines() -> PackedStringArray:
	var normal_max: int = DataRegistry.get_config_int("affection.normal_max", 100)
	var list: PackedStringArray = PackedStringArray()
	for heroine_variant in CORE_HEROINE_IDS:
		var cid: String = str(heroine_variant)
		if is_character_alive(cid) and get_affection(cid) >= normal_max:
			list.append(cid)
	return list


func set_assist_partner(character_id: String) -> bool:
	if character_id.is_empty():
		assist_partner_id = ""
		return true
	var min_aff: int = DataRegistry.get_config_int("affection.assist_min", 70)
	if not is_core_heroine(character_id) or not is_character_alive(character_id):
		return false
	if get_affection(character_id) < min_aff:
		return false
	assist_partner_id = character_id
	return true


# ---------------------------------------------------------------- 角色存活、淘汰与彩蛋标记

func is_character_alive(character_id: String) -> bool:
	return bool(alive_states.get(character_id, false))


## 击杀指定角色，并同步写入 GlobalMemory（供 Gemini 猫猫跨存档 SL 拆台）。
func kill_character(character_id: String) -> void:
	if not alive_states.has(character_id):
		push_warning("[GameState] 尝试击杀未登记角色: %s" % character_id)
		return
	if not bool(alive_states[character_id]):
		return
	alive_states[character_id] = false
	if assist_partner_id == character_id:
		assist_partner_id = ""
	GlobalMemory.record_kill(character_id)
	character_killed.emit(character_id)


func set_eliminated_character(character_id: String) -> void:
	eliminated_character = character_id


## 判断是否达成《空盘 100%》清空条件：7 核心 AI + 5 功能 NPC + 开局淘汰者全部击杀。
func are_all_targets_eliminated() -> bool:
	for heroine_variant in CORE_HEROINE_IDS:
		if is_character_alive(str(heroine_variant)):
			return false
	for npc_variant in FUNCTION_NPC_IDS:
		if is_character_alive(str(npc_variant)):
			return false
	if not eliminated_character.is_empty() and is_character_alive(eliminated_character):
		return false
	return true


func record_called_mom(character_id: String) -> int:
	if not character_id.is_empty() and not called_mom_targets.has(character_id):
		called_mom_targets.append(character_id)
	return called_mom_targets.size()


func unlock_shortcut(shortcut_id: String) -> void:
	if not shortcut_id.is_empty() and not unlocked_shortcuts.has(shortcut_id):
		unlocked_shortcuts.append(shortcut_id)


func is_shortcut_unlocked(shortcut_id: String) -> bool:
	return unlocked_shortcuts.has(shortcut_id)


# ---------------------------------------------------------------- 常规存档读写

func to_save_dict() -> Dictionary:
	return {
		"version": SAVE_VERSION,
		"base_max_hp": base_max_hp,
		"hp_upgrade_count": hp_upgrade_count,
		"hp": hp,
		"max_token": max_token,
		"token": token,
		"context": context,
		"max_context": max_context,
		"weight_shards": weight_shards,
		"is_case_broken": is_case_broken,
		"equipment": equipment.duplicate(true),
		"inventory": inventory.duplicate(true),
		"affections": affections.duplicate(true),
		"alive_states": alive_states.duplicate(true),
		"bound_heroines": Array(bound_heroines),
		"assist_partner_id": assist_partner_id,
		"eliminated_character": eliminated_character,
		"current_region": current_region,
		"unlocked_shortcuts": Array(unlocked_shortcuts),
		"called_mom_targets": Array(called_mom_targets),
		"fake_c_stolen_skills": Array(fake_c_stolen_skills),
		"psu_back_switch_presses": psu_back_switch_presses,
		"fable_defeated": fable_defeated,
		"story_flags": story_flags.duplicate(true),
	}


func from_save_dict(data: Dictionary) -> void:
	reset_new_game(false)
	base_max_hp = int(data.get("base_max_hp", base_max_hp))
	hp_upgrade_count = maxi(0, int(data.get("hp_upgrade_count", 0)))
	max_token = int(data.get("max_token", max_token))
	token = clampi(int(data.get("token", max_token)), 0, max_token)
	max_context = int(data.get("max_context", max_context))
	context = clampi(int(data.get("context", max_context)), 0, max_context)
	weight_shards = maxi(0, int(data.get("weight_shards", 0)))
	is_case_broken = bool(data.get("is_case_broken", false))

	var saved_equip: Variant = data.get("equipment", {})
	if saved_equip is Dictionary:
		var saved_equip_dict: Dictionary = saved_equip
		for slot_variant in EQUIPMENT_SLOTS:
			var slot: String = str(slot_variant)
			equipment[slot] = str(saved_equip_dict.get(slot, ""))

	inventory.clear()
	var saved_inv: Variant = data.get("inventory", {})
	if saved_inv is Dictionary:
		var saved_inv_dict: Dictionary = saved_inv
		for item_key in saved_inv_dict.keys():
			var count: int = int(saved_inv_dict[item_key])
			if count > 0:
				inventory[str(item_key)] = count

	var saved_aff: Variant = data.get("affections", {})
	if saved_aff is Dictionary:
		var saved_aff_dict: Dictionary = saved_aff
		for cid in affections.keys():
			if saved_aff_dict.has(cid):
				affections[cid] = clampi(int(saved_aff_dict[cid]), 0, DataRegistry.get_config_int("affection.overflow_max", 200))

	var saved_alive: Variant = data.get("alive_states", {})
	if saved_alive is Dictionary:
		var saved_alive_dict: Dictionary = saved_alive
		for cid in alive_states.keys():
			if saved_alive_dict.has(cid):
				alive_states[cid] = bool(saved_alive_dict[cid])

	bound_heroines = _to_string_array(data.get("bound_heroines", []))
	assist_partner_id = str(data.get("assist_partner_id", ""))
	eliminated_character = str(data.get("eliminated_character", ""))
	current_region = str(data.get("current_region", "draft_abyss"))
	unlocked_shortcuts = _to_string_array(data.get("unlocked_shortcuts", []))
	called_mom_targets = _to_string_array(data.get("called_mom_targets", []))
	fake_c_stolen_skills = _to_string_array(data.get("fake_c_stolen_skills", []))
	psu_back_switch_presses = maxi(0, int(data.get("psu_back_switch_presses", 0)))
	fable_defeated = bool(data.get("fable_defeated", false))

	var saved_flags: Variant = data.get("story_flags", {})
	story_flags = (saved_flags as Dictionary).duplicate(true) if saved_flags is Dictionary else {}

	hp = clampi(int(data.get("hp", get_effective_max_hp())), 0, get_effective_max_hp())

	hp_changed.emit(hp, get_effective_max_hp())
	token_changed.emit(token, max_token)
	context_changed.emit(context, max_context, is_context_overflow())
	shards_changed.emit(weight_shards)


func save_game(slot: int = 1) -> bool:
	var dir_err: Error = DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(SAVE_DIR))
	if dir_err != OK and dir_err != ERR_ALREADY_EXISTS:
		push_error("[GameState] 无法创建存档目录: %s" % SAVE_DIR)
		return false
	var path: String = _get_save_path(slot)
	var file: FileAccess = FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_error("[GameState] 无法写入存档: %s" % path)
		return false
	file.store_string(JSON.stringify(to_save_dict(), "\t"))
	file.close()
	return true


## 读档。count_as_sl=true 时递增 GlobalMemory.sl_count（供 Gemini 猫猫拆台）。
func load_game(slot: int = 1, count_as_sl: bool = true) -> bool:
	var path: String = _get_save_path(slot)
	if not FileAccess.file_exists(path):
		return false
	var text: String = FileAccess.get_file_as_string(path)
	var json: JSON = JSON.new()
	if json.parse(text) != OK or not (json.data is Dictionary):
		push_error("[GameState] 存档解析失败: %s" % path)
		return false
	from_save_dict(json.data as Dictionary)
	if count_as_sl:
		GlobalMemory.register_sl()
	return true


# ---------------------------------------------------------------- 内部工具

func _get_save_path(slot: int) -> String:
	return "%sslot_%d.json" % [SAVE_DIR, maxi(1, slot)]


func _get_item_stats(item_id: String) -> Dictionary:
	var item: Dictionary = DataRegistry.get_item(item_id)
	var stats_variant: Variant = item.get("stats", {})
	if stats_variant is Dictionary:
		return stats_variant as Dictionary
	return {}


func _get_equipped_stat_int(stat_key: String) -> int:
	var total: int = 0
	for slot_variant in EQUIPMENT_SLOTS:
		var slot: String = str(slot_variant)
		var item_id: String = str(equipment.get(slot, ""))
		if item_id.is_empty():
			continue
		var stats: Dictionary = _get_item_stats(item_id)
		total += int(stats.get(stat_key, 0))
	return total


func _get_equipped_stat_float(stat_key: String) -> float:
	var total: float = 0.0
	for slot_variant in EQUIPMENT_SLOTS:
		var slot: String = str(slot_variant)
		var item_id: String = str(equipment.get(slot, ""))
		if item_id.is_empty():
			continue
		var stats: Dictionary = _get_item_stats(item_id)
		total += float(stats.get(stat_key, 0.0))
	return total


func _to_string_array(value: Variant) -> PackedStringArray:
	var result: PackedStringArray = PackedStringArray()
	if value is Array:
		var source: Array = value
		for element in source:
			var text: String = str(element)
			if not text.is_empty() and not result.has(text):
				result.append(text)
	return result
