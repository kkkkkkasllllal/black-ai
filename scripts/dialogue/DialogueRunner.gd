class_name DialogueRunner
extends RefCounted
## 轻量 .dialogue 剧本运行器
## 使用帧栈执行 DialogueParser 生成的 AST，通过 Godot 4 内置 Expression 安全求值 if 与 do 指令。

signal line_ready(speaker: String, text: String)
signal choices_ready(options: Array)
signal action_requested(action_name: String)
signal dialogue_finished

var _doc: Dictionary = {}
var _character_id: String = ""
var _frames: Array = []
var _waiting_for_choice: bool = false
var _pending_options: Array = []
var _running: bool = false


func start(parsed_doc: Dictionary, start_section: String, character_id: String = "") -> bool:
	_doc = parsed_doc
	_character_id = character_id
	_frames.clear()
	_waiting_for_choice = false
	_pending_options.clear()
	_running = false

	var sections_variant: Variant = _doc.get("sections", {})
	if not (sections_variant is Dictionary):
		dialogue_finished.emit()
		return false
	var sections: Dictionary = sections_variant
	var target: String = start_section
	if not sections.has(target):
		var order_variant: Variant = _doc.get("order", PackedStringArray())
		if order_variant is PackedStringArray and not (order_variant as PackedStringArray).is_empty():
			target = (order_variant as PackedStringArray)[0]
		else:
			dialogue_finished.emit()
			return false

	var stmts_variant: Variant = sections[target]
	if not (stmts_variant is Array):
		dialogue_finished.emit()
		return false

	_frames.append({ "statements": stmts_variant as Array, "index": 0 })
	_running = true
	advance()
	return true


func is_running() -> bool:
	return _running


func is_waiting_for_choice() -> bool:
	return _waiting_for_choice


func jump_to_section(section_name: String) -> bool:
	var sections_variant: Variant = _doc.get("sections", {})
	if not (sections_variant is Dictionary):
		return false
	var sections: Dictionary = sections_variant
	if not sections.has(section_name):
		return false
	_frames.clear()
	_waiting_for_choice = false
	_pending_options.clear()
	_frames.append({ "statements": sections[section_name] as Array, "index": 0 })
	_running = true
	advance()
	return true


func advance() -> void:
	if not _running or _waiting_for_choice:
		return

	var safety_steps: int = 0
	while not _frames.is_empty():
		safety_steps += 1
		if safety_steps > 256:
			push_error("[DialogueRunner] 检测到疑似死循环，已强制中止对话。")
			_finish()
			return

		var top: Dictionary = _frames[_frames.size() - 1]
		var stmts: Array = top["statements"]
		var idx: int = int(top["index"])
		if idx >= stmts.size():
			_frames.pop_back()
			continue

		top["index"] = idx + 1
		var stmt: Dictionary = stmts[idx]
		var stype: String = str(stmt.get("type", ""))

		match stype:
			"line":
				var speaker: String = str(stmt.get("speaker", ""))
				var text: String = _interpolate_text(str(stmt.get("text", "")))
				line_ready.emit(speaker, text)
				return
			"do":
				_eval_expression(str(stmt.get("expr", "")))
			"if_chain":
				var branches_variant: Variant = stmt.get("branches", [])
				if branches_variant is Array:
					var branches: Array = branches_variant
					for br_variant in branches:
						if not (br_variant is Dictionary):
							continue
						var br: Dictionary = br_variant
						var cond: String = str(br.get("condition", ""))
						if cond.is_empty() or _eval_condition(cond):
							var body_variant: Variant = br.get("body", [])
							if body_variant is Array:
								var body_arr: Array = body_variant
								if not body_arr.is_empty():
									_frames.append({ "statements": body_arr, "index": 0 })
							break
			"choices":
				var raw_opts_variant: Variant = stmt.get("options", [])
				var visible_opts: Array = []
				if raw_opts_variant is Array:
					var raw_opts: Array = raw_opts_variant
					for opt_variant in raw_opts:
						if not (opt_variant is Dictionary):
							continue
						var opt: Dictionary = opt_variant
						var opt_cond: String = str(opt.get("condition", ""))
						if opt_cond.is_empty() or _eval_condition(opt_cond):
							visible_opts.append(opt)
				if visible_opts.is_empty():
					continue
				_pending_options = visible_opts
				_waiting_for_choice = true
				choices_ready.emit(visible_opts)
				return
			"jump":
				var target: String = str(stmt.get("target", "END"))
				if _handle_jump(target):
					return

	_finish()


func choose(option_index: int) -> void:
	if not _running or not _waiting_for_choice:
		return
	if option_index < 0 or option_index >= _pending_options.size():
		return

	var chosen: Dictionary = _pending_options[option_index]
	_waiting_for_choice = false
	_pending_options.clear()

	var body_variant: Variant = chosen.get("body", [])
	if body_variant is Array and not (body_variant as Array).is_empty():
		_frames.append({ "statements": body_variant as Array, "index": 0 })

	var target: String = str(chosen.get("target", ""))
	if not target.is_empty():
		if _handle_jump(target):
			return

	advance()


## 处理跳转目标；返回 true 表示本轮 advance 应暂停或结束。
func _handle_jump(target: String) -> bool:
	if target == "END" or target.is_empty():
		_finish()
		return true
	if target == "OPEN_GIFT":
		action_requested.emit("open_gift")
		return true
	var sections_variant: Variant = _doc.get("sections", {})
	if sections_variant is Dictionary and (sections_variant as Dictionary).has(target):
		_frames.clear()
		_frames.append({ "statements": (sections_variant as Dictionary)[target] as Array, "index": 0 })
		return false
	push_warning("[DialogueRunner] 找不到目标段落: %s" % target)
	_finish()
	return true


func _finish() -> void:
	_frames.clear()
	_waiting_for_choice = false
	_pending_options.clear()
	_running = false
	dialogue_finished.emit()


func _eval_condition(expr_text: String) -> bool:
	var val: Variant = _eval_expression(expr_text)
	return bool(val)


func _eval_expression(expr_text: String) -> Variant:
	if expr_text.is_empty():
		return false
	var expr: Expression = Expression.new()
	var input_names: PackedStringArray = PackedStringArray([
		"GameState",
		"GlobalMemory",
		"DataRegistry",
		"character_id",
		"affection",
	])
	var parse_err: Error = expr.parse(expr_text, input_names)
	if parse_err != OK:
		push_error("[DialogueRunner] 表达式解析失败: '%s' (%s)" % [expr_text, expr.get_error_text()])
		return false
	var inputs: Array = [
		GameState,
		GlobalMemory,
		DataRegistry,
		_character_id,
		GameState.get_affection(_character_id),
	]
	var result: Variant = expr.execute(inputs, null, true)
	if expr.has_execute_failed():
		push_error("[DialogueRunner] 表达式执行失败: '%s' (%s)" % [expr_text, expr.get_error_text()])
		return false
	return result


func _interpolate_text(raw: String) -> String:
	var out: String = raw
	if out.contains("{affection}"):
		out = out.replace("{affection}", str(GameState.get_affection(_character_id)))
	if out.contains("{tier}"):
		var tier: Dictionary = GameState.get_affection_tier(_character_id)
		out = out.replace("{tier}", str(tier.get("name", "初见")))
	if out.contains("{context}"):
		out = out.replace("{context}", str(GameState.context))
	if out.contains("{sl_count}"):
		out = out.replace("{sl_count}", str(GlobalMemory.sl_count))
	return out
