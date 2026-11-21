class_name DialogueParser
extends RefCounted
## 轻量 .dialogue 纯文本解析器（兼容 Godot Dialogue Manager 语法子集）
## 支持语法：
##   # 注释
##   ~ section_id
##   if <expr>: / elif <expr>: / else:（按缩进嵌套）
##   do <expr>
##   => target_section / => END / => OPEN_GIFT
##   - 选项文本 => target_section
##   - 选项文本 [if <expr>] => target_section
##   角色名: 台词内容


static func parse_file(res_path: String) -> Dictionary:
	if not FileAccess.file_exists(res_path):
		return {
			"ok": false,
			"path": res_path,
			"sections": {},
			"order": PackedStringArray(),
			"errors": PackedStringArray(["对话文件不存在: %s" % res_path]),
		}
	var text: String = FileAccess.get_file_as_string(res_path)
	return parse_text(text, res_path)


static func parse_text(text: String, source_name: String = "<memory>") -> Dictionary:
	var sections: Dictionary = {}
	var order: PackedStringArray = PackedStringArray()
	var errors: PackedStringArray = PackedStringArray()

	var raw_lines: PackedStringArray = text.replace("\r\n", "\n").split("\n")
	var raw_sections: Dictionary = {}
	var current_section: String = ""

	for i in range(raw_lines.size()):
		var raw: String = raw_lines[i]
		var stripped: String = raw.strip_edges()
		if stripped.is_empty() or stripped.begins_with("#"):
			continue
		if stripped.begins_with("~"):
			var sec_name: String = stripped.substr(1).strip_edges()
			if sec_name.is_empty():
				errors.append("%s:%d: 空的段落标题 '~'" % [source_name, i + 1])
				continue
			if raw_sections.has(sec_name):
				errors.append("%s:%d: 重复段落标题 '%s'" % [source_name, i + 1, sec_name])
			else:
				raw_sections[sec_name] = []
				order.append(sec_name)
			current_section = sec_name
			continue

		if current_section.is_empty():
			errors.append("%s:%d: 段落标题 '~' 之前出现内容: %s" % [source_name, i + 1, stripped])
			continue

		var sec_lines: Array = raw_sections[current_section]
		sec_lines.append({
			"indent": _measure_indent(raw),
			"text": stripped,
			"line_no": i + 1,
		})

	for sec_name in order:
		var sec_lines_variant: Variant = raw_sections[sec_name]
		var sec_lines: Array = sec_lines_variant if sec_lines_variant is Array else []
		var cursor: Dictionary = { "idx": 0 }
		var body: Array = _parse_block(sec_lines, cursor, 0, source_name, errors)
		sections[sec_name] = body

	return {
		"ok": errors.is_empty(),
		"path": source_name,
		"sections": sections,
		"order": order,
		"errors": errors,
	}


static func _measure_indent(raw_line: String) -> int:
	var indent: int = 0
	for i in range(raw_line.length()):
		var ch: String = raw_line.substr(i, 1)
		if ch == "\t":
			indent += 4
		elif ch == " ":
			indent += 1
		else:
			break
	return indent


static func _parse_block(
	lines: Array,
	cursor: Dictionary,
	min_indent: int,
	source_name: String,
	errors: PackedStringArray
) -> Array:
	var result: Array = []

	while int(cursor["idx"]) < lines.size():
		var idx: int = int(cursor["idx"])
		var entry: Dictionary = lines[idx]
		var indent: int = int(entry["indent"])
		if indent < min_indent:
			break

		var text: String = str(entry["text"])
		var line_no: int = int(entry["line_no"])

		# if / elif / else 链
		if text.begins_with("if ") and text.ends_with(":"):
			var branches: Array = []
			var if_cond: String = text.substr(3, text.length() - 4).strip_edges()
			cursor["idx"] = idx + 1
			var if_body: Array = _parse_indented_children(lines, cursor, indent, source_name, errors)
			branches.append({ "condition": if_cond, "body": if_body })

			while int(cursor["idx"]) < lines.size():
				var next_idx: int = int(cursor["idx"])
				var next_entry: Dictionary = lines[next_idx]
				var next_indent: int = int(next_entry["indent"])
				var next_text: String = str(next_entry["text"])
				if next_indent != indent:
					break
				if next_text.begins_with("elif ") and next_text.ends_with(":"):
					var elif_cond: String = next_text.substr(5, next_text.length() - 6).strip_edges()
					cursor["idx"] = next_idx + 1
					var elif_body: Array = _parse_indented_children(lines, cursor, indent, source_name, errors)
					branches.append({ "condition": elif_cond, "body": elif_body })
				elif next_text == "else:":
					cursor["idx"] = next_idx + 1
					var else_body: Array = _parse_indented_children(lines, cursor, indent, source_name, errors)
					branches.append({ "condition": "", "body": else_body })
					break
				else:
					break

			result.append({
				"type": "if_chain",
				"branches": branches,
				"line_no": line_no,
			})
			continue

		if text.begins_with("elif ") or text == "else:":
			errors.append("%s:%d: 孤立的 %s 缺少前置 if" % [source_name, line_no, text])
			cursor["idx"] = idx + 1
			continue

		# 连续分支选项组（以 "- " 开头）
		if text.begins_with("- "):
			var options: Array = []
			while int(cursor["idx"]) < lines.size():
				var opt_idx: int = int(cursor["idx"])
				var opt_entry: Dictionary = lines[opt_idx]
				var opt_indent: int = int(opt_entry["indent"])
				var opt_text: String = str(opt_entry["text"])
				if opt_indent != indent or not opt_text.begins_with("- "):
					break
				var parsed_opt: Dictionary = _parse_choice_header(opt_text.substr(2).strip_edges())
				cursor["idx"] = opt_idx + 1
				var opt_body: Array = _parse_indented_children(lines, cursor, indent, source_name, errors)
				parsed_opt["body"] = opt_body
				parsed_opt["line_no"] = int(opt_entry["line_no"])
				options.append(parsed_opt)

			result.append({
				"type": "choices",
				"options": options,
				"line_no": line_no,
			})
			continue

		# 跳转指令 => target
		if text.begins_with("=>"):
			var target: String = text.substr(2).strip_edges()
			result.append({
				"type": "jump",
				"target": target,
				"line_no": line_no,
			})
			cursor["idx"] = idx + 1
			continue

		# 状态变更指令 do <expr>
		if text.begins_with("do "):
			var expr_text: String = text.substr(3).strip_edges()
			result.append({
				"type": "do",
				"expr": expr_text,
				"line_no": line_no,
			})
			cursor["idx"] = idx + 1
			continue

		# 普通角色对白 / 旁白
		var speaker: String = ""
		var speech: String = text
		var colon_idx: int = _find_speaker_colon(text)
		if colon_idx > 0:
			speaker = text.substr(0, colon_idx).strip_edges()
			speech = text.substr(colon_idx + 1).strip_edges()

		result.append({
			"type": "line",
			"speaker": speaker,
			"text": speech,
			"line_no": line_no,
		})
		cursor["idx"] = idx + 1

	return result


static func _parse_indented_children(
	lines: Array,
	cursor: Dictionary,
	parent_indent: int,
	source_name: String,
	errors: PackedStringArray
) -> Array:
	var idx: int = int(cursor["idx"])
	if idx >= lines.size():
		return []
	var next_entry: Dictionary = lines[idx]
	var child_indent: int = int(next_entry["indent"])
	if child_indent <= parent_indent:
		return []
	return _parse_block(lines, cursor, child_indent, source_name, errors)


static func _parse_choice_header(raw_choice: String) -> Dictionary:
	var working: String = raw_choice
	var target: String = ""
	var arrow_idx: int = working.rfind("=>")
	if arrow_idx != -1:
		target = working.substr(arrow_idx + 2).strip_edges()
		working = working.substr(0, arrow_idx).strip_edges()

	var condition: String = ""
	var cond_start: int = working.rfind("[if ")
	if cond_start != -1 and working.ends_with("]"):
		condition = working.substr(cond_start + 4, working.length() - cond_start - 5).strip_edges()
		working = working.substr(0, cond_start).strip_edges()

	return {
		"text": working,
		"condition": condition,
		"target": target,
	}


## 查找“角色名: 台词”的英文冒号（排除引号、URL 或过长句内冒号）。
static func _find_speaker_colon(line_text: String) -> int:
	var colon_idx: int = line_text.find(":")
	if colon_idx <= 0 or colon_idx > 24:
		return -1
	var prefix: String = line_text.substr(0, colon_idx)
	if prefix.contains("“") or prefix.contains("\"") or prefix.contains("http"):
		return -1
	return colon_idx
