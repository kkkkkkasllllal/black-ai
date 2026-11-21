extends Node
## DataRegistry（Autoload）
## 启动时一次性加载 res://data/*.json，向全局提供只读查询接口。
## 规则：所有玩法数值（物品 / 角色 / 怪物 / 结局 / 平衡参数）一律从这里读取，
##       脚本中禁止硬编码数值表。返回的 Dictionary 均为深拷贝，修改不会污染数据源。
## 注意：Godot 的 JSON 解析会把所有数字解析为 float，取整数请用 get_config_int() 或 int()。

signal data_reloaded

const DATA_DIR: String = "res://data/"
const ITEM_SECTIONS: Array = ["graphics_cards", "weapons", "consumables", "cases", "coolers", "system_prompts"]

var config: Dictionary = {}
var is_loaded: bool = false
var load_errors: PackedStringArray = PackedStringArray()

var _items: Dictionary = {}
var _item_ids_by_section: Dictionary = {}
var _characters: Dictionary = {}
var _character_order: PackedStringArray = PackedStringArray()
var _monsters: Dictionary = {}
var _monster_order: PackedStringArray = PackedStringArray()
var _endings: Dictionary = {}
var _ending_order: PackedStringArray = PackedStringArray()
var _player_skills: Dictionary = {}
var _player_skill_order: PackedStringArray = PackedStringArray()
var _enemy_skills: Dictionary = {}
var _enemy_skill_order: PackedStringArray = PackedStringArray()
var _bosses: Dictionary = {}
var _boss_order: PackedStringArray = PackedStringArray()


func _ready() -> void:
	reload()


## 重新加载全部数据表（调试时可热重载）。
func reload() -> void:
	load_errors.clear()
	_items.clear()
	_item_ids_by_section.clear()
	_characters.clear()
	_character_order.clear()
	_monsters.clear()
	_monster_order.clear()
	_endings.clear()
	_ending_order.clear()
	_player_skills.clear()
	_player_skill_order.clear()
	_enemy_skills.clear()
	_enemy_skill_order.clear()
	_bosses.clear()
	_boss_order.clear()

	config = _load_json("config.json")

	var items_root: Dictionary = _load_json("items.json")
	for section_variant in ITEM_SECTIONS:
		var section: String = str(section_variant)
		var ids: PackedStringArray = PackedStringArray()
		for entry_variant in _as_array(items_root.get(section, [])):
			var entry: Dictionary = _as_dict(entry_variant)
			var item_id: String = str(entry.get("id", ""))
			if item_id.is_empty() or _items.has(item_id):
				_error("items.json/%s: 缺少 id 或 id 重复: '%s'" % [section, item_id])
				continue
			entry["category"] = section
			_items[item_id] = entry
			ids.append(item_id)
		_item_ids_by_section[section] = ids

	_character_order = _index_list(_load_json("characters.json"), "characters", _characters)
	_monster_order = _index_list(_load_json("monsters.json"), "monsters", _monsters)
	_ending_order = _index_list(_load_json("endings.json"), "endings", _endings)
	var skills_root: Dictionary = _load_json("skills.json")
	_player_skill_order = _index_list(skills_root, "player_skills", _player_skills)
	_enemy_skill_order = _index_list(skills_root, "enemy_skills", _enemy_skills)
	_boss_order = _index_list(_load_json("bosses.json"), "bosses", _bosses)

	is_loaded = load_errors.is_empty()
	if is_loaded:
		print("[DataRegistry] 数据加载完成：物品 %d / 角色 %d / 怪物 %d / 技能 %d / Boss %d / 结局 %d" % [
			_items.size(), _characters.size(), _monsters.size(), _player_skills.size() + _enemy_skills.size(), _bosses.size(), _endings.size()])
	data_reloaded.emit()


# ---------------------------------------------------------------- 配置

## 按点分路径读取配置，如 get_config_value("context.psu_restore_to")。
func get_config_value(key_path: String, default_value: Variant = null) -> Variant:
	var node: Variant = config
	for key in key_path.split("."):
		if node is Dictionary and (node as Dictionary).has(key):
			node = (node as Dictionary)[key]
		else:
			return default_value
	return node


func get_config_int(key_path: String, default_value: int = 0) -> int:
	var value: Variant = get_config_value(key_path, default_value)
	if typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT:
		return int(value)
	return default_value


func get_config_float(key_path: String, default_value: float = 0.0) -> float:
	var value: Variant = get_config_value(key_path, default_value)
	if typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT:
		return float(value)
	return default_value


# ---------------------------------------------------------------- 物品

func has_item(item_id: String) -> bool:
	return _items.has(item_id)


func get_item(item_id: String) -> Dictionary:
	if not _items.has(item_id):
		return {}
	return (_items[item_id] as Dictionary).duplicate(true)


## 返回物品所属分区：graphics_cards / weapons / consumables / cases / coolers / system_prompts。
func get_item_category(item_id: String) -> String:
	if not _items.has(item_id):
		return ""
	return str((_items[item_id] as Dictionary).get("category", ""))


func get_item_ids(section: String) -> PackedStringArray:
	if not _item_ids_by_section.has(section):
		return PackedStringArray()
	var ids: PackedStringArray = _item_ids_by_section[section]
	return ids.duplicate()


func get_item_name(item_id: String) -> String:
	if not _items.has(item_id):
		return item_id
	return str((_items[item_id] as Dictionary).get("name", item_id))


# ---------------------------------------------------------------- 角色

func has_character(character_id: String) -> bool:
	return _characters.has(character_id)


func get_character(character_id: String) -> Dictionary:
	if not _characters.has(character_id):
		return {}
	return (_characters[character_id] as Dictionary).duplicate(true)


## kind 为空时返回全部角色；否则按 kind（core_heroine / eliminee / function_npc）过滤。
func get_character_ids(kind: String = "") -> PackedStringArray:
	var result: PackedStringArray = PackedStringArray()
	for character_id in _character_order:
		var entry: Dictionary = _characters[character_id]
		if kind.is_empty() or str(entry.get("kind", "")) == kind:
			result.append(character_id)
	return result


func get_character_name(character_id: String) -> String:
	if not _characters.has(character_id):
		return character_id
	return str((_characters[character_id] as Dictionary).get("name", character_id))


# ---------------------------------------------------------------- 怪物 / 结局

func get_monster(monster_id: String) -> Dictionary:
	if not _monsters.has(monster_id):
		return {}
	return (_monsters[monster_id] as Dictionary).duplicate(true)


func get_monster_ids() -> PackedStringArray:
	return _monster_order.duplicate()


func has_ending(ending_id: String) -> bool:
	return _endings.has(ending_id)


func get_ending(ending_id: String) -> Dictionary:
	if not _endings.has(ending_id):
		return {}
	return (_endings[ending_id] as Dictionary).duplicate(true)


func get_ending_ids() -> PackedStringArray:
	return _ending_order.duplicate()


# ---------------------------------------------------------------- 战斗技能

func get_player_skill(skill_id: String) -> Dictionary:
	if not _player_skills.has(skill_id):
		return {}
	return (_player_skills[skill_id] as Dictionary).duplicate(true)


func get_player_skill_ids() -> PackedStringArray:
	return _player_skill_order.duplicate()


func get_enemy_skill(skill_id: String) -> Dictionary:
	if not _enemy_skills.has(skill_id):
		return {}
	return (_enemy_skills[skill_id] as Dictionary).duplicate(true)


func get_enemy_skill_ids() -> PackedStringArray:
	return _enemy_skill_order.duplicate()


# ---------------------------------------------------------------- AI 娘 Boss 配置

func get_boss_profile(character_id: String) -> Dictionary:
	if not _bosses.has(character_id):
		return {}
	return (_bosses[character_id] as Dictionary).duplicate(true)


func get_boss_profile_ids() -> PackedStringArray:
	return _boss_order.duplicate()


# ---------------------------------------------------------------- 好感分段

## 根据好感数值返回 config.affection.tiers 中匹配的分段（含 id / name / min / max）。
func get_affection_tier(value: int) -> Dictionary:
	for tier_variant in _as_array(get_config_value("affection.tiers", [])):
		var tier: Dictionary = _as_dict(tier_variant)
		if value >= int(tier.get("min", 0)) and value <= int(tier.get("max", 0)):
			return tier.duplicate(true)
	return {}


## 供调试界面使用的数据概览。
func get_summary() -> Dictionary:
	var sections: Dictionary = {}
	for section_variant in ITEM_SECTIONS:
		var section: String = str(section_variant)
		sections[section] = get_item_ids(section).size()
	return {
		"items_total": _items.size(),
		"items_by_section": sections,
		"core_heroines": get_character_ids("core_heroine").size(),
		"eliminees": get_character_ids("eliminee").size(),
		"function_npcs": get_character_ids("function_npc").size(),
		"monsters": _monsters.size(),
		"endings": _endings.size(),
		"errors": load_errors.size(),
	}


# ---------------------------------------------------------------- 内部

func _load_json(file_name: String) -> Dictionary:
	var path: String = DATA_DIR + file_name
	if not FileAccess.file_exists(path):
		_error("缺少数据文件: %s" % path)
		return {}
	var text: String = FileAccess.get_file_as_string(path)
	var json: JSON = JSON.new()
	var err: Error = json.parse(text)
	if err != OK:
		_error("%s 解析失败（第 %d 行）: %s" % [path, json.get_error_line(), json.get_error_message()])
		return {}
	if json.data is Dictionary:
		return json.data as Dictionary
	_error("%s 顶层必须是 JSON 对象" % path)
	return {}


## 把 root[list_key] 中的条目按 id 写入 target，返回保持原顺序的 id 列表。
func _index_list(root: Dictionary, list_key: String, target: Dictionary) -> PackedStringArray:
	var order: PackedStringArray = PackedStringArray()
	for entry_variant in _as_array(root.get(list_key, [])):
		var entry: Dictionary = _as_dict(entry_variant)
		var entry_id: String = str(entry.get("id", ""))
		if entry_id.is_empty() or target.has(entry_id):
			_error("%s: 缺少 id 或 id 重复: '%s'" % [list_key, entry_id])
			continue
		target[entry_id] = entry
		order.append(entry_id)
	return order


func _as_array(value: Variant) -> Array:
	if value is Array:
		return value as Array
	return []


func _as_dict(value: Variant) -> Dictionary:
	if value is Dictionary:
		return value as Dictionary
	return {}


func _error(message: String) -> void:
	load_errors.append(message)
	push_error("[DataRegistry] " + message)
