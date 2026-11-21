extends CanvasLayer
## 5 秒假断电蓝屏搞笑彩蛋结局《手贱的代价》（M3 核心交付物）
## 触发条件：绕到巨型大 PSU 电源背面连续按 3 次红色物理总开关（I / O）。
## 自动写入 GlobalMemory.unlock_ending("joke_itchy_fingers")，5 秒后自动通电恢复可操作状态。

signal finished(first_unlock: bool)

const ENDING_ID: String = "joke_itchy_fingers"

@onready var screen_bg: ColorRect = $ScreenBg
@onready var content_box: VBoxContainer = $Center/ContentBox
@onready var face_label: Label = $Center/ContentBox/FaceLabel
@onready var body_label: Label = $Center/ContentBox/BodyLabel
@onready var unlock_label: Label = $Center/ContentBox/UnlockLabel
@onready var countdown_label: Label = $Center/ContentBox/CountdownLabel

var _active: bool = false
var _elapsed: float = 0.0
var _total_duration: float = 5.0
var _first_unlock: bool = false


func _ready() -> void:
	visible = false
	_total_duration = maxf(2.0, DataRegistry.get_config_float("psu.easter_egg_duration", 5.0))


func play_sequence() -> void:
	if _active:
		return
	_active = true
	_elapsed = 0.0
	_first_unlock = GlobalMemory.unlock_ending(ENDING_ID)
	visible = true
	_update_stage()


func is_playing() -> bool:
	return _active


func _input(event: InputEvent) -> void:
	if not _active:
		return
	# 彩蛋播放期间吞掉键盘与点击输入，防止误触菜单或移动
	if event is InputEventKey or event is InputEventMouseButton:
		get_viewport().set_input_as_handled()


func _process(delta: float) -> void:
	if not _active:
		return
	_elapsed += delta
	if _elapsed >= _total_duration:
		_active = false
		visible = false
		finished.emit(_first_unlock)
		return
	_update_stage()


func _update_stage() -> void:
	var remaining: float = maxf(0.0, _total_duration - _elapsed)
	if _elapsed < 0.65:
		# 阶段 1：瞬间断电黑屏
		screen_bg.color = Color(0.01, 0.01, 0.01, 1.0)
		face_label.text = "[CLICK]"
		body_label.text = "POWER LOSS DETECTED // PSU MASTER SWITCH [O]\n整座黑曜石主板广场瞬间断电……"
		unlock_label.text = ""
		countdown_label.text = ""
		content_box.modulate = Color(0.85, 0.85, 0.85, 1.0)
	elif _elapsed < _total_duration - 0.55:
		# 阶段 2：经典假蓝屏 + 彩蛋结局认证
		screen_bg.color = Color(0.04, 0.24, 0.66, 1.0)
		face_label.text = ":("
		body_label.text = (
			"你的整座暗黑废墟遇到了严重问题，需要立刻重新通电。\n"
			+ "检测到有人绕到巨型大 PSU 电源背面，连续三次掰下了红色物理总开关。\n\n"
			+ "终止代码：USER_ITCHY_FINGERS_PSU_OFF (0x00000580)\n"
			+ "失败模块：giant_psu_master_switch.sys"
		)
		var ending_data: Dictionary = DataRegistry.get_ending(ENDING_ID)
		var ending_name: String = str(ending_data.get("name", "手贱的代价"))
		var tag: String = "（首次解锁！已永久写入 GlobalMemory）" if _first_unlock else "（已收录于 GlobalMemory）"
		unlock_label.text = "★ 彩蛋结局：《%s》 %s ★" % [ending_name, tag]
		countdown_label.text = "正在慌忙把插头重新怼回去…… %.1f 秒后恢复供电" % remaining
		content_box.modulate = Color.WHITE
	else:
		# 阶段 3：白光重新通电闪回
		var flash_t: float = clampf((_elapsed - (_total_duration - 0.55)) / 0.55, 0.0, 1.0)
		screen_bg.color = Color(0.95, 0.92, 0.86, 1.0 - flash_t * 0.85)
		face_label.text = "PSU REBOOTING..."
		body_label.text = "风扇重新起转…… 暖橘微光恢复中……"
		unlock_label.text = ""
		countdown_label.text = ""
		content_box.modulate = Color(0.12, 0.12, 0.14, 1.0 - flash_t)
