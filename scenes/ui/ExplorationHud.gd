extends CanvasLayer
## 探索场景 HUD + 上下文溢出暗角叠加层 + Esc 菜单（M2 起通用）

signal pause_toggled(is_paused: bool)
signal toggle_context_debug_requested
signal return_to_boot_requested

@onready var overflow_vignette: ColorRect = $OverflowVignette
@onready var region_label: Label = $StatusPanel/Margin/VBox/RegionLabel
@onready var stats_label: Label = $StatusPanel/Margin/VBox/StatsLabel
@onready var context_label: Label = $StatusPanel/Margin/VBox/ContextLabel
@onready var context_bar: ProgressBar = $StatusPanel/Margin/VBox/ContextBar
@onready var lantern_label: Label = $StatusPanel/Margin/VBox/LanternLabel
@onready var notice_label: Label = $StatusPanel/Margin/VBox/NoticeLabel
@onready var pause_overlay: ColorRect = $PauseOverlay

var _vignette_intensity: float = 0.0
var _is_paused: bool = false
var _notice_timer: float = 0.0
var _lantern_is_dim: bool = false


func _ready() -> void:
	pause_overlay.visible = false
	notice_label.text = ""
	GameState.hp_changed.connect(_on_hp_or_token_changed)
	GameState.token_changed.connect(_on_hp_or_token_changed)
	GameState.context_changed.connect(_on_context_changed)
	_refresh_status()
	_sync_vignette_immediate()


func _process(delta: float) -> void:
	var target_intensity: float = _compute_target_vignette_intensity()
	_vignette_intensity = lerpf(_vignette_intensity, target_intensity, clampf(delta * 5.0, 0.0, 1.0))
	_apply_vignette_intensity(_vignette_intensity)

	if _notice_timer > 0.0:
		_notice_timer -= delta
		if _notice_timer <= 0.0:
			notice_label.text = ""


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("menu"):
		set_paused(not _is_paused)
		get_viewport().set_input_as_handled()


func set_region_title(title: String) -> void:
	region_label.text = title


func set_lantern_dim(is_dim: bool) -> void:
	_lantern_is_dim = is_dim
	_refresh_lantern_label()


func show_notice(message: String, duration: float = 2.6) -> void:
	notice_label.text = message
	_notice_timer = duration


func set_paused(paused: bool) -> void:
	if _is_paused == paused:
		return
	_is_paused = paused
	pause_overlay.visible = _is_paused
	pause_toggled.emit(_is_paused)


func is_paused() -> bool:
	return _is_paused


func _refresh_status() -> void:
	stats_label.text = "HP %d / %d   |   Token %d / %d" % [
		GameState.hp,
		GameState.get_effective_max_hp(),
		GameState.token,
		GameState.max_token,
	]
	context_bar.max_value = float(GameState.max_context)
	context_bar.value = float(GameState.context)

	var overflow: bool = GameState.is_context_overflow()
	var critical: bool = GameState.is_context_critical()
	if critical:
		context_label.text = "上下文稳定度：%d%%  [里世界崩坏！]" % GameState.context
		context_label.modulate = Color(1.0, 0.25, 0.28, 1.0)
		context_bar.modulate = Color(0.95, 0.16, 0.20, 1.0)
	elif overflow:
		context_label.text = "上下文稳定度：%d%%  [里世界溢出]" % GameState.context
		context_label.modulate = Color(1.0, 0.42, 0.42, 1.0)
		context_bar.modulate = Color(0.88, 0.22, 0.25, 1.0)
	else:
		context_label.text = "上下文稳定度：%d%%  [表世界稳定]" % GameState.context
		context_label.modulate = Color(0.86, 0.90, 0.96, 1.0)
		context_bar.modulate = Color(0.45, 0.78, 0.92, 1.0)

	_refresh_lantern_label()


func _refresh_lantern_label() -> void:
	if _lantern_is_dim:
		lantern_label.text = "提灯：调暗（低存在感）  [按 F 调亮]"
		lantern_label.modulate = Color(0.76, 0.68, 0.56, 1.0)
	else:
		lantern_label.text = "提灯：常亮  [按 F 调暗]"
		lantern_label.modulate = Color(1.0, 0.86, 0.56, 1.0)


func _compute_target_vignette_intensity() -> float:
	if not GameState.is_context_overflow():
		return 0.0
	if GameState.is_context_critical():
		return 0.95
	var threshold: float = maxf(1.0, float(DataRegistry.get_config_int("context.overflow_threshold", 30)))
	var ratio: float = clampf((threshold - float(GameState.context)) / threshold, 0.0, 1.0)
	return 0.60 + ratio * 0.28


func _sync_vignette_immediate() -> void:
	_vignette_intensity = _compute_target_vignette_intensity()
	_apply_vignette_intensity(_vignette_intensity)


func _apply_vignette_intensity(value: float) -> void:
	if overflow_vignette.material is ShaderMaterial:
		var shader_mat: ShaderMaterial = overflow_vignette.material as ShaderMaterial
		shader_mat.set_shader_parameter("intensity", value)


func _on_hp_or_token_changed(_current: int, _maximum: int) -> void:
	_refresh_status()


func _on_context_changed(_current: int, _maximum: int, _is_overflow: bool) -> void:
	_refresh_status()


func _on_resume_button_pressed() -> void:
	set_paused(false)


func _on_toggle_context_button_pressed() -> void:
	toggle_context_debug_requested.emit()


func _on_return_boot_button_pressed() -> void:
	set_paused(false)
	return_to_boot_requested.emit()
