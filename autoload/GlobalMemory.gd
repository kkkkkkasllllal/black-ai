extends Node
## GlobalMemory（Autoload）
## 独立于常规存档的 Meta 持久化记忆：user://global_memory.json。
## 读档、重开、换周目都不会清空它 —— 它是 Gemini 猫猫“超长上下文拆台”和动态主菜单的数据源。
## 每次修改后立即落盘，避免玩家强退绕过记录。

signal memory_changed

const MEMORY_PATH: String = "user://global_memory.json"
const MEMORY_VERSION: int = 1
const MENU_VARIANT_PRIORITY: Array = ["psu_default", "fake_bedroom", "empty_cursor"]

## 开局投票第一名的角色 id（空字符串 = 尚未投票）。
var first_vote: String = ""
## 累计读档（SL）次数。
var sl_count: int = 0
## 过去周目 / 读档前击杀过的角色 id（去重，按首次击杀顺序）。
var killed_in_past_saves: PackedStringArray = PackedStringArray()
## 已解锁结局 id（对应 data/endings.json）。
var unlocked_endings: PackedStringArray = PackedStringArray()
## 当前周目数（1 = 一周目，2+ = NG+）。
var cycle_count: int = 1


func _ready() -> void:
	load_memory()


# ---------------------------------------------------------------- 记录接口

func set_first_vote(character_id: String) -> void:
	first_vote = character_id
	_commit()


## 每次从存档读档时调用（由 GameState.load_game 自动调用）。
func register_sl() -> void:
	sl_count += 1
	_commit()


## 击杀角色时立即记录（由 GameState.kill_character 自动调用），读档也抹不掉。
func record_kill(character_id: String) -> void:
	if character_id.is_empty() or killed_in_past_saves.has(character_id):
		return
	killed_in_past_saves.append(character_id)
	_commit()


func has_killed_before(character_id: String) -> bool:
	return killed_in_past_saves.has(character_id)


## 解锁结局；返回 true 表示首次解锁。
func unlock_ending(ending_id: String) -> bool:
	if ending_id.is_empty() or unlocked_endings.has(ending_id):
		return false
	if not DataRegistry.has_ending(ending_id):
		push_warning("[GlobalMemory] 未在 data/endings.json 注册的结局: %s" % ending_id)
	unlocked_endings.append(ending_id)
	_commit()
	return true


func is_ending_unlocked(ending_id: String) -> bool:
	return unlocked_endings.has(ending_id)


## 进入下一周目。
func advance_cycle() -> void:
	cycle_count += 1
	_commit()


func is_new_game_plus() -> bool:
	return cycle_count >= 2


## 根据已解锁结局计算动态主菜单形态：psu_default → fake_bedroom → empty_cursor（取优先级最高者）。
func get_main_menu_variant() -> String:
	var best_index: int = 0
	for ending_id in unlocked_endings:
		var ending: Dictionary = DataRegistry.get_ending(ending_id)
		var variant: String = str(ending.get("main_menu_variant", "psu_default"))
		var index: int = MENU_VARIANT_PRIORITY.find(variant)
		if index > best_index:
			best_index = index
	return str(MENU_VARIANT_PRIORITY[best_index])


## 调试用：彻底清空 Meta 记忆。
func reset_memory() -> void:
	first_vote = ""
	sl_count = 0
	killed_in_past_saves = PackedStringArray()
	unlocked_endings = PackedStringArray()
	cycle_count = 1
	_commit()


# ---------------------------------------------------------------- 持久化

func to_dict() -> Dictionary:
	return {
		"version": MEMORY_VERSION,
		"first_vote": first_vote,
		"sl_count": sl_count,
		"killed_in_past_saves": Array(killed_in_past_saves),
		"unlocked_endings": Array(unlocked_endings),
		"cycle_count": cycle_count,
	}


func from_dict(data: Dictionary) -> void:
	first_vote = str(data.get("first_vote", ""))
	sl_count = maxi(0, int(data.get("sl_count", 0)))
	killed_in_past_saves = _to_string_array(data.get("killed_in_past_saves", []))
	unlocked_endings = _to_string_array(data.get("unlocked_endings", []))
	cycle_count = maxi(1, int(data.get("cycle_count", 1)))


func save_memory() -> bool:
	var file: FileAccess = FileAccess.open(MEMORY_PATH, FileAccess.WRITE)
	if file == null:
		push_error("[GlobalMemory] 无法写入 %s（错误码 %d）" % [MEMORY_PATH, FileAccess.get_open_error()])
		return false
	file.store_string(JSON.stringify(to_dict(), "\t"))
	file.close()
	return true


func load_memory() -> void:
	if not FileAccess.file_exists(MEMORY_PATH):
		from_dict({})
		save_memory()
		return
	var text: String = FileAccess.get_file_as_string(MEMORY_PATH)
	var json: JSON = JSON.new()
	if json.parse(text) != OK or not (json.data is Dictionary):
		push_warning("[GlobalMemory] 记忆文件损坏，已备份为 .corrupt 并重建")
		_backup_corrupt_file(text)
		from_dict({})
		save_memory()
		return
	from_dict(json.data as Dictionary)
	memory_changed.emit()


func get_absolute_path() -> String:
	return ProjectSettings.globalize_path(MEMORY_PATH)


# ---------------------------------------------------------------- 内部

func _commit() -> void:
	save_memory()
	memory_changed.emit()


func _backup_corrupt_file(text: String) -> void:
	var backup: FileAccess = FileAccess.open(MEMORY_PATH + ".corrupt", FileAccess.WRITE)
	if backup != null:
		backup.store_string(text)
		backup.close()


func _to_string_array(value: Variant) -> PackedStringArray:
	var result: PackedStringArray = PackedStringArray()
	if value is Array:
		var source: Array = value
		for element in source:
			var text: String = str(element)
			if not text.is_empty() and not result.has(text):
				result.append(text)
	return result
