extends StaticBody2D
## M3 测试暗影怪占位实体（2 帧红眼黑影剪影）
## 用于验证大 PSU 电源【清理缓存】立即刷新暗影怪，以及清理暗影怪掉落废弃权重碎片升级 HP。
## 正式回合制战斗将在 M5 接入，此处仅支持近身挥砍清理与刷新重置。

signal defeated(enemy_node: Node2D, reward_info: Dictionary)

@onready var collision_shape: CollisionShape2D = $CollisionShape2D
@onready var visual_root: Node2D = $Visual
@onready var body_fill: ColorRect = $Visual/BodyFill
@onready var eye_left: ColorRect = $Visual/EyeLeft
@onready var eye_right: ColorRect = $Visual/EyeRight
@onready var name_label: Label = $Visual/NameLabel

var monster_id: String = "glitch_ghost"
var spawn_position: Vector2 = Vector2.ZERO
var _alive: bool = true
var _anim_time: float = 0.0
var _flash_timer: float = 0.0


func setup(p_monster_id: String, p_spawn_position: Vector2) -> void:
	monster_id = p_monster_id
	spawn_position = p_spawn_position
	position = spawn_position
	_apply_monster_data()


func _ready() -> void:
	_apply_monster_data()


func _process(delta: float) -> void:
	if not _alive:
		return
	_anim_time += delta
	# 大地图 2 帧红眼黑影剪影节奏（每 0.35s 切换一次轻微上下抖动与红眼亮度）
	var frame_odd: bool = int(floor(_anim_time / 0.35)) % 2 == 1
	visual_root.position.y = -3.0 if frame_odd else 0.0
	var eye_color: Color = Color(1.0, 0.18, 0.20, 1.0) if frame_odd else Color(0.75, 0.06, 0.10, 1.0)
	eye_left.color = eye_color
	eye_right.color = eye_color

	if _flash_timer > 0.0:
		_flash_timer = maxf(0.0, _flash_timer - delta)
		modulate = Color(1.4, 0.55, 0.55, 1.0) if _flash_timer > 0.0 else Color.WHITE


func is_alive() -> bool:
	return _alive


func kill_placeholder() -> Dictionary:
	if not _alive:
		return {}
	_alive = false
	visible = false
	collision_shape.set_deferred("disabled", true)
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
	visible = true
	collision_shape.set_deferred("disabled", false)
	_flash_timer = 0.45


func _apply_monster_data() -> void:
	if not is_node_ready():
		return
	var data: Dictionary = DataRegistry.get_monster(monster_id)
	var display_name: String = str(data.get("name", monster_id))
	var shards: int = int(data.get("weight_shards", 3))
	name_label.text = "%s (+%d碎片)" % [display_name, shards]
	var accent: Color = Color.from_string(str(data.get("placeholder_color", "#222222")), Color(0.12, 0.12, 0.14, 1.0))
	body_fill.color = accent.darkened(0.72)
