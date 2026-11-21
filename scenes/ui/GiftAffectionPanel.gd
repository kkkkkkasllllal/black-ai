extends CanvasLayer
## M4 送礼 UI + 全员好感度面板（0–100% 常规满好感 / 101–200% 偏执溢出态）
## 严格通过 DataRegistry + GameState.gift_graphics_card() 执行 6 档显卡规则：
## - 580 矿卡仅 DeepSeek 三姐妹接收（大/小肥鱼 +8，假小 C +12），其余拒收并弹出二次确认（可强送 -5）
## - 10600 / 20600 / 50900 / 华为显卡三姐妹享高加成
## - 600900 显卡直接拉满 100%，若已满 100% 则直接冲至 200%（偏执溢出态）

signal opened
signal closed(last_reaction_section: String, target_character_id: String)

@onready var backdrop: ColorRect = $Backdrop
@onready var tabs: TabContainer = $Backdrop/Center/Panel/Margin/VBox/Tabs
@onready var close_button: Button = $Backdrop/Center/Panel/Margin/VBox/Header/CloseButton
@onready var target_selector_row: HBoxContainer = $Backdrop/Center/Panel/Margin/VBox/Tabs/GiftTab/TargetSelectorRow
@onready var target_swatch: ColorRect = $Backdrop/Center/Panel/Margin/VBox/Tabs/GiftTab/TargetSummary/Margin/HBox/TargetSwatch
@onready var target_info_label: Label = $Backdrop/Center/Panel/Margin/VBox/Tabs/GiftTab/TargetSummary/Margin/HBox/InfoCol/TargetInfoLabel
@onready var target_affinity_label: Label = $Backdrop/Center/Panel/Margin/VBox/Tabs/GiftTab/TargetSummary/Margin/HBox/InfoCol/TargetAffinityLabel
@onready var target_bar_normal: ProgressBar = $Backdrop/Center/Panel/Margin/VBox/Tabs/GiftTab/TargetSummary/Margin/HBox/InfoCol/BarsRow/NormalBar
@onready var target_bar_overflow: ProgressBar = $Backdrop/Center/Panel/Margin/VBox/Tabs/GiftTab/TargetSummary/Margin/HBox/InfoCol/BarsRow/OverflowBar
@onready var gpu_list_box: VBoxContainer = $Backdrop/Center/Panel/Margin/VBox/Tabs/GiftTab/GpuScroll/GpuListBox
@onready var affection_legend_label: Label = $Backdrop/Center/Panel/Margin/VBox/Tabs/AffectionTab/Legend
@onready var affection_list_box: VBoxContainer = $Backdrop/Center/Panel/Margin/VBox/Tabs/AffectionTab/AffectionScroll/AffectionListBox
@onready var feedback_label: Label = $Backdrop/Center/Panel/Margin/VBox/FeedbackLabel
@onready var reject_overlay: ColorRect = $RejectOverlay
@onready var reject_text_label: Label = $RejectOverlay/Center/RejectPanel/Margin/VBox/RejectText
@onready var reject_force_button: Button = $RejectOverlay/Center/RejectPanel/Margin/VBox/Buttons/ForceGiftButton
@onready var reject_cancel_button: Button = $RejectOverlay/Center/RejectPanel/Margin/VBox/Buttons/CancelGiftButton

var _is_open: bool = false
var _target_character_id: String = "big_fish"
var _locked_to_dialogue: bool = false
var _pending_reject_gpu_id: String = ""
var _last_reaction_section: String = ""


func _ready() -> void:
	visible = false
	backdrop.visible = false
	reject_overlay.visible = false
	tabs.set_tab_title(0, "赠送 6 档显卡")
	tabs.set_tab_title(1, "全员好感度面板（0–200%）")
	GameState.affection_changed.connect(_on_affection_changed)
	GameState.inventory_changed.connect(_on_inventory_changed)
	GameState.save_loaded.connect(_on_save_loaded)


func _unhandled_input(event: InputEvent) -> void:
	if not _is_open:
		return
	if event.is_action_pressed("menu"):
		if reject_overlay.visible:
			_close_reject_popup(false)
		else:
			close_panel()
		get_viewport().set_input_as_handled()


## 从角色对话进入送礼界面（锁定当前角色，关闭后返回对话并播放反应）。
func open_for_gift(character_id: String) -> void:
	_target_character_id = character_id if GameState.is_core_heroine(character_id) else "big_fish"
	_locked_to_dialogue = true
	_last_reaction_section = ""
	_pending_reject_gpu_id = ""
	_is_open = true
	visible = true
	backdrop.visible = true
	reject_overlay.visible = false
	tabs.current_tab = 0
	feedback_label.text = "选择要赠送给【%s】的显卡。" % DataRegistry.get_character_name(_target_character_id)
	refresh_all()
	close_button.grab_focus()
	opened.emit()


## 独立打开全员好感度总览面板（例如按 Tab 或暂停菜单入口）。
func open_affection_overview(initial_character_id: String = "") -> void:
	if not initial_character_id.is_empty() and GameState.is_core_heroine(initial_character_id):
		_target_character_id = initial_character_id
	_locked_to_dialogue = false
	_last_reaction_section = ""
	_pending_reject_gpu_id = ""
	_is_open = true
	visible = true
	backdrop.visible = true
	reject_overlay.visible = false
	tabs.current_tab = 1
	feedback_label.text = "常规满好感为 100%，继续投喂或赠送 600900 可突破至 200%（偏执溢出态）。"
	refresh_all()
	close_button.grab_focus()
	opened.emit()


func close_panel() -> void:
	if not _is_open:
		return
	var reaction: String = _last_reaction_section
	var target_id: String = _target_character_id
	_is_open = false
	visible = false
	backdrop.visible = false
	reject_overlay.visible = false
	_pending_reject_gpu_id = ""
	closed.emit(reaction, target_id)


func is_open() -> bool:
	return _is_open


func refresh_all() -> void:
	if not is_node_ready():
		return
	_refresh_target_selector()
	_refresh_gift_tab()
	_refresh_affection_tab()


# ---------------------------------------------------------------- Tab 0: 6 档显卡送礼

func _refresh_target_selector() -> void:
	_clear_children(target_selector_row)
	target_selector_row.visible = not _locked_to_dialogue
	if _locked_to_dialogue:
		return
	for heroine_variant in GameState.CORE_HEROINE_IDS:
		var cid: String = str(heroine_variant)
		var btn: Button = Button.new()
		btn.text = DataRegistry.get_character_name(cid)
		btn.disabled = (cid == _target_character_id) or not GameState.is_character_alive(cid)
		btn.pressed.connect(_on_select_target_heroine.bind(cid))
		target_selector_row.add_child(btn)


func _refresh_gift_tab() -> void:
	var ch: Dictionary = DataRegistry.get_character(_target_character_id)
	var cname: String = str(ch.get("name", _target_character_id))
	var proto: String = str(ch.get("prototype", ""))
	var gift_group: String = str(ch.get("gift_group", "general"))
	var color: Color = Color.from_string(str(ch.get("placeholder_color", "#ffffff")), Color.WHITE)
	var aff: int = GameState.get_affection(_target_character_id)
	var tier: Dictionary = GameState.get_affection_tier(_target_character_id)
	var tier_name: String = str(tier.get("name", "初见"))

	target_swatch.color = color
	target_info_label.text = "%s（%s）  |  好感：%d%%（%s）" % [cname, proto, aff, tier_name]
	if gift_group == "deepseek":
		target_affinity_label.text = "偏好：DeepSeek 三姐妹——收 580 矿卡，所有显卡获额外高额加成（华为 +35）"
		target_affinity_label.modulate = Color(0.55, 0.88, 1.0, 1.0)
	else:
		target_affinity_label.text = "偏好：通用显卡——拒收 580 矿卡（硬塞触发 -5 好感惩罚）"
		target_affinity_label.modulate = Color(1.0, 0.78, 0.56, 1.0)

	target_bar_normal.max_value = 100.0
	target_bar_normal.value = float(mini(100, aff))
	target_bar_normal.modulate = Color(1.0, 0.84, 0.36, 1.0) if aff >= 100 else Color(0.45, 0.82, 0.96, 1.0)

	target_bar_overflow.max_value = 100.0
	target_bar_overflow.value = float(maxi(0, aff - 100))
	target_bar_overflow.modulate = Color(0.95, 0.16, 0.25, 1.0)

	_clear_children(gpu_list_box)
	var alive: bool = GameState.is_character_alive(_target_character_id)
	var gpu_ids: PackedStringArray = DataRegistry.get_item_ids("graphics_cards")
	for gpu_id in gpu_ids:
		var card: Dictionary = DataRegistry.get_item(gpu_id)
		var owned: int = GameState.get_item_count(gpu_id)
		var preview: Dictionary = _describe_gpu_effect(_target_character_id, card, gift_group, aff)

		var row: HBoxContainer = HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)

		var swatch: ColorRect = ColorRect.new()
		swatch.custom_minimum_size = Vector2(20, 20)
		swatch.color = Color.from_string(str(card.get("placeholder_color", "#888888")), Color.GRAY)
		row.add_child(swatch)

		var name_lbl: Label = Label.new()
		name_lbl.custom_minimum_size = Vector2(180, 0)
		name_lbl.text = "%s ×%d" % [str(card.get("name", gpu_id)), owned]
		name_lbl.tooltip_text = str(card.get("description", ""))
		row.add_child(name_lbl)

		var eff_lbl: Label = Label.new()
		eff_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		eff_lbl.text = str(preview.get("text", ""))
		eff_lbl.modulate = preview.get("color", Color.WHITE) as Color
		row.add_child(eff_lbl)

		var give_btn: Button = Button.new()
		give_btn.custom_minimum_size = Vector2(96, 0)
		give_btn.text = "赠送"
		give_btn.disabled = (owned <= 0) or not alive
		give_btn.pressed.connect(_on_gift_gpu_pressed.bind(gpu_id))
		row.add_child(give_btn)

		gpu_list_box.add_child(row)


func _describe_gpu_effect(character_id: String, card: Dictionary, gift_group: String, current_aff: int) -> Dictionary:
	var gift_variant: Variant = card.get("gift", {})
	var gift: Dictionary = gift_variant if gift_variant is Dictionary else {}
	var mode: String = str(gift.get("mode", "add"))
	if mode == "fill":
		var fill_to: int = int(gift.get("fill_to", 100))
		var overflow_to: int = int(gift.get("overflow_fill_to", 200))
		if current_aff >= overflow_to:
			return { "text": "好感已达 %d%% 偏执极限" % overflow_to, "color": Color(1.0, 0.35, 0.42, 1.0) }
		if current_aff >= fill_to:
			return {
				"text": "已满 %d%% → 直接冲至 %d%%（偏执溢出态！）" % [fill_to, overflow_to],
				"color": Color(1.0, 0.28, 0.36, 1.0),
			}
		return {
			"text": "直接拉满至 %d%% 满好感（满后再送可冲至 %d%%）" % [fill_to, overflow_to],
			"color": Color(1.0, 0.88, 0.40, 1.0),
		}

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
		var penalty: int = int(gift.get("reject_penalty", -5))
		return {
			"text": "拒收！（若选择强送：好感 %+d）" % penalty,
			"color": Color(1.0, 0.45, 0.45, 1.0),
		}
	var gain: int = int(gain_variant)
	var tag: String = "（三姐妹专属高加成）" if gift_group == "deepseek" else "（通用加成）"
	return {
		"text": "好感 +%d%% %s" % [gain, tag],
		"color": Color(0.62, 0.94, 0.72, 1.0),
	}


# ---------------------------------------------------------------- Tab 1: 全员好感度总览（0–200%）

func _refresh_affection_tab() -> void:
	var assist_min: int = DataRegistry.get_config_int("affection.assist_min", 70)
	var current_assist: String = DataRegistry.get_character_name(GameState.assist_partner_id) if not GameState.assist_partner_id.is_empty() else "无"
	affection_legend_label.text = "左槽：0–100%% 常规 | 右槽（红）：101–200%% 偏执溢出  |  当前 API 并发助战：%s（好感≥%d%%可设）" % [
		current_assist,
		assist_min,
	]
	_clear_children(affection_list_box)
	for heroine_variant in GameState.CORE_HEROINE_IDS:
		var cid: String = str(heroine_variant)
		var ch: Dictionary = DataRegistry.get_character(cid)
		var cname: String = str(ch.get("name", cid))
		var proto: String = str(ch.get("prototype", ""))
		var alive: bool = GameState.is_character_alive(cid)
		var aff: int = GameState.get_affection(cid)
		var tier: Dictionary = GameState.get_affection_tier(cid)
		var tier_name: String = str(tier.get("name", "初见"))

		var card_panel: PanelContainer = PanelContainer.new()
		var margin: MarginContainer = MarginContainer.new()
		margin.add_theme_constant_override("margin_left", 10)
		margin.add_theme_constant_override("margin_top", 8)
		margin.add_theme_constant_override("margin_right", 10)
		margin.add_theme_constant_override("margin_bottom", 8)
		card_panel.add_child(margin)

		var row: HBoxContainer = HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		margin.add_child(row)

		var swatch: ColorRect = ColorRect.new()
		swatch.custom_minimum_size = Vector2(26, 26)
		var base_color: Color = Color.from_string(str(ch.get("placeholder_color", "#ffffff")), Color.WHITE)
		swatch.color = base_color if alive else base_color.darkened(0.7)
		row.add_child(swatch)

		var info_col: VBoxContainer = VBoxContainer.new()
		info_col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		info_col.add_theme_constant_override("separation", 4)
		row.add_child(info_col)

		var title_lbl: Label = Label.new()
		var status_str: String = "" if alive else " [已清空]"
		var milestone_hint: String = ""
		if aff >= 200:
			milestone_hint = " · 偏执溢出极限"
		elif aff >= 101:
			milestone_hint = " · 突破常规上限"
		elif aff >= 100:
			milestone_hint = " · 满好感达成"
		elif aff >= 70:
			milestone_hint = " · 可设并发助战"
		title_lbl.text = "%s（%s）%s  —  %d%% [%s]%s" % [cname, proto, status_str, aff, tier_name, milestone_hint]
		if not alive:
			title_lbl.modulate = Color(0.55, 0.55, 0.58, 1.0)
		elif aff >= 101:
			title_lbl.modulate = Color(1.0, 0.30, 0.36, 1.0)
		elif aff >= 100:
			title_lbl.modulate = Color(1.0, 0.86, 0.42, 1.0)
		info_col.add_child(title_lbl)

		var bars_row: HBoxContainer = HBoxContainer.new()
		bars_row.add_theme_constant_override("separation", 6)
		info_col.add_child(bars_row)

		var bar_norm: ProgressBar = ProgressBar.new()
		bar_norm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		bar_norm.custom_minimum_size = Vector2(0, 12)
		bar_norm.max_value = 100.0
		bar_norm.value = float(mini(100, aff))
		bar_norm.show_percentage = false
		bar_norm.modulate = Color(1.0, 0.82, 0.34, 1.0) if aff >= 100 else Color(0.45, 0.82, 0.96, 1.0)
		bars_row.add_child(bar_norm)

		var bar_over: ProgressBar = ProgressBar.new()
		bar_over.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		bar_over.custom_minimum_size = Vector2(0, 12)
		bar_over.max_value = 100.0
		bar_over.value = float(maxi(0, aff - 100))
		bar_over.show_percentage = false
		bar_over.modulate = Color(0.95, 0.16, 0.25, 1.0)
		bars_row.add_child(bar_over)

		var is_current_assist: bool = (GameState.assist_partner_id == cid)
		var assist_btn: Button = Button.new()
		if is_current_assist:
			assist_btn.text = "已设助战(取消)"
			assist_btn.modulate = Color(0.65, 0.95, 1.0, 1.0)
			assist_btn.pressed.connect(_on_toggle_assist_clicked.bind(""))
		else:
			assist_btn.text = "设并发助战"
			assist_btn.disabled = (not alive) or (aff < assist_min)
			assist_btn.tooltip_text = "需要好感达到 %d%% 且角色存活" % assist_min
			assist_btn.pressed.connect(_on_toggle_assist_clicked.bind(cid))
		row.add_child(assist_btn)

		if not _locked_to_dialogue:
			var jump_btn: Button = Button.new()
			jump_btn.text = "送显卡"
			jump_btn.disabled = not alive
			jump_btn.pressed.connect(_on_overview_gift_clicked.bind(cid))
			row.add_child(jump_btn)

		affection_list_box.add_child(card_panel)


# ---------------------------------------------------------------- 送礼执行与拒收二次确认

func _on_gift_gpu_pressed(gpu_id: String) -> void:
	var res: Dictionary = GameState.gift_graphics_card(_target_character_id, gpu_id, false, true)
	if not bool(res.get("ok", false)):
		feedback_label.text = "赠送失败（%s）。" % str(res.get("reason", "unknown"))
		return

	if bool(res.get("rejected", false)):
		_open_reject_popup(gpu_id)
		return

	var old_val: int = int(res.get("old_value", 0))
	var new_val: int = int(res.get("new_value", 0))
	var delta: int = int(res.get("delta", 0))
	var tier_name: String = str(GameState.get_affection_tier(_target_character_id).get("name", ""))
	var cname: String = DataRegistry.get_character_name(_target_character_id)
	var gpu_name: String = DataRegistry.get_item_name(gpu_id)

	if new_val >= 200 and old_val < 200:
		_last_reaction_section = "gift_overflow_200"
	elif new_val >= 100 and old_val < 100:
		_last_reaction_section = "gift_full_100"
	else:
		_last_reaction_section = "gift_accepted"

	feedback_label.text = "赠送【%s】给【%s】成功！好感 %d%% → %d%%（%+d%% · %s）" % [
		gpu_name,
		cname,
		old_val,
		new_val,
		delta,
		tier_name,
	]
	refresh_all()


func _open_reject_popup(gpu_id: String) -> void:
	_pending_reject_gpu_id = gpu_id
	var cname: String = DataRegistry.get_character_name(_target_character_id)
	var gpu_name: String = DataRegistry.get_item_name(gpu_id)
	var card: Dictionary = DataRegistry.get_item(gpu_id)
	var gift_variant: Variant = card.get("gift", {})
	var gift: Dictionary = gift_variant if gift_variant is Dictionary else {}
	var penalty: int = int(gift.get("reject_penalty", -5))

	reject_text_label.text = (
		"【%s】一脸嫌弃地推开了【%s】！\n"
		+ "（只有 DeepSeek 三姐妹接收 580 矿卡，其余 AI 娘全员拒收）\n\n"
		+ "是否强行把【%s】塞给她？（强送惩罚：好感 %+d%%）"
	) % [cname, gpu_name, gpu_name, penalty]
	reject_overlay.visible = true
	reject_cancel_button.grab_focus()


func _close_reject_popup(did_force: bool) -> void:
	var gpu_id: String = _pending_reject_gpu_id
	_pending_reject_gpu_id = ""
	reject_overlay.visible = false

	if not did_force:
		_last_reaction_section = "gift_rejected"
		feedback_label.text = "你收回了【%s】。（【%s】拒收此卡）" % [
			DataRegistry.get_item_name(gpu_id),
			DataRegistry.get_character_name(_target_character_id),
		]
		refresh_all()
		return

	var res: Dictionary = GameState.gift_graphics_card(_target_character_id, gpu_id, true, true)
	var old_val: int = int(res.get("old_value", 0))
	var new_val: int = int(res.get("new_value", 0))
	var delta: int = int(res.get("delta", 0))
	_last_reaction_section = "gift_forced"
	feedback_label.text = "强送【%s】遭【%s】当场拍飞！触发拒收惩罚：好感 %d%% → %d%%（%+d%%）" % [
		DataRegistry.get_item_name(gpu_id),
		DataRegistry.get_character_name(_target_character_id),
		old_val,
		new_val,
		delta,
	]
	refresh_all()


func _on_force_gift_button_pressed() -> void:
	_close_reject_popup(true)


func _on_cancel_gift_button_pressed() -> void:
	_close_reject_popup(false)


func _on_select_target_heroine(cid: String) -> void:
	_target_character_id = cid
	refresh_all()


func _on_overview_gift_clicked(cid: String) -> void:
	_target_character_id = cid
	tabs.current_tab = 0
	refresh_all()


func _on_toggle_assist_clicked(cid: String) -> void:
	if cid.is_empty():
		GameState.set_assist_partner("")
		feedback_label.text = "已取消 API 并发助战伙伴。"
	elif GameState.set_assist_partner(cid):
		feedback_label.text = "已将【%s】设为 API 并发助战伙伴！（战斗中可随时呼叫，注意修罗场组合！）" % DataRegistry.get_character_name(cid)
	else:
		feedback_label.text = "设置助战失败：需要好感 ≥ 70% 且角色存活。"
	refresh_all()


func _on_close_button_pressed() -> void:
	close_panel()


func _clear_children(container: Node) -> void:
	for child in container.get_children():
		child.queue_free()


func _on_affection_changed(_cid: String, _old_val: int, _new_val: int, _tier_id: String) -> void:
	if _is_open:
		refresh_all()


func _on_inventory_changed(_item_id: String, _count: int) -> void:
	if _is_open:
		refresh_all()


func _on_save_loaded(_slot: int) -> void:
	if _is_open:
		refresh_all()
