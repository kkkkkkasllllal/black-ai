extends StaticBody2D
## 暗影怪大地图占位实体（2 帧红眼黑影剪影，M5 升级支持碰撞遇敌 + 溢出专属浮现 + 精英标记）
## - 玩家靠近触碰 EncounterZone 触发常规遇敌；主动按鼠标左键 / Space 挥砍命中触发先手回合制战斗
## - overflow_only 怪物（如未定义黑影）仅在上下文溢出（<= 30%）时显形并可遇敌
## - 大 PSU 电源【清理缓存】发出刷新信号后立刻满状态重生

signal defeated(enemy_node: Node2D, reward_info: Dictionary)
signal encounter_triggered(enemy_node: Node2D)

@onready var collision_shape: CollisionShape2D = $CollisionShape2D
@onready var encounter_zone: Area2D = $EncounterZone
@onready var encounter_shape: CollisionShape2D = $EncounterZone/CollisionShape2D
@onready var visual_root: Node2D = $Visual
@onready var body_outline: ColorRect = $Visual/BodyOutline
@onready var body_fill: ColorRect = $Visual/BodyFill
@onready var eye_left: ColorRect = $Visual/EyeLeft
@onready var eye_right: ColorRect = $Visual/EyeRight
@onready var name_label: Label = $Visual/NameLabel

var monster_id: String = "glitch_ghost"
var spawn_position: Vector2 = Vector2.ZERO
var overflow_only: bool = false
var is_boss_monster: bool = false

var _alive: bool = true
var _anim_time: float = 0.0
var _flash_timer: float = 0.0
var _encounter_cooldown: float = 0.0


func setup(p_monster_id: String, p_spawn_position: Vector2) -> void:
	monster_id = p_monster_id
	spawn_position = p_spawn_position
	position = spawn_position
	_apply_monster_data()
	_sync_presence()


func _ready() -> void:
	encounter_zone.body_entered.connect(_on_encounter_body_entered)
	GameState.context_changed.connect(_on_context_changed)
	_apply_monster_data()
	_sync_presence()


func _process(delta: float) -> void:
	if _encounter_cooldown > 0.0:
		_encounter_cooldown = maxf(0.0, _encounter_cooldown - delta)
	if not visible:
		return
	_anim_time += delta
	var frame_odd: bool = int(floor(_anim_time / 0.35)) % 2 == 1
	visual_root.position.y = -3.0 if frame_odd else 0.0
	var eye_color: Color = Color(1.0, 0.18, 0.20, 1.0) if frame_odd else Color(0.75, 0.06, 0.10, 1.0)
	eye_left.color = eye_color
	eye_right.color = eye_color

	if _flash_timer > 0.0:
		_flash_timer = maxf(0.0, _flash_timer - delta)
		modulate = Color(1.4, 0.55, 0.55, 1.0) if _flash_timer > 0.0 else Color.WHITE


func get_monster_id() -> String:
	return monster_id


func is_alive() -> bool:
	return _alive


func is_active_in_world() -> bool:
	if not _alive:
		return false
	if overflow_only and not GameState.is_context_overflow():
		return false
	return true


func set_encounter_cooldown(seconds: float) -> void:
	_encounter_cooldown = maxf(_encounter_cooldown, seconds)


func kill_placeholder() -> Dictionary:
	if not _alive:
		return {}
	_alive = false
	_sync_presence()
	var data: Dictionary = DataRegistry.get_monster(monster_id)
	var reward: Dictionary = {
		"monster_id": monster_id,
		"name": str(data.get("name", monster_id)),
		"weight_shards": int(data.get("weight_shards", 3)),
	}
	defeated.emit(self, reward)
	return reward


func respawn_placeholder() -> void:
	_alive = true
	position = spawn_position
	_encounter_cooldown = 0.6
	_sync_presence()
	if visible:
		_flash_timer = 0.45


func _apply_monster_data() -> void:
	if not is_node_ready():
		return
	var data: Dictionary = DataRegistry.get_monster(monster_id)
	overflow_only = bool(data.get("overflow_only", false))
	is_boss_monster = bool(data.get("is_boss", false))
	var display_name: String = str(data.get("name", monster_id))
	var shards: int = int(data.get("weight_shards", 3))
	var prefix: String = "[精英] " if is_boss_monster else ("[溢出] " if overflow_only else "")
	name_label.text = "%s%s (+%d碎片)" % [prefix, display_name, shards]
	var accent: Color = Color.from_string(str(data.get("placeholder_color", "#222222")), Color(0.12, 0.12, 0.14, 1.0))
	body_fill.color = accent.darkened(0.72)
	body_outline.color = Color(0.78, 0.35, 0.96, 0.95) if is_boss_monster else Color(0.55, 0.10, 0.14, 0.90)
	visual_root.scale = Vector2(1.22, 1.22) if is_boss_monster else Vector2.ONE


func _sync_presence() -> void:
	if not is_node_ready():
		return
	var active: bool = is_active_in_world()
	visible = active
	collision_shape.set_deferred("disabled", not active)
	encounter_shape.set_deferred("disabled", not active)


func _on_context_changed(_current: int, _maximum: int, _is_overflow: bool) -> void:
	if overflow_only:
		_sync_presence()


func _on_encounter_body_entered(body: Node) -> void:
	if not is_active_in_world() or _encounter_cooldown > 0.0:
		return
	if body is CharacterBody2D and body.name == "Player":
		encounter_triggered.emit(self)
