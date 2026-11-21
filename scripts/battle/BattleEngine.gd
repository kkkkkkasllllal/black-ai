class_name BattleEngine
extends RefCounted
## M5 核心回合制战斗引擎（纯逻辑，零 UI 依赖，供 BattleOverlay 与后续 M6 Boss 战复用）
## 严格遵循策划公式与数据驱动规范：
## - 极简伤害公式：max(min_damage, round((ATK * 倍率 - DEF) * 属性克制))
## - Token 消耗与【输出截断】（Token 不足仍可强放，威力乘 token_truncate_power_mult，台词断句）
## - 防御指令（减伤 50% + 免疫暴击 + 少量 Token 回稳）
## - 完整硬件机制：水宕机、水泥电阻限流打断、鼓包电容雷电+自爆风险、6 机箱、5 散热、6 消耗品、6 怪物

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

var turn_number: int = 1
var phase: String = "player_input" # player_input / victory / defeat / escaped
var preemptive_turn: bool = false

var enemy: Dictionary = {}
var player_statuses: Dictionary = {}
var player_defending: bool = false
var player_next_turn_spd_bonus: int = 0
var player_last_action: String = ""

var last_truncation_banner: String = ""
var last_visual_fx: String = ""
var victory_rewards: Dictionary = {}

var _enemy_charge_interrupted: bool = false
var _rng: RandomNumberGenerator = RandomNumberGenerator.new()


func start_monster_battle(monster_id: String, is_preemptive: bool = false) -> Array:
	_rng.randomize()
	var mdata: Dictionary = DataRegistry.get_monster(monster_id)
	var stats_variant: Variant = mdata.get("stats", {})
	var stats: Dictionary = stats_variant if stats_variant is Dictionary else {}

	turn_number = 1
	phase = "player_input"
	preemptive_turn = is_preemptive
	player_statuses.clear()
	player_defending = false
	player_next_turn_spd_bonus = 0
	player_last_action = ""
	last_truncation_banner = ""
	last_visual_fx = ""
	victory_rewards.clear()
	_enemy_charge_interrupted = false

	var max_hp: int = maxi(1, int(stats.get("hp", 60)))
	enemy = {
		"id": monster_id,
		"name": str(mdata.get("name", monster_id)),
		"is_boss": bool(mdata.get("is_boss", false)),
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


func is_battle_over() -> bool:
	return phase != "player_input"


func get_enemy_effective_atk() -> int:
	var atk: float = float(enemy.get("base_atk", 20))
	if _enemy_has_status("throttled"):
		atk *= 0.6
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
	if charging == "overheat_explode":
		return "意图：【警告！过热熔渣爆破就绪】本回合将砸下 65+ 过热重击！（砸水泥电阻可打断限流，或防御保机箱）"
	if charging == "deep_think_charge":
		return "意图：【警告！深度思考蓄力完毕】本回合将发动 70+ 重击！（泼水 / 砸水泥电阻可打断，或防御减伤）"

	var mid: String = str(enemy.get("id", ""))
	match mid:
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


func format_status_badges(status_dict: Dictionary) -> String:
	if status_dict.is_empty():
		return "无异常"
	var parts: PackedStringArray = PackedStringArray()
	for k in status_dict.keys():
		var sid: String = str(k)
		var turns: int = int(status_dict[k])
		parts.append("%s(%d)" % [str(STATUS_NAMES.get(sid, sid)), turns])
	return " · ".join(parts)


## 执行玩家本回合动作，并结算完整回合（先手判定 + 敌方行动 + 回合末装备/状态/Token 结算）。
## action_type: "attack" / "skill" / "defend" / "item" / "escape"
func execute_player_turn(action_type: String, action_arg: String = "") -> Array:
	var logs: Array = []
	if phase != "player_input":
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

	# 逃跑优先判定
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
		# 逃跑失败则轮到敌人行动
		_run_enemy_turn(logs)
		if phase == "player_input":
			_run_turn_end(logs)
		return logs

	# 防御姿态总是立刻生效（确保先手减伤 50% + 防暴击）
	if action_type == "defend":
		player_defending = true
		player_last_action = "defend"
		GameState.change_token(5)
		logs.append("[color=#7ce8ff]你架起【防御姿态】！本回合所受伤害减半且免疫暴击（额外恢复 Token +5）。[/color]")
		_run_enemy_turn(logs)
		if phase == "player_input":
			_run_turn_end(logs)
		return logs

	# 先手顺序判定：主动拔刀第 1 回合、使用道具或速度占优时玩家先手
	var player_first: bool = (
		has_first_strike
		or action_type == "item"
		or player_speed >= get_enemy_effective_spd()
	)

	if player_first:
		_run_player_action(action_type, action_arg, logs)
		if _check_victory(logs):
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
		if _check_victory(logs):
			return logs

	if phase == "player_input":
		_run_turn_end(logs)
	return logs


# ---------------------------------------------------------------- 玩家行动

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


func _perform_player_basic_attack(logs: Array) -> void:
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

	for i in range(hits):
		if int(enemy["hp"]) <= 0:
			break
		var is_crit: bool = force_crit or (_rng.randf() <= crit_rate)
		var dmg: int = _calc_damage(atk, 1.0, get_enemy_effective_def(), 1.0, is_crit, false)
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

	var kind: String = str(skill.get("kind", "attack"))
	if kind == "support":
		var mult: float = trunc_mult if truncated else 1.0
		var ctx_gain: int = maxi(1, int(round(float(skill.get("restore_context", 18)) * mult)))
		var hp_gain: int = maxi(1, int(round(float(skill.get("restore_hp", 10)) * mult)))
		GameState.change_context(ctx_gain)
		GameState.change_hp(hp_gain)
		logs.append("[color=#8ef2a8]恢复上下文 +%d%%，恢复 HP +%d！[/color]" % [ctx_gain, hp_gain])
		return

	var power_mult: float = float(skill.get("power_mult", 1.5))
	if truncated:
		power_mult *= trunc_mult
	var pierce: float = float(skill.get("armor_pierce", 0.0))
	var eff_def: int = int(round(float(get_enemy_effective_def()) * (1.0 - pierce)))
	var is_crit: bool = (not truncated) and (_rng.randf() <= GameState.get_effective_crit_rate())
	var dmg: int = _calc_damage(GameState.get_effective_atk(), power_mult, eff_def, 1.0, is_crit, false)
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


func _perform_player_item(item_id: String, logs: Array) -> void:
	if not GameState.has_item(item_id, 1):
		logs.append("背包中没有【%s】！" % DataRegistry.get_item_name(item_id))
		return

	var item: Dictionary = DataRegistry.get_item(item_id)
	var iname: String = str(item.get("name", item_id))
	var category: String = DataRegistry.get_item_category(item_id)
	GameState.remove_item(item_id, 1)

	# 1. 投掷类硬件武器（水 / 大功率水泥电阻 / 鼓包电解电容）
	if category == "weapons":
		_resolve_throwable_weapon(item_id, item, logs)
		return

	# 2. 580 矿卡捏碎闪光（专克未定义黑影）
	if item_id == "gpu_580":
		var is_weak: bool = _enemy_is_weak_to("gpu_580")
		var dmg: int = 42 if is_weak else 10
		enemy["hp"] = maxi(0, int(enemy["hp"]) - dmg)
		last_visual_fx = "lightning"
		logs.append("[color=#ffe066]你捏碎【580 矿卡】爆出刺眼强光！对【%s】造成 %d 点闪光伤害！[/color]" % [str(enemy["name"]), dmg])
		if is_weak:
			_apply_enemy_status("short_circuit", 1, logs)
		return

	# 3. 便携硬件消耗品（读取 data/items.json 的 use_effects）
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

	# 主板纽扣电池额外克制乱码游魂 / 未定义黑影
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
					var water_dmg: int = int(round(18.0 * weak_mult))
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
				if not str(enemy.get("charging_skill_id", "")).is_empty() and _rng.randf() <= float(eff.get("chance", 1.0)):
					_interrupt_enemy_charge("【%s】精准限流，彻底打断了【%s】的蓄力！" % [iname, str(enemy["name"])], logs)

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


# ---------------------------------------------------------------- 敌方 AI 回合

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

	# 如果上回合已经蓄力，本回合直接释放蓄力大招
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
	# 闪避判定（防御时不闪避直接硬吃半伤，保持稳定；锁死状态闪避减半）
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

	# 侧透玻璃机箱碎裂检测（单次伤害 > threshold，默认 45）
	_check_glass_case_break(dmg, logs)

	# 鼓包电解电容在背包中受重击提前自爆风险
	_check_capacitor_self_explode(dmg, logs)

	return dmg


# ---------------------------------------------------------------- 回合末被动、状态与胜负结算

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
	# 蓄力被打断时，敌人未执行动作，限流从下一回合开始计时。
	_tick_statuses(enemy["statuses"] as Dictionary, "throttled" if _enemy_charge_interrupted else "")

	if _check_defeat(logs):
		return

	# 回合结束才出现的漏液短路从下一回合生效。
	if self_leak_chance > 0.0 and _rng.randf() <= self_leak_chance:
		if _rng.randf() < 0.5:
			logs.append("[color=#4cc9f0]【漏液水冷】接口飙出一股水柱滋向敌方！[/color]")
			_apply_enemy_status("short_circuit", 1, logs)
		else:
			logs.append("[color=#ff8855]【漏液水冷】接口漏水滴在自己主板上！[/color]")
			_apply_player_status("short_circuit", 1, logs)

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
	}
	logs.append("[color=#a6e3a1][b]战斗胜利！击败了【%s】！获得废弃权重碎片 +%d！[/b][/color]" % [str(enemy["name"]), shards])
	if not dropped_items.is_empty():
		logs.append("[color=#ffe066]战利品掉落：%s[/color]" % "、".join(dropped_items))
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


func _tick_statuses(sts: Dictionary, skip_status_id: String = "") -> void:
	var to_remove: PackedStringArray = PackedStringArray()
	for k in sts.keys():
		if k == skip_status_id:
			continue
		var left: int = int(sts[k]) - 1
		if left <= 0:
			to_remove.append(str(k))
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
		_:
			return "尚无记录"


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
