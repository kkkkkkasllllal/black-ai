extends Control
## M1 启动与骨架自检场景
## 用于打开 Godot 4 后立即验证 Autoload 单例、JSON 数据表与核心状态读写链路。

const EXPLORE_PROTOTYPE_SCENE: String = "res://scenes/world/ExplorePrototype.tscn"

@onready var summary_label: RichTextLabel = $Margin/VBox/SummaryLabel
@onready var log_label: RichTextLabel = $Margin/VBox/LogLabel
@onready var enter_explore_button: Button = $Margin/VBox/Buttons/EnterExploreButton


func _ready() -> void:
	_refresh_summary()
	enter_explore_button.grab_focus()
	_append_log("自检就绪。点击「进入探索与战斗原型（M2–M6）」（或按 Enter）开始试玩。")


func _refresh_summary() -> void:
	var data_info: Dictionary = DataRegistry.get_summary()
	var sections_variant: Variant = data_info.get("items_by_section", {})
	var sections: Dictionary = sections_variant if sections_variant is Dictionary else {}
	var lines: PackedStringArray = PackedStringArray([
		"[b]《BLACK AI》M1 工程骨架自检面板[/b]",
		"DataRegistry 状态：%s（错误 %d）" % ["OK" if DataRegistry.is_loaded else "ERROR", int(data_info.get("errors", 0))],
		"  · 物品总数：%d（显卡 %d / 武器 %d / 消耗品 %d / 机箱 %d / 散热 %d / 提示词 %d）" % [
			int(data_info.get("items_total", 0)),
			int(sections.get("graphics_cards", 0)),
			int(sections.get("weapons", 0)),
			int(sections.get("consumables", 0)),
			int(sections.get("cases", 0)),
			int(sections.get("coolers", 0)),
			int(sections.get("system_prompts", 0)),
		],
		"  · 角色：核心 AI 娘 %d / 淘汰候选 %d / 功能 NPC %d | 怪物：%d | 结局：%d" % [
			int(data_info.get("core_heroines", 0)),
			int(data_info.get("eliminees", 0)),
			int(data_info.get("function_npcs", 0)),
			int(data_info.get("monsters", 0)),
			int(data_info.get("endings", 0)),
		],
		"",
		"[b]GameState 运行时[/b]",
		"  · HP：%d / %d | Token：%d / %d | 上下文：%d / %d（%s）| 碎片：%d" % [
			GameState.hp,
			GameState.get_effective_max_hp(),
			GameState.token,
			GameState.max_token,
			GameState.context,
			GameState.max_context,
			"里世界溢出" if GameState.is_context_overflow() else "表世界稳定",
			GameState.weight_shards,
		],
		"  · 装备：武器=%s | 机箱=%s | 散热=%s | 提示词=%s" % [
			_slot_text("weapon"),
			_slot_text("case"),
			_slot_text("cooler"),
			_slot_text("system_prompt"),
		],
		"  · 有效面板：ATK %d / DEF %d / SPD %d / 闪避 %.0f%% / 暴击 %.0f%%" % [
			GameState.get_effective_atk(),
			GameState.get_effective_def(),
			GameState.get_effective_spd(),
			GameState.get_effective_evasion() * 100.0,
			GameState.get_effective_crit_rate() * 100.0,
		],
		"",
		"[b]GlobalMemory 持久化记忆[/b]（%s）" % GlobalMemory.get_absolute_path(),
		"  · 周目：%d | 开局第一名：%s | SL 次数：%d | 过往击杀：%s | 已解锁结局：%s | 主菜单形态：%s" % [
			GlobalMemory.cycle_count,
			GlobalMemory.first_vote if not GlobalMemory.first_vote.is_empty() else "未投票",
			GlobalMemory.sl_count,
			", ".join(GlobalMemory.killed_in_past_saves) if not GlobalMemory.killed_in_past_saves.is_empty() else "无",
			", ".join(GlobalMemory.unlocked_endings) if not GlobalMemory.unlocked_endings.is_empty() else "无",
			GlobalMemory.get_main_menu_variant(),
		],
	])
	summary_label.text = "\n".join(lines)


func _slot_text(slot: String) -> String:
	var item_id: String = str(GameState.equipment.get(slot, ""))
	if item_id.is_empty():
		return "无"
	return DataRegistry.get_item_name(item_id)


func _append_log(message: String) -> void:
	log_label.append_text(message + "\n")


func _on_enter_explore_button_pressed() -> void:
	var err: Error = get_tree().change_scene_to_file(EXPLORE_PROTOTYPE_SCENE)
	if err != OK:
		_append_log("[场景切换] 无法加载 %s（错误码 %d）" % [EXPLORE_PROTOTYPE_SCENE, err])


func _on_test_gpu_button_pressed() -> void:
	GameState.add_item("gpu_580", 2)
	# 从足够承受扣减的测试好感度开始，避免 0 的下限掩盖拒收惩罚。
	var gemini_before: int = GameState.add_affection("gemini_cat", 10 - GameState.get_affection("gemini_cat"))
	var r1: Dictionary = GameState.gift_graphics_card("fake_c", "gpu_580", false, true)
	var r2: Dictionary = GameState.gift_graphics_card("gemini_cat", "gpu_580", true, true)
	_append_log("[显卡测试] 假小 C 收 580 -> 好感 %d（%+d）；Gemini 猫猫拒收后强送 -> 好感 %d → %d（%+d）" % [
		int(r1.get("new_value", 0)),
		int(r1.get("delta", 0)),
		gemini_before,
		int(r2.get("new_value", 0)),
		int(r2.get("delta", 0)),
	])
	_refresh_summary()


func _on_test_context_button_pressed() -> void:
	if GameState.is_context_overflow():
		GameState.psu_clear_cache()
		_append_log("[PSU 清理缓存] 上下文已回稳至 %d%%，发出刷新暗影怪信号。" % GameState.context)
	else:
		GameState.set_context(15)
		_append_log("[上下文污染] 上下文降至 %d%% -> 已进入里世界溢出状态！" % GameState.context)
	_refresh_summary()


func _on_test_sl_button_pressed() -> void:
	if not GameState.save_game(1) or not GameState.load_game(1, true):
		_append_log("[SL 测试] 存档或读档失败，请查看 Godot 错误输出。")
		return
	_append_log("[SL 测试] 存档并读档 1 次，GlobalMemory.sl_count = %d。" % GlobalMemory.sl_count)
	_refresh_summary()
