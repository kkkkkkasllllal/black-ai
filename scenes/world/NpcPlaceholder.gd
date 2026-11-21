extends StaticBody2D
## 7 位核心 AI 娘纯色色块 NPC 占位实体（M4 起通用）
## - 颜色、名称、原型严格从 DataRegistry.get_character(character_id) 读取
## - 表世界为高饱和代表色块；上下文溢出（<=30%）或好感偏执溢出（>=101%）时出现暗红裂纹与微颤
## - 玩家进入 InteractZone 时向探索场景上报，由场景仲裁最近可交互对象

signal player_proximity_changed(npc_node: Node2D, in_range: bool)

@onready var collision_shape: CollisionShape2D = $CollisionShape2D
@onready var visual_root: Node2D = $Visual
@onready var border_rect: ColorRect = $Visual/BorderRect
@onready var fill_rect: ColorRect = $Visual/FillRect
@onready var crack_a: ColorRect = $Visual/CrackA
@onready var crack_b: ColorRect = $Visual/CrackB
@onready var name_label: Label = $Visual/NameLabel
@onready var affection_label: Label = $Visual/AffectionLabel
@onready var aura_light: PointLight2D = $AuraLight
@onready var interact_zone: Area2D = $InteractZone

var character_id: String = "big_fish"
var _display_name: String = ""
var _base_color: Color = Color.WHITE
var _player_in_range: bool = false
var _time: float = 0.0
var _rng: RandomNumberGenerator = RandomNumberGenerator.new()


func setup(p_character_id: String, world_pos: Vector2) -> void:
	character_id = p_character_id
	position = world_pos
	_apply_character_data()
	_refresh_alive_state()
	_refresh_affection_label()


func _ready() -> void:
	_rng.randomize()
	interact_zone.body_entered.connect(_on_zone_body_entered)
	interact_zone.body_exited.connect(_on_zone_body_exited)
	GameState.affection_changed.connect(_on_affection_changed)
	GameState.character_killed.connect(_on_character_killed)
	GameState.save_loaded.connect(_on_save_loaded)
	_apply_character_data()
	_refresh_alive_state()
	_refresh_affection_label()


func _process(delta: float) -> void:
	if not visible:
		return
	_time += delta
	var overflow_state: bool = is_in_overflow_form()
	crack_a.visible = overflow_state
	crack_b.visible = overflow_state

	if overflow_state:
		border_rect.color = Color(0.92, 0.12, 0.16, 1.0)
		fill_rect.color = _base_color.darkened(0.32)
		visual_root.position = Vector2(
			_rng.randf_range(-1.4, 1.4),
			_rng.randf_range(-1.4, 1.4)
		)
	else:
		border_rect.color = Color(0.94, 0.94, 0.96, 1.0)
		fill_rect.color = _base_color
		visual_root.position = Vector2(0.0, sin(_time * 2.4 + position.x * 0.03) * 1.6)

	if aura_light.visible:
		if overflow_state:
			aura_light.color = Color(1.0, 0.95, 0.85, 1.0)
			aura_light.energy = 1.85 + 0.25 * sin(_time * 8.0)
		else:
			aura_light.color = Color(1.0, 0.72, 0.28, 1.0)
			aura_light.energy = 0.85 + 0.08 * sin(_time * 2.5)


func get_character_id() -> String:
	return character_id


func get_display_name() -> String:
	return _display_name


func get_dialogue_path() -> String:
	return "res://dialogue/%s.dialogue" % character_id


func is_alive() -> bool:
	return GameState.is_character_alive(character_id)


func is_in_overflow_form() -> bool:
	return GameState.is_context_overflow() or GameState.get_affection(character_id) >= 101


func get_interact_prompt() -> String:
	var aff: int = GameState.get_affection(character_id)
	var tier: Dictionary = GameState.get_affection_tier(character_id)
	var tier_name: String = str(tier.get("name", "初见"))
	var suffix: String = " [里世界态]" if is_in_overflow_form() else ""
	return "[E] 与【%s】对话 / 送显卡（好感 %d%% · %s）%s" % [_display_name, aff, tier_name, suffix]


func refresh_visual_state() -> void:
	_refresh_alive_state()
	_refresh_affection_label()


func _apply_character_data() -> void:
	if not is_node_ready():
		return
	var data: Dictionary = DataRegistry.get_character(character_id)
	_display_name = str(data.get("name", character_id))
	_base_color = Color.from_string(str(data.get("placeholder_color", "#ffffff")), Color.WHITE)
	fill_rect.color = _base_color
	name_label.text = _display_name

	# 小龙娘（Sol）自带暖阳微光光环，契合策划“在小龙娘暖光旁停留”设定
	if character_id == "sol":
		aura_light.visible = true
		aura_light.texture = PlaceholderFactory.create_radial_light_texture(128)
		aura_light.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
		aura_light.blend_mode = PointLight2D.BLEND_MODE_ADD
		aura_light.shadow_enabled = false
		aura_light.texture_scale = 1.9
	else:
		aura_light.visible = false


func _refresh_alive_state() -> void:
	if not is_node_ready():
		return
	var alive: bool = is_alive()
	visible = alive
	collision_shape.set_deferred("disabled", not alive)
	if not alive and _player_in_range:
		_player_in_range = false
		player_proximity_changed.emit(self, false)


func _refresh_affection_label() -> void:
	if not is_node_ready():
		return
	var aff: int = GameState.get_affection(character_id)
	var tier: Dictionary = GameState.get_affection_tier(character_id)
	var tier_name: String = str(tier.get("name", "初见"))
	affection_label.text = "%d%% · %s" % [aff, tier_name]
	if aff >= 101:
		affection_label.modulate = Color(1.0, 0.25, 0.30, 1.0)
	elif aff >= 100:
		affection_label.modulate = Color(1.0, 0.85, 0.35, 1.0)
	elif aff >= 70:
		affection_label.modulate = Color(1.0, 0.62, 0.78, 1.0)
	else:
		affection_label.modulate = Color(0.80, 0.86, 0.94, 1.0)


func _is_player_body(body: Node) -> bool:
	return body is CharacterBody2D and body.name == "Player"


func _on_zone_body_entered(body: Node) -> void:
	if _is_player_body(body) and is_alive():
		_player_in_range = true
		player_proximity_changed.emit(self, true)


func _on_zone_body_exited(body: Node) -> void:
	if _is_player_body(body) and _player_in_range:
		_player_in_range = false
		player_proximity_changed.emit(self, false)


func _on_affection_changed(cid: String, _old_val: int, _new_val: int, _tier_id: String) -> void:
	if cid == character_id:
		_refresh_affection_label()


func _on_character_killed(cid: String) -> void:
	if cid == character_id:
		_refresh_alive_state()


func _on_save_loaded(_slot: int) -> void:
	_refresh_alive_state()
	_refresh_affection_label()
