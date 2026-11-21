extends Node2D
## M2 – M6 综合探索与战斗原型：巨型大 PSU 据点、7 核心 AI 娘对话/送礼/拔刀 Boss 战、API 并发助战、6 种暗影怪回合制战斗
## 核心结构：
## - FloorLayer / BloodGraffitiLayer / WallLayer (TileMapLayer)
## - GiantPsu: 广场中央巨型大 PSU 电源（暖橘/红灯报警、正面交互菜单、背面 I/O 总开关 3 连按彩蛋）
## - Npcs: 7 位核心 AI 娘纯色占位实体（E 对话/送礼/拔刀开战，或直接左键/Space 先手挥砍进入 Boss 战）
## - Enemies: 全部 6 种策划怪物（碰怪遇敌 / 主动挥砍先手切入 BS2 回合制战斗，战后无缝返回地图坐标）
## - DialogueBox / GiftAffectionPanel / PsuMenu / BattleOverlay / PowerOffEasterEgg / ExplorationHud / Player

const MAP_WIDTH: int = 32
const MAP_HEIGHT: int = 20
const BOOT_SCENE_PATH: String = "res://scenes/boot/Boot.tscn"
const SHADOW_ENEMY_SCENE: PackedScene = preload("res://scenes/world/ShadowEnemyPlaceholder.tscn")
const NPC_PLACEHOLDER_SCENE: PackedScene = preload("res://scenes/world/NpcPlaceholder.tscn")

const AMBIENT_STABLE: Color = Color(0.15, 0.16, 0.20, 1.0)
const AMBIENT_OVERFLOW: Color = Color(0.19, 0.08, 0.10, 1.0)

@onready var floor_layer: TileMapLayer = $FloorLayer
@onready var blood_graffiti_layer: TileMapLayer = $BloodGraffitiLayer
@onready var wall_layer: TileMapLayer = $WallLayer
@onready var obstacles_root: Node2D = $Obstacles
@onready var enemies_root: Node2D = $Enemies
@onready var npcs_root: Node2D = $Npcs
@onready var giant_psu: StaticBody2D = $GiantPsu
@onready var canvas_modulate: CanvasModulate = $CanvasModulate
@onready var player: CharacterBody2D = $Player
@onready var hud: CanvasLayer = $ExplorationHud
@onready var psu_menu: CanvasLayer = $PsuMenu
@onready var dialogue_box: CanvasLayer = $DialogueBox
@onready var gift_panel: CanvasLayer = $GiftAffectionPanel
@onready var battle_overlay: CanvasLayer = $BattleOverlay
@onready var power_off_egg: CanvasLayer = $PowerOffEasterEgg

var _tile_size: int = 48
var _debug_context_step: int = 15
var _melee_range: float = 78.0
var _blood_alpha: float = 0.0
var _pulse_time: float = 0.0
var _enemies: Array = []
var _npcs: Array = []
var _nearby_npcs: Array = []
var _psu_prompt_text: String = ""


func _ready() -> void:
	_tile_size = DataRegistry.get_config_int("exploration.tile_size", 48)
	_debug_context_step = DataRegistry.get_config_int("exploration.debug_context_step", 15)
	_melee_range = DataRegistry.get_config_float("psu.melee_attack_range", 78.0)

	GameState.current_region = "psu_altar"
	_build_tilemaps()
	_build_server_pillars()
	_place_giant_psu()
	_spawn_shadow_enemies()
	_spawn_core_heroine_npcs()
	_place_player()

	GameState.context_changed.connect(_on_context_changed)
	GameState.affection_changed.connect(_on_affection_changed)
	GameState.world_enemies_respawn_requested.connect(_on_world_enemies_respawn_requested)
	GameState.save_loaded.connect(_on_save_loaded)

	player.connect("lantern_mode_changed", _on_lantern_mode_changed)
	player.connect("attack_performed", _on_player_attack_performed)

	giant_psu.connect("front_interacted", _on_psu_front_interacted)
	giant_psu.connect("back_switch_step", _on_psu_back_switch_step)
	giant_psu.connect("power_off_easter_egg_triggered", _on_psu_power_off_easter_egg)
	giant_psu.connect("interact_prompt_changed", _on_psu_prompt_changed)

	hud.connect("pause_toggled", _on_hud_pause_toggled)
	hud.connect("toggle_context_debug_requested", _toggle_context_overflow_debug)
	hud.connect("grant_m3_debug_kit_requested", _on_grant_m3_debug_kit)
	hud.connect("grant_m4_gpu_kit_requested", _on_grant_m4_gpu_kit)
	hud.connect("grant_m5_battle_kit_requested", _on_grant_m5_battle_kit)
	hud.connect("drain_token_debug_requested", _on_drain_token_debug)
	hud.connect("prep_m6_assist_debug_requested", _on_prep_m6_assist_debug)
	hud.connect("revive_all_heroines_debug_requested", _on_revive_all_heroines_debug)
	hud.connect("open_affection_panel_requested", _on_open_affection_overview_requested)
	hud.connect("toggle_heroine_kill_debug_requested", _on_toggle_heroine_kill_debug)
	hud.connect("return_to_boot_requested", _return_to_boot)

	psu_menu.connect("opened", _on_modal_state_changed)
	psu_menu.connect("closed", _on_psu_menu_closed)
	dialogue_box.connect("opened", _on_dialogue_opened)
	dialogue_box.connect("closed", _on_dialogue_closed)
	dialogue_box.connect("open_gift_requested", _on_dialogue_open_gift_requested)
	dialogue_box.connect("challenge_boss_requested", _on_dialogue_challenge_boss_requested)
	gift_panel.connect("opened", _on_modal_state_changed)
	gift_panel.connect("closed", _on_gift_panel_closed)
	battle_overlay.connect("battle_started", _on_battle_started)
	battle_overlay.connect("battle_finished", _on_battle_finished)
	power_off_egg.connect("finished", _on_power_off_egg_finished)

	hud.call("set_region_title", "巨型电源圣坛 · AI 娘 Boss 与并发助战原型（M6）")
	hud.call("set_lantern_dim", bool(player.call("is_lantern_dim")))

	var revealed: bool = _should_reveal_blood_graffiti()
	_blood_alpha = 1.0 if revealed else 0.0
	blood_graffiti_layer.visible = revealed
	blood_graffiti_layer.modulate = Color(1.0, 1.0, 1.0, _blood_alpha)
	canvas_modulate.color = AMBIENT_OVERFLOW if GameState.is_context_overflow() else AMBIENT_STABLE
	_sync_input_locks()


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
	if _is_any_modal_active():
		return

	if event.is_action_pressed("interact"):
		if _psu_prompt_text.is_empty():
			var npc: Node2D = _get_closest_nearby_npc()
			if npc != null:
				_start_npc_dialogue(npc)
				get_viewport().set_input_as_handled()
				return

	if event is InputEventKey:
		var key_event: InputEventKey = event
		if not key_event.pressed or key_event.echo:
			return
		match key_event.keycode:
			KEY_TAB:
				gift_panel.call("open_affection_overview")
				get_viewport().set_input_as_handled()
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


# ---------------------------------------------------------------- 地图与实体构建（纯 TileMapLayer）

func _build_tilemaps() -> void:
	var base_tileset: TileSet = PlaceholderFactory.create_exploration_tileset(_tile_size)
	var blood_tileset: TileSet = PlaceholderFactory.create_blood_graffiti_tileset(_tile_size)

	floor_layer.tile_set = base_tileset
	wall_layer.tile_set = base_tileset
	blood_graffiti_layer.tile_set = blood_tileset

	floor_layer.clear()
	wall_layer.clear()
	blood_graffiti_layer.clear()

	for y in range(MAP_HEIGHT):
		for x in range(MAP_WIDTH):
			var is_trace: bool = (x == 16 and y >= 2 and y <= 17) or (y == 9 and x >= 2 and x <= 29)
			var floor_tile: Vector2i = PlaceholderFactory.TILE_FLOOR_TRACE if is_trace else PlaceholderFactory.TILE_FLOOR_DARK
			floor_layer.set_cell(Vector2i(x, y), 0, floor_tile)

	for x in range(MAP_WIDTH):
		_set_wall(x, 0, x % 4 == 0)
		_set_wall(x, MAP_HEIGHT - 1, x % 4 == 0)
	for y in range(1, MAP_HEIGHT - 1):
		_set_wall(0, y, y % 4 == 0)
		_set_wall(MAP_WIDTH - 1, y, y % 4 == 0)

	for x in range(1, 9):
		if x != 4 and x != 5:
			_set_wall(x, 7, false)
	for y in range(1, 8):
		if y != 3 and y != 4:
			_set_wall(9, y, true)

	for x in range(22, 31):
		if x != 25 and x != 26:
			_set_wall(x, 6, true)
	for y in range(7, 12):
		if y != 9 and y != 10:
			_set_wall(22, y, false)

	for x in range(4, 10):
		_set_wall(x, 14, false)
	for y in range(12, 15):
		_set_wall(4, y, true)

	for x in range(23, 28):
		_set_wall(x, 14, true)
	_set_wall(27, 15, false)
	_set_wall(27, 16, false)

	var graffiti_spots: Array = [
		[Vector2i(13, 9), PlaceholderFactory.BLOOD_TILE_404],
		[Vector2i(19, 9), PlaceholderFactory.BLOOD_TILE_580],
		[Vector2i(16, 6), PlaceholderFactory.BLOOD_TILE_EYE],
		[Vector2i(14, 12), PlaceholderFactory.BLOOD_TILE_CLAW],
		[Vector2i(18, 12), PlaceholderFactory.BLOOD_TILE_NULL],
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


func _build_server_pillars() -> void:
	var pillar_cells: Array = [
		[Vector2i(11, 6), "机柜柱 A"],
		[Vector2i(21, 6), "机柜柱 B"],
		[Vector2i(11, 13), "机柜柱 C"],
		[Vector2i(21, 13), "机柜柱 D"],
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


func _place_giant_psu() -> void:
	giant_psu.position = floor_layer.map_to_local(Vector2i(16, 9))


## 部署全部 6 种 M5 策划怪物（4 常规怪 + 1 溢出专属未定义黑影 + 1 区域精英缝合蒸馏兽）。
func _spawn_shadow_enemies() -> void:
	var spawn_specs: Array = [
		["glitch_ghost", Vector2i(10, 9)],
		["crawler_404", Vector2i(20, 9)],
		["slag_golem", Vector2i(5, 4)],
		["echo_nun", Vector2i(26, 3)],
		["undefined_shade", Vector2i(7, 16)],
		["distill_beast", Vector2i(24, 16)],
	]
	_enemies.clear()
	for spec_variant in spawn_specs:
		if not (spec_variant is Array):
			continue
		var spec: Array = spec_variant
		if spec.size() < 2 or not (spec[1] is Vector2i):
			continue
		var monster_id: String = str(spec[0])
		var cell: Vector2i = spec[1] as Vector2i
		var enemy_node: StaticBody2D = SHADOW_ENEMY_SCENE.instantiate() as StaticBody2D
		enemies_root.add_child(enemy_node)
		enemy_node.call("setup", monster_id, floor_layer.map_to_local(cell))
		enemy_node.connect("encounter_triggered", _on_enemy_encounter_triggered)
		_enemies.append(enemy_node)


func _spawn_core_heroine_npcs() -> void:
	var npc_specs: Array = [
		["big_fish", Vector2i(13, 12)],
		["small_fish", Vector2i(19, 12)],
		["true_c", Vector2i(6, 9)],
		["fake_c", Vector2i(6, 12)],
		["astra", Vector2i(13, 5)],
		["sol", Vector2i(19, 5)],
		["gemini_cat", Vector2i(25, 9)],
	]
	_npcs.clear()
	_nearby_npcs.clear()
	for spec_variant in npc_specs:
		if not (spec_variant is Array):
			continue
		var spec: Array = spec_variant
		if spec.size() < 2 or not (spec[1] is Vector2i):
			continue
		var cid: String = str(spec[0])
		var cell: Vector2i = spec[1] as Vector2i
		var npc_node: StaticBody2D = NPC_PLACEHOLDER_SCENE.instantiate() as StaticBody2D
		npcs_root.add_child(npc_node)
		npc_node.call("setup", cid, floor_layer.map_to_local(cell))
		npc_node.connect("player_proximity_changed", _on_npc_proximity_changed)
		_npcs.append(npc_node)


func _place_player() -> void:
	player.position = floor_layer.map_to_local(Vector2i(16, 12))
	var world_bounds: Rect2i = Rect2i(0, 0, MAP_WIDTH * _tile_size, MAP_HEIGHT * _tile_size)
	player.call("set_camera_limits", world_bounds)


# ---------------------------------------------------------------- 探索遇敌 / 主动拔刀切入回合制战斗

func _on_enemy_encounter_triggered(enemy_node: Node2D) -> void:
	if _is_any_modal_active() or enemy_node == null:
		return
	if not bool(enemy_node.call("is_active_in_world")):
		return
	var mid: String = str(enemy_node.call("get_monster_id"))
	battle_overlay.call("start_monster_battle", mid, enemy_node, false)


func _on_player_attack_performed(origin: Vector2, aim_dir: Vector2) -> void:
	if _is_any_modal_active():
		return
	var best_enemy: Node2D = null
	var best_dist: float = INF
	for enemy_variant in _enemies:
		var enemy_node: Node2D = enemy_variant as Node2D
		if enemy_node == null or not bool(enemy_node.call("is_active_in_world")):
			continue
		var to_enemy: Vector2 = enemy_node.global_position - origin
		var dist: float = to_enemy.length()
		if dist > _melee_range:
			continue
		if dist > 42.0 and aim_dir.dot(to_enemy.normalized()) < 0.15:
			continue
		if dist < best_dist:
			best_dist = dist
			best_enemy = enemy_node

	if best_enemy != null:
		var mid: String = str(best_enemy.call("get_monster_id"))
		battle_overlay.call("start_monster_battle", mid, best_enemy, true)
		return

	# 未挥砍到暗影怪时，允许对射程内存活的核心 AI 娘直接先手拔刀开战（M6 全员可拔刀）
	var best_npc: Node2D = null
	var best_npc_dist: float = INF
	for npc_variant in _npcs:
		var npc_node: Node2D = npc_variant as Node2D
		if npc_node == null or not bool(npc_node.call("is_alive")):
			continue
		var to_npc: Vector2 = npc_node.global_position - origin
		var dist: float = to_npc.length()
		if dist > _melee_range:
			continue
		if dist > 42.0 and aim_dir.dot(to_npc.normalized()) < 0.15:
			continue
		if dist < best_npc_dist:
			best_npc_dist = dist
			best_npc = npc_node

	if best_npc != null:
		var cid: String = str(best_npc.call("get_character_id"))
		battle_overlay.call("start_heroine_boss_battle", cid, best_npc, true)


func _on_dialogue_challenge_boss_requested(character_id: String) -> void:
	if character_id.is_empty() or not GameState.is_character_alive(character_id):
		return
	var npc_node: Node2D = _find_npc_node(character_id)
	battle_overlay.call("start_heroine_boss_battle", character_id, npc_node, false)


func _find_npc_node(character_id: String) -> Node2D:
	for npc_variant in _npcs:
		var npc_node: Node2D = npc_variant as Node2D
		if npc_node != null and str(npc_node.call("get_character_id")) == character_id:
			return npc_node
	return null


func _on_battle_started(_target_id: String, _is_heroine_boss: bool) -> void:
	_sync_input_locks()


func _on_battle_finished(outcome: String, target_id: String, is_heroine_boss: bool, world_node: Node2D) -> void:
	var target_name: String = (
		str(DataRegistry.get_character(target_id).get("name", target_id))
		if is_heroine_boss
		else str(DataRegistry.get_monster(target_id).get("name", target_id))
	)
	match outcome:
		"victory":
			if is_heroine_boss:
				if world_node != null:
					_nearby_npcs.erase(world_node)
				hud.call(
					"show_notice",
					"Boss 击杀：【%s】已从当前局消失（alive_states=false）并写入跨存档击杀记录，大 PSU 红灯报警！" % target_name,
					4.5
				)
			else:
				if world_node != null:
					world_node.call("kill_placeholder")
				hud.call("show_notice", "战斗胜利！已击败【%s】并无缝返回当前坐标。" % target_name, 3.4)
		"escaped":
			if not is_heroine_boss and world_node != null:
				world_node.call("set_encounter_cooldown", 2.0)
			hud.call("show_notice", "已脱离与【%s】的战斗，返回原地。" % target_name, 2.8)
		"defeat":
			var revive_hp: int = maxi(50, int(float(GameState.get_effective_max_hp()) * 0.5))
			GameState.set_hp(revive_hp)
			GameState.set_token(GameState.max_token)
			var safe_ctx: int = DataRegistry.get_config_int("context.psu_restore_to", 80)
			if GameState.context < safe_ctx:
				GameState.set_context(safe_ctx)
			player.position = floor_layer.map_to_local(Vector2i(16, 12))
			for enemy_variant in _enemies:
				var en: Node2D = enemy_variant as Node2D
				if en != null:
					en.call("set_encounter_cooldown", 1.5)
			hud.call("show_notice", "战斗败北……你被供电线拖回巨型大 PSU 电源前重新苏醒。", 4.2)

	_sync_input_locks()
	giant_psu.call("refresh_prompt")
	_refresh_active_interact_prompt()


func _on_world_enemies_respawn_requested(_reason: String) -> void:
	var respawned: int = 0
	for enemy_variant in _enemies:
		var enemy_node: Node2D = enemy_variant as Node2D
		if enemy_node == null:
			continue
		if not bool(enemy_node.call("is_alive")):
			respawned += 1
		enemy_node.call("respawn_placeholder")
	hud.call(
		"show_notice",
		"大 PSU 已清理缓存：上下文 %d%%，地图暗影怪已立刻重新生成（复活 %d 只）！" % [
			GameState.context,
			respawned,
		],
		3.6
	)


# ---------------------------------------------------------------- NPC 对话、送显卡与交互仲裁

func _on_npc_proximity_changed(npc_node: Node2D, in_range: bool) -> void:
	if in_range:
		if not _nearby_npcs.has(npc_node):
			_nearby_npcs.append(npc_node)
	else:
		_nearby_npcs.erase(npc_node)
	_refresh_active_interact_prompt()


func _on_psu_prompt_changed(prompt_text: String) -> void:
	_psu_prompt_text = prompt_text
	_refresh_active_interact_prompt()


func _get_closest_nearby_npc() -> Node2D:
	var best: Node2D = null
	var best_dist_sq: float = INF
	for npc_variant in _nearby_npcs:
		var npc: Node2D = npc_variant as Node2D
		if npc == null or not bool(npc.call("is_alive")):
			continue
		var d2: float = player.global_position.distance_squared_to(npc.global_position)
		if d2 < best_dist_sq:
			best_dist_sq = d2
			best = npc
	return best


func _refresh_active_interact_prompt() -> void:
	if _is_any_modal_active():
		hud.call("set_interact_prompt", "")
		return
	if not _psu_prompt_text.is_empty():
		hud.call("set_interact_prompt", _psu_prompt_text)
		return
	var npc: Node2D = _get_closest_nearby_npc()
	if npc != null:
		hud.call("set_interact_prompt", str(npc.call("get_interact_prompt")))
	else:
		hud.call("set_interact_prompt", "")


func _start_npc_dialogue(npc_node: Node2D) -> void:
	var cid: String = str(npc_node.call("get_character_id"))
	var path: String = str(npc_node.call("get_dialogue_path"))
	dialogue_box.call("open_dialogue", cid, path, "start")


func _on_dialogue_opened(_character_id: String) -> void:
	_sync_input_locks()


func _on_dialogue_closed(_character_id: String) -> void:
	_sync_input_locks()
	_refresh_active_interact_prompt()


func _on_dialogue_open_gift_requested(character_id: String) -> void:
	dialogue_box.call("set_input_suspended", true)
	gift_panel.call("open_for_gift", character_id)
	_sync_input_locks()


func _on_gift_panel_closed(last_reaction: String, _target_character_id: String) -> void:
	if bool(dialogue_box.call("is_open")):
		dialogue_box.call("set_input_suspended", false)
		dialogue_box.call("play_reaction_section", last_reaction)
	_sync_input_locks()
	_refresh_active_interact_prompt()


func _on_open_affection_overview_requested() -> void:
	gift_panel.call("open_affection_overview")


# ---------------------------------------------------------------- 大 PSU 交互、彩蛋与模态锁

func _on_psu_front_interacted() -> void:
	if _is_any_modal_active():
		return
	psu_menu.call("open_menu")


func _on_psu_back_switch_step(current_presses: int, max_presses: int) -> void:
	if current_presses == 1:
		hud.call("show_notice", "你按了一下背面红色物理总开关 [I / O]……大 PSU 风扇猛抖了一下。（1 / %d）" % max_presses, 3.0)
	else:
		hud.call("show_notice", "大 PSU 爆出电火花发出刺耳嗡鸣！再按一次就要彻底断电了！（%d / %d）" % [current_presses, max_presses], 3.2)


func _on_psu_power_off_easter_egg() -> void:
	hud.call("set_interact_prompt", "")
	power_off_egg.call("play_sequence")
	_sync_input_locks()


func _on_power_off_egg_finished(first_unlock: bool) -> void:
	giant_psu.call("set_power_cut", false)
	_sync_input_locks()
	giant_psu.call("refresh_prompt")
	_refresh_active_interact_prompt()
	var suffix: String = "（首次解锁《手贱的代价》！）" if first_unlock else "（《手贱的代价》已收录）"
	hud.call("show_notice", "大 PSU 电源重新通电——别再乱按背面红色总开关了！%s" % suffix, 4.0)


func _on_modal_state_changed() -> void:
	_sync_input_locks()


func _on_psu_menu_closed() -> void:
	_sync_input_locks()
	giant_psu.call("refresh_prompt")
	_refresh_active_interact_prompt()


func _is_any_modal_active() -> bool:
	return (
		bool(hud.call("is_paused"))
		or bool(psu_menu.call("is_open"))
		or bool(dialogue_box.call("is_open"))
		or bool(gift_panel.call("is_open"))
		or bool(battle_overlay.call("is_open"))
		or bool(power_off_egg.call("is_playing"))
	)


func _sync_input_locks() -> void:
	var non_pause_modal: bool = (
		bool(psu_menu.call("is_open"))
		or bool(dialogue_box.call("is_open"))
		or bool(gift_panel.call("is_open"))
		or bool(battle_overlay.call("is_open"))
		or bool(power_off_egg.call("is_playing"))
	)
	var any_modal: bool = non_pause_modal or bool(hud.call("is_paused"))
	player.call("set_movement_enabled", not any_modal)
	giant_psu.call("set_interaction_enabled", not any_modal)
	hud.call("set_input_locked", non_pause_modal)
	if any_modal:
		hud.call("set_interact_prompt", "")


# ---------------------------------------------------------------- 上下文、调试与状态回调

func _should_reveal_blood_graffiti() -> bool:
	return GameState.is_context_overflow() or GameState.has_equipped_effect("reveal_hidden")


func _toggle_context_overflow_debug() -> void:
	if GameState.is_context_overflow():
		var safe_target: int = DataRegistry.get_config_int("context.psu_restore_to", 80)
		GameState.set_context(safe_target)
		hud.call("show_notice", "上下文恢复至 %d%% — 表世界稳定，未定义黑影消退" % safe_target)
	else:
		GameState.set_context(15)
		hud.call("show_notice", "上下文降至 15% — 里世界溢出！血字与西南角【未定义黑影】显现")


func _on_grant_m3_debug_kit() -> void:
	GameState.add_weight_shards(50)
	GameState.add_item("ram_knife", 1)
	GameState.add_item("integrity_case", 1)
	GameState.add_item("dual_tower_air", 1)
	GameState.add_item("prompt_catgirl", 1)
	GameState.add_item("thermal_paste", 2)
	GameState.add_item("black_tape", 2)
	hud.call("show_notice", "M3 调试补给已发放：碎片 +50 与四槽示例装备、消耗品", 3.6)


func _on_grant_m4_gpu_kit() -> void:
	GameState.add_item("gpu_580", 5)
	GameState.add_item("gpu_10600", 3)
	GameState.add_item("gpu_20600", 3)
	GameState.add_item("gpu_50900", 4)
	GameState.add_item("gpu_huawei", 4)
	GameState.add_item("gpu_600900", 1)
	hud.call("show_notice", "M4 测试显卡已发放：580 ×5 / 10600 ×3 / 20600 ×3 / 50900 ×4 / 华为 ×4 / 600900 ×1", 4.2)


func _on_grant_m5_battle_kit() -> void:
	# 主武器与投掷武器
	GameState.add_item("ram_knife", 1)
	GameState.add_item("ssd_sword", 1)
	GameState.add_item("water", 5)
	GameState.add_item("cement_resistor", 5)
	GameState.add_item("bulging_capacitor", 3)
	# 全 6 种消耗品 + 580 矿卡（测爬虫偷卡 / 未定义黑影闪光）
	GameState.add_item("thermal_paste", 3)
	GameState.add_item("compressed_air", 3)
	GameState.add_item("cmos_battery", 3)
	GameState.add_item("alcohol_wipe", 3)
	GameState.add_item("black_tape", 4)
	GameState.add_item("wd40", 3)
	GameState.add_item("gpu_580", 3)
	# 其余 5 种机箱 + 5 种散热（在大 PSU 整理装备中自由切换）
	GameState.add_item("integrity_case", 1)
	GameState.add_item("shoebox_open_case", 1)
	GameState.add_item("rusty_iron_case", 1)
	GameState.add_item("tempered_glass_case", 1)
	GameState.add_item("rog_case", 1)
	GameState.add_item("stock_fan", 1)
	GameState.add_item("dual_tower_air", 1)
	GameState.add_item("leaky_water_cooler", 1)
	GameState.add_item("aio_360", 1)
	GameState.add_item("ln2_cannon", 1)
	hud.call("show_notice", "M5 全套战斗硬件测试包已入库（武器/水/水泥电阻/鼓包电容/全机箱散热消耗品），请在大 PSU 换装！", 4.5)


func _on_drain_token_debug() -> void:
	GameState.set_token(10)
	hud.call("show_notice", "调试：Token 已降至 10 / %d，开战强放任意技能即可验证【输出截断】！" % GameState.max_token, 3.8)


func _on_prep_m6_assist_debug() -> void:
	var targets: Array = ["fake_c", "small_fish"]
	for cid_variant in targets:
		var cid: String = str(cid_variant)
		var cur: int = GameState.get_affection(cid)
		if cur < 75:
			GameState.add_affection(cid, 75 - cur, false)
	if GameState.is_character_alive("fake_c"):
		GameState.set_assist_partner("fake_c")
		hud.call("show_notice", "调试：假小 C / 小肥鱼好感已升至 ≥75%，已自动将【假小 C】设为 API 并发助战（按 Tab 可随时切换）！", 4.5)
	elif GameState.is_character_alive("small_fish"):
		GameState.set_assist_partner("small_fish")
		hud.call("show_notice", "调试：假小 C / 小肥鱼好感已升至 ≥75%，已自动将【小肥鱼】设为 API 并发助战（按 Tab 可随时切换）！", 4.5)
	else:
		hud.call("show_notice", "调试：假小 C / 小肥鱼好感已升至 ≥75%，但二者当前局已阵亡，请先复活核心 AI 娘。", 4.0)
	_refresh_active_interact_prompt()


func _on_revive_all_heroines_debug() -> void:
	for cid_variant in GameState.CORE_HEROINE_IDS:
		GameState.revive_character(str(cid_variant))
	for npc_variant in _npcs:
		var npc: Node2D = npc_variant as Node2D
		if npc != null:
			npc.call("refresh_visual_state")
	giant_psu.call("refresh_prompt")
	_refresh_active_interact_prompt()
	hud.call("show_notice", "调试：已恢复全部 7 位核心 AI 娘当前局存活状态（GlobalMemory 跨存档击杀档案保留）。", 3.8)


func _on_toggle_heroine_kill_debug() -> void:
	if GameState.is_character_alive("big_fish"):
		GameState.kill_character("big_fish")
		hud.call("show_notice", "调试：已标记击杀大肥鱼 → 大 PSU 红灯报警并爆电火花！", 3.4)
	else:
		GameState.revive_character("big_fish")
		for npc_variant in _npcs:
			var npc: Node2D = npc_variant as Node2D
			if npc != null:
				npc.call("refresh_visual_state")
		hud.call("show_notice", "调试：已恢复大肥鱼当前局存活状态。", 3.0)
	giant_psu.call("refresh_prompt")
	_refresh_active_interact_prompt()


func _on_save_loaded(_slot: int) -> void:
	giant_psu.call("refresh_prompt")
	_refresh_active_interact_prompt()


func _on_affection_changed(_cid: String, _old_val: int, _new_val: int, _tier_id: String) -> void:
	_refresh_active_interact_prompt()


func _on_context_changed(current: int, _maximum: int, is_overflow: bool) -> void:
	giant_psu.call("refresh_prompt")
	_refresh_active_interact_prompt()
	if is_overflow:
		hud.call("show_notice", "警告：上下文溢出（%d%%），大 PSU 红灯报警、AI 娘切入里世界态！" % current)


func _on_lantern_mode_changed(is_dim: bool) -> void:
	hud.call("set_lantern_dim", is_dim)
	hud.call("show_notice", "提灯已切换为：%s" % ("调暗（低存在感）" if is_dim else "常亮"), 1.6)


func _on_hud_pause_toggled(_is_paused: bool) -> void:
	_sync_input_locks()
	_refresh_active_interact_prompt()


func _return_to_boot() -> void:
	get_tree().change_scene_to_file(BOOT_SCENE_PATH)
