extends StaticBody2D
## 巨型大 PSU 电源据点实体（M3 核心交付物）
## - 正常态：暖橘风扇微光、平稳旋转、5 条粗黑供电根须电缆扎入黑曜石地面
## - 报警态（上下文溢出 <= 30% 或任意核心 AI 娘被击杀）：红灯高频报警 + 电火花粒子喷发
## - 正面交互区（南侧）：按 E 打开大 PSU 据点菜单（清理缓存 / 升级 HP / 整理装备 / 存档读档）
## - 背面隐藏区（北侧）：红色物理总开关（I / O），连按 3 次触发 5 秒断电蓝屏彩蛋《手贱的代价》

signal front_interacted
signal back_switch_step(current_presses: int, max_presses: int)
signal power_off_easter_egg_triggered
signal interact_prompt_changed(prompt_text: String)

const COLOR_NORMAL_GLOW: Color = Color(1.0, 0.58, 0.22, 1.0)
const COLOR_ALARM_GLOW: Color = Color(1.0, 0.14, 0.16, 1.0)

@onready var cable_roots: Node2D = $CableRoots
@onready var fan_blades: Node2D = $ChassisVisual/FanHub/FanBlades
@onready var status_led: ColorRect = $ChassisVisual/StatusLed
@onready var switch_rocker: ColorRect = $ChassisVisual/BackSwitchPanel/SwitchRocker
@onready var fan_glow_light: PointLight2D = $FanGlowLight
@onready var spark_particles: CPUParticles2D = $SparkParticles
@onready var front_zone: Area2D = $FrontInteractZone
@onready var back_zone: Area2D = $BackSwitchZone

var _player_in_front: bool = false
var _player_in_back: bool = false
var _interaction_enabled: bool = true
var _power_cut: bool = false
var _max_switch_presses: int = 3
var _time: float = 0.0
var _burst_spark_timer: float = 0.0


func _ready() -> void:
	_max_switch_presses = DataRegistry.get_config_int("psu.back_switch_max_presses", 3)
	_setup_visuals()
	front_zone.body_entered.connect(_on_front_body_entered)
	front_zone.body_exited.connect(_on_front_body_exited)
	back_zone.body_entered.connect(_on_back_body_entered)
	back_zone.body_exited.connect(_on_back_body_exited)
	_update_prompt()


func _setup_visuals() -> void:
	# 1. 暖橘/红灯风扇光晕贴图
	fan_glow_light.texture = PlaceholderFactory.create_radial_light_texture(128)
	fan_glow_light.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	fan_glow_light.blend_mode = PointLight2D.BLEND_MODE_ADD
	fan_glow_light.shadow_enabled = false
	fan_glow_light.texture_scale = 2.5
	fan_glow_light.color = COLOR_NORMAL_GLOW
	fan_glow_light.energy = 1.25

	# 2. 五条粗黑古树根须供电电缆，向外延伸入主板地面
	var cable_paths: Array = [
		[Vector2(-52, 34), Vector2(-110, 68), Vector2(-185, 118)],
		[Vector2(52, 34), Vector2(112, 72), Vector2(188, 122)],
		[Vector2(-68, -6), Vector2(-132, -16), Vector2(-210, -4)],
		[Vector2(68, -6), Vector2(134, -18), Vector2(214, -6)],
		[Vector2(0, -48), Vector2(-8, -110), Vector2(12, -178)],
	]
	for path_variant in cable_paths:
		if not (path_variant is Array):
			continue
		var path_array: Array = path_variant
		var pts: PackedVector2Array = PackedVector2Array()
		for pt_variant in path_array:
			if pt_variant is Vector2:
				pts.append(pt_variant as Vector2)
		var line: Line2D = Line2D.new()
		line.points = pts
		line.width = 7.0
		line.default_color = Color(0.06, 0.06, 0.08, 1.0)
		line.begin_cap_mode = Line2D.LINE_CAP_ROUND
		line.end_cap_mode = Line2D.LINE_CAP_ROUND
		line.joint_mode = Line2D.LINE_JOINT_ROUND
		cable_roots.add_child(line)

		# 电缆表皮微弱暖铜高光脊线
		var highlight: Line2D = Line2D.new()
		highlight.points = pts
		highlight.width = 1.5
		highlight.default_color = Color(0.28, 0.19, 0.13, 0.75)
		cable_roots.add_child(highlight)


func _process(delta: float) -> void:
	_time += delta
	if _burst_spark_timer > 0.0:
		_burst_spark_timer = maxf(0.0, _burst_spark_timer - delta)

	if _power_cut:
		fan_glow_light.energy = lerpf(fan_glow_light.energy, 0.0, clampf(delta * 16.0, 0.0, 1.0))
		status_led.color = Color(0.08, 0.08, 0.09, 1.0)
		spark_particles.emitting = false
		return

	var alarm: bool = is_alarm_active()
	if alarm:
		# 报警态：风扇抽搐卡顿、红灯急促闪烁、电火花持续爆出
		var stutter: float = 0.25 if sin(_time * 13.0) > 0.2 else 4.2
		fan_blades.rotation += delta * stutter
		var blink: float = 0.5 + 0.5 * sin(_time * 12.0)
		fan_glow_light.color = COLOR_ALARM_GLOW
		fan_glow_light.energy = 0.75 + blink * 1.15
		status_led.color = Color(1.0, 0.12, 0.15, 1.0) if blink > 0.35 else Color(0.32, 0.04, 0.05, 1.0)
		spark_particles.emitting = true
	else:
		# 正常态：暖橘柔和微光、风扇匀速转动
		fan_blades.rotation += delta * 2.1
		var breathe: float = 1.0 + 0.08 * sin(_time * 2.6)
		fan_glow_light.color = COLOR_NORMAL_GLOW
		fan_glow_light.energy = 1.25 * breathe
		status_led.color = Color(1.0, 0.62, 0.22, 1.0)
		spark_particles.emitting = _burst_spark_timer > 0.0

	# 背面红色总开关指示色（随按压次数加深警示）
	var presses: int = GameState.psu_back_switch_presses
	if presses >= 2:
		switch_rocker.color = Color(1.0, 0.22, 0.18, 1.0) if sin(_time * 16.0) > 0.0 else Color(0.55, 0.06, 0.08, 1.0)
	elif presses == 1:
		switch_rocker.color = Color(0.95, 0.32, 0.22, 1.0)
	else:
		switch_rocker.color = Color(0.82, 0.12, 0.16, 1.0)


func _unhandled_input(event: InputEvent) -> void:
	if not _interaction_enabled or _power_cut:
		return
	if not event.is_action_pressed("interact"):
		return

	if _player_in_front:
		get_viewport().set_input_as_handled()
		front_interacted.emit()
	elif _player_in_back:
		get_viewport().set_input_as_handled()
		_handle_back_switch_press()


## 是否处于红灯报警状态：上下文溢出（<= 30%）或任意核心 AI 娘被击杀。
func is_alarm_active() -> bool:
	return GameState.is_context_overflow() or GameState.has_any_core_heroine_killed()


func set_interaction_enabled(enabled: bool) -> void:
	_interaction_enabled = enabled
	_update_prompt()


func set_power_cut(cut: bool) -> void:
	_power_cut = cut
	_update_prompt()


func refresh_prompt() -> void:
	_update_prompt()


func _handle_back_switch_press() -> void:
	GameState.psu_back_switch_presses += 1
	var presses: int = GameState.psu_back_switch_presses
	_burst_spark_timer = 0.65

	if presses >= _max_switch_presses:
		GameState.psu_back_switch_presses = 0
		set_power_cut(true)
		power_off_easter_egg_triggered.emit()
	else:
		back_switch_step.emit(presses, _max_switch_presses)
		_update_prompt()


func _update_prompt() -> void:
	if not _interaction_enabled or _power_cut:
		interact_prompt_changed.emit("")
		return
	if _player_in_front:
		var status_tag: String = " [红灯报警！]" if is_alarm_active() else ""
		interact_prompt_changed.emit("[E] 操作巨型大 PSU 电源%s（清理缓存 / 升级血量 / 整理装备 / 存档）" % status_tag)
	elif _player_in_back:
		var presses: int = GameState.psu_back_switch_presses
		interact_prompt_changed.emit("[E] 按下背面红色物理总开关 I / O（%d / %d）" % [presses, _max_switch_presses])
	else:
		interact_prompt_changed.emit("")


func _is_player_body(body: Node) -> bool:
	return body is CharacterBody2D and body.name == "Player"


func _on_front_body_entered(body: Node) -> void:
	if _is_player_body(body):
		_player_in_front = true
		_update_prompt()


func _on_front_body_exited(body: Node) -> void:
	if _is_player_body(body):
		_player_in_front = false
		_update_prompt()


func _on_back_body_entered(body: Node) -> void:
	if _is_player_body(body):
		_player_in_back = true
		_update_prompt()


func _on_back_body_exited(body: Node) -> void:
	if _is_player_body(body):
		_player_in_back = false
		_update_prompt()
