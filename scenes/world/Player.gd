extends CharacterBody2D
## 玩家探索角色（M2 核心原型，后续 M3–M12 通用复用）
## - WASD / 方向键 8 向平滑移动（CircleShape2D + MOTION_MODE_FLOATING 避免卡墙角）
## - 鼠标控制扇形 PointLight2D 提灯视野与实时 2D 阴影
## - F 键切换提灯档位（常亮 / 调暗省存在感）
## - 上下文溢出时驱动 Camera2D 细微抖动

signal lantern_mode_changed(is_dim: bool)
signal attack_performed(origin: Vector2, aim_dir: Vector2)

@onready var lantern_pivot: Node2D = $LanternPivot
@onready var lantern_cone_light: PointLight2D = $LanternPivot/LanternConeLight
@onready var lantern_halo_light: PointLight2D = $LanternPivot/LanternHaloLight
@onready var lantern_pointer: ColorRect = $LanternPivot/LanternPointer
@onready var slash_visual: ColorRect = $LanternPivot/SlashVisual
@onready var camera: Camera2D = $Camera2D

var _move_speed: float = 220.0
var _move_accel: float = 1600.0
var _move_friction: float = 1800.0

var _bright_energy: float = 1.95
var _bright_scale: float = 3.3
var _dim_energy: float = 0.6
var _dim_scale: float = 1.95

var _halo_bright_energy: float = 0.6
var _halo_bright_scale: float = 1.35
var _halo_dim_energy: float = 0.25
var _halo_dim_scale: float = 0.9

var _overflow_jitter_px: float = 2.4
var _critical_jitter_px: float = 4.8
var _attack_cooldown: float = 0.30

var _is_lantern_dim: bool = false
var _movement_enabled: bool = true
var _time_elapsed: float = 0.0
var _attack_cd_remaining: float = 0.0
var _slash_visual_timer: float = 0.0
var _rng: RandomNumberGenerator = RandomNumberGenerator.new()


func _ready() -> void:
	_rng.randomize()
	_load_config()
	motion_mode = CharacterBody2D.MOTION_MODE_FLOATING
	wall_min_slide_angle = 0.0
	_setup_lantern_lights()
	lantern_mode_changed.emit(_is_lantern_dim)


func _load_config() -> void:
	_move_speed = DataRegistry.get_config_float("exploration.move_speed", 220.0)
	_move_accel = DataRegistry.get_config_float("exploration.move_accel", 1600.0)
	_move_friction = DataRegistry.get_config_float("exploration.move_friction", 1800.0)

	_bright_energy = DataRegistry.get_config_float("exploration.lantern_bright_energy", 1.95)
	_bright_scale = DataRegistry.get_config_float("exploration.lantern_bright_scale", 3.3)
	_dim_energy = DataRegistry.get_config_float("exploration.lantern_dim_energy", 0.6)
	_dim_scale = DataRegistry.get_config_float("exploration.lantern_dim_scale", 1.95)

	_halo_bright_energy = DataRegistry.get_config_float("exploration.halo_bright_energy", 0.6)
	_halo_bright_scale = DataRegistry.get_config_float("exploration.halo_bright_scale", 1.35)
	_halo_dim_energy = DataRegistry.get_config_float("exploration.halo_dim_energy", 0.25)
	_halo_dim_scale = DataRegistry.get_config_float("exploration.halo_dim_scale", 0.9)

	_overflow_jitter_px = DataRegistry.get_config_float("exploration.overflow_jitter_px", 2.4)
	_critical_jitter_px = DataRegistry.get_config_float("exploration.critical_jitter_px", 4.8)
	_attack_cooldown = DataRegistry.get_config_float("psu.melee_attack_cooldown", 0.30)


func _setup_lantern_lights() -> void:
	var cone_tex: ImageTexture = PlaceholderFactory.create_lantern_cone_texture(192, 38.0, 15.0)
	var halo_tex: ImageTexture = PlaceholderFactory.create_radial_light_texture(128)

	lantern_cone_light.texture = cone_tex
	lantern_cone_light.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	lantern_cone_light.blend_mode = PointLight2D.BLEND_MODE_ADD
	lantern_cone_light.shadow_enabled = true
	lantern_cone_light.shadow_color = Color(0.0, 0.0, 0.0, 0.94)
	lantern_cone_light.shadow_filter = PointLight2D.SHADOW_FILTER_PCF5
	lantern_cone_light.shadow_filter_smooth = 2.5
	lantern_cone_light.color = Color(1.0, 0.87, 0.65, 1.0)
	lantern_cone_light.energy = _bright_energy
	lantern_cone_light.texture_scale = _bright_scale

	lantern_halo_light.texture = halo_tex
	lantern_halo_light.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	lantern_halo_light.blend_mode = PointLight2D.BLEND_MODE_ADD
	lantern_halo_light.shadow_enabled = true
	lantern_halo_light.shadow_color = Color(0.0, 0.0, 0.0, 0.92)
	lantern_halo_light.shadow_filter = PointLight2D.SHADOW_FILTER_PCF5
	lantern_halo_light.shadow_filter_smooth = 2.0
	lantern_halo_light.color = Color(0.95, 0.84, 0.68, 1.0)
	lantern_halo_light.energy = _halo_bright_energy
	lantern_halo_light.texture_scale = _halo_bright_scale


func _unhandled_input(event: InputEvent) -> void:
	if not _movement_enabled:
		return
	if event.is_action_pressed("toggle_lantern"):
		toggle_lantern()
		get_viewport().set_input_as_handled()
	elif event.is_action_pressed("attack") and _attack_cd_remaining <= 0.0:
		_perform_melee_slash()
		get_viewport().set_input_as_handled()


func _physics_process(delta: float) -> void:
	if _movement_enabled:
		var input_dir: Vector2 = Input.get_vector("move_left", "move_right", "move_up", "move_down")
		if input_dir.length_squared() > 0.0:
			velocity = velocity.move_toward(input_dir * _move_speed, _move_accel * delta)
		else:
			velocity = velocity.move_toward(Vector2.ZERO, _move_friction * delta)
	else:
		velocity = Vector2.ZERO

	move_and_slide()


func _process(delta: float) -> void:
	_time_elapsed += delta
	if _attack_cd_remaining > 0.0:
		_attack_cd_remaining = maxf(0.0, _attack_cd_remaining - delta)
	if _slash_visual_timer > 0.0:
		_slash_visual_timer = maxf(0.0, _slash_visual_timer - delta)
		var alpha: float = clampf(_slash_visual_timer / 0.14, 0.0, 1.0)
		slash_visual.visible = _slash_visual_timer > 0.0
		slash_visual.color = Color(0.95, 0.96, 1.0, alpha * 0.72)
	_update_lantern_aim()
	_update_lantern_visuals(delta)
	_update_camera_jitter(delta)


func _perform_melee_slash() -> void:
	_attack_cd_remaining = _attack_cooldown
	_slash_visual_timer = 0.14
	slash_visual.visible = true
	var aim_dir: Vector2 = Vector2.RIGHT.rotated(lantern_pivot.rotation)
	attack_performed.emit(global_position, aim_dir)


func toggle_lantern() -> void:
	_is_lantern_dim = not _is_lantern_dim
	lantern_mode_changed.emit(_is_lantern_dim)


func is_lantern_dim() -> bool:
	return _is_lantern_dim


func set_movement_enabled(enabled: bool) -> void:
	_movement_enabled = enabled
	if not enabled:
		velocity = Vector2.ZERO


func set_camera_limits(bounds: Rect2i) -> void:
	# Camera2D.offset 可以越过相机边界，为最大抖动预留空间。
	var jitter_margin: int = ceili(maxf(_overflow_jitter_px, _critical_jitter_px))
	camera.limit_left = bounds.position.x + jitter_margin
	camera.limit_top = bounds.position.y + jitter_margin
	camera.limit_right = bounds.end.x - jitter_margin
	camera.limit_bottom = bounds.end.y - jitter_margin


func _update_lantern_aim() -> void:
	if not _movement_enabled:
		return
	var mouse_pos: Vector2 = get_global_mouse_position()
	var to_mouse: Vector2 = mouse_pos - global_position
	if to_mouse.length_squared() > 1.0:
		lantern_pivot.rotation = to_mouse.angle()


func _update_lantern_visuals(delta: float) -> void:
	var flicker: float = 1.0 + sin(_time_elapsed * 7.5) * 0.025 + sin(_time_elapsed * 19.0) * 0.015
	var target_cone_energy: float = (_dim_energy if _is_lantern_dim else _bright_energy) * flicker
	var target_cone_scale: float = _dim_scale if _is_lantern_dim else _bright_scale
	var target_halo_energy: float = (_halo_dim_energy if _is_lantern_dim else _halo_bright_energy) * flicker
	var target_halo_scale: float = _halo_dim_scale if _is_lantern_dim else _halo_bright_scale

	var overflow: bool = GameState.is_context_overflow()
	var target_cone_color: Color = Color(0.88, 0.72, 0.52, 1.0) if _is_lantern_dim else Color(1.0, 0.87, 0.65, 1.0)
	if overflow:
		target_cone_color = target_cone_color.lerp(Color(1.0, 0.68, 0.58, 1.0), 0.35)

	var blend: float = clampf(delta * 10.0, 0.0, 1.0)
	lantern_cone_light.energy = lerpf(lantern_cone_light.energy, target_cone_energy, blend)
	lantern_cone_light.texture_scale = lerpf(lantern_cone_light.texture_scale, target_cone_scale, blend)
	lantern_cone_light.color = lantern_cone_light.color.lerp(target_cone_color, blend)

	lantern_halo_light.energy = lerpf(lantern_halo_light.energy, target_halo_energy, blend)
	lantern_halo_light.texture_scale = lerpf(lantern_halo_light.texture_scale, target_halo_scale, blend)

	lantern_pointer.color = Color(0.65, 0.45, 0.25, 0.9) if _is_lantern_dim else Color(1.0, 0.84, 0.42, 1.0)


func _update_camera_jitter(delta: float) -> void:
	if GameState.is_context_overflow():
		var amp: float = _critical_jitter_px if GameState.is_context_critical() else _overflow_jitter_px
		camera.offset = Vector2(
			_rng.randf_range(-amp, amp),
			_rng.randf_range(-amp, amp)
		)
	else:
		camera.offset = camera.offset.lerp(Vector2.ZERO, clampf(delta * 14.0, 0.0, 1.0))
