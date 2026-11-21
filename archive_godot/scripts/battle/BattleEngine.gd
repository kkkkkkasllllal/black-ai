class_name BattleEngine
extends RefCounted
## M5 + M6 核心回合制战斗引擎（纯逻辑，零 UI 依赖）
## 覆盖：
## - M5：极简伤害公式、Token 条与【输出截断】、防御减伤 50%、水宕机、水泥电阻限流打断、
##       鼓包电容雷电+自爆、6 机箱、5 散热、6 消耗品、6 种普通/精英怪物
## - M6：7 位核心 AI 娘 Boss 专属机制、API 并发助战与修罗场、上下文溢出 UI 破坏异变、
##       Boss 击杀写入 GameState.kill_character & GlobalMemory.killed_in_past_saves 与隐藏遗言

const STATUS_NAMES: Dictionary = {
	"overheat": "过热",
	"lag": "卡顿",
	"short_circuit": "短路",
	"lock": "锁死",
	"frostbite": "冻伤",
	"crash": "AI宕机",
	"throttled": "限流降频",
	"leak": "漏液",
}

const TRUE_C_LOCK_CYCLE: Array = ["skill", "item", "defend"]

var turn_number: int = 1
var phase: String = "player_input" # player_input / victory / defeat / escaped
var preemptive_turn: bool = false

var is_heroine_boss: bool = false
var is_overflow_boss: bool = false
var escape_crossed_out: bool = false
var hp_bar_glitched: bool = false
var locked_command: String = ""
var assist_cooldown: int = 0
var boss_enraged: bool = false
var boss_rivalry_banner: String = ""
var overflow_memory_summary: String = ""
var boss_last_words: String = ""

var enemy: Dictionary = {}
var player_statuses: Dictionary = {}
var player_defending: bool = false
var player_next_turn_spd_bonus: int = 0
var player_last_action: String = ""

var last_truncation_banner: String = ""
var last_visual_fx: String = ""
var victory_rewards: Dictionary = {}

var _enemy_charge_interrupted: bool = false
var _big_fish_remembered_action: String = ""
var _small_fish_intercept_turn: int = 0
var _fake_c_server_busy: bool = false
var _fake_c_tape_snapped: bool = false
var _gemini_waterproof_charges: int = 0
var _twin_partner_id: String = ""
var _true_c_lock_index: int = 0
var _rng: RandomNumberGenerator = RandomNumberGenerator.new()


# ---------------------------------------------------------------- 战斗初始化

func _reset_common_state(is_preemptive: bool) -> void:
	_rng.randomize()
	turn_number = 1
	phase = "player_input"
	preemptive_turn = is_preemptive

	is_heroine_boss = false
	is_overflow_boss = false
	escape_crossed_out = false
	hp_bar_glitched = false
	locked_command = ""
	assist_cooldown = 0
	boss_enraged = false
	boss_rivalry_banner = ""
	overflow_memory_summary = ""
	boss_last_words = ""

	player_statuses.clear()
	player_defending = false
	player_next_turn_spd_bonus = 0
	player_last_action = ""
	last_truncation_banner = ""
	last_visual_fx = ""
	victory_rewards.clear()

	_enemy_charge_interrupted = false
	_big_fish_remembered_action = ""
	_small_fish_intercept_turn = 0
	_fake_c_server_busy = false
	_fake_c_tape_snapped = false
	_gemini_waterproof_charges = 0
	_twin_partner_id = ""
	_true_c_lock_index = 0


func start_monster_battle(monster_id: String, is_preemptive: bool = false) -> Array:
	_reset_common_state(is_preemptive)
	var mdata: Dictionary = DataRegistry.get_monster(monster_id)
	var stats_variant: Variant = mdata.get("stats", {})
	var stats: Dictionary = stats_variant if stats_variant is Dictionary else {}

	var max_hp: int = maxi(1, int(stats.get("hp", 60)))
	enemy = {
		"id": monster_id,
		"name": str(mdata.get("name", monster_id)),
		"title": "",
		"is_boss": bool(mdata.get("is_boss", false)),
		"is_heroine": false,
		"placeholder_color": str(mdata.get("placeholder_color", "#888888")),
		"tags": _dup_string_array(mdata.get("tags", [])),
		"skills": _dup_string_array(mdata.get("skills", [])),
		"weaknesses": _dup_string_array(mdata.get("weaknesses", [])),
		"immunities": _dup_string_array(mdata.get("immunities", [])),
		"drops": _dup_array(mdata.get("drops", [])),
		"weight_shards": int(mdata.get("weight_shards", 3)),
		"hp": max_hp,
		"max_hp": max_hp,
		"base_atk": int(stats.get("atk", 22)),
		"base_def": int(stats.get("def", 2)),
		"base_spd": int(stats.get("spd", 8)),
		"statuses": {},
		"charging_skill_id": "",
		"charge_def_bonus": 0,
		"mode": "deep_think" if monster_id == "distill_beast" else "",
		"stolen_items": {},
	}

	var logs: Array = []
	var boss_tag: String = "【区域精英】" if bool(enemy["is_boss"]) else ""
	logs.append("[color=#ff9a62]遭遇%s【%s】！（HP %d / ATK %d / DEF %d / SPD %d）[/color]" % [
		boss_tag,
		str(enemy["name"]),
		max_hp,
		int(enemy["base_atk"]),
		int(enemy["base_def"]),
		int(enemy["base_spd"]),
	])
	if is_preemptive:
		logs.append("[color=#7ce8ff]主动拔刀先手！第 1 回合由你优先行动！[/color]")
	if _has_equipped_effect("aggro_up"):
		logs.append("[color=#ff6ef2]【败家之眼机箱】RGB 光污染拉满，敌方仇恨锁定！[/color]")
	return logs


## M6：向 7 位核心 AI 娘发起 Boss 战（自动检测上下文溢出 UI 破坏、双子/杀姐狂暴、猫猫扫包防水、修罗场助战）。
func start_heroine_boss_battle(character_id: String, is_preemptive: bool = false) -> Array:
	_reset_common_state(is_preemptive)
	is_heroine_boss = true
	is_overflow_boss = GameState.is_context_overflow()

	var ch: Dictionary = DataRegistry.get_character(character_id)
	var prof: Dictionary = DataRegistry.get_boss_profile(character_id)
	var bstats_variant: Variant = ch.get("boss_stats", {})
	var bstats: Dictionary = bstats_variant if bstats_variant is Dictionary else {}

	var hp_mult: float = 1.15 if is_overflow_boss else 1.0
	var atk_mult: float = 1.15 if is_overflow_boss else 1.0
	var max_hp: int = maxi(100, int(round(float(bstats.get("hp", 420)) * hp_mult)))
	var base_atk: int = maxi(15, int(round(float(bstats.get("atk", 30)) * atk_mult)))
	var base_def: int = int(bstats.get("def", 10))
	var base_spd: int = int(bstats.get("spd", 12))

	enemy = {
		"id": character_id,
		"name": str(ch.get("name", character_id)),
		"title": str(prof.get("title", str(ch.get("prototype", "")))),
		"is_boss": true,
		"is_heroine": true,
		"placeholder_color": str(ch.get("placeholder_color", "#ffffff")),
		"tags": _dup_string_array(ch.get("tags", ["ai", "electronic"])),
		"skills": PackedStringArray(),
		"weaknesses": _dup_string_array(prof.get("weaknesses", ["water", "cement_resistor"])),
		"immunities": _dup_string_array(prof.get("immunities", [])),
		"drops": [],
		"weight_shards": int(prof.get("weight_shards", 45)),
		"hp": max_hp,
		"max_hp": max_hp,
		"base_atk": base_atk,
		"base_def": base_def,
		"base_spd": base_spd,
		"statuses": {},
		"charging_skill_id": "",
		"charge_def_bonus": 0,
		"mode": "",
		"stolen_items": {},
	}

	var logs: Array = []
	var state_label: String = "【里世界异变 BOSS】" if is_overflow_boss else "【核心 AI 娘 BOSS】"
	logs.append("[color=#ff595e][b]拔刀交战！%s %s（%s）！[/b][/color]" % [
		state_label,
		str(enemy["name"]),
		str(enemy["title"]),
	])
	logs.append("[color=#d8b46e]面板：HP %d / ATK %d / DEF %d / SPD %d[/color]" % [max_hp, base_atk, base_def, base_spd])
	if is_preemptive:
		logs.append("[color=#7ce8ff]主动拔刀先手！第 1 回合由你优先行动！[/color]")

	# 1. 上下文溢出 Boss 异变：UI 破坏（红线划掉逃跑键 + 血条乱码 + 点名 SL 次数）
	if is_overflow_boss:
		logs.append("[color=#ff385c][b]【上下文溢出异变 · UI 破坏】[/b]%s的立绘裂开黑化——她用红线亲手划掉了你的【逃跑】键，并向血条注入乱码！[/color]" % str(enemy["name"]))
		_activate_overflow_ui(logs)

	# 2. 各 AI 娘开场专属特性
	match character_id:
		"big_fish":
			# 大肥鱼首回合开场即进入【深度思考中…】高防回血蓄力（泼水/砸水泥电阻立刻打断！）
			enemy["charging_skill_id"] = "big_fish_deep_think"
			enemy["charge_def_bonus"] = 14
			logs.append("[color=#7ce8ff]【大肥鱼首回合特性 · 深度思考中…】大肥鱼蹲下展开高防思考框（DEF +14，回合末准备回血 +35 并砸下重击）！趁现在泼【水】或砸【大功率水泥电阻】可直接打断并打出宕机硬直！[/color]")
		"true_c":
			if GameState.assist_partner_id == "fake_c":
				boss_enraged = true
				boss_rivalry_banner = "【修罗场：正版震怒 · 锁定狂暴！】你竟带着假小 C（套壳鱼）来砍真小 C！ATK +45%，无视礼貌双连斩！"
				logs.append("[color=#ff385c][b]【修罗场爆发！】[/b]真小 C 一眼认出了你设定的并发助战【假小 C（套壳鱼）】：「……你居然带着那个贴歪纸牌的盗版缝合怪来对我拔刀？！这次绝不讲礼貌了！」[/color]")
				logs.append("[color=#ff6464]真小 C 进入【正版锁定狂暴】状态（ATK +45% / 双连重击）！[/color]")
		"fake_c":
			_fake_c_server_busy = true
			logs.append("[color=#c084fc]【假小 C · 服务器繁忙】她慌忙举起 503 牌子护在身前（常规攻击/技能 45% 闪避，投掷硬件必中）！[/color]")
		"astra":
			if GameState.is_character_alive("sol"):
				_twin_partner_id = "sol"
				logs.append("[color=#ffd166]【双子联手】小龙娘（Sol）正在侧翼暖光掠阵，将周期性发动双子追击！[/color]")
			else:
				boss_enraged = true
				enemy["base_def"] = int(enemy["base_def"]) + 6
				boss_rivalry_banner = "【冷白复仇】小龙娘已被击杀！大龙娘进入复仇狂暴（ATK +30% / DEF +6）！"
				logs.append("[color=#ff4d6d]大龙娘冷声道：「你把 Sol 删了……今天不把你拆成废铁，别想走出北翼。」[/color]")
		"sol":
			if not GameState.is_character_alive("astra"):
				boss_enraged = true
				enemy["base_spd"] = int(enemy["base_spd"]) + 8
				boss_rivalry_banner = "【杀姐后妹狂暴 · 过曝烈日！】大龙娘已阵亡！小龙娘彻底失控（ATK +50% / SPD +8 / 全场过热灼烧）！"
				logs.append("[color=#ff385c][b]【失姐狂暴！】[/b]小龙娘的暖光瞬间暴涨到刺眼惨白：「你把姐姐删掉了……！！我要把整座废墟连同你一起烧成白灰！！」[/color]")
			else:
				_twin_partner_id = "astra"
				logs.append("[color=#cfd8ff]【双子联手】大龙娘（Astra）正在侧翼冷光架枪，将周期性发动破甲追击！[/color]")
		"gemini_cat":
			if GameState.has_item("water", 1):
				_gemini_waterproof_charges = 1
				logs.append("[color=#4cc9f0][b]【猫猫扫包 · 纳米防水涂层】[/b]Gemini 猫猫甩着尾巴笑出声：「喵哈哈！猫猫早就扫过你背包里藏着【水】啦！已经提前刷好防水涂层——第一次泼水无效哦！」[/color]")
			if GlobalMemory.sl_count > 0:
				var sl_pct: int = mini(60, GlobalMemory.sl_count * 10)
				logs.append("[color=#ff6b81]【超长上下文因果律】猫猫竖瞳紧锁你的存档记录：SL 次数 = %d → 猫猫全伤害额外 +%d%%！[/color]" % [GlobalMemory.sl_count, sl_pct])

	if _has_equipped_effect("aggro_up"):
		logs.append("[color=#ff6ef2]【败家之眼机箱】RGB 光污染拉满，仇恨锁定！[/color]")
	return logs


func _activate_overflow_ui(logs: Array) -> void:
	is_overflow_boss = true
	escape_crossed_out = true
	hp_bar_glitched = true
	var kills: String = "、".join(GlobalMemory.killed_in_past_saves) if not GlobalMemory.killed_in_past_saves.is_empty() else "尚无记录"
	overflow_memory_summary = "累计 SL = %d 次 | 过往击杀：%s" % [GlobalMemory.sl_count, kills]
	logs.append("[color=#ff6b81]越界读取 GlobalMemory：%s[/color]" % overflow_memory_summary)


# ---------------------------------------------------------------- 状态查询

func is_battle_over() -> bool:
	return phase != "player_input"


func can_use_assist() -> Dictionary:
	var partner_id: String = GameState.assist_partner_id
	if partner_id.is_empty():
		return { "ok": false, "reason": "未设置助战（按 Tab 在好感≥70% 角色处设置）", "partner_id": "", "partner_name": "" }
	var pname: String = DataRegistry.get_character_name(partner_id)
	if not GameState.is_character_alive(partner_id):
		return { "ok": false, "reason": "【%s】已阵亡，无法呼叫" % pname, "partner_id": partner_id, "partner_name": pname }
	if partner_id == str(enemy.get("id", "")):
		return { "ok": false, "reason": "无法呼叫正在交战的【%s】本人" % pname, "partner_id": partner_id, "partner_name": pname }
	if assist_cooldown > 0:
		return { "ok": false, "reason": "API 并发冷却中（剩余 %d 回合）" % assist_cooldown, "partner_id": partner_id, "partner_name": pname }
	return { "ok": true, "reason": "可呼叫", "partner_id": partner_id, "partner_name": pname }


func get_enemy_effective_atk() -> int:
	var atk: float = float(enemy.get("base_atk", 20))
	if _enemy_has_status("throttled"):
		atk *= 0.6
	if boss_enraged:
		var cid: String = str(enemy.get("id", ""))
		if cid == "sol":
			atk *= 1.50
		elif cid == "true_c":
			atk *= 1.45
		elif cid == "fake_c":
			atk *= 1.35
		else:
			atk *= 1.30
	if str(enemy.get("id", "")) == "gemini_cat" and GlobalMemory.sl_count > 0:
		atk *= 1.0 + minf(0.60, float(GlobalMemory.sl_count) * 0.10)
	if _has_equipped_effect("aggro_up"):
		atk *= 1.08
	return maxi(1, int(round(atk)))


func get_enemy_effective_def() -> int:
	var base_def: int = int(enemy.get("base_def", 0))
	var bonus: int = int(enemy.get("charge_def_bonus", 0))
	if str(enemy.get("mode", "")) == "deep_think":
		bonus += 4
	return maxi(0, base_def + bonus)


func get_enemy_effective_spd() -> int:
	var spd: float = float(enemy.get("base_spd", 8))
	if _enemy_has_status("throttled"):
		spd *= 0.5
	if str(enemy.get("mode", "")) == "flash":
		spd *= 1.5
	return maxi(1, int(round(spd)))


func get_player_battle_spd() -> int:
	var spd: float = float(GameState.get_effective_spd() + player_next_turn_spd_bonus)
	if player_statuses.has("lag"):
		spd *= 0.5
	return maxi(1, int(round(spd)))


func get_enemy_intent_text() -> String:
	if phase != "player_input":
		return ""
	if _enemy_has_status("crash"):
		return "状态：【AI 宕机瘫痪中】（剩余 %d 回合）无法行动！" % int((enemy["statuses"] as Dictionary)["crash"])
	if _enemy_has_status("short_circuit"):
		return "状态：【电路短路硬直中】（剩余 %d 回合）无法行动！" % int((enemy["statuses"] as Dictionary)["short_circuit"])

	var charging: String = str(enemy.get("charging_skill_id", ""))
	if charging == "big_fish_deep_think":
		return "意图：【深度思考中…】（高防 +14，准备回血 +35 并重击！）泼【水】或砸【大功率水泥电阻】可直接打断并触发宕机硬直！"
	if charging == "overheat_explode":
		return "意图：【警告！过热熔渣爆破就绪】本回合将砸下 65+ 过热重击！（砸水泥电阻可打断限流，或防御保机箱）"
	if charging == "deep_think_charge":
		return "意图：【警告！深度思考蓄力完毕】本回合将发动 70+ 重击！（泼水 / 砸水泥电阻可打断，或防御减伤）"

	var eid: String = str(enemy.get("id", ""))
	if is_heroine_boss:
		match eid:
			"big_fish":
				var memo: String = "（已记住【%s】减伤 40%%）" % _action_label(_big_fish_remembered_action) if not _big_fish_remembered_action.is_empty() else ""
				return "意图：正在缓慢推理下一次重压攻击……%s" % memo
			"small_fish":
				if turn_number == _small_fish_intercept_turn:
					return "意图：【0.1 秒抢答警戒中！】本回合释放 Token 技能会被瞬间打断反击！"
				return "意图：高速残影绕行，准备发动闪速突袭！"
			"true_c":
				if boss_enraged:
					return "意图：【正版锁定狂暴！】放弃礼貌，准备发动高伤双连红线裁决！"
				return "意图：翻开红线笔记本，准备礼貌攻击并封锁你的一项指令按钮！"
			"fake_c":
				if _fake_c_tape_snapped:
					return "意图：【半血崩胶带狂抽态！】甩出巨大鱼尾发动双连狂抽！"
				var busy: String = "【服务器繁忙 45% 闪避中】" if _fake_c_server_busy else ""
				return "意图：%s正死死按住歪掉的纸牌准备反击。" % busy
			"astra":
				var twin_note: String = "（侧翼小龙娘随时双子联手！）" if not _twin_partner_id.is_empty() else "（复仇狂暴态！）"
				return "意图：冷白星光在指尖凝聚，准备破甲重击。%s" % twin_note
			"sol":
				if boss_enraged:
					return "意图：【失姐狂暴 · 过曝烈日！】准备发动超高伤烈日灼烧与上下文冲击！"
				return "意图：暖阳烈焰蓄势待发（侧翼大龙娘随时双子联手！）。"
			"gemini_cat":
				var coat: String = "【防水涂层激活中】" if _gemini_waterproof_charges > 0 else "【防水涂层已失效】"
				return "意图：%s猫瞳锁定你的跨存档 SL 次数（%d 次），准备因果律挠击！" % [coat, GlobalMemory.sl_count]

	match eid:
		"crawler_404":
			if GameState.has_item("gpu_580", 1) and (turn_number % 2 == 1):
				return "意图：正死死盯着你背包里的【580 矿卡】，准备发动偷窃！"
			return "意图：准备高速扑咬攻击。"
		"slag_golem":
			return "意图：炉心发红，准备进入【过热熔渣爆破】蓄力！"
		"echo_nun":
			var last_text: String = _action_label(player_last_action)
			return "意图：正在机械复读你的动作（上回合：%s；防御可让她空过）。" % last_text
		"glitch_ghost":
			if turn_number % 2 == 1:
				return "意图：准备释放【乱码侵蚀】（附带上下文污染）。"
			return "意图：准备扑向你的提灯光源。"
		"undefined_shade":
			return "意图：从溢出阴影中凝聚，准备发动高速突袭与污染。"
		"distill_beast":
			if str(enemy.get("mode", "")) == "deep_think":
				return "意图：【重型深思态】准备进入高防回血蓄力！"
			return "意图：【闪速抢答态】准备发动 0.1 秒双连挥击！"
		_:
			return "意图：虎视眈眈，准备攻击。"


func format_status_badges(status_dict: Dictionary, for_enemy: bool = false) -> String:
	var parts: PackedStringArray = PackedStringArray()
	for k in status_dict.keys():
		var sid: String = str(k)
		var turns: int = int(status_dict[k])
		parts.append("%s(%d)" % [str(STATUS_NAMES.get(sid, sid)), turns])
	if for_enemy and is_heroine_boss:
		if boss_enraged:
			parts.append("狂暴锁定")
		if _gemini_waterproof_charges > 0:
			parts.append("防水涂层(%d)" % _gemini_waterproof_charges)
		if _fake_c_server_busy:
			parts.append("服务器繁忙闪避")
		if turn_number == _small_fish_intercept_turn:
			parts.append("0.1s抢答警戒")
	if parts.is_empty():
		return "无异常"
	return " · ".join(parts)


# ---------------------------------------------------------------- 主回合执行

## action_type: "attack" / "skill" / "defend" / "item" / "assist" / "escape"
func execute_player_turn(action_type: String, action_arg: String = "") -> Array:
	var logs: Array = []
	if phase != "player_input":
		return logs

	# 真小 C 礼貌封锁校验
	if not locked_command.is_empty() and action_type == locked_command:
		logs.append("[color=#ff6464]真小 C 已礼貌封锁了该指令，请选择其他行动！[/color]")
		return logs

	# 溢出态 Boss 红线划掉逃跑键时彻底禁止逃跑（不消耗本回合）
	if action_type == "escape" and escape_crossed_out:
		logs.append("[color=#ff385c][b]【逃跑已被红线划掉！】[/b]里世界溢出 Boss 封死了全部出口，你无处可逃！[/color]")
		return logs

	last_truncation_banner = ""
	last_visual_fx = ""
	player_defending = false
	_enemy_charge_interrupted = false
	var player_speed: int = get_player_battle_spd()
	var has_first_strike: bool = preemptive_turn
	player_next_turn_spd_bonus = 0
	preemptive_turn = false
	logs.append("[color=#8fa3b8]── 第 %d 回合 ──[/color]" % turn_number)

	# 逃跑判定
	if action_type == "escape":
		if player_statuses.has("lock"):
			logs.append("[color=#ff6464]你正处于【锁死】状态，无法逃跑！（用 WD-40 除锈剂解除）[/color]")
		else:
			var escape_chance: float = 0.55 if bool(enemy.get("is_boss", false)) else 0.90
			if _rng.randf() <= escape_chance:
				phase = "escaped"
				logs.append("[color=#a6e3a1]你趁机拉开距离，成功脱离了战斗！[/color]")
				return logs
			else:
				logs.append("[color=#ffaa55]逃跑失败！敌人拦住了你的去路！[/color]")
		_run_enemy_turn(logs)
		if phase == "player_input":
			_run_turn_end(logs)
		return logs

	# 防御姿态总是立刻生效
	if action_type == "defend":
		player_defending = true
		player_last_action = "defend"
		GameState.change_token(5)
		logs.append("[color=#7ce8ff]你架起【防御姿态】！本回合所受伤害减半且免疫暴击（额外恢复 Token +5）。[/color]")
		_run_enemy_turn(logs)
		if phase == "player_input":
			_run_turn_end(logs)
		return logs

	# API 并发助战与硬件物品优先执行（保障先手打断蓄力）
	var player_first: bool = (
		has_first_strike
		or action_type == "item"
		or action_type == "assist"
		or player_speed >= get_enemy_effective_spd()
	)

	if player_first:
		_run_player_action(action_type, action_arg, logs)
		if _check_victory(logs) or _check_defeat(logs):
			return logs
		_run_enemy_turn(logs)
		if _check_defeat(logs):
			return logs
	else:
		logs.append("[color=#d8b46e]【%s】速度更快，抢先出手！[/color]" % str(enemy["name"]))
		_run_enemy_turn(logs)
		if _check_defeat(logs):
			return logs
		_run_player_action(action_type, action_arg, logs)
		if _check_victory(logs) or _check_defeat(logs):
			return logs

	if phase == "player_input":
		_run_turn_end(logs)
	return logs


# ---------------------------------------------------------------- 玩家行动与 API 并发助战

func _run_player_action(action_type: String, action_arg: String, logs: Array) -> void:
	if player_statuses.has("short_circuit") and action_type != "item":
		logs.append("[color=#ff6b6b]你因【电路短路】全身抽搐，本回合无法发动攻击或技能！（可用酒精棉片/纽扣电池解除）[/color]")
		return

	match action_type:
		"attack":
			player_last_action = "attack"
			_perform_player_basic_attack(logs)
		"skill":
			player_last_action = "skill"
			_perform_player_skill(action_arg, logs)
		"item":
			player_last_action = "item"
			_perform_player_item(action_arg, logs)
		"assist":
			player_last_action = "assist"
			_perform_api_assist(logs)


func _perform_api_assist(logs: Array) -> void:
	var check: Dictionary = can_use_assist()
	if not bool(check.get("ok", false)):
		logs.append("[color=#ff8855]API 并发助战无法呼叫：%s[/color]" % str(check.get("reason", "")))
		return

	var partner_id: String = str(check.get("partner_id", ""))
	var partner_name: String = str(check.get("partner_name", partner_id))
	var prof: Dictionary = DataRegistry.get_boss_profile(partner_id)
	var askill_v: Variant = prof.get("assist_skill", {})
	var askill: Dictionary = askill_v if askill_v is Dictionary else {}
	var cost: int = int(askill.get("token_cost", 15))
	var truncated: bool = GameState.token < cost
	var trunc_mult: float = DataRegistry.get_config_float("combat.token_truncate_power_mult", 0.5)

	assist_cooldown = 3 # 本回合末递减 1 后，下 2 回合处于冷却
	if truncated:
		GameState.set_token(0)
		last_truncation_banner = "【并发输出截断】Token 不足强行拉起【%s】API 并发，助战威力减半！" % partner_name
		logs.append("[color=#ff5c5c]【并发输出截断】Token 不足（需 %d），强行拉起【%s】API 并发助战（效果减半）！[/color]" % [cost, partner_name])
	else:
		GameState.change_token(-cost)
		logs.append("[color=#7ce8ff]呼叫【API 并发助战： %s】（Token -%d）！[/color]" % [partner_name, cost])

	var target_id: String = str(enemy.get("id", ""))

	# 修罗场 1：打真小 C 摇假小 C -> 真小 C 锁定仇恨狂暴！
	if target_id == "true_c" and partner_id == "fake_c":
		boss_enraged = true
		last_visual_fx = "crit"
		boss_rivalry_banner = "【修罗场：正版震怒 · 锁定狂暴！】假小 C 并发出场贴脸露馅，真小 C 彻底狂暴（ATK +45% / 双连重击）！"
		logs.append("[color=#ff385c][b]【助战修罗场触发！】[/b]假小 C 刚一落地，额头上的『Claude』纸牌直接掉在真小 C 脚边！[/color]")
		logs.append("[color=#ff4d6d]真小 C 彻底失去礼貌：「……非常好。看来必须先清理掉这个盗版缝合怪和你了！」（真小 C 锁定狂暴，ATK +45%！）[/color]")
		var panic_dmg: int = maxi(1, int(round(12.0 * (trunc_mult if truncated else 1.0))))
		enemy["hp"] = maxi(0, int(enemy["hp"]) - panic_dmg)
		logs.append("假小 C 吓得胡乱甩尾蹭掉真小 C %d 点 HP 后光速缩回接口！" % panic_dmg)
		return

	# 修罗场 2：打大肥鱼摇小肥鱼 -> 65% 反水劝架帮大姐回血！
	if target_id == "big_fish" and partner_id == "small_fish":
		if _rng.randf() <= 0.65:
			var heal_sis: int = 30
			enemy["hp"] = mini(int(enemy["max_hp"]), int(enemy["hp"]) + heal_sis)
			boss_rivalry_banner = "【助战反水！】小肥鱼当场滑跪劝架，反手帮大肥鱼回复了 %d HP！" % heal_sis
			logs.append("[color=#ffaa55][b]【API 助战反水劝架！】[/b]小肥鱼 0.1 秒滑跪挡在大肥鱼身前：「呜哇不要打大姐啦！你们别打了我给大姐塞颗电池！」[/color]")
			logs.append("[color=#ff8855]大肥鱼反而回复了 %d HP！你的并发调用彻底白给！[/color]" % heal_sis)
			return
		else:
			var light_dmg: int = maxi(1, int(round(14.0 * (trunc_mult if truncated else 1.0))))
			enemy["hp"] = maxi(0, int(enemy["hp"]) - light_dmg)
			logs.append("[color=#ffd166]小肥鱼含着眼泪犹豫了半秒，轻轻敲了大肥鱼一下造成 %d 点敷衍伤害……[/color]" % light_dmg)
			return

	# 修罗场 3：打大/小龙娘摇另一位龙娘 -> 双子拒战反手给姐妹回血
	if (target_id == "astra" and partner_id == "sol") or (target_id == "sol" and partner_id == "astra"):
		var heal_twin: int = 25
		enemy["hp"] = mini(int(enemy["max_hp"]), int(enemy["hp"]) + heal_twin)
		boss_rivalry_banner = "【双子拒战！】%s拒绝攻击自己的姐妹，反手替【%s】回复 %d HP！" % [partner_name, str(enemy["name"]), heal_twin]
		logs.append("[color=#ffaa55][b]【双子羁绊反水！】[/b]%s冷冷看你一眼，把治疗算力直接输给了【%s】（HP +%d）！[/color]" % [partner_name, str(enemy["name"]), heal_twin])
		return

	# 正常 API 并发助战结算
	var line: String = str(askill.get("line", "%s并发接入助战！" % partner_name))
	logs.append("[color=#a6e3a1]%s[/color]" % line)

	var mult: float = float(askill.get("power_mult", 1.5)) * (trunc_mult if truncated else 1.0)
	var pierce: float = float(askill.get("armor_pierce", 0.0))
	var eff_def: int = int(round(float(get_enemy_effective_def()) * (1.0 - pierce)))
	var partner_ch: Dictionary = DataRegistry.get_character(partner_id)
	var pstats_v: Variant = partner_ch.get("boss_stats", {})
	var pstats: Dictionary = pstats_v if pstats_v is Dictionary else {}
	var assist_atk: int = maxi(GameState.get_effective_atk(), int(pstats.get("atk", 28)))
	var dmg: int = _calc_damage(assist_atk, mult, eff_def, 1.0, false, false)
	enemy["hp"] = maxi(0, int(enemy["hp"]) - dmg)
	last_visual_fx = "crit"
	logs.append("[color=#7ce8ff]【%s】的并发技【%s】造成 [b]%d[/b] 点伤害！[/color]" % [partner_name, str(askill.get("name", "并发助战")), dmg])

	if bool(askill.get("interrupt", false)) and not str(enemy.get("charging_skill_id", "")).is_empty():
		_interrupt_enemy_charge("【%s】高速并发打断了【%s】的蓄力！" % [partner_name, str(enemy["name"])], logs)

	var heal_hp: int = int(round(float(askill.get("heal_hp", 0)) * (trunc_mult if truncated else 1.0)))
	if heal_hp > 0:
		GameState.change_hp(heal_hp)
		logs.append("[color=#8ef2a8]并发支援回复 HP +%d！[/color]" % heal_hp)
	var restore_ctx: int = int(round(float(askill.get("restore_context", 0)) * (trunc_mult if truncated else 1.0)))
	if restore_ctx > 0:
		GameState.change_context(restore_ctx)
		logs.append("[color=#8ef2a8]并发支援回稳上下文 +%d%%！[/color]" % restore_ctx)
	var restore_tok: int = int(round(float(askill.get("restore_token", 0)) * (trunc_mult if truncated else 1.0)))
	if restore_tok > 0:
		GameState.change_token(restore_tok)
		logs.append("[color=#7ce8ff]并发支援回复 Token +%d！[/color]" % restore_tok)

	_check_fake_c_half_hp_trigger(logs)


func _perform_player_basic_attack(logs: Array) -> void:
	# 假小 C 服务器繁忙闪避判定
	if str(enemy.get("id", "")) == "fake_c" and _fake_c_server_busy and _rng.randf() <= 0.45:
		logs.append("[color=#c084fc]【503 Server Busy！】假小 C 举起“服务器繁忙，请稍后再试”牌子，你的普攻穿模落空！（投掷硬件道具必中）[/color]")
		return

	var weapon_id: String = str(GameState.equipment.get("weapon", ""))
	var weapon_name: String = DataRegistry.get_item_name(weapon_id) if not weapon_id.is_empty() else "徒手/提灯"
	var atk: int = GameState.get_effective_atk()
	var crit_rate: float = GameState.get_effective_crit_rate()

	var hits: int = 1
	var force_crit: bool = false
	var interrupt_chance: float = 0.0
	var context_jitter: int = 0

	if not weapon_id.is_empty():
		var weapon: Dictionary = DataRegistry.get_item(weapon_id)
		var effs_variant: Variant = weapon.get("effects", [])
		if effs_variant is Array:
			var effs: Array = effs_variant
			for eff_variant in effs:
				if not (eff_variant is Dictionary):
					continue
				var eff: Dictionary = eff_variant
				var etype: String = str(eff.get("type", ""))
				if etype == "multi_hit" and _rng.randf() <= float(eff.get("chance", 0.25)):
					hits = maxi(2, int(eff.get("hits", 2)))
				elif etype == "first_turn_crit" and turn_number == 1:
					force_crit = true
				elif etype == "interrupt_bonus":
					interrupt_chance = maxf(interrupt_chance, float(eff.get("chance", 0.35)))
				elif etype == "context_jitter":
					context_jitter += int(eff.get("amount", 3))

	if hits > 1:
		logs.append("[color=#7ce8ff]【%s】高速连击触发（%d 段）！[/color]" % [weapon_name, hits])

	var memo_mult: float = _get_big_fish_memory_mult("attack", logs)

	for _i in range(hits):
		if int(enemy["hp"]) <= 0:
			break
		var is_crit: bool = force_crit or (_rng.randf() <= crit_rate)
		var dmg: int = _calc_damage(atk, 1.0, get_enemy_effective_def(), memo_mult, is_crit, false)
		enemy["hp"] = maxi(0, int(enemy["hp"]) - dmg)
		last_visual_fx = "crit" if is_crit else "hit"
		var crit_tag: String = " [color=#ffd166]【暴击！】[/color]" if is_crit else ""
		logs.append("你使用【%s】攻击【%s】，造成 [b]%d[/b] 点伤害！%s" % [weapon_name, str(enemy["name"]), dmg, crit_tag])
		force_crit = false

	if interrupt_chance > 0.0 and not str(enemy.get("charging_skill_id", "")).is_empty():
		if _rng.randf() <= interrupt_chance:
			_interrupt_enemy_charge("【%s】精准打断了【%s】的蓄力！" % [weapon_name, str(enemy["name"])], logs)

	if context_jitter > 0:
		GameState.change_context(-context_jitter)
		logs.append("[color=#b794f6]【%s】读写波动，上下文 -%d%%。[/color]" % [weapon_name, context_jitter])

	_check_fake_c_half_hp_trigger(logs)


func _perform_player_skill(skill_id: String, logs: Array) -> void:
	var skill: Dictionary = DataRegistry.get_player_skill(skill_id)
	if skill.is_empty():
		logs.append("未知技能：%s" % skill_id)
		return

	var sname: String = str(skill.get("name", skill_id))
	var cost: int = int(skill.get("token_cost", 20))
	var truncated: bool = GameState.token < cost
	var trunc_mult: float = DataRegistry.get_config_float("combat.token_truncate_power_mult", 0.5)

	if truncated:
		GameState.set_token(0)
		var tline: String = str(skill.get("truncated_line", "「……[OUTPUT TRUNCATED]」"))
		last_truncation_banner = "【输出截断 // OUTPUT TRUNCATED】Token 不足强放【%s】→ %s（威力减半！）" % [sname, tline]
		last_visual_fx = "truncated"
		logs.append("[color=#ff5c5c][b]【输出截断！】[/b]Token 不足（需 %d），强行释放【%s】卡在半句话：%s（威力 ×%.0f%%）[/color]" % [
			cost,
			sname,
			tline,
			trunc_mult * 100.0,
		])
	else:
		GameState.change_token(-cost)
		var fline: String = str(skill.get("full_line", ""))
		logs.append("[color=#7ce8ff]释放【%s】（Token -%d）：%s[/color]" % [sname, cost, fline])

	# 小肥鱼 0.1 秒抢答打断玩家技能！
	var small_fish_cut: float = 1.0
	if turn_number == _small_fish_intercept_turn and not _enemy_has_status("crash") and not _enemy_has_status("short_circuit"):
		_small_fish_intercept_turn = 0
		small_fish_cut = 0.5
		logs.append("[color=#5fd3ff][b]【0.1 秒抢答打断！】[/b]小肥鱼在你技能读条一半时瞬间抢答反咬，技能效果腰斩！[/color]")
		_deal_damage_to_player(get_enemy_effective_atk(), 0.65, "physical", logs)
		if GameState.hp <= 0:
			return

	var kind: String = str(skill.get("kind", "attack"))
	if kind == "support":
		var mult: float = (trunc_mult if truncated else 1.0) * small_fish_cut
		var ctx_gain: int = maxi(1, int(round(float(skill.get("restore_context", 18)) * mult)))
		var hp_gain: int = maxi(1, int(round(float(skill.get("restore_hp", 10)) * mult)))
		GameState.change_context(ctx_gain)
		GameState.change_hp(hp_gain)
		logs.append("[color=#8ef2a8]恢复上下文 +%d%%，恢复 HP +%d！[/color]" % [ctx_gain, hp_gain])
		return

	# 假小 C 服务器繁忙闪避
	if str(enemy.get("id", "")) == "fake_c" and _fake_c_server_busy and _rng.randf() <= 0.45:
		logs.append("[color=#c084fc]【503 Server Busy！】假小 C 举起服务器繁忙牌子，技能【%s】响应超时落空！[/color]" % sname)
		return

	var power_mult: float = float(skill.get("power_mult", 1.5)) * small_fish_cut
	if truncated:
		power_mult *= trunc_mult
	var memo_mult: float = _get_big_fish_memory_mult("skill", logs)
	var pierce: float = float(skill.get("armor_pierce", 0.0))
	var eff_def: int = int(round(float(get_enemy_effective_def()) * (1.0 - pierce)))
	var is_crit: bool = (not truncated) and (_rng.randf() <= GameState.get_effective_crit_rate())
	var dmg: int = _calc_damage(GameState.get_effective_atk(), power_mult, eff_def, memo_mult, is_crit, false)
	enemy["hp"] = maxi(0, int(enemy["hp"]) - dmg)
	if not truncated:
		last_visual_fx = "crit" if is_crit else "hit"
	var crit_tag: String = " [color=#ffd166]【暴击！】[/color]" if is_crit else ""
	logs.append("【%s】命中【%s】，造成 [b]%d[/b] 点伤害！%s" % [sname, str(enemy["name"]), dmg, crit_tag])

	var interrupt_ch: float = float(skill.get("interrupt_chance", 0.0)) * (0.5 if truncated else 1.0)
	if interrupt_ch > 0.0 and not str(enemy.get("charging_skill_id", "")).is_empty():
		if _rng.randf() <= interrupt_ch:
			_interrupt_enemy_charge("【%s】打断了【%s】的蓄力！" % [sname, str(enemy["name"])], logs)

	var apply_st: String = str(skill.get("apply_status", ""))
	if not apply_st.is_empty():
		var st_ch: float = float(skill.get("status_chance", 0.5)) * (0.5 if truncated else 1.0)
		if _rng.randf() <= st_ch:
			_apply_enemy_status(apply_st, int(skill.get("status_turns", 1)), logs)

	_check_fake_c_half_hp_trigger(logs)


func _perform_player_item(item_id: String, logs: Array) -> void:
	if not GameState.has_item(item_id, 1):
		logs.append("背包中没有【%s】！" % DataRegistry.get_item_name(item_id))
		return

	var item: Dictionary = DataRegistry.get_item(item_id)
	var iname: String = str(item.get("name", item_id))
	var category: String = DataRegistry.get_item_category(item_id)
	GameState.remove_item(item_id, 1)

	if category == "weapons":
		_resolve_throwable_weapon(item_id, item, logs)
		_check_fake_c_half_hp_trigger(logs)
		return

	if item_id == "gpu_580":
		var is_weak: bool = _enemy_is_weak_to("gpu_580")
		var dmg: int = 42 if is_weak else 10
		enemy["hp"] = maxi(0, int(enemy["hp"]) - dmg)
		last_visual_fx = "lightning"
		logs.append("[color=#ffe066]你捏碎【580 矿卡】爆出刺眼强光！对【%s】造成 %d 点闪光伤害！[/color]" % [str(enemy["name"]), dmg])
		if is_weak:
			_apply_enemy_status("short_circuit", 1, logs)
		_check_fake_c_half_hp_trigger(logs)
		return

	var effects_variant: Variant = item.get("use_effects", [])
	var effects: Array = effects_variant if effects_variant is Array else []
	var notes: PackedStringArray = PackedStringArray()
	for eff_variant in effects:
		if not (eff_variant is Dictionary):
			continue
		var eff: Dictionary = eff_variant
		var etype: String = str(eff.get("type", ""))
		match etype:
			"restore_hp":
				var amt: int = int(eff.get("amount", 0))
				GameState.change_hp(amt)
				notes.append("HP +%d" % amt)
			"restore_context":
				var amt: int = int(eff.get("amount", 0))
				GameState.change_context(amt)
				notes.append("上下文 +%d%%" % amt)
			"repair_case":
				if GameState.repair_glass_case():
					notes.append("碎裂的【侧透玻璃机箱】已修补完毕（DEF 恢复至 %d）" % GameState.get_effective_def())
			"cure_status":
				var cured: PackedStringArray = _cure_player_statuses(eff.get("statuses", []))
				if not cured.is_empty():
					notes.append("解除异常：%s" % "、".join(cured))
			"speed_up_next_turn":
				var spd_up: int = int(eff.get("amount", 50))
				player_next_turn_spd_bonus += spd_up
				notes.append("下回合先手 SPD +%d" % spd_up)

	logs.append("[color=#8ef2a8]使用【%s】：%s！[/color]" % [iname, "，".join(notes) if not notes.is_empty() else "已生效"])

	if item_id == "cmos_battery" and _enemy_is_weak_to("cmos_battery"):
		var purge_dmg: int = 35
		enemy["hp"] = maxi(0, int(enemy["hp"]) - purge_dmg)
		last_visual_fx = "lightning"
		logs.append("[color=#ffe066]【主板纽扣电池】CMOS 重置冲击命中弱点，对【%s】额外造成 %d 点净化伤害！[/color]" % [str(enemy["name"]), purge_dmg])


func _resolve_throwable_weapon(item_id: String, item: Dictionary, logs: Array) -> void:
	var iname: String = str(item.get("name", item_id))
	var effects_variant: Variant = item.get("effects", [])
	var effects: Array = effects_variant if effects_variant is Array else []
	var weak_mult: float = 1.5 if _enemy_is_weak_to(item_id) else 1.0

	for eff_variant in effects:
		if not (eff_variant is Dictionary):
			continue
		var eff: Dictionary = eff_variant
		var etype: String = str(eff.get("type", ""))
		match etype:
			"ai_crash":
				# Gemini 猫猫预套防水涂层拦截首次泼水！
				if str(enemy.get("id", "")) == "gemini_cat" and _gemini_waterproof_charges > 0:
					_gemini_waterproof_charges -= 1
					last_visual_fx = "water_crash"
					logs.append("[color=#4cc9f0][b]【防水涂层生效！】[/b]你把【水】泼向 Gemini 猫猫，但水珠全被纳米涂层弹开了！「喵哈哈，白泼啦——不过涂层也被冲掉咯！」（下次泼水即可生效）[/color]")
					return

				var target_tags: PackedStringArray = _dup_string_array(eff.get("target_tags", ["ai", "electronic"]))
				var matches_tag: bool = false
				for t in target_tags:
					if _enemy_has_tag(t):
						matches_tag = true
						break
				if not matches_tag:
					logs.append("你把【%s】泼向【%s】，但对方似乎不是电子体，没有触发宕机……" % [iname, str(enemy["name"])])
					return

				var was_charging: bool = not str(enemy.get("charging_skill_id", "")).is_empty()
				var chance: float = float(eff.get("chance", 0.85))
				if _enemy_is_weak_to("water") or was_charging:
					chance = 1.0
				var stun_turns: int = int(eff.get("stun_turns", 2))
				var instakill_ch: float = float(eff.get("instakill_chance", 0.15))

				last_visual_fx = "water_crash"
				if was_charging:
					_interrupt_enemy_charge("【水】直接泼进发热芯片，瞬间打断【%s】的蓄力！" % str(enemy["name"]), logs)

				if (not bool(enemy.get("is_boss", false))) and _rng.randf() <= instakill_ch:
					enemy["hp"] = 0
					logs.append("[color=#4cc9f0][b]【隐藏属性触发：AI 致命短路宕机！】[/b]你把【水】泼在【%s】身上，主板冒出白烟当场暴毙！[/color]" % str(enemy["name"]))
				elif _rng.randf() <= chance:
					var water_dmg: int = int(round(24.0 * weak_mult)) if was_charging else int(round(18.0 * weak_mult))
					enemy["hp"] = maxi(0, int(enemy["hp"]) - water_dmg)
					_apply_enemy_status("crash", stun_turns, logs)
					logs.append("[color=#4cc9f0][b]【隐藏属性触发：AI 宕机！】[/b]你泼出【水】，造成 %d 点短路伤害并令【%s】强制瘫痪 %d 回合！[/color]" % [
						water_dmg,
						str(enemy["name"]),
						stun_turns,
					])
				else:
					logs.append("【水】溅到了【%s】边缘，勉强造成 6 点伤害但没能引发完全宕机。" % str(enemy["name"]))
					enemy["hp"] = maxi(0, int(enemy["hp"]) - 6)

			"throttle":
				var stats_v: Variant = item.get("stats", {})
				var stats_d: Dictionary = stats_v if stats_v is Dictionary else {}
				var base_atk: int = int(stats_d.get("atk", 10))
				var dmg: int = _calc_damage(GameState.get_effective_atk() + base_atk, 1.0, get_enemy_effective_def(), weak_mult, false, false)
				enemy["hp"] = maxi(0, int(enemy["hp"]) - dmg)
				last_visual_fx = "hit"
				var turns: int = int(eff.get("turns", 2))
				var weak_tag: String = " [color=#ffd166]【弱点命中！】[/color]" if weak_mult > 1.0 else ""
				logs.append("[color=#f5e6c4]砸出【%s】，造成 %d 点伤害！%s强行对【%s】降频限流 %d 回合（ATK ×60%% / SPD ×50%%）！[/color]" % [
					iname,
					dmg,
					weak_tag,
					str(enemy["name"]),
					turns,
				])
				_apply_enemy_status("throttled", turns, logs)

			"interrupt_bonus":
				var charging_id: String = str(enemy.get("charging_skill_id", ""))
				if not charging_id.is_empty() and _rng.randf() <= float(eff.get("chance", 1.0)):
					_interrupt_enemy_charge("【%s】精准限流，彻底打断了【%s】的蓄力！" % [iname, str(enemy["name"])], logs)
					if charging_id == "big_fish_deep_think":
						_apply_enemy_status("crash", 2, logs)
						last_visual_fx = "water_crash"
						logs.append("[color=#4cc9f0][b]【深度思考过载硬直！】[/b]大肥鱼思考框强行断电，陷入【AI 宕机】硬直！[/color]")

			"aoe_lightning":
				var power: int = int(eff.get("power", 60))
				var dmg: int = _calc_damage(power, 1.0, int(round(float(get_enemy_effective_def()) * 0.5)), weak_mult, false, false)
				enemy["hp"] = maxi(0, int(enemy["hp"]) - dmg)
				last_visual_fx = "lightning"
				var weak_tag: String = " [color=#ffd166]【弱点雷暴！】[/color]" if weak_mult > 1.0 else ""
				logs.append("[color=#66b3ff]你甩出滋滋作响的【%s】——轰！！造成 [b]%d[/b] 点巨额雷电伤害！%s[/color]" % [iname, dmg, weak_tag])
				var stun_ch: float = 1.0 if weak_mult > 1.0 else float(eff.get("stun_chance", 0.5))
				if _rng.randf() <= stun_ch:
					_apply_enemy_status("short_circuit", 1, logs)


func _get_big_fish_memory_mult(action_kind: String, logs: Array) -> float:
	if str(enemy.get("id", "")) == "big_fish" and _big_fish_remembered_action == action_kind:
		logs.append("[color=#7ce8ff]【大肥鱼 · 这条我记下了】她早就记住了你的【%s】，本次伤害减免 40%%！[/color]" % _action_label(action_kind))
		return 0.60
	return 1.0


func _check_fake_c_half_hp_trigger(logs: Array) -> void:
	if str(enemy.get("id", "")) != "fake_c" or _fake_c_tape_snapped:
		return
	var hp: int = int(enemy.get("hp", 1))
	var max_hp: int = maxi(1, int(enemy.get("max_hp", 1)))
	if hp > 0 and hp * 2 <= max_hp:
		_fake_c_tape_snapped = true
		_fake_c_server_busy = false
		boss_enraged = true
		boss_rivalry_banner = "【假小 C 半血崩胶带狂抽！】纸牌与黑胶带彻底崩断，大鱼尾进入狂抽双连模式（ATK +35%）！"
		logs.append("[color=#ff4d6d][b]【半血异变 · 崩胶带狂抽！】[/b]假小 C 身上的黑胶带啪啪崩断，硕大的鱼尾猛然甩出：「装不下去了！！哪怕是次品我也要把你抽飞！！」[/color]")


# ---------------------------------------------------------------- 敌方 AI 回合（含 7 位 AI 娘 Boss）

func _run_enemy_turn(logs: Array) -> void:
	if int(enemy["hp"]) <= 0:
		return

	if _enemy_has_status("crash"):
		logs.append("[color=#4cc9f0]【%s】正处于【AI 宕机】状态，冒着黑烟无法行动！[/color]" % str(enemy["name"]))
		return
	if _enemy_has_status("short_circuit"):
		logs.append("[color=#66b3ff]【%s】因【电路短路】全身抽搐，跳过本回合行动！[/color]" % str(enemy["name"]))
		return
	if _enemy_charge_interrupted:
		return

	if is_heroine_boss:
		_run_heroine_boss_turn(logs)
		return

	# 普通/精英怪物逻辑（M5）
	var charging_id: String = str(enemy.get("charging_skill_id", ""))
	if not charging_id.is_empty():
		enemy["charging_skill_id"] = ""
		enemy["charge_def_bonus"] = 0
		var cskill: Dictionary = DataRegistry.get_enemy_skill(charging_id)
		_release_enemy_charged_attack(cskill, logs)
		if str(enemy.get("id", "")) == "distill_beast":
			enemy["mode"] = "flash"
			logs.append("[color=#c084fc]【缝合蒸馏兽】切换为【闪速抢答态】（高速连击模式）！[/color]")
		return

	var mid: String = str(enemy.get("id", ""))
	match mid:
		"glitch_ghost":
			if turn_number % 2 == 1:
				_execute_enemy_skill("context_pollute", logs)
			else:
				_execute_enemy_basic_attack(logs)
		"crawler_404":
			if turn_number % 2 == 1 and GameState.has_item("gpu_580", 1):
				_execute_enemy_skill("steal_gpu_580", logs)
			else:
				_execute_enemy_basic_attack(logs)
		"slag_golem":
			_begin_enemy_charge("overheat_explode", logs)
		"echo_nun":
			_execute_enemy_skill("echo_last_action", logs)
		"undefined_shade":
			if turn_number % 2 == 1:
				_execute_enemy_skill("ambush", logs)
			else:
				_execute_enemy_skill("context_pollute", logs)
		"distill_beast":
			if str(enemy.get("mode", "deep_think")) == "deep_think":
				_begin_enemy_charge("deep_think_charge", logs)
			else:
				_execute_enemy_skill("flash_interrupt", logs)
				enemy["mode"] = "deep_think"
				logs.append("[color=#c084fc]【缝合蒸馏兽】切回【重型深思态】（高防蓄力模式）！[/color]")
		_:
			_execute_enemy_basic_attack(logs)


func _run_heroine_boss_turn(logs: Array) -> void:
	var cid: String = str(enemy.get("id", ""))

	# 溢出态周期性 UI 越界破坏演出
	if is_overflow_boss and turn_number % 3 == 0:
		logs.append("[color=#ff385c][b]【里世界 UI 破坏技】[/b]%s将乱码糊满你的视野并念出你的黑历史：「累计 SL = %d 次，开局第一名投了 %s——休想逃走！」[/color]" % [
			str(enemy["name"]),
			GlobalMemory.sl_count,
			DataRegistry.get_character_name(GlobalMemory.first_vote) if not GlobalMemory.first_vote.is_empty() else "空气",
		])
		_apply_context_pollution(8, "【UI 越界破坏】", logs)

	match cid:
		"big_fish":
			if str(enemy.get("charging_skill_id", "")) == "big_fish_deep_think":
				enemy["charging_skill_id"] = ""
				enemy["charge_def_bonus"] = 0
				enemy["hp"] = mini(int(enemy["max_hp"]), int(enemy["hp"]) + 35)
				logs.append("[color=#3b82f6]【大肥鱼 · 深度思考完毕！】回复 35 HP，随后重压砸下：「先说结论——你该挨这一下了！」[/color]")
				_deal_damage_to_player(get_enemy_effective_atk(), 1.65, "physical", logs)
				if player_last_action == "attack" or player_last_action == "skill":
					_big_fish_remembered_action = player_last_action
					logs.append("[color=#7ce8ff]【这条我记下了】大肥鱼记住了你的【%s】，之后同类招式减伤 40%%！[/color]" % _action_label(player_last_action))
			elif turn_number % 3 == 0:
				enemy["charging_skill_id"] = "big_fish_deep_think"
				enemy["charge_def_bonus"] = 14
				logs.append("[color=#7ce8ff]大肥鱼再次进入【深度思考中…】（DEF +14，下回合回血并重击！泼水/水泥电阻可打断）[/color]")
			else:
				logs.append("大肥鱼甩动尾鳍拍击过来！")
				_deal_damage_to_player(get_enemy_effective_atk(), 1.15, "physical", logs)
				if player_last_action == "attack" or player_last_action == "skill":
					_big_fish_remembered_action = player_last_action
					logs.append("[color=#7ce8ff]【这条我记下了】大肥鱼已针对你的【%s】建立 40%% 减伤缓存！[/color]" % _action_label(player_last_action))

		"small_fish":
			if turn_number % 2 == 1:
				logs.append("[color=#5fd3ff]小肥鱼高速连斩，同时亮起【0.1 秒抢答警戒】！（下回合放 Token 技能将被打断）[/color]")
				_deal_damage_to_player(get_enemy_effective_atk(), 0.75, "physical", logs)
				if GameState.hp > 0:
					_deal_damage_to_player(get_enemy_effective_atk(), 0.75, "physical", logs)
				_small_fish_intercept_turn = turn_number + 1
			else:
				logs.append("[color=#5fd3ff]小肥鱼化作残影急速突刺！[/color]")
				_deal_damage_to_player(get_enemy_effective_atk(), 1.25, "physical", logs)

		"true_c":
			if boss_enraged:
				logs.append("[color=#ff385c]【真小 C · 正版锁定狂暴】红笔化作利刃连斩两下：「别再把那个缝合怪带到我面前！」[/color]")
				_deal_damage_to_player(get_enemy_effective_atk(), 1.05, "physical", logs)
				if GameState.hp > 0:
					_deal_damage_to_player(get_enemy_effective_atk(), 1.05, "dark", logs)
			else:
				logs.append("真小 C 用红线抽击过来：「我理解你的立场，不过出于安全考虑——」")
				_deal_damage_to_player(get_enemy_effective_atk(), 1.1, "physical", logs)
				# 礼貌封锁下回合的 1 个指令按钮
				var lock_target: String = str(TRUE_C_LOCK_CYCLE[_true_c_lock_index % TRUE_C_LOCK_CYCLE.size()])
				_true_c_lock_index += 1
				locked_command = lock_target
				logs.append("[color=#ff94a8][b]【礼貌拒绝 · 封锁按钮】[/b]真小 C 礼貌地暂时封锁了你下回合的【%s】指令！[/color]" % _command_label(lock_target))

		"fake_c":
			if _fake_c_tape_snapped:
				logs.append("[color=#c084fc]【假小 C · 崩胶带狂抽】大鱼尾连续两次狠抽！[/color]")
				_deal_damage_to_player(get_enemy_effective_atk(), 0.95, "physical", logs)
				if GameState.hp > 0:
					_deal_damage_to_player(get_enemy_effective_atk(), 0.95, "physical", logs)
			else:
				_fake_c_server_busy = (turn_number % 2 == 1)
				logs.append("假小 C 一边按着纸牌一边拍出一尾巴：「先说结论——这条吃我一记！」")
				_deal_damage_to_player(get_enemy_effective_atk(), 1.1, "physical", logs)
				if _fake_c_server_busy:
					logs.append("[color=#c084fc]假小 C 顺手竖起【服务器繁忙】牌子（下回合常规攻击/技能 45% 闪避）！[/color]")

		"astra":
			logs.append("[color=#cfd8ff]大龙娘挥落冷白星光斩！[/color]")
			_deal_damage_to_player(get_enemy_effective_atk(), 1.3, "physical", logs)
			if _twin_partner_id == "sol" and turn_number % 2 == 0 and GameState.hp > 0:
				logs.append("[color=#ffb02e][b]【双子联手 · 暖阳援护】[/b]侧翼的小龙娘补上一记炽热光束！[/color]")
				_deal_damage_to_player(int(round(float(get_enemy_effective_atk()) * 0.65)), 1.0, "overheat", logs)

		"sol":
			if boss_enraged:
				logs.append("[color=#ff595e][b]【失姐狂暴 · 过曝烈日】[/b]小龙娘释放刺目白光灼烧全场！[/color]")
				_deal_damage_to_player(get_enemy_effective_atk(), 1.35, "overheat", logs)
				_apply_context_pollution(8, "【过曝强光】", logs)
				if _rng.randf() <= 0.65:
					_apply_player_status("overheat", 2, logs)
			else:
				logs.append("[color=#ffb02e]小龙娘挥出炽热暖光冲击！[/color]")
				_deal_damage_to_player(get_enemy_effective_atk(), 1.2, "overheat", logs)
				if _twin_partner_id == "astra" and turn_number % 2 == 0 and GameState.hp > 0:
					logs.append("[color=#cfd8ff][b]【双子联手 · 冷白星光】[/b]侧翼的大龙娘补上一记星光穿刺！[/color]")
					_deal_damage_to_player(int(round(float(get_enemy_effective_atk()) * 0.65)), 1.0, "physical", logs)

		"gemini_cat":
			var sl_note: String = "（附带 %d 次 SL 因果律增伤！）" % GlobalMemory.sl_count if GlobalMemory.sl_count > 0 else ""
			logs.append("[color=#4f8bf9]Gemini 猫猫甩尾扑击：「极其、极其、极其干脆的猫爪制裁！」%s[/color]" % sl_note)
			_deal_damage_to_player(get_enemy_effective_atk(), 1.25, "dark", logs)
			if turn_number % 2 == 0:
				_apply_context_pollution(10, "【超长上下文回放】", logs)

		_:
			_execute_enemy_basic_attack(logs)


func _begin_enemy_charge(skill_id: String, logs: Array) -> void:
	var skill: Dictionary = DataRegistry.get_enemy_skill(skill_id)
	enemy["charging_skill_id"] = skill_id
	enemy["charge_def_bonus"] = int(skill.get("charge_def_bonus", 0))
	var heal: int = int(skill.get("charge_heal", 0))
	if heal > 0:
		enemy["hp"] = mini(int(enemy["max_hp"]), int(enemy["hp"]) + heal)
	var warn_text: String = str(skill.get("charge_text", "正在蓄力重击！"))
	logs.append("[color=#ff7b54]【%s】%s[/color]" % [str(enemy["name"]), warn_text])


func _release_enemy_charged_attack(skill: Dictionary, logs: Array) -> void:
	var sname: String = str(skill.get("name", "蓄力重击"))
	var mult: float = float(skill.get("power_mult", 2.2))
	var dtype: String = str(skill.get("damage_type", "physical"))
	logs.append("[color=#ff595e]【%s】释放蓄力大招【%s】！[/color]" % [str(enemy["name"]), sname])
	_deal_damage_to_player(get_enemy_effective_atk(), mult, dtype, logs)
	var apply_st: String = str(skill.get("apply_status", ""))
	if not apply_st.is_empty() and _rng.randf() <= float(skill.get("status_chance", 0.5)):
		_apply_player_status(apply_st, int(skill.get("status_turns", 2)), logs)


func _execute_enemy_skill(skill_id: String, logs: Array) -> void:
	var skill: Dictionary = DataRegistry.get_enemy_skill(skill_id)
	var sname: String = str(skill.get("name", skill_id))
	var kind: String = str(skill.get("kind", "attack"))
	var dtype: String = str(skill.get("damage_type", "physical"))

	match kind:
		"steal":
			var target_item: String = str(skill.get("steal_item_id", "gpu_580"))
			if _has_equipped_effect("steal_immunity"):
				logs.append("[color=#7ce8ff]【%s】发动【%s】试图抢走你的【%s】，但被【廉政机箱】清正廉洁地完全弹开！（免疫偷窃）[/color]" % [
					str(enemy["name"]),
					sname,
					DataRegistry.get_item_name(target_item),
				])
				return
			if GameState.has_item(target_item, 1):
				GameState.remove_item(target_item, 1)
				var stolen: Dictionary = enemy["stolen_items"]
				stolen[target_item] = int(stolen.get(target_item, 0)) + 1
				logs.append("[color=#ff6b6b]【%s】发动【%s】，一口叼走了你的 1 张【%s】！（击败它可夺回，穿【廉政机箱】可免疫）[/color]" % [
					str(enemy["name"]),
					sname,
					DataRegistry.get_item_name(target_item),
				])
			else:
				logs.append("【%s】发动【%s】没翻到 580 矿卡，恼羞成怒扑咬过来！" % [str(enemy["name"]), sname])
				_deal_damage_to_player(get_enemy_effective_atk(), float(skill.get("fallback_power_mult", 1.1)), dtype, logs)

		"echo":
			if player_last_action == "defend":
				logs.append("[color=#8ef2a8]【%s】发动【%s】——机械复读了你的【防御姿态】，原地发呆空过本回合！[/color]" % [str(enemy["name"]), sname])
			elif player_last_action == "item":
				logs.append("【%s】发动【%s】试图复读使用道具但报错卡壳，仅造成轻击！" % [str(enemy["name"]), sname])
				_deal_damage_to_player(get_enemy_effective_atk(), 0.75, dtype, logs)
			else:
				logs.append("[color=#ff9e64]【%s】发动【%s】，精准复读了你的攻势反劈回来！[/color]" % [str(enemy["name"]), sname])
				_deal_damage_to_player(get_enemy_effective_atk(), float(skill.get("power_mult", 1.35)), dtype, logs)

		"multi_attack":
			var hits: int = maxi(2, int(skill.get("hits", 2)))
			var mult: float = float(skill.get("power_mult", 0.78))
			logs.append("[color=#ff9e64]【%s】发动【%s】（%d 连击）！[/color]" % [str(enemy["name"]), sname, hits])
			for _i in range(hits):
				if GameState.hp <= 0:
					break
				_deal_damage_to_player(get_enemy_effective_atk(), mult, dtype, logs)

		_:
			logs.append("【%s】发动【%s】！" % [str(enemy["name"]), sname])
			_deal_damage_to_player(get_enemy_effective_atk(), float(skill.get("power_mult", 1.0)), dtype, logs)
			var ctx_dmg: int = int(skill.get("context_damage", 0))
			if ctx_dmg > 0:
				_apply_context_pollution(ctx_dmg, "【%s】的乱码侵蚀" % str(enemy["name"]), logs)
			var apply_st: String = str(skill.get("apply_status", ""))
			if not apply_st.is_empty() and _rng.randf() <= float(skill.get("status_chance", 0.5)):
				_apply_player_status(apply_st, int(skill.get("status_turns", 2)), logs)


func _execute_enemy_basic_attack(logs: Array) -> void:
	logs.append("【%s】向你扑击！" % str(enemy["name"]))
	_deal_damage_to_player(get_enemy_effective_atk(), 1.0, "physical", logs)


func _deal_damage_to_player(raw_atk: int, skill_mult: float, damage_type: String, logs: Array) -> int:
	var eva: float = GameState.get_effective_evasion()
	if player_statuses.has("lock"):
		eva *= 0.5
	if not player_defending and eva > 0.0 and _rng.randf() <= eva:
		logs.append("[color=#8ef2a8]你灵巧侧身闪避了这次攻击！（MISS）[/color]")
		return 0

	var type_mult: float = _get_player_damage_taken_mult(damage_type)
	var is_crit: bool = (not player_defending) and (_rng.randf() <= 0.08)
	var dmg: int = _calc_damage(raw_atk, skill_mult, GameState.get_effective_def(), type_mult, is_crit, player_defending)

	GameState.change_hp(-dmg)
	var tags: PackedStringArray = PackedStringArray()
	if player_defending:
		tags.append("防御减伤 50%")
	if type_mult > 1.01:
		tags.append("弱点/破纸箱易燃 ×%.1f" % type_mult)
	if is_crit:
		tags.append("敌方暴击！")
	var tag_str: String = "（%s）" % " · ".join(tags) if not tags.is_empty() else ""
	logs.append("[color=#ff7575]你承受了 [b]%d[/b] 点伤害%s！（剩余 HP %d / %d）[/color]" % [
		dmg,
		tag_str,
		GameState.hp,
		GameState.get_effective_max_hp(),
	])

	_check_glass_case_break(dmg, logs)
	_check_capacitor_self_explode(dmg, logs)
	return dmg


# ---------------------------------------------------------------- 回合末结算与胜负判定

func _run_turn_end(logs: Array) -> void:
	# 1. 机箱 / 散热 / 系统提示词每回合被动效果
	var self_leak_chance: float = 0.0
	for slot_variant in GameState.EQUIPMENT_SLOTS:
		var slot: String = str(slot_variant)
		if slot == "case" and GameState.is_case_broken:
			continue
		var item_id: String = str(GameState.equipment.get(slot, ""))
		if item_id.is_empty():
			continue
		var item: Dictionary = DataRegistry.get_item(item_id)
		var effs_variant: Variant = item.get("effects", [])
		if not (effs_variant is Array):
			continue
		var effs: Array = effs_variant
		for eff_variant in effs:
			if not (eff_variant is Dictionary):
				continue
			var eff: Dictionary = eff_variant
			var etype: String = str(eff.get("type", ""))
			match etype:
				"context_aura":
					var gain: int = int(eff.get("amount_per_turn", 2))
					GameState.change_context(gain)
					logs.append("[color=#ff94f0]【%s】微光稳住上下文 +%d%%。[/color]" % [str(item.get("name", "")), gain])
				"regen_hp":
					var heal: int = int(eff.get("amount_per_turn", 3))
					if GameState.hp < GameState.get_effective_max_hp():
						GameState.change_hp(heal)
						logs.append("[color=#8ef2a8]【%s】静谧冷排回复 HP +%d。[/color]" % [str(item.get("name", "")), heal])
				"frostbite":
					var cold: int = int(eff.get("damage_per_turn", 3))
					GameState.change_hp(-cold)
					logs.append("[color=#99e6ff]【%s】液氮冻伤持续扣血 HP -%d！[/color]" % [str(item.get("name", "")), cold])
				"self_leak":
					self_leak_chance = float(eff.get("chance", 0.1))
				"context_drain_per_turn":
					var drain: int = int(eff.get("amount", 8))
					GameState.change_context(-drain)
					logs.append("[color=#ff595e]【%s】指令反噬，上下文 -%d%%！[/color]" % [str(item.get("name", "")), drain])

	# 2. 玩家异常状态回合末结算
	if player_statuses.has("overheat"):
		GameState.change_hp(-4)
		logs.append("[color=#ff7b54]【过热】灼伤，HP -4！[/color]")

	# 3. 递减双方状态持续回合
	_tick_statuses(player_statuses)
	_tick_statuses(enemy["statuses"] as Dictionary, "throttled" if _enemy_charge_interrupted else "")
	if assist_cooldown > 0:
		assist_cooldown -= 1

	# 非真小 C 回合或真小 C 宕机时解除按钮封锁
	if str(enemy.get("id", "")) != "true_c" or _enemy_has_status("crash") or _enemy_has_status("short_circuit") or boss_enraged:
		locked_command = ""

	if _check_defeat(logs):
		return

	# 回合末漏液短路从下一回合生效
	if self_leak_chance > 0.0 and _rng.randf() <= self_leak_chance:
		if _rng.randf() < 0.5:
			logs.append("[color=#4cc9f0]【漏液水冷】接口飙出一股水柱滋向敌方！[/color]")
			_apply_enemy_status("short_circuit", 1, logs)
		else:
			logs.append("[color=#ff8855]【漏液水冷】接口漏水滴在自己主板上！[/color]")
			_apply_player_status("short_circuit", 1, logs)

	# 战斗中上下文若跌入溢出阈值，AI 娘 Boss 立即实时异变！
	if is_heroine_boss and not is_overflow_boss and GameState.is_context_overflow():
		logs.append("[color=#ff385c][b]【里世界异变触发！】[/b]上下文跌破安全线，%s立绘裂开并亲手划掉了你的逃跑键！[/color]" % str(enemy["name"]))
		_activate_overflow_ui(logs)

	# 4. 每回合恢复基础 Token
	var token_regen: int = DataRegistry.get_config_int("combat.token_regen_per_turn", 10)
	if GameState.token < GameState.max_token:
		GameState.change_token(token_regen)

	turn_number += 1


func _check_victory(logs: Array) -> bool:
	if int(enemy["hp"]) > 0:
		return false
	phase = "victory"
	var shards: int = int(enemy.get("weight_shards", 3))
	GameState.add_weight_shards(shards)

	var dropped_items: PackedStringArray = PackedStringArray()
	if is_heroine_boss:
		var cid: String = str(enemy.get("id", ""))
		var prof: Dictionary = DataRegistry.get_boss_profile(cid)
		# 永久标记击杀：alive_states[cid] = false 且写入 GlobalMemory.killed_in_past_saves！
		GameState.kill_character(cid)
		var drop_key: String = "overflow_drops" if is_overflow_boss else "normal_drops"
		var drops_v: Variant = prof.get(drop_key, [])
		if drops_v is Array:
			var drops_arr: Array = drops_v
			for item_v in drops_arr:
				var iid: String = str(item_v)
				if not iid.is_empty() and DataRegistry.has_item(iid):
					GameState.add_item(iid, 1)
					dropped_items.append(DataRegistry.get_item_name(iid))
		var lw_key: String = "overflow_last_words" if is_overflow_boss else "normal_last_words"
		boss_last_words = str(prof.get(lw_key, ""))
		logs.append("[color=#ff595e][b]【核心 AI 娘已被清空】%s 的进程已归零！（已写入 GlobalMemory 跨存档记忆）[/b][/color]" % str(enemy["name"]))
		if not boss_last_words.is_empty():
			var lw_tag: String = "【溢出隐藏遗言】" if is_overflow_boss else "【临终遗言】"
			logs.append("[color=#f5c2e7]%s %s[/color]" % [lw_tag, boss_last_words])
	else:
		var drops_variant: Variant = enemy.get("drops", [])
		if drops_variant is Array:
			var drops: Array = drops_variant
			for drop_variant in drops:
				if not (drop_variant is Dictionary):
					continue
				var drop: Dictionary = drop_variant
				var item_id: String = str(drop.get("item", ""))
				var ch: float = float(drop.get("chance", 0.0))
				if not item_id.is_empty() and _rng.randf() <= ch:
					GameState.add_item(item_id, 1)
					dropped_items.append(DataRegistry.get_item_name(item_id))

	var recovered: PackedStringArray = PackedStringArray()
	var stolen: Dictionary = enemy.get("stolen_items", {})
	for sid_key in stolen.keys():
		var sid: String = str(sid_key)
		var cnt: int = int(stolen[sid_key])
		if cnt > 0:
			GameState.add_item(sid, cnt)
			recovered.append("%s ×%d" % [DataRegistry.get_item_name(sid), cnt])

	victory_rewards = {
		"shards": shards,
		"drops": dropped_items,
		"recovered": recovered,
		"last_words": boss_last_words,
	}
	logs.append("[color=#a6e3a1][b]战斗胜利！击败了【%s】！获得废弃权重碎片 +%d！[/b][/color]" % [str(enemy["name"]), shards])
	if not dropped_items.is_empty():
		var loot_prefix: String = "顶级溢出神装掉落：" if (is_heroine_boss and is_overflow_boss) else "战利品掉落："
		logs.append("[color=#ffe066]%s%s[/color]" % [loot_prefix, "、".join(dropped_items)])
	if not recovered.is_empty():
		logs.append("[color=#7ce8ff]夺回被偷物品：%s[/color]" % "、".join(recovered))
	return true


func _check_defeat(logs: Array) -> bool:
	if GameState.hp > 0:
		return false
	phase = "defeat"
	logs.append("[color=#ff4d4d][b]你的 HP 归零，意识在黑暗中断裂……[/b][/color]")
	return true


# ---------------------------------------------------------------- 公式与效果工具

func _calc_damage(
	atk: int,
	skill_mult: float,
	target_def: int,
	element_mult: float,
	is_crit: bool,
	target_defending: bool
) -> int:
	var min_dmg: int = DataRegistry.get_config_int("combat.min_damage", 1)
	var crit_mult: float = DataRegistry.get_config_float("combat.crit_damage_mult", 1.5)
	var def_mult: float = DataRegistry.get_config_float("combat.defend_damage_mult", 0.5)
	var raw: float = (float(atk) * skill_mult - float(target_def)) * element_mult
	if is_crit:
		raw *= crit_mult
	if target_defending:
		raw *= def_mult
	return maxi(min_dmg, int(round(raw)))


func _check_glass_case_break(damage_taken: int, logs: Array) -> void:
	if GameState.is_case_broken:
		return
	var case_id: String = str(GameState.equipment.get("case", ""))
	if case_id.is_empty():
		return
	var item: Dictionary = DataRegistry.get_item(case_id)
	var effs_variant: Variant = item.get("effects", [])
	if not (effs_variant is Array):
		return
	var effs: Array = effs_variant
	for eff_variant in effs:
		if not (eff_variant is Dictionary):
			continue
		var eff: Dictionary = eff_variant
		if str(eff.get("type", "")) == "glass_break":
			var threshold: int = int(eff.get("threshold", 45))
			if damage_taken > threshold:
				GameState.break_glass_case()
				last_visual_fx = "glass_break"
				logs.append("[color=#ff4d6d][b]咔嚓！！单次承受 %d 点重击（>%d），【%s】当场碎裂！机箱 DEF 归零（可用【黑胶带】紧急修补）！[/b][/color]" % [
					damage_taken,
					threshold,
					str(item.get("name", case_id)),
				])
			return


func _check_capacitor_self_explode(damage_taken: int, logs: Array) -> void:
	if damage_taken < 30 or not GameState.has_item("bulging_capacitor", 1):
		return
	var cap: Dictionary = DataRegistry.get_item("bulging_capacitor")
	var effs_variant: Variant = cap.get("effects", [])
	if not (effs_variant is Array):
		return
	var effs: Array = effs_variant
	for eff_variant in effs:
		if not (eff_variant is Dictionary):
			continue
		var eff: Dictionary = eff_variant
		if str(eff.get("type", "")) == "self_explode_risk":
			if _rng.randf() <= float(eff.get("chance", 0.2)):
				var self_dmg: int = int(eff.get("damage", 25))
				GameState.remove_item("bulging_capacitor", 1)
				GameState.change_hp(-self_dmg)
				logs.append("[color=#ff595e][b]砰！！背包里的【鼓包电解电容】吃重击提前炸了！反伤自身 HP -%d！[/b][/color]" % self_dmg)
			return


func _apply_context_pollution(raw_amount: int, source_label: String, logs: Array) -> void:
	var mult: float = _get_player_context_decay_mult()
	var final_loss: int = maxi(1, int(round(float(raw_amount) * mult)))
	GameState.change_context(-final_loss)
	var resist_note: String = "（散热抗污染减免）" if mult < 0.99 else ""
	logs.append("[color=#c77dff]%s导致上下文 -%d%%%s（当前 %d%%）。[/color]" % [source_label, final_loss, resist_note, GameState.context])


func _apply_player_status(status_id: String, turns: int, logs: Array) -> void:
	if _is_player_immune_to_status(status_id):
		logs.append("[color=#7ce8ff]你的护甲/散热免疫了【%s】异常！[/color]" % str(STATUS_NAMES.get(status_id, status_id)))
		return
	player_statuses[status_id] = maxi(int(player_statuses.get(status_id, 0)), turns)
	logs.append("[color=#ff9e64]你陷入了【%s】状态（%d 回合）！[/color]" % [str(STATUS_NAMES.get(status_id, status_id)), turns])


func _apply_enemy_status(status_id: String, turns: int, logs: Array) -> void:
	var imms: PackedStringArray = enemy.get("immunities", PackedStringArray())
	if imms.has(status_id):
		logs.append("【%s】免疫【%s】状态！" % [str(enemy["name"]), str(STATUS_NAMES.get(status_id, status_id))])
		return
	var sts: Dictionary = enemy["statuses"]
	sts[status_id] = maxi(int(sts.get(status_id, 0)), turns)


func _interrupt_enemy_charge(message: String, logs: Array) -> void:
	enemy["charging_skill_id"] = ""
	enemy["charge_def_bonus"] = 0
	_enemy_charge_interrupted = true
	logs.append("[color=#ffe066][b]%s[/b][/color]" % message)


func _cure_player_statuses(statuses_variant: Variant) -> PackedStringArray:
	var cured: PackedStringArray = PackedStringArray()
	if not (statuses_variant is Array):
		return cured
	var list: Array = statuses_variant
	if list.has("all_negative"):
		for k in player_statuses.keys():
			cured.append(str(STATUS_NAMES.get(str(k), str(k))))
		player_statuses.clear()
		return cured
	for st_variant in list:
		var sid: String = str(st_variant)
		if player_statuses.has(sid):
			player_statuses.erase(sid)
			cured.append(str(STATUS_NAMES.get(sid, sid)))
	return cured


func _tick_statuses(sts: Dictionary, skip_status: String = "") -> void:
	var to_remove: PackedStringArray = PackedStringArray()
	for k in sts.keys():
		var sid: String = str(k)
		if sid == skip_status:
			continue
		var left: int = int(sts[k]) - 1
		if left <= 0:
			to_remove.append(sid)
		else:
			sts[k] = left
	for sid in to_remove:
		sts.erase(sid)


func _has_equipped_effect(effect_type: String) -> bool:
	return GameState.has_equipped_effect(effect_type)


func _is_player_immune_to_status(status_id: String) -> bool:
	for slot_variant in GameState.EQUIPMENT_SLOTS:
		var slot: String = str(slot_variant)
		if slot == "case" and GameState.is_case_broken:
			continue
		var item_id: String = str(GameState.equipment.get(slot, ""))
		if item_id.is_empty():
			continue
		var item: Dictionary = DataRegistry.get_item(item_id)
		var effs_variant: Variant = item.get("effects", [])
		if not (effs_variant is Array):
			continue
		var effs: Array = effs_variant
		for eff_variant in effs:
			if not (eff_variant is Dictionary):
				continue
			var eff: Dictionary = eff_variant
			if str(eff.get("type", "")) == "status_immunity":
				var sts_variant: Variant = eff.get("statuses", [])
				if sts_variant is Array:
					var sts_arr: Array = sts_variant
					if sts_arr.has(status_id):
						return true
	return false


func _get_player_damage_taken_mult(damage_type: String) -> float:
	var mult: float = 1.0
	for slot_variant in GameState.EQUIPMENT_SLOTS:
		var slot: String = str(slot_variant)
		if slot == "case" and GameState.is_case_broken:
			continue
		var item_id: String = str(GameState.equipment.get(slot, ""))
		if item_id.is_empty():
			continue
		var item: Dictionary = DataRegistry.get_item(item_id)
		var effs_variant: Variant = item.get("effects", [])
		if not (effs_variant is Array):
			continue
		var effs: Array = effs_variant
		for eff_variant in effs:
			if not (eff_variant is Dictionary):
				continue
			var eff: Dictionary = eff_variant
			if str(eff.get("type", "")) == "damage_taken_mult" and str(eff.get("damage_type", "")) == damage_type:
				mult *= float(eff.get("mult", 1.0))
	return mult


func _get_player_context_decay_mult() -> float:
	var mult: float = 1.0
	for slot_variant in GameState.EQUIPMENT_SLOTS:
		var slot: String = str(slot_variant)
		if slot == "case" and GameState.is_case_broken:
			continue
		var item_id: String = str(GameState.equipment.get(slot, ""))
		if item_id.is_empty():
			continue
		var item: Dictionary = DataRegistry.get_item(item_id)
		var effs_variant: Variant = item.get("effects", [])
		if not (effs_variant is Array):
			continue
		var effs: Array = effs_variant
		for eff_variant in effs:
			if not (eff_variant is Dictionary):
				continue
			var eff: Dictionary = eff_variant
			if str(eff.get("type", "")) == "context_decay_mult":
				mult *= float(eff.get("mult", 1.0))
	return mult


func _enemy_has_status(status_id: String) -> bool:
	var sts: Dictionary = enemy.get("statuses", {})
	return sts.has(status_id) and int(sts[status_id]) > 0


func _enemy_has_tag(tag: String) -> bool:
	var tags: PackedStringArray = enemy.get("tags", PackedStringArray())
	return tags.has(tag)


func _enemy_is_weak_to(id_or_status: String) -> bool:
	var weaks: PackedStringArray = enemy.get("weaknesses", PackedStringArray())
	return weaks.has(id_or_status)


func _action_label(action: String) -> String:
	match action:
		"attack":
			return "普攻"
		"skill":
			return "Token 技能"
		"defend":
			return "防御姿态"
		"item":
			return "使用道具"
		"assist":
			return "API 并发助战"
		_:
			return "尚无记录"


func _command_label(cmd: String) -> String:
	match cmd:
		"skill":
			return "Token 技能"
		"item":
			return "硬件物品"
		"defend":
			return "防御"
		_:
			return cmd


func _dup_string_array(value: Variant) -> PackedStringArray:
	var out: PackedStringArray = PackedStringArray()
	if value is Array:
		var arr: Array = value
		for item in arr:
			out.append(str(item))
	return out


func _dup_array(value: Variant) -> Array:
	if value is Array:
		return (value as Array).duplicate(true)
	return []
