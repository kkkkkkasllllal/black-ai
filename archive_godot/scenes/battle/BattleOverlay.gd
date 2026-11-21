extends CanvasLayer
## M5 + M6 BS2 同款高难回合制战斗界面（覆盖层，战后无缝返回探索坐标）
## 支持：
## - 普通 / 精英怪物战（start_monster_battle）
## - 7 位核心 AI 娘 Boss 战（start_heroine_boss_battle）
## - API 并发助战按钮 + 修罗场警示
## - 真小 C 礼貌封锁单个指令按钮
## - 上下文溢出 Boss 异变：立绘裂纹黑化 + 红线划掉逃跑键 + 血条 1-bit 乱码扰动 + SL 点名

signal battle_started(target_id: String, is_heroine_boss: bool)
signal battle_finished(outcome: String, target_id: String, is_heroine_boss: bool, world_node: Node2D)

const BATTLE_ENGINE_SCRIPT: GDScript = preload("res://scripts/battle/BattleEngine.gd")
const GLITCH_CHARS: Array = ["█", "▓", "▒", "░", "?", "#", "4", "0"]

@onready var backdrop: ColorRect = $Backdrop
@onready var turn_label: Label = $Backdrop/Margin/FramePanel/Margin/RootVBox/TopBar/TurnLabel
@onready var enemy_title_label: Label = $Backdrop/Margin/FramePanel/Margin/RootVBox/TopBar/EnemyTitleLabel
@onready var enemy_portrait_bg: ColorRect = $Backdrop/Margin/FramePanel/Margin/RootVBox/EnemyRow/PortraitHolder/PortraitBorder
@onready var enemy_portrait_fill: ColorRect = $Backdrop/Margin/FramePanel/Margin/RootVBox/EnemyRow/PortraitHolder/PortraitBorder/PortraitFill
@onready var enemy_eye_left: ColorRect = $Backdrop/Margin/FramePanel/Margin/RootVBox/EnemyRow/PortraitHolder/PortraitBorder/EyeLeft
@onready var enemy_eye_right: ColorRect = $Backdrop/Margin/FramePanel/Margin/RootVBox/EnemyRow/PortraitHolder/PortraitBorder/EyeRight
@onready var portrait_crack_a: ColorRect = $Backdrop/Margin/FramePanel/Margin/RootVBox/EnemyRow/PortraitHolder/PortraitBorder/PortraitCrackA
@onready var portrait_crack_b: ColorRect = $Backdrop/Margin/FramePanel/Margin/RootVBox/EnemyRow/PortraitHolder/PortraitBorder/PortraitCrackB
@onready var enemy_hp_label: Label = $Backdrop/Margin/FramePanel/Margin/RootVBox/EnemyRow/EnemyInfoCol/EnemyHpLabel
@onready var enemy_hp_bar: ProgressBar = $Backdrop/Margin/FramePanel/Margin/RootVBox/EnemyRow/EnemyInfoCol/EnemyHpBar
@onready var enemy_stats_label: Label = $Backdrop/Margin/FramePanel/Margin/RootVBox/EnemyRow/EnemyInfoCol/EnemyStatsLabel
@onready var enemy_status_label: Label = $Backdrop/Margin/FramePanel/Margin/RootVBox/EnemyRow/EnemyInfoCol/EnemyStatusLabel
@onready var enemy_intent_label: Label = $Backdrop/Margin/FramePanel/Margin/RootVBox/EnemyRow/EnemyInfoCol/EnemyIntentLabel
@onready var alert_banner: Label = $Backdrop/Margin/FramePanel/Margin/RootVBox/AlertBanner
@onready var combat_log: RichTextLabel = $Backdrop/Margin/FramePanel/Margin/RootVBox/CombatLog
@onready var player_hp_label: Label = $Backdrop/Margin/FramePanel/Margin/RootVBox/BottomRow/PlayerCard/Margin/VBox/PlayerHpLabel
@onready var player_hp_bar: ProgressBar = $Backdrop/Margin/FramePanel/Margin/RootVBox/BottomRow/PlayerCard/Margin/VBox/PlayerHpBar
@onready var player_token_label: Label = $Backdrop/Margin/FramePanel/Margin/RootVBox/BottomRow/PlayerCard/Margin/VBox/PlayerTokenLabel
@onready var player_token_bar: ProgressBar = $Backdrop/Margin/FramePanel/Margin/RootVBox/BottomRow/PlayerCard/Margin/VBox/PlayerTokenBar
@onready var player_context_label: Label = $Backdrop/Margin/FramePanel/Margin/RootVBox/BottomRow/PlayerCard/Margin/VBox/PlayerContextLabel
@onready var player_stats_label: Label = $Backdrop/Margin/FramePanel/Margin/RootVBox/BottomRow/PlayerCard/Margin/VBox/PlayerStatsLabel
@onready var player_gear_label: Label = $Backdrop/Margin/FramePanel/Margin/RootVBox/BottomRow/PlayerCard/Margin/VBox/PlayerGearLabel
@onready var player_status_label: Label = $Backdrop/Margin/FramePanel/Margin/RootVBox/BottomRow/PlayerCard/Margin/VBox/PlayerStatusLabel
@onready var cmd_row: HBoxContainer = $Backdrop/Margin/FramePanel/Margin/RootVBox/BottomRow/CommandCard/Margin/VBox/CmdRow
@onready var attack_button: Button = $Backdrop/Margin/FramePanel/Margin/RootVBox/BottomRow/CommandCard/Margin/VBox/CmdRow/AttackButton
@onready var skill_button: Button = $Backdrop/Margin/FramePanel/Margin/RootVBox/BottomRow/CommandCard/Margin/VBox/CmdRow/SkillButton
@onready var defend_button: Button = $Backdrop/Margin/FramePanel/Margin/RootVBox/BottomRow/CommandCard/Margin/VBox/CmdRow/DefendButton
@onready var item_button: Button = $Backdrop/Margin/FramePanel/Margin/RootVBox/BottomRow/CommandCard/Margin/VBox/CmdRow/ItemButton
@onready var assist_button: Button = $Backdrop/Margin/FramePanel/Margin/RootVBox/BottomRow/CommandCard/Margin/VBox/CmdRow/AssistButton
@onready var escape_button: Button = $Backdrop/Margin/FramePanel/Margin/RootVBox/BottomRow/CommandCard/Margin/VBox/CmdRow/EscapeButton
@onready var escape_strike_line: ColorRect = $Backdrop/Margin/FramePanel/Margin/RootVBox/BottomRow/CommandCard/Margin/VBox/CmdRow/EscapeButton/EscapeStrikeLine
@onready var submenu_title: Label = $Backdrop/Margin/FramePanel/Margin/RootVBox/BottomRow/CommandCard/Margin/VBox/SubmenuTitle
@onready var submenu_list: VBoxContainer = $Backdrop/Margin/FramePanel/Margin/RootVBox/BottomRow/CommandCard/Margin/VBox/SubmenuScroll/SubmenuList
@onready var finish_button: Button = $Backdrop/Margin/FramePanel/Margin/RootVBox/BottomRow/CommandCard/Margin/VBox/FinishButton

var _engine: RefCounted = null
var _is_open: bool = false
var _target_id: String = ""
var _is_heroine_boss: bool = false
var _world_node: Node2D = null
var _active_submenu: String = "" # "" / "skills" / "items"
var _fx_timer: float = 0.0
var _fx_kind: String = ""
var _glitch_timer: float = 0.0
var _clean_enemy_hp_text: String = ""
var _clean_player_hp_text: String = ""
var _portrait_base_pos: Vector2 = Vector2.ZERO
var _rng: RandomNumberGenerator = RandomNumberGenerator.new()


func _ready() -> void:
	_rng.randomize()
	visible = false
	backdrop.visible = false
	escape_strike_line.visible = false
	portrait_crack_a.visible = false
	portrait_crack_b.visible = false
	_portrait_base_pos = enemy_portrait_bg.position


func _process(delta: float) -> void:
	if not _is_open:
		return

	# 受击/特效震动
	if _fx_timer > 0.0:
		_fx_timer = maxf(0.0, _fx_timer - delta)
		if _fx_timer > 0.0:
			var amp: float = 7.0 if _fx_kind == "crit" or _fx_kind == "lightning" else 4.0
			enemy_portrait_bg.position = _portrait_base_pos + Vector2(
				_rng.randf_range(-amp, amp),
				_rng.randf_range(-amp, amp)
			)
		else:
			enemy_portrait_bg.position = _portrait_base_pos
			enemy_portrait_bg.modulate = Color.WHITE

	# 上下文溢出 Boss 战：1-bit 乱码糊血条演出
	if _engine != null and bool(_engine.get("hp_bar_glitched")):
		_glitch_timer += delta
		if _glitch_timer >= 0.18:
			_glitch_timer = 0.0
			enemy_hp_label.text = _glitch_text(_clean_enemy_hp_text) + " [ERR_0x580]"
			player_hp_label.text = _glitch_text(_clean_player_hp_text) + " [CORRUPT]"
			enemy_hp_bar.modulate = Color(1.0, 0.14, 0.24, 1.0) if _rng.randf() < 0.5 else Color(0.72, 0.05, 0.18, 1.0)


func _unhandled_input(event: InputEvent) -> void:
	if not _is_open:
		return
	if event.is_action_pressed("menu"):
		if not _active_submenu.is_empty():
			_set_submenu("")
		get_viewport().set_input_as_handled()
		return
	if _engine != null and bool(_engine.call("is_battle_over")):
		if event.is_action_pressed("ui_accept") or event.is_action_pressed("interact"):
			_close_and_emit()
			get_viewport().set_input_as_handled()


func start_monster_battle(monster_id: String, enemy_world_node: Node2D, is_preemptive: bool = false) -> void:
	_open_battle(monster_id, false, enemy_world_node, is_preemptive)


func start_heroine_boss_battle(character_id: String, npc_world_node: Node2D, is_preemptive: bool = false) -> void:
	_open_battle(character_id, true, npc_world_node, is_preemptive)


func _open_battle(target_id: String, heroine_boss: bool, world_node: Node2D, is_preemptive: bool) -> void:
	if _is_open:
		return
	_engine = BATTLE_ENGINE_SCRIPT.new() as RefCounted
	_target_id = target_id
	_is_heroine_boss = heroine_boss
	_world_node = world_node
	_active_submenu = ""
	_glitch_timer = 0.0
	_is_open = true
	visible = true
	backdrop.visible = true
	combat_log.clear()

	var intro_logs_variant: Variant = null
	if heroine_boss:
		intro_logs_variant = _engine.call("start_heroine_boss_battle", target_id, is_preemptive)
	else:
		intro_logs_variant = _engine.call("start_monster_battle", target_id, is_preemptive)
	_append_logs(intro_logs_variant)
	_refresh_all()
	attack_button.grab_focus()
	battle_started.emit(target_id, heroine_boss)


func is_open() -> bool:
	return _is_open


# ---------------------------------------------------------------- 指令触发

func _execute_turn(action_type: String, action_arg: String = "") -> void:
	if _engine == null or bool(_engine.call("is_battle_over")):
		return
	_active_submenu = ""
	var logs_variant: Variant = _engine.call("execute_player_turn", action_type, action_arg)
	_append_logs(logs_variant)

	var fx: String = str(_engine.get("last_visual_fx"))
	if not fx.is_empty():
		_trigger_fx(fx)

	_refresh_all()


func _on_attack_button_pressed() -> void:
	_execute_turn("attack")


func _on_skill_button_pressed() -> void:
	_set_submenu("skills" if _active_submenu != "skills" else "")


func _on_defend_button_pressed() -> void:
	_execute_turn("defend")


func _on_item_button_pressed() -> void:
	_set_submenu("items" if _active_submenu != "items" else "")


func _on_assist_button_pressed() -> void:
	_execute_turn("assist")


func _on_escape_button_pressed() -> void:
	_execute_turn("escape")


func _on_skill_chosen(skill_id: String) -> void:
	_execute_turn("skill", skill_id)


func _on_item_chosen(item_id: String) -> void:
	_execute_turn("item", item_id)


func _on_finish_button_pressed() -> void:
	_close_and_emit()


func _close_and_emit() -> void:
	if not _is_open:
		return
	var outcome: String = str(_engine.get("phase")) if _engine != null else "escaped"
	var tid: String = _target_id
	var was_heroine: bool = _is_heroine_boss
	var wnode: Node2D = _world_node
	_is_open = false
	visible = false
	backdrop.visible = false
	_engine = null
	_world_node = null
	battle_finished.emit(outcome, tid, was_heroine, wnode)


# ---------------------------------------------------------------- UI 刷新

func _refresh_all() -> void:
	if _engine == null:
		return
	var enemy_variant: Variant = _engine.get("enemy")
	var enemy: Dictionary = enemy_variant if enemy_variant is Dictionary else {}
	var turn_no: int = int(_engine.get("turn_number"))
	var phase: String = str(_engine.get("phase"))
	var is_overflow_boss: bool = bool(_engine.get("is_overflow_boss"))
	var escape_crossed: bool = bool(_engine.get("escape_crossed_out"))
	var glitched_hp: bool = bool(_engine.get("hp_bar_glitched"))
	var locked_cmd: String = str(_engine.get("locked_command"))
	var enraged: bool = bool(_engine.get("boss_enraged"))

	backdrop.color = Color(0.06, 0.01, 0.02, 0.96) if is_overflow_boss else Color(0.02, 0.02, 0.03, 0.95)
	var mode_tag_top: String = "里世界异变 BOSS 战" if is_overflow_boss else ("核心 AI 娘 BOSS 战" if _is_heroine_boss else "BS2 高难回合制")
	turn_label.text = "第 %d 回合  |  %s" % [turn_no, mode_tag_top]

	var title_suffix: String = ""
	if _is_heroine_boss:
		var subtitle: String = str(enemy.get("title", ""))
		if not subtitle.is_empty():
			title_suffix = "（%s）" % subtitle
		if is_overflow_boss:
			title_suffix += " [里世界黑化]"
		if enraged:
			title_suffix += " [狂暴锁定!]"
	elif bool(enemy.get("is_boss", false)):
		title_suffix = " [区域精英]"
		var mstr: String = str(enemy.get("mode", ""))
		if mstr == "deep_think":
			title_suffix += " · 重型深思态"
		elif mstr == "flash":
			title_suffix += " · 闪速抢答态"
	enemy_title_label.text = "%s%s" % [str(enemy.get("name", _target_id)), title_suffix]
	enemy_title_label.modulate = Color(1.0, 0.34, 0.42, 1.0) if (is_overflow_boss or enraged) else Color.WHITE

	# 敌方立绘、裂纹与状态着色
	var accent: Color = Color.from_string(str(enemy.get("placeholder_color", "#888888")), Color.GRAY)
	var corrupted_portrait: bool = is_overflow_boss or enraged
	portrait_crack_a.visible = corrupted_portrait
	portrait_crack_b.visible = corrupted_portrait
	enemy_portrait_fill.color = accent.darkened(0.42 if corrupted_portrait else (0.18 if _is_heroine_boss else 0.62))

	var charging: bool = not str(enemy.get("charging_skill_id", "")).is_empty()
	var enemy_sts_variant: Variant = enemy.get("statuses", {})
	var enemy_sts: Dictionary = enemy_sts_variant if enemy_sts_variant is Dictionary else {}
	if enemy_sts.has("crash") or enemy_sts.has("short_circuit"):
		enemy_portrait_bg.color = Color(0.28, 0.78, 1.0, 1.0)
		enemy_eye_left.color = Color(0.35, 0.85, 1.0, 1.0)
		enemy_eye_right.color = Color(0.35, 0.85, 1.0, 1.0)
	elif corrupted_portrait:
		enemy_portrait_bg.color = Color(0.95, 0.14, 0.22, 1.0)
		enemy_eye_left.color = Color(1.0, 0.12, 0.18, 1.0)
		enemy_eye_right.color = Color(1.0, 0.12, 0.18, 1.0)
	elif charging:
		enemy_portrait_bg.color = Color(1.0, 0.32, 0.16, 1.0)
		enemy_eye_left.color = Color(1.0, 0.88, 0.25, 1.0)
		enemy_eye_right.color = Color(1.0, 0.88, 0.25, 1.0)
	else:
		enemy_portrait_bg.color = accent
		enemy_eye_left.color = Color(1.0, 0.18, 0.22, 1.0)
		enemy_eye_right.color = Color(1.0, 0.18, 0.22, 1.0)

	var ehp: int = int(enemy.get("hp", 0))
	var emax: int = maxi(1, int(enemy.get("max_hp", 1)))
	_clean_enemy_hp_text = "敌方 HP：%d / %d" % [ehp, emax]
	enemy_hp_label.text = _glitch_text(_clean_enemy_hp_text) + " [ERR_0x580]" if glitched_hp else _clean_enemy_hp_text
	enemy_hp_bar.max_value = float(emax)
	enemy_hp_bar.value = float(ehp)
	enemy_hp_bar.modulate = Color(0.92, 0.22, 0.28, 1.0)

	var tags_variant: Variant = enemy.get("tags", PackedStringArray())
	var tags_str: String = ""
	if tags_variant is PackedStringArray:
		var tags_arr: PackedStringArray = tags_variant
		tags_str = ", ".join(tags_arr)
	enemy_stats_label.text = "ATK %d  |  DEF %d  |  SPD %d  |  标签：[%s]" % [
		int(_engine.call("get_enemy_effective_atk")),
		int(_engine.call("get_enemy_effective_def")),
		int(_engine.call("get_enemy_effective_spd")),
		tags_str,
	]
	enemy_status_label.text = "敌方状态：%s" % str(_engine.call("format_status_badges", enemy_sts, true))
	enemy_intent_label.text = str(_engine.call("get_enemy_intent_text"))
	enemy_intent_label.modulate = Color(1.0, 0.45, 0.35, 1.0) if (charging or enraged) else Color(0.92, 0.86, 0.68, 1.0)

	# 顶部警示横幅（优先级：输出截断 > 修罗场/溢出 UI 破坏 > 侧透玻璃碎裂）
	var trunc_banner: String = str(_engine.get("last_truncation_banner"))
	var rivalry_banner: String = str(_engine.get("boss_rivalry_banner"))
	if not trunc_banner.is_empty():
		alert_banner.visible = true
		alert_banner.text = trunc_banner
		alert_banner.modulate = Color(1.0, 0.36, 0.36, 1.0)
	elif not rivalry_banner.is_empty() or is_overflow_boss:
		alert_banner.visible = true
		alert_banner.text = rivalry_banner
		alert_banner.modulate = Color(1.0, 0.28, 0.42, 1.0)
	elif GameState.is_case_broken:
		alert_banner.visible = true
		alert_banner.text = "警告：【侧透玻璃机箱】已碎裂，机箱防御归零！请在【硬件物品】中使用【黑胶带】紧急修补！"
		alert_banner.modulate = Color(1.0, 0.48, 0.56, 1.0)
	else:
		alert_banner.visible = false
		alert_banner.text = ""
	if is_overflow_boss:
		var overflow_notice: String = "【里世界 UI 破坏】逃跑已划掉 · 血条乱码 | %s" % str(_engine.get("overflow_memory_summary"))
		alert_banner.text = overflow_notice if alert_banner.text.is_empty() else alert_banner.text + "\n" + overflow_notice

	# 玩家状态面板
	var pmax_hp: int = GameState.get_effective_max_hp()
	_clean_player_hp_text = "HP：%d / %d" % [GameState.hp, pmax_hp]
	player_hp_label.text = _glitch_text(_clean_player_hp_text) + " [CORRUPT]" if glitched_hp else _clean_player_hp_text
	player_hp_bar.max_value = float(pmax_hp)
	player_hp_bar.value = float(GameState.hp)
	player_hp_bar.modulate = Color(0.38, 0.85, 0.52, 1.0) if GameState.hp > int(float(pmax_hp) * 0.35) else Color(0.95, 0.25, 0.28, 1.0)

	player_token_label.text = "Token：%d / %d（不足强放技能将触发输出截断）" % [GameState.token, GameState.max_token]
	player_token_bar.max_value = float(GameState.max_token)
	player_token_bar.value = float(GameState.token)
	player_token_bar.modulate = Color(0.35, 0.78, 0.96, 1.0) if GameState.token >= 25 else Color(1.0, 0.58, 0.22, 1.0)

	player_context_label.text = "上下文稳定度：%d%%（%s）" % [
		GameState.context,
		"里世界溢出！" if GameState.is_context_overflow() else "表世界稳定",
	]
	player_context_label.modulate = Color(1.0, 0.36, 0.40, 1.0) if GameState.is_context_overflow() else Color(0.84, 0.90, 0.98, 1.0)

	player_stats_label.text = "ATK %d  |  DEF %d  |  SPD %d  |  闪避 %.0f%%  |  暴击 %.0f%%" % [
		GameState.get_effective_atk(),
		GameState.get_effective_def(),
		int(_engine.call("get_player_battle_spd")),
		GameState.get_effective_evasion() * 100.0,
		GameState.get_effective_crit_rate() * 100.0,
	]

	var case_id: String = str(GameState.equipment.get("case", ""))
	var case_name: String = DataRegistry.get_item_name(case_id) if not case_id.is_empty() else "无"
	if GameState.is_case_broken:
		case_name += "[已碎裂!]"
	var weapon_id: String = str(GameState.equipment.get("weapon", ""))
	var cooler_id: String = str(GameState.equipment.get("cooler", ""))
	var prompt_id: String = str(GameState.equipment.get("system_prompt", ""))
	player_gear_label.text = "武器：%s | 机箱：%s\n散热：%s | 提示词：%s" % [
		DataRegistry.get_item_name(weapon_id) if not weapon_id.is_empty() else "无",
		case_name,
		DataRegistry.get_item_name(cooler_id) if not cooler_id.is_empty() else "无",
		DataRegistry.get_item_name(prompt_id) if not prompt_id.is_empty() else "无",
	]

	var psts_variant: Variant = _engine.get("player_statuses")
	var psts: Dictionary = psts_variant if psts_variant is Dictionary else {}
	var assist_str: String = DataRegistry.get_character_name(GameState.assist_partner_id) if not GameState.assist_partner_id.is_empty() else "无"
	player_status_label.text = "我方状态：%s  |  并发助战：%s" % [
		str(_engine.call("format_status_badges", psts, false)),
		assist_str,
	]

	# 指令按钮动态态（真小 C 礼貌封锁 + 溢出划掉逃跑键 + API 并发助战按钮）
	_refresh_command_buttons(locked_cmd, escape_crossed)

	var over: bool = phase != "player_input"
	cmd_row.visible = not over
	finish_button.visible = over
	if over:
		_clear_submenu()
		submenu_title.text = _outcome_title(phase)
		finish_button.text = _outcome_button_text(phase)
		finish_button.grab_focus()
	else:
		_rebuild_submenu()


func _refresh_command_buttons(locked_cmd: String, escape_crossed: bool) -> void:
	skill_button.disabled = (locked_cmd == "skill")
	skill_button.text = "技能[封锁]" if locked_cmd == "skill" else "Token技能"
	skill_button.modulate = Color(1.0, 0.45, 0.48, 1.0) if locked_cmd == "skill" else Color.WHITE

	defend_button.disabled = (locked_cmd == "defend")
	defend_button.text = "防御[封锁]" if locked_cmd == "defend" else "防御(-50%)"
	defend_button.modulate = Color(1.0, 0.45, 0.48, 1.0) if locked_cmd == "defend" else Color.WHITE

	item_button.disabled = (locked_cmd == "item")
	item_button.text = "物品[封锁]" if locked_cmd == "item" else "硬件物品"
	item_button.modulate = Color(1.0, 0.45, 0.48, 1.0) if locked_cmd == "item" else Color.WHITE

	# API 并发助战按钮
	var assist_v: Variant = _engine.call("can_use_assist")
	var assist_info: Dictionary = assist_v if assist_v is Dictionary else {}
	var assist_ok: bool = bool(assist_info.get("ok", false))
	var pname: String = str(assist_info.get("partner_name", ""))
	assist_button.disabled = not assist_ok
	if assist_ok:
		assist_button.text = "助战:%s" % pname
		assist_button.modulate = Color(0.68, 0.94, 1.0, 1.0)
	elif not pname.is_empty():
		assist_button.text = "助战(CD)"
		assist_button.modulate = Color(0.70, 0.72, 0.76, 1.0)
	else:
		assist_button.text = "助战(未设)"
		assist_button.modulate = Color(0.66, 0.68, 0.72, 1.0)
	assist_button.tooltip_text = str(assist_info.get("reason", ""))

	# 溢出态红线划掉逃跑键
	escape_button.disabled = escape_crossed
	escape_strike_line.visible = escape_crossed
	if escape_crossed:
		escape_button.text = "逃跑[划掉]"
		escape_button.modulate = Color(1.0, 0.36, 0.40, 1.0)
	else:
		escape_button.text = "逃跑"
		escape_button.modulate = Color.WHITE


func _set_submenu(mode: String) -> void:
	_active_submenu = mode
	_rebuild_submenu()


func _rebuild_submenu() -> void:
	_clear_submenu()
	if _active_submenu == "skills":
		submenu_title.text = "选择 Token 技能（Token 不足也可强行释放 → 触发【输出截断】！）"
		for skill_id in DataRegistry.get_player_skill_ids():
			var sk: Dictionary = DataRegistry.get_player_skill(skill_id)
			var cost: int = int(sk.get("token_cost", 20))
			var will_truncate: bool = GameState.token < cost
			var btn: Button = Button.new()
			var warn: String = "  [⚠ Token 不足 → 强放触发输出截断！]" if will_truncate else ""
			btn.text = "%s（%d Token）— %s%s" % [
				str(sk.get("name", skill_id)),
				cost,
				str(sk.get("description", "")),
				warn,
			]
			btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
			if will_truncate:
				btn.modulate = Color(1.0, 0.56, 0.42, 1.0)
			btn.pressed.connect(_on_skill_chosen.bind(skill_id))
			submenu_list.add_child(btn)
	elif _active_submenu == "items":
		submenu_title.text = "选择战斗可用硬件武器 / 消耗品"
		var usable_ids: PackedStringArray = _collect_battle_items()
		if usable_ids.is_empty():
			var lbl: Label = Label.new()
			lbl.text = "（背包中没有战斗可用道具。可在 Esc 菜单领取 M5 全套硬件测试包。）"
			lbl.modulate = Color(0.68, 0.70, 0.76, 1.0)
			submenu_list.add_child(lbl)
		else:
			for item_id in usable_ids:
				var item: Dictionary = DataRegistry.get_item(item_id)
				var cnt: int = GameState.get_item_count(item_id)
				var btn: Button = Button.new()
				btn.text = "%s ×%d — %s" % [
					str(item.get("name", item_id)),
					cnt,
					_battle_item_hint(item_id, item),
				]
				btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
				btn.pressed.connect(_on_item_chosen.bind(item_id))
				submenu_list.add_child(btn)
	else:
		submenu_title.text = "请选择本回合行动（普攻 / Token 技能 / 防御减伤 50% / 硬件物品 / API 并发助战 / 逃跑）"


func _collect_battle_items() -> PackedStringArray:
	var result: PackedStringArray = PackedStringArray()
	var keys: Array = GameState.inventory.keys()
	keys.sort()
	for k in keys:
		var item_id: String = str(k)
		if GameState.get_item_count(item_id) <= 0:
			continue
		var item: Dictionary = DataRegistry.get_item(item_id)
		var cat: String = DataRegistry.get_item_category(item_id)
		if cat == "weapons" and str(item.get("slot", "")) == "throwable":
			result.append(item_id)
		elif cat == "consumables":
			var usable_v: Variant = item.get("usable_in", [])
			if usable_v is Array:
				var usable_arr: Array = usable_v
				if usable_arr.has("battle"):
					result.append(item_id)
		elif item_id == "gpu_580":
			result.append(item_id)
	return result


func _battle_item_hint(item_id: String, item: Dictionary) -> String:
	match item_id:
		"water":
			return "投掷（对电子/AI 单位触发隐藏属性：AI 宕机瘫痪 2 回合 / 打断深度思考）"
		"cement_resistor":
			return "投掷（强行限流 2 回合降攻降速 + 100% 打断敌方蓄力）"
		"bulging_capacitor":
			return "投掷（巨额雷电伤害 + 概率短路眩晕；带在身上挨重击有自爆风险）"
		"black_tape":
			return "回复 HP +40，且可紧急修补碎裂的【侧透玻璃机箱】"
		"alcohol_wipe":
			return "回复 HP +25，解除短路/卡顿"
		"thermal_paste":
			return "回复上下文 +20%，解除过热"
		"compressed_air":
			return "回复上下文 +35%，解除卡顿"
		"cmos_battery":
			return "回复上下文 +40%，清除全异常（克制乱码游魂/未定义黑影）"
		"wd40":
			return "解除锁死，下回合先手 SPD +50"
		"gpu_580":
			return "捏碎矿卡闪光（克制【未定义黑影】）"
		_:
			return str(item.get("description", ""))


func _glitch_text(source: String) -> String:
	if source.length() < 4:
		return source
	var out: String = ""
	for i in range(source.length()):
		var ch: String = source.substr(i, 1)
		if ch >= "0" and ch <= "9" and _rng.randf() < 0.45:
			out += str(GLITCH_CHARS[_rng.randi_range(0, GLITCH_CHARS.size() - 1)])
		else:
			out += ch
	return out


func _trigger_fx(fx_kind: String) -> void:
	_fx_kind = fx_kind
	_fx_timer = 0.28
	match fx_kind:
		"water_crash":
			enemy_portrait_bg.modulate = Color(0.45, 0.90, 1.0, 1.0)
		"lightning":
			enemy_portrait_bg.modulate = Color(1.0, 0.95, 0.45, 1.0)
		"crit":
			enemy_portrait_bg.modulate = Color(1.0, 0.35, 0.35, 1.0)
		"glass_break", "truncated":
			enemy_portrait_bg.modulate = Color(1.0, 0.42, 0.58, 1.0)
		_:
			enemy_portrait_bg.modulate = Color(1.35, 0.72, 0.72, 1.0)


func _outcome_title(phase: String) -> String:
	match phase:
		"victory":
			if _is_heroine_boss:
				return "【核心 AI 娘已清空】战利品已入库，击杀记录已写入 GlobalMemory！"
			return "【战斗胜利】已清理敌方进程！"
		"defeat":
			return "【战斗败北】你倒在了废墟之中……"
		_:
			return "【脱离战斗】成功撤回探索地图。"


func _outcome_button_text(phase: String) -> String:
	match phase:
		"victory":
			return "领取战利品并返回地图（Enter）"
		"defeat":
			return "在巨型大 PSU 电源前重新苏醒（Enter）"
		_:
			return "返回探索坐标（Enter）"


func _append_logs(logs_variant: Variant) -> void:
	if not (logs_variant is Array):
		return
	var arr: Array = logs_variant
	for line_variant in arr:
		combat_log.append_text(str(line_variant) + "\n")


func _clear_submenu() -> void:
	for child in submenu_list.get_children():
		child.queue_free()
