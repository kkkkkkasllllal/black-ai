extends CanvasLayer
## M4 通用分支对话框 UI（解析并播放 dialogue/*.dialogue 纯文本剧本）
## - 左侧展示角色代表色占位立绘（里世界/偏执溢出态自动裂纹黑化）与 0–200% 双段好感条
## - 右侧展示台词与动态分支选项，支持直接跳转送显卡面板并在送礼后播放角色专属反应台词

signal opened(character_id: String)
signal closed(character_id: String)
signal open_gift_requested(character_id: String)

const DIALOGUE_PARSER_SCRIPT: GDScript = preload("res://scripts/dialogue/DialogueParser.gd")
const DIALOGUE_RUNNER_SCRIPT: GDScript = preload("res://scripts/dialogue/DialogueRunner.gd")

@onready var backdrop: Control = $Backdrop
@onready var portrait_border: ColorRect = $Backdrop/BottomMargin/Panel/Margin/HBox/PortraitCol/PortraitBox/Border
@onready var portrait_fill: ColorRect = $Backdrop/BottomMargin/Panel/Margin/HBox/PortraitCol/PortraitBox/Fill
@onready var portrait_crack_a: ColorRect = $Backdrop/BottomMargin/Panel/Margin/HBox/PortraitCol/PortraitBox/CrackA
@onready var portrait_crack_b: ColorRect = $Backdrop/BottomMargin/Panel/Margin/HBox/PortraitCol/PortraitBox/CrackB
@onready var portrait_name_label: Label = $Backdrop/BottomMargin/Panel/Margin/HBox/PortraitCol/PortraitName
@onready var affection_text_label: Label = $Backdrop/BottomMargin/Panel/Margin/HBox/PortraitCol/AffectionText
@onready var affection_bar: ProgressBar = $Backdrop/BottomMargin/Panel/Margin/HBox/PortraitCol/AffectionBar
@onready var speaker_label: Label = $Backdrop/BottomMargin/Panel/Margin/HBox/ContentCol/HeaderRow/SpeakerLabel
@onready var state_badge_label: Label = $Backdrop/BottomMargin/Panel/Margin/HBox/ContentCol/HeaderRow/StateBadge
@onready var dialogue_text: RichTextLabel = $Backdrop/BottomMargin/Panel/Margin/HBox/ContentCol/DialogueText
@onready var choices_box: VBoxContainer = $Backdrop/BottomMargin/Panel/Margin/HBox/ContentCol/ChoicesBox
@onready var gift_button: Button = $Backdrop/BottomMargin/Panel/Margin/HBox/ContentCol/FooterRow/GiftButton
@onready var next_button: Button = $Backdrop/BottomMargin/Panel/Margin/HBox/ContentCol/FooterRow/NextButton
@onready var close_button: Button = $Backdrop/BottomMargin/Panel/Margin/HBox/ContentCol/FooterRow/CloseButton

var _runner: RefCounted = null
var _character_id: String = ""
var _current_doc: Dictionary = {}
var _is_open: bool = false
var _input_suspended: bool = false


func _ready() -> void:
	visible = false
	backdrop.visible = false
	_runner = DIALOGUE_RUNNER_SCRIPT.new() as RefCounted
	_runner.connect("line_ready", _on_line_ready)
	_runner.connect("choices_ready", _on_choices_ready)
	_runner.connect("action_requested", _on_action_requested)
	_runner.connect("dialogue_finished", _on_dialogue_finished)
	GameState.affection_changed.connect(_on_affection_changed)
	GameState.context_changed.connect(_on_context_changed)


func _unhandled_input(event: InputEvent) -> void:
	if not _is_open or _input_suspended:
		return
	if event.is_action_pressed("menu"):
		close_dialogue()
		get_viewport().set_input_as_handled()
		return
	if not bool(_runner.call("is_waiting_for_choice")):
		if event.is_action_pressed("interact") or event.is_action_pressed("ui_accept"):
			_runner.call("advance")
			get_viewport().set_input_as_handled()


func open_dialogue(character_id: String, dialogue_path: String, start_section: String = "start") -> bool:
	var parsed_variant: Variant = DIALOGUE_PARSER_SCRIPT.call("parse_file", dialogue_path)
	var parsed: Dictionary = parsed_variant if parsed_variant is Dictionary else {}
	if not bool(parsed.get("ok", false)):
		push_error("[DialogueBox] 剧本解析失败: %s -> %s" % [dialogue_path, str(parsed.get("errors", []))])
		return false

	_character_id = character_id
	_current_doc = parsed
	_is_open = true
	_input_suspended = false
	visible = true
	backdrop.visible = true

	_refresh_character_header()
	opened.emit(_character_id)
	_runner.call("start", _current_doc, start_section, _character_id)
	return true


func close_dialogue() -> void:
	if not _is_open:
		return
	var closing_id: String = _character_id
	_is_open = false
	_input_suspended = false
	visible = false
	backdrop.visible = false
	_clear_choices()
	closed.emit(closing_id)


func is_open() -> bool:
	return _is_open


func set_input_suspended(suspended: bool) -> void:
	_input_suspended = suspended


func get_current_character_id() -> String:
	return _character_id


## 在送显卡界面关闭后播放当前角色对应反应段落（若未送礼则恢复对话）。
func play_reaction_section(section_name: String) -> void:
	if not _is_open:
		return
	_refresh_character_header()
	if section_name.is_empty():
		if not bool(_runner.call("is_running")) or (choices_box.get_child_count() == 0 and not next_button.visible):
			_runner.call("start", _current_doc, "start", _character_id)
		return
	if not bool(_runner.call("jump_to_section", section_name)):
		_runner.call("start", _current_doc, "start", _character_id)


# ---------------------------------------------------------------- 内部渲染

func _refresh_character_header() -> void:
	var ch: Dictionary = DataRegistry.get_character(_character_id)
	var cname: String = str(ch.get("name", _character_id))
	var proto: String = str(ch.get("prototype", ""))
	var color: Color = Color.from_string(str(ch.get("placeholder_color", "#ffffff")), Color.WHITE)
	var aff: int = GameState.get_affection(_character_id)
	var tier: Dictionary = GameState.get_affection_tier(_character_id)
	var tier_name: String = str(tier.get("name", "初见"))
	var overflow_ctx: bool = GameState.is_context_overflow()
	var obsessed: bool = aff >= 101

	portrait_name_label.text = cname
	speaker_label.text = "%s（%s）" % [cname, proto] if not proto.is_empty() else cname

	var corrupted: bool = overflow_ctx or obsessed
	portrait_crack_a.visible = corrupted
	portrait_crack_b.visible = corrupted
	portrait_border.color = Color(0.92, 0.14, 0.18, 1.0) if corrupted else Color(0.92, 0.92, 0.95, 1.0)
	portrait_fill.color = color.darkened(0.32) if corrupted else color

	if obsessed and overflow_ctx:
		state_badge_label.text = "[双溢出：偏执 + 里世界]"
		state_badge_label.modulate = Color(1.0, 0.20, 0.25, 1.0)
	elif obsessed:
		state_badge_label.text = "[偏执溢出态 101–200%]"
		state_badge_label.modulate = Color(1.0, 0.28, 0.34, 1.0)
	elif overflow_ctx:
		state_badge_label.text = "[里世界 · 上下文溢出]"
		state_badge_label.modulate = Color(1.0, 0.42, 0.42, 1.0)
	else:
		state_badge_label.text = "[表世界稳定]"
		state_badge_label.modulate = Color(0.65, 0.85, 0.96, 1.0)

	affection_text_label.text = "好感：%d%%（%s）" % [aff, tier_name]
	if aff > 100:
		affection_bar.min_value = 0.0
		affection_bar.max_value = 200.0
		affection_bar.value = float(aff)
		affection_bar.modulate = Color(0.96, 0.18, 0.28, 1.0)
		affection_text_label.modulate = Color(1.0, 0.32, 0.38, 1.0)
	else:
		affection_bar.min_value = 0.0
		affection_bar.max_value = 100.0
		affection_bar.value = float(aff)
		affection_bar.modulate = Color(1.0, 0.72, 0.34, 1.0) if aff >= 100 else Color(0.45, 0.82, 0.96, 1.0)
		affection_text_label.modulate = Color(1.0, 0.86, 0.45, 1.0) if aff >= 100 else Color(0.86, 0.90, 0.96, 1.0)

	gift_button.visible = GameState.is_core_heroine(_character_id)


func _on_line_ready(speaker: String, text: String) -> void:
	_clear_choices()
	if not speaker.is_empty():
		var ch: Dictionary = DataRegistry.get_character(_character_id)
		var proto: String = str(ch.get("prototype", ""))
		speaker_label.text = "%s（%s）" % [speaker, proto] if (speaker == str(ch.get("name", "")) and not proto.is_empty()) else speaker
	dialogue_text.text = text
	next_button.visible = true
	next_button.grab_focus()


func _on_choices_ready(options: Array) -> void:
	_clear_choices()
	next_button.visible = false
	var first_btn: Button = null
	for i in range(options.size()):
		var opt: Dictionary = options[i]
		var btn: Button = Button.new()
		btn.text = "%d. %s" % [i + 1, str(opt.get("text", "..."))]
		btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
		btn.pressed.connect(_on_choice_pressed.bind(i))
		choices_box.add_child(btn)
		if first_btn == null:
			first_btn = btn
	if first_btn != null:
		first_btn.grab_focus()


func _on_action_requested(action_name: String) -> void:
	if action_name == "open_gift":
		_clear_choices()
		next_button.visible = false
		open_gift_requested.emit(_character_id)


func _on_dialogue_finished() -> void:
	close_dialogue()


func _on_choice_pressed(index: int) -> void:
	_runner.call("choose", index)


func _on_next_button_pressed() -> void:
	_runner.call("advance")


func _on_gift_button_pressed() -> void:
	open_gift_requested.emit(_character_id)


func _on_close_button_pressed() -> void:
	close_dialogue()


func _clear_choices() -> void:
	for child in choices_box.get_children():
		child.queue_free()


func _on_affection_changed(cid: String, _old_val: int, _new_val: int, _tier_id: String) -> void:
	if _is_open and cid == _character_id:
		_refresh_character_header()


func _on_context_changed(_current: int, _maximum: int, _is_overflow: bool) -> void:
	if _is_open:
		_refresh_character_header()
