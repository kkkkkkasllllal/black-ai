extends Node2D
## M2：2D 上帝视角探索原型测试箱庭
## 核心结构：
## - FloorLayer (TileMapLayer): 黑曜石主板地板与供电走线
## - BloodGraffitiLayer (TileMapLayer): 隐藏血字层（仅在上下文溢出 <= 30% 时显现）
## - WallLayer (TileMapLayer): 带 TileSet 碰撞体与实时阴影遮挡的墙体层
## - Obstacles (Node2D): 独立机柜石柱（含 StaticBody2D + LightOccluder2D），用于验证 360° 实时阴影
## - CanvasModulate: 暗环境底色，随表/里世界平滑切换
## - Player + ExplorationHud: 提灯探索与溢出视觉反馈

const MAP_WIDTH: int = 32
const MAP_HEIGHT: int = 20
const BOOT_SCENE_PATH: String = "res://scenes/boot/Boot.tscn"

const AMBIENT_STABLE: Color = Color(0.15, 0.16, 0.20, 1.0)
const AMBIENT_OVERFLOW: Color = Color(0.19, 0.08, 0.10, 1.0)

@onready var floor_layer: TileMapLayer = $FloorLayer
@onready var blood_graffiti_layer: TileMapLayer = $BloodGraffitiLayer
@onready var wall_layer: TileMapLayer = $WallLayer
@onready var obstacles_root: Node2D = $Obstacles
@onready var canvas_modulate: CanvasModulate = $CanvasModulate
@onready var player: CharacterBody2D = $Player
@onready var hud: CanvasLayer = $ExplorationHud

var _tile_size: int = 48
var _debug_context_step: int = 15
var _blood_alpha: float = 0.0
var _pulse_time: float = 0.0


func _ready() -> void:
	_tile_size = DataRegistry.get_config_int("exploration.tile_size", 48)
	_debug_context_step = DataRegistry.get_config_int("exploration.debug_context_step", 15)

	_build_tilemaps()
	_build_server_pillars()
	_place_player()

	GameState.context_changed.connect(_on_context_changed)
	player.connect("lantern_mode_changed", _on_lantern_mode_changed)
	hud.connect("pause_toggled", _on_hud_pause_toggled)
	hud.connect("toggle_context_debug_requested", _toggle_context_overflow_debug)
	hud.connect("return_to_boot_requested", _return_to_boot)

	hud.call("set_region_title", "测试箱庭 · 探索原型（M2）")
	hud.call("set_lantern_dim", bool(player.call("is_lantern_dim")))

	var revealed: bool = _should_reveal_blood_graffiti()
	_blood_alpha = 1.0 if revealed else 0.0
	blood_graffiti_layer.visible = revealed
	blood_graffiti_layer.modulate = Color(1.0, 1.0, 1.0, _blood_alpha)
	canvas_modulate.color = AMBIENT_OVERFLOW if GameState.is_context_overflow() else AMBIENT_STABLE


func _process(delta: float) -> void:
	_pulse_time += delta
	var revealed: bool = _should_reveal_blood_graffiti()
	var target_alpha: float = 1.0 if revealed else 0.0
	_blood_alpha = lerpf(_blood_alpha, target_alpha, clampf(delta * 6.5, 0.0, 1.0))

	if _blood_alpha <= 0.01 and not revealed:
		blood_graffiti_layer.visible = false
	else:
		blood_graffiti_layer.visible = true
		var pulse: float = 0.86 + 0.14 * sin(_pulse_time * 3.8)
		blood_graffiti_layer.modulate = Color(1.0, 1.0, 1.0, _blood_alpha * pulse)

	var target_ambient: Color = AMBIENT_OVERFLOW if GameState.is_context_overflow() else AMBIENT_STABLE
	canvas_modulate.color = canvas_modulate.color.lerp(target_ambient, clampf(delta * 4.0, 0.0, 1.0))


func _unhandled_input(event: InputEvent) -> void:
	if bool(hud.call("is_paused")):
		return
	if event is InputEventKey:
		var key_event: InputEventKey = event
		if not key_event.pressed or key_event.echo:
			return
		match key_event.keycode:
			KEY_1, KEY_BRACKETLEFT:
				GameState.change_context(-_debug_context_step)
				hud.call("show_notice", "调试：上下文 -%d%%（当前 %d%%）" % [_debug_context_step, GameState.context])
				get_viewport().set_input_as_handled()
			KEY_2, KEY_BRACKETRIGHT:
				GameState.change_context(_debug_context_step)
				hud.call("show_notice", "调试：上下文 +%d%%（当前 %d%%）" % [_debug_context_step, GameState.context])
				get_viewport().set_input_as_handled()
			KEY_3:
				_toggle_context_overflow_debug()
				get_viewport().set_input_as_handled()


# ---------------------------------------------------------------- 地图构建（纯 TileMapLayer）

func _build_tilemaps() -> void:
	var base_tileset: TileSet = PlaceholderFactory.create_exploration_tileset(_tile_size)
	var blood_tileset: TileSet = PlaceholderFactory.create_blood_graffiti_tileset(_tile_size)

	floor_layer.tile_set = base_tileset
	wall_layer.tile_set = base_tileset
	blood_graffiti_layer.tile_set = blood_tileset

	floor_layer.clear()
	wall_layer.clear()
	blood_graffiti_layer.clear()

	# 1. 地面铺设（黑曜石主板地板 + 中央十字供电铜线）
	for y in range(MAP_HEIGHT):
		for x in range(MAP_WIDTH):
			var is_trace: bool = (x == 16 and y >= 2 and y <= 17) or (y == 10 and x >= 2 and x <= 29)
			var floor_tile: Vector2i = PlaceholderFactory.TILE_FLOOR_TRACE if is_trace else PlaceholderFactory.TILE_FLOOR_DARK
			floor_layer.set_cell(Vector2i(x, y), 0, floor_tile)

	# 2. 外围封闭墙体
	for x in range(MAP_WIDTH):
		_set_wall(x, 0, x % 4 == 0)
		_set_wall(x, MAP_HEIGHT - 1, x % 4 == 0)
	for y in range(1, MAP_HEIGHT - 1):
		_set_wall(0, y, y % 4 == 0)
		_set_wall(MAP_WIDTH - 1, y, y % 4 == 0)

	# 3. 内部隔断墙（形成拐角、暗廊与掩体，用于测试不卡墙角与实时阴影遮挡）
	# 左上暗室隔墙（宽敞双格入口）
	for x in range(1, 9):
		if x != 4 and x != 5:
			_set_wall(x, 7, false)
	for y in range(1, 8):
		if y != 3 and y != 4:
			_set_wall(9, y, true)

	# 右上折返暗廊
	for x in range(22, 31):
		if x != 25 and x != 26:
			_set_wall(x, 6, true)
	for y in range(7, 12):
		if y != 9 and y != 10:
			_set_wall(22, y, false)

	# 左下 L 型掩体墙
	for x in range(4, 10):
		_set_wall(x, 14, false)
	for y in range(12, 15):
		_set_wall(4, y, true)

	# 右下隔断短墙
	for x in range(23, 28):
		_set_wall(x, 14, true)
	_set_wall(27, 15, false)
	_set_wall(27, 16, false)

	# 4. 上下文溢出隐藏血字 TileMapLayer（表世界不可见，<= 30% 显现）
	var graffiti_spots: Array = [
		# 出生点周围（一键切溢出后视野内立即可见）
		[Vector2i(14, 10), PlaceholderFactory.BLOOD_TILE_404],
		[Vector2i(18, 10), PlaceholderFactory.BLOOD_TILE_580],
		[Vector2i(16, 8), PlaceholderFactory.BLOOD_TILE_EYE],
		[Vector2i(15, 12), PlaceholderFactory.BLOOD_TILE_CLAW],
		[Vector2i(17, 12), PlaceholderFactory.BLOOD_TILE_NULL],
		# 隔间与暗廊深处（供提灯探索发掘）
		[Vector2i(3, 3), PlaceholderFactory.BLOOD_TILE_NULL],
		[Vector2i(5, 3), PlaceholderFactory.BLOOD_TILE_EYE],
		[Vector2i(2, 5), PlaceholderFactory.BLOOD_TILE_CLAW],
		[Vector2i(26, 2), PlaceholderFactory.BLOOD_TILE_404],
		[Vector2i(28, 3), PlaceholderFactory.BLOOD_TILE_CROSS],
		[Vector2i(6, 16), PlaceholderFactory.BLOOD_TILE_580],
		[Vector2i(7, 16), PlaceholderFactory.BLOOD_TILE_CLAW],
		[Vector2i(24, 16), PlaceholderFactory.BLOOD_TILE_EYE],
		[Vector2i(25, 16), PlaceholderFactory.BLOOD_TILE_CROSS],
		[Vector2i(16, 3), PlaceholderFactory.BLOOD_TILE_CROSS],
	]
	for entry_variant in graffiti_spots:
		if entry_variant is Array:
			var entry: Array = entry_variant
			if entry.size() >= 2 and entry[0] is Vector2i and entry[1] is Vector2i:
				var cell: Vector2i = entry[0] as Vector2i
				var tile_coord: Vector2i = entry[1] as Vector2i
				blood_graffiti_layer.set_cell(cell, 0, tile_coord)


func _set_wall(x: int, y: int, rack_variant: bool) -> void:
	var tile: Vector2i = PlaceholderFactory.TILE_WALL_RACK if rack_variant else PlaceholderFactory.TILE_WALL_STONE
	wall_layer.set_cell(Vector2i(x, y), 0, tile)


## 在广场四角放置带显式 LightOccluder2D 与 StaticBody2D 的独立机柜石柱，
## 用于直观验收 360° 扇形提灯实时阴影与防卡角绕柱手感。
func _build_server_pillars() -> void:
	var pillar_cells: Array = [
		[Vector2i(13, 7), "机柜柱 A"],
		[Vector2i(19, 7), "机柜柱 B"],
		[Vector2i(13, 13), "机柜柱 C"],
		[Vector2i(19, 13), "机柜柱 D"],
	]
	var size: float = float(_tile_size)
	var half: float = size * 0.5
	var occluder_inset: float = half - 2.0
	var occ_poly: PackedVector2Array = PackedVector2Array([
		Vector2(-occluder_inset, -occluder_inset),
		Vector2(occluder_inset, -occluder_inset),
		Vector2(occluder_inset, occluder_inset),
		Vector2(-occluder_inset, occluder_inset),
	])

	for spec_variant in pillar_cells:
		if not (spec_variant is Array):
			continue
		var spec: Array = spec_variant
		if spec.size() < 2 or not (spec[0] is Vector2i):
			continue
		var cell: Vector2i = spec[0] as Vector2i
		var label_text: String = str(spec[1])

		var body: StaticBody2D = StaticBody2D.new()
		body.position = floor_layer.map_to_local(cell)
		body.z_index = 3

		var shape_node: CollisionShape2D = CollisionShape2D.new()
		var rect_shape: RectangleShape2D = RectangleShape2D.new()
		rect_shape.size = Vector2(size - 4.0, size - 4.0)
		shape_node.shape = rect_shape
		body.add_child(shape_node)

		var block: Node2D = PlaceholderFactory.create_labeled_block(
			Vector2(size, size),
			Color(0.22, 0.23, 0.29, 1.0),
			label_text,
			Color(0.55, 0.58, 0.66, 1.0)
		)
		body.add_child(block)

		var occluder_node: LightOccluder2D = LightOccluder2D.new()
		var occluder_res: OccluderPolygon2D = OccluderPolygon2D.new()
		occluder_res.polygon = occ_poly
		occluder_res.closed = true
		occluder_res.cull_mode = OccluderPolygon2D.CULL_DISABLED
		occluder_node.occluder = occluder_res
		body.add_child(occluder_node)

		obstacles_root.add_child(body)


func _place_player() -> void:
	player.position = floor_layer.map_to_local(Vector2i(16, 10))
	var world_bounds: Rect2i = Rect2i(0, 0, MAP_WIDTH * _tile_size, MAP_HEIGHT * _tile_size)
	player.call("set_camera_limits", world_bounds)


func _should_reveal_blood_graffiti() -> bool:
	return GameState.is_context_overflow() or GameState.has_equipped_effect("reveal_hidden")


func _toggle_context_overflow_debug() -> void:
	if GameState.is_context_overflow():
		var safe_target: int = DataRegistry.get_config_int("context.psu_restore_to", 80)
		GameState.set_context(safe_target)
		hud.call("show_notice", "上下文恢复至 %d%% — 表世界稳定，隐藏血字已消退" % safe_target)
	else:
		GameState.set_context(15)
		hud.call("show_notice", "上下文降至 15% — 里世界溢出！地板隐藏血字显现")


func _on_context_changed(current: int, _maximum: int, is_overflow: bool) -> void:
	if is_overflow:
		hud.call("show_notice", "警告：上下文溢出（%d%%），里世界血字浮现！" % current)


func _on_lantern_mode_changed(is_dim: bool) -> void:
	hud.call("set_lantern_dim", is_dim)
	hud.call("show_notice", "提灯已切换为：%s" % ("调暗（低存在感）" if is_dim else "常亮"), 1.6)


func _on_hud_pause_toggled(is_paused: bool) -> void:
	player.call("set_movement_enabled", not is_paused)


func _return_to_boot() -> void:
	get_tree().change_scene_to_file(BOOT_SCENE_PATH)
