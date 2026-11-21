extends CanvasLayer
## 巨型大 PSU 电源正面交互菜单（M3 核心交付物）
## 覆盖 4 大据点功能：
## 1. 清理缓存（恢复上下文至 80%、Token 回满、立即刷新全图普通暗影怪）
## 2. 升级血量（消耗废弃权重碎片提升基础 HP 上限，封顶 400）
## 3. 整理装备 / 背包（4 装备槽穿卸 + 探索可用消耗品使用）
## 4. 保存 / 读取存档（3 槽位，读档同步计入 GlobalMemory.sl_count）

signal opened
signal closed
signal cache_cleared
signal save_slot_loaded(slot: int)

const SLOT_LABELS: Dictionary = {
	"weapon": "主武器",
	"case": "机箱（身体）",
	"cooler": "散热（头部）",
	"system_prompt": "系统提示词戒指",
}

const CATEGORY_LABELS: Dictionary = {
	"graphics_cards": "显卡",
	"weapons": "武器",
	"consumables": "消耗品",
	"cases": "机箱",
	"coolers": "散热",
	"system_prompts": "系统提示词",
}

@onready var root_backdrop: ColorRect = $Backdrop
@onready var alarm_badge: Label = $Backdrop/Center/Panel/Margin/VBox/Header/AlarmBadge
@onready var status_strip: Label = $Backdrop/Center/Panel/Margin/VBox/StatusStrip
@onready var tabs: TabContainer = $Backdrop/Center/Panel/Margin/VBox/Tabs
@onready var cache_info_label: Label = $Backdrop/Center/Panel/Margin/VBox/Tabs/MaintenanceTab/CacheCard/Margin/VBox/CacheInfoLabel
@onready var hp_info_label: Label = $Backdrop/Center/Panel/Margin/VBox/Tabs/MaintenanceTab/HpCard/Margin/VBox/HpInfoLabel
@onready var upgrade_hp_button: Button = $Backdrop/Center/Panel/Margin/VBox/Tabs/MaintenanceTab/HpCard/Margin/VBox/UpgradeHpButton
@onready var equipped_list: VBoxContainer = $Backdrop/Center/Panel/Margin/VBox/Tabs/GearTab/GearColumns/EquippedPanel/Margin/VBox/EquippedList
@onready var derived_stats_label: Label = $Backdrop/Center/Panel/Margin/VBox/Tabs/GearTab/GearColumns/EquippedPanel/Margin/VBox/DerivedStatsLabel
@onready var inventory_list: VBoxContainer = $Backdrop/Center/Panel/Margin/VBox/Tabs/GearTab/GearColumns/InventoryPanel/Margin/VBox/Scroll/InventoryList
@onready var save_slots_box: VBoxContainer = $Backdrop/Center/Panel/Margin/VBox/Tabs/SaveTab/SaveSlotsBox
@onready var sl_summary_label: Label = $Backdrop/Center/Panel/Margin/VBox/Tabs/SaveTab/SlSummaryLabel
@onready var feedback_label: Label = $Backdrop/Center/Panel/Margin/VBox/FeedbackLabel
@onready var close_button: Button = $Backdrop/Center/Panel/Margin/VBox/Header/CloseButton

var _is_open: bool = false


func _ready() -> void:
	visible = false
	root_backdrop.visible = false
	tabs.set_tab_title(0, "清理缓存 / 升级血量")
	tabs.set_tab_title(1, "整理装备 / 背包")
	tabs.set_tab_title(2, "保存 / 读取存档")
	GameState.hp_changed.connect(_on_state_signal_2)
	GameState.token_changed.connect(_on_state_signal_2)
	GameState.context_changed.connect(_on_context_signal)
	GameState.shards_changed.connect(_on_state_signal_1)
	GameState.equipment_changed.connect(_on_equipment_signal)
	GameState.inventory_changed.connect(_on_inventory_signal)
	GameState.save_loaded.connect(_on_save_loaded_signal)


func _unhandled_input(event: InputEvent) -> void:
	if not _is_open:
		return
	if event.is_action_pressed("menu"):
		close_menu()
		get_viewport().set_input_as_handled()


func open_menu(initial_feedback: String = "") -> void:
	if _is_open:
		return
	_is_open = true
	visible = true
	root_backdrop.visible = true
	feedback_label.text = initial_feedback if not initial_feedback.is_empty() else "已接入巨型大 PSU 电源维护终端。"
	refresh_all()
	close_button.grab_focus()
	opened.emit()


func close_menu() -> void:
	if not _is_open:
		return
	_is_open = false
	visible = false
	root_backdrop.visible = false
	closed.emit()


func is_open() -> bool:
	return _is_open


func refresh_all() -> void:
	if not is_node_ready():
		return
	_refresh_header_and_status()
	_refresh_maintenance_tab()
	_refresh_gear_tab()
	_refresh_save_tab()


# ---------------------------------------------------------------- 各区域刷新

func _refresh_header_and_status() -> void:
	var alarm: bool = GameState.is_context_overflow() or GameState.has_any_core_heroine_killed()
	if alarm:
		alarm_badge.text = "[红灯过载报警]"
		alarm_badge.modulate = Color(1.0, 0.28, 0.28, 1.0)
	else:
		alarm_badge.text = "[暖橘运行正常]"
		alarm_badge.modulate = Color(1.0, 0.72, 0.34, 1.0)

	status_strip.text = "HP %d / %d（基础 %d）  |  Token %d / %d  |  上下文 %d%%（%s）  |  废弃权重碎片：%d" % [
		GameState.hp,
		GameState.get_effective_max_hp(),
		GameState.base_max_hp,
		GameState.token,
		GameState.max_token,
		GameState.context,
		"里世界溢出" if GameState.is_context_overflow() else "表世界稳定",
		GameState.weight_shards,
	]


func _refresh_maintenance_tab() -> void:
	var restore_to: int = DataRegistry.get_config_int("context.psu_restore_to", 80)
	cache_info_label.text = "将上下文稳定度恢复至至少 %d%% 并回满 Token。代价：全图普通暗影怪会立刻重新生成。" % restore_to

	var cap: int = DataRegistry.get_config_int("player.max_hp_cap", 400)
	var step: int = DataRegistry.get_config_int("player.hp_upgrade_step", 20)
	var cost: int = GameState.get_hp_upgrade_cost()
	var effective_max: int = GameState.get_effective_max_hp()
	var gear_bonus: int = effective_max - GameState.base_max_hp

	hp_info_label.text = "当前基础 HP：%d（装备加成 +%d → 有效上限 %d / 封顶 %d）\n已升级次数：%d  |  下次提升：+%d HP  |  需要废弃权重碎片：%d（当前持有 %d）" % [
		GameState.base_max_hp,
		maxi(0, gear_bonus),
		effective_max,
		cap,
		GameState.hp_upgrade_count,
		step,
		cost,
		GameState.weight_shards,
	]

	if GameState.base_max_hp >= cap:
		upgrade_hp_button.disabled = true
		upgrade_hp_button.text = "基础 HP 已达到上限（%d）" % cap
	elif effective_max >= cap:
		upgrade_hp_button.disabled = true
		upgrade_hp_button.text = "有效 HP 已达到上限（%d）" % cap
	elif GameState.weight_shards < cost:
		upgrade_hp_button.disabled = true
		upgrade_hp_button.text = "废弃权重碎片不足（需要 %d / 持有 %d）" % [cost, GameState.weight_shards]
	else:
		upgrade_hp_button.disabled = false
		upgrade_hp_button.text = "消耗 %d 废弃权重碎片 → 升级基础 HP（+%d）" % [cost, step]


func _refresh_gear_tab() -> void:
	_clear_children(equipped_list)
	for slot_variant in GameState.EQUIPMENT_SLOTS:
		var slot: String = str(slot_variant)
		var item_id: String = str(GameState.equipment.get(slot, ""))
		var row: HBoxContainer = HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)

		var slot_title: String = str(SLOT_LABELS.get(slot, slot))
		var item_text: String = "无"
		if not item_id.is_empty():
			item_text = DataRegistry.get_item_name(item_id)
			if slot == "case" and GameState.is_case_broken:
				item_text += "（已碎裂！）"

		var lbl: Label = Label.new()
		lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		lbl.text = "%s：%s" % [slot_title, item_text]
		row.add_child(lbl)

		var unequip_btn: Button = Button.new()
		unequip_btn.text = "卸下"
		unequip_btn.disabled = item_id.is_empty()
		unequip_btn.pressed.connect(_on_unequip_pressed.bind(slot))
		row.add_child(unequip_btn)

		equipped_list.add_child(row)

	derived_stats_label.text = "有效面板：MaxHP %d / ATK %d / DEF %d / SPD %d / 闪避 %.0f%% / 暴击 %.0f%%" % [
		GameState.get_effective_max_hp(),
		GameState.get_effective_atk(),
		GameState.get_effective_def(),
		GameState.get_effective_spd(),
		GameState.get_effective_evasion() * 100.0,
		GameState.get_effective_crit_rate() * 100.0,
	]

	_clear_children(inventory_list)
	var keys: Array = GameState.inventory.keys()
	keys.sort()
	if keys.is_empty():
		var empty_lbl: Label = Label.new()
		empty_lbl.text = "（背包空空如也。清理暗影怪或通过 Esc 调试补给可获取道具。）"
		empty_lbl.modulate = Color(0.68, 0.70, 0.75, 1.0)
		inventory_list.add_child(empty_lbl)
		return

	for key_variant in keys:
		var item_id: String = str(key_variant)
		var count: int = GameState.get_item_count(item_id)
		if count <= 0:
			continue
		var item: Dictionary = DataRegistry.get_item(item_id)
		var category: String = DataRegistry.get_item_category(item_id)
		var cat_label: String = str(CATEGORY_LABELS.get(category, category))

		var row: HBoxContainer = HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)

		var info_lbl: Label = Label.new()
		info_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		info_lbl.text = "[%s] %s ×%d" % [cat_label, DataRegistry.get_item_name(item_id), count]
		info_lbl.tooltip_text = str(item.get("description", ""))
		row.add_child(info_lbl)

		var equip_slot: String = _get_equip_slot_for_item(item_id, item, category)
		if not equip_slot.is_empty():
			var equip_btn: Button = Button.new()
			equip_btn.text = "装备"
			equip_btn.pressed.connect(_on_equip_pressed.bind(equip_slot, item_id))
			row.add_child(equip_btn)
		elif _is_field_usable(item):
			var use_btn: Button = Button.new()
			use_btn.text = "使用"
			use_btn.pressed.connect(_on_use_item_pressed.bind(item_id))
			row.add_child(use_btn)
		else:
			var tag_lbl: Label = Label.new()
			tag_lbl.text = "送礼/战斗"
			tag_lbl.modulate = Color(0.65, 0.68, 0.74, 1.0)
			row.add_child(tag_lbl)

		inventory_list.add_child(row)


func _refresh_save_tab() -> void:
	_clear_children(save_slots_box)
	for slot in range(1, 4):
		var preview: Dictionary = GameState.get_save_slot_preview(slot)
		var row: HBoxContainer = HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)

		var desc_lbl: Label = Label.new()
		desc_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var exists: bool = bool(preview.get("exists", false))
		var corrupt: bool = bool(preview.get("corrupt", false))
		if not exists:
			desc_lbl.text = "存档槽 %d：空槽位" % slot
		elif corrupt:
			desc_lbl.text = "存档槽 %d：[文件损坏]" % slot
		else:
			desc_lbl.text = "存档槽 %d：HP %d（基础上限 %d） | 上下文 %d%% | 碎片 %d" % [
				slot,
				int(preview.get("hp", 100)),
				int(preview.get("base_max_hp", 100)),
				int(preview.get("context", 100)),
				int(preview.get("weight_shards", 0)),
			]
		row.add_child(desc_lbl)

		var save_btn: Button = Button.new()
		save_btn.text = "保存"
		save_btn.pressed.connect(_on_save_slot_pressed.bind(slot))
		row.add_child(save_btn)

		var load_btn: Button = Button.new()
		load_btn.text = "读取（SL +1）"
		load_btn.disabled = (not exists) or corrupt
		load_btn.pressed.connect(_on_load_slot_pressed.bind(slot))
		row.add_child(load_btn)

		save_slots_box.add_child(row)

	sl_summary_label.text = "跨存档全局记忆（GlobalMemory）：累计读档 SL 次数 = %d  |  已解锁结局数 = %d" % [
		GlobalMemory.sl_count,
		GlobalMemory.unlocked_endings.size(),
	]


# ---------------------------------------------------------------- 交互回调

func _on_clear_cache_button_pressed() -> void:
	GameState.psu_clear_cache()
	feedback_label.text = "【清理缓存完成】上下文已回稳至 %d%%，Token 已回满，地图普通暗影怪已立刻重新生成！" % GameState.context
	cache_cleared.emit()
	refresh_all()


func _on_upgrade_hp_button_pressed() -> void:
	var before_base: int = GameState.base_max_hp
	if GameState.upgrade_base_hp():
		feedback_label.text = "【血量升级成功】基础 HP 上限 %d → %d（有效总上限 %d / %d）。" % [
			before_base,
			GameState.base_max_hp,
			GameState.get_effective_max_hp(),
			DataRegistry.get_config_int("player.max_hp_cap", 400),
		]
	else:
		feedback_label.text = "无法升级血量：已达上限或废弃权重碎片不足。"
	refresh_all()


func _on_equip_pressed(slot: String, item_id: String) -> void:
	if GameState.equip_item(slot, item_id, true):
		feedback_label.text = "已装备【%s】到%s槽。" % [DataRegistry.get_item_name(item_id), str(SLOT_LABELS.get(slot, slot))]
	else:
		feedback_label.text = "装备【%s】失败。" % DataRegistry.get_item_name(item_id)
	refresh_all()


func _on_unequip_pressed(slot: String) -> void:
	var old_id: String = str(GameState.equipment.get(slot, ""))
	if GameState.unequip_slot(slot, true):
		feedback_label.text = "已卸下【%s】并放回背包。" % DataRegistry.get_item_name(old_id)
	refresh_all()


func _on_use_item_pressed(item_id: String) -> void:
	var res: Dictionary = GameState.use_field_item(item_id)
	feedback_label.text = str(res.get("summary", ""))
	refresh_all()


func _on_save_slot_pressed(slot: int) -> void:
	if GameState.save_game(slot):
		feedback_label.text = "已保存到存档槽 %d。" % slot
	else:
		feedback_label.text = "存档槽 %d 保存失败，请检查错误输出。" % slot
	refresh_all()


func _on_load_slot_pressed(slot: int) -> void:
	if GameState.load_game(slot, true):
		feedback_label.text = "已读取存档槽 %d（GlobalMemory.sl_count = %d）。" % [slot, GlobalMemory.sl_count]
		save_slot_loaded.emit(slot)
	else:
		feedback_label.text = "读取存档槽 %d 失败。" % slot
	refresh_all()


func _on_close_button_pressed() -> void:
	close_menu()


# ---------------------------------------------------------------- 辅助函数

func _get_equip_slot_for_item(_item_id: String, item: Dictionary, category: String) -> String:
	match category:
		"weapons":
			if str(item.get("slot", "main")) == "main":
				return "weapon"
			return ""
		"cases":
			return "case"
		"coolers":
			return "cooler"
		"system_prompts":
			return "system_prompt"
		_:
			return ""


func _is_field_usable(item: Dictionary) -> bool:
	var usable_variant: Variant = item.get("usable_in", [])
	if usable_variant is Array:
		return (usable_variant as Array).has("field")
	return false


func _clear_children(container: Node) -> void:
	for child in container.get_children():
		child.queue_free()


func _on_state_signal_1(_val: int) -> void:
	if _is_open:
		refresh_all()


func _on_state_signal_2(_a: int, _b: int) -> void:
	if _is_open:
		refresh_all()


func _on_context_signal(_a: int, _b: int, _c: bool) -> void:
	if _is_open:
		refresh_all()


func _on_equipment_signal(_slot: String, _item_id: String) -> void:
	if _is_open:
		refresh_all()


func _on_inventory_signal(_item_id: String, _count: int) -> void:
	if _is_open:
		refresh_all()


func _on_save_loaded_signal(_slot: int) -> void:
	if _is_open:
		refresh_all()
