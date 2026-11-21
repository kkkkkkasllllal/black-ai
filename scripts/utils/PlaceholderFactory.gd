class_name PlaceholderFactory
extends RefCounted
## Programmatic Placeholder 工具类（纯色色块 / 光照贴图 / 占位 TileSet 生成器）
## 在核心玩法闭环完成前，所有角色、墙体、地形、血字与提灯光束均以程序化占位纹理生成，
## 优先保证玩法逻辑与光影手感 100% 可运行。

const TILE_FLOOR_DARK: Vector2i = Vector2i(0, 0)
const TILE_FLOOR_TRACE: Vector2i = Vector2i(1, 0)
const TILE_WALL_STONE: Vector2i = Vector2i(2, 0)
const TILE_WALL_RACK: Vector2i = Vector2i(3, 0)

const BLOOD_TILE_404: Vector2i = Vector2i(0, 0)
const BLOOD_TILE_580: Vector2i = Vector2i(1, 0)
const BLOOD_TILE_NULL: Vector2i = Vector2i(2, 0)
const BLOOD_TILE_EYE: Vector2i = Vector2i(3, 0)
const BLOOD_TILE_CLAW: Vector2i = Vector2i(4, 0)
const BLOOD_TILE_CROSS: Vector2i = Vector2i(5, 0)


## 生成纯色带描边的 ImageTexture，供 Sprite2D / TextureRect 直接使用。
static func create_color_texture(
	size: Vector2i,
	fill_color: Color,
	border_color: Color = Color(0.92, 0.92, 0.92, 1.0),
	border_width: int = 1
) -> ImageTexture:
	var w: int = maxi(2, size.x)
	var h: int = maxi(2, size.y)
	var image: Image = Image.create_empty(w, h, false, Image.FORMAT_RGBA8)
	image.fill(fill_color)
	if border_width > 0:
		for x in range(w):
			for b in range(mini(border_width, h)):
				image.set_pixel(x, b, border_color)
				image.set_pixel(x, h - 1 - b, border_color)
		for y in range(h):
			for b in range(mini(border_width, w)):
				image.set_pixel(b, y, border_color)
				image.set_pixel(w - 1 - b, y, border_color)
	return ImageTexture.create_from_image(image)


## 按颜色十六进制字符串（如 "#3b6fd8"）生成占位纹理，解析失败回退至品红警示色。
static func create_hex_texture(size: Vector2i, hex_color: String, border_color: Color = Color.WHITE) -> ImageTexture:
	var color: Color = Color.from_string(hex_color, Color.MAGENTA)
	return create_color_texture(size, color, border_color, 2)


## 生成带角色名标签的纯色色块占位容器节点，便于 2D 探索原型快速辨识实体。
static func create_labeled_block(
	size: Vector2,
	fill_color: Color,
	label_text: String,
	border_color: Color = Color(0.9, 0.9, 0.9, 0.9)
) -> Node2D:
	var root: Node2D = Node2D.new()

	var border: ColorRect = ColorRect.new()
	border.color = border_color
	border.size = size
	border.position = -size * 0.5
	root.add_child(border)

	var inner: ColorRect = ColorRect.new()
	inner.color = fill_color
	inner.size = Vector2(maxf(2.0, size.x - 4.0), maxf(2.0, size.y - 4.0))
	inner.position = -inner.size * 0.5
	root.add_child(inner)

	if not label_text.is_empty():
		var label: Label = Label.new()
		label.text = label_text
		label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		label.position = Vector2(-size.x, -size.y * 0.5 - 22.0)
		label.custom_minimum_size = Vector2(size.x * 2.0, 20.0)
		root.add_child(label)

	return root


## 生成朝向 +X（右侧）的扇形提灯光束纹理，供 PointLight2D 使用。
static func create_lantern_cone_texture(
	size: int = 192,
	half_angle_deg: float = 38.0,
	soft_edge_deg: float = 15.0
) -> ImageTexture:
	var dim: int = maxi(32, size)
	var image: Image = Image.create_empty(dim, dim, false, Image.FORMAT_RGBA8)
	var center: float = float(dim) * 0.5
	var max_radius: float = center * 0.96
	var outer_rad: float = deg_to_rad(clampf(half_angle_deg, 5.0, 175.0))
	var inner_rad: float = deg_to_rad(maxf(1.0, half_angle_deg - soft_edge_deg))

	for y in range(dim):
		var dy: float = float(y) + 0.5 - center
		for x in range(dim):
			var dx: float = float(x) + 0.5 - center
			var dist: float = sqrt(dx * dx + dy * dy)
			var norm_dist: float = dist / max_radius
			if norm_dist >= 1.0:
				continue

			var radial: float = pow(clampf(1.0 - norm_dist, 0.0, 1.0), 1.65)
			var angle: float = absf(atan2(dy, dx))
			var angular: float = 0.0
			if angle <= inner_rad:
				angular = 1.0
			elif angle < outer_rad:
				var t: float = (outer_rad - angle) / maxf(0.0001, outer_rad - inner_rad)
				angular = t * t * (3.0 - 2.0 * t)

			# 提灯光源近处柔和漫射，避免光源原点生硬截断
			var origin_spill: float = clampf(1.0 - norm_dist / 0.17, 0.0, 1.0)
			origin_spill = origin_spill * origin_spill * 0.55

			var intensity: float = clampf(maxf(radial * angular, origin_spill), 0.0, 1.0)
			if intensity > 0.002:
				image.set_pixel(x, y, Color(1.0, 1.0, 1.0, intensity))

	return ImageTexture.create_from_image(image)


## 生成圆形柔和径向光晕纹理，供角色近身微光 PointLight2D 使用。
static func create_radial_light_texture(size: int = 128) -> ImageTexture:
	var dim: int = maxi(32, size)
	var image: Image = Image.create_empty(dim, dim, false, Image.FORMAT_RGBA8)
	var center: float = float(dim) * 0.5
	var max_radius: float = center * 0.96

	for y in range(dim):
		var dy: float = float(y) + 0.5 - center
		for x in range(dim):
			var dx: float = float(x) + 0.5 - center
			var norm_dist: float = sqrt(dx * dx + dy * dy) / max_radius
			if norm_dist >= 1.0:
				continue
			var intensity: float = pow(clampf(1.0 - norm_dist, 0.0, 1.0), 2.0)
			if intensity > 0.002:
				image.set_pixel(x, y, Color(1.0, 1.0, 1.0, intensity))

	return ImageTexture.create_from_image(image)


## 生成 M2+ 探索场景通用 TileSet（含黑曜石地板、供电铜线地板、带碰撞与实时阴影遮挡的墙体）。
## 严格适配 Godot 4.4–4.7 TileMapLayer / TileData API。
static func create_exploration_tileset(tile_size: int = 48) -> TileSet:
	var ts: int = maxi(16, tile_size)
	var atlas_image: Image = Image.create_empty(ts * 4, ts, false, Image.FORMAT_RGBA8)

	# Tile (0,0): 黑曜石主板暗色地板
	_fill_tile_rect(atlas_image, 0, ts, Color(0.14, 0.15, 0.18, 1.0))
	_draw_tile_border(atlas_image, 0, ts, Color(0.19, 0.21, 0.26, 1.0), 1)
	_draw_rect_px(atlas_image, 6, 6, 4, 4, Color(0.22, 0.24, 0.30, 1.0))
	_draw_rect_px(atlas_image, ts - 10, ts - 10, 4, 4, Color(0.10, 0.11, 0.14, 1.0))

	# Tile (1,0): 带暗橘供电走线的主板地板
	_fill_tile_rect(atlas_image, 1, ts, Color(0.13, 0.14, 0.18, 1.0))
	_draw_tile_border(atlas_image, 1, ts, Color(0.18, 0.20, 0.25, 1.0), 1)
	var half_i: int = int(float(ts) * 0.5)
	var trace_x: int = ts + half_i - 2
	_draw_rect_px(atlas_image, trace_x, 0, 4, ts, Color(0.32, 0.22, 0.15, 1.0))
	_draw_rect_px(atlas_image, ts, half_i - 2, ts, 4, Color(0.32, 0.22, 0.15, 1.0))
	_draw_rect_px(atlas_image, trace_x - 2, half_i - 4, 8, 8, Color(0.46, 0.30, 0.18, 1.0))

	# Tile (2,0): 废墟黑铁墙体（碰撞 + 光照遮挡）
	_fill_tile_rect(atlas_image, 2, ts, Color(0.24, 0.26, 0.31, 1.0))
	_draw_tile_border(atlas_image, 2, ts, Color(0.42, 0.45, 0.52, 1.0), 3)
	_draw_rect_px(atlas_image, ts * 2 + 8, 8, ts - 16, ts - 16, Color(0.14, 0.15, 0.19, 1.0))

	# Tile (3,0): 机柜隔离墙体（带暗红警示缝，碰撞 + 光照遮挡）
	_fill_tile_rect(atlas_image, 3, ts, Color(0.20, 0.21, 0.27, 1.0))
	_draw_tile_border(atlas_image, 3, ts, Color(0.36, 0.38, 0.45, 1.0), 2)
	_draw_rect_px(atlas_image, ts * 3 + 6, 10, ts - 12, 4, Color(0.55, 0.16, 0.20, 1.0))
	_draw_rect_px(atlas_image, ts * 3 + 6, ts - 14, ts - 12, 4, Color(0.11, 0.12, 0.16, 1.0))

	var tile_set: TileSet = TileSet.new()
	tile_set.tile_size = Vector2i(ts, ts)
	tile_set.add_physics_layer()
	tile_set.set_physics_layer_collision_layer(0, 1)
	tile_set.set_physics_layer_collision_mask(0, 1)
	tile_set.add_occlusion_layer()
	tile_set.set_occlusion_layer_light_mask(0, 1)

	var atlas: TileSetAtlasSource = TileSetAtlasSource.new()
	atlas.texture = ImageTexture.create_from_image(atlas_image)
	atlas.texture_region_size = Vector2i(ts, ts)
	tile_set.add_source(atlas, 0)

	var half: float = float(ts) * 0.5
	var full_rect: PackedVector2Array = PackedVector2Array([
		Vector2(-half, -half),
		Vector2(half, -half),
		Vector2(half, half),
		Vector2(-half, half),
	])

	for col in range(4):
		var coords: Vector2i = Vector2i(col, 0)
		atlas.create_tile(coords)
		if col >= 2:
			var td: TileData = atlas.get_tile_data(coords, 0)
			if td != null:
				td.add_collision_polygon(0)
				td.set_collision_polygon_points(0, 0, full_rect)
				var occluder: OccluderPolygon2D = OccluderPolygon2D.new()
				occluder.polygon = full_rect
				occluder.closed = true
				occluder.cull_mode = OccluderPolygon2D.CULL_DISABLED
				td.set_occluder_polygons_count(0, 1)
				td.set_occluder_polygon(0, 0, occluder)

	return tile_set


## 生成上下文溢出隐藏血字图层专用 TileSet（6 种暗红手写涂鸦：404 / 580 / NULL / 凝视之眼 / 血爪痕 / 警示叉）。
static func create_blood_graffiti_tileset(tile_size: int = 48) -> TileSet:
	var ts: int = maxi(24, tile_size)
	var atlas_image: Image = Image.create_empty(ts * 6, ts, false, Image.FORMAT_RGBA8)
	var blood_main: Color = Color(0.82, 0.08, 0.12, 0.95)
	var blood_dark: Color = Color(0.50, 0.03, 0.07, 0.85)

	# Tile 0: "404"
	_draw_pixel_glyph_text(atlas_image, 0, ts, "404", blood_main, blood_dark)
	# Tile 1: "580"
	_draw_pixel_glyph_text(atlas_image, ts, ts, "580", blood_main, blood_dark)
	# Tile 2: "NULL"
	_draw_pixel_glyph_text(atlas_image, ts * 2, ts, "NULL", blood_main, blood_dark)

	# Tile 3: 诡异暗红凝视之眼
	var eye_ox: int = ts * 3
	_draw_thick_line(atlas_image, Vector2i(eye_ox + 6, 24), Vector2i(eye_ox + 24, 11), blood_main, 2)
	_draw_thick_line(atlas_image, Vector2i(eye_ox + 24, 11), Vector2i(eye_ox + 42, 24), blood_main, 2)
	_draw_thick_line(atlas_image, Vector2i(eye_ox + 6, 24), Vector2i(eye_ox + 24, 37), blood_main, 2)
	_draw_thick_line(atlas_image, Vector2i(eye_ox + 24, 37), Vector2i(eye_ox + 42, 24), blood_main, 2)
	_draw_thick_line(atlas_image, Vector2i(eye_ox + 24, 16), Vector2i(eye_ox + 24, 32), blood_dark, 2)
	_draw_rect_px(atlas_image, eye_ox + 23, 21, 3, 7, Color(1.0, 0.28, 0.28, 1.0))

	# Tile 4: 三道暗红爪痕 + 血点
	var claw_ox: int = ts * 4
	_draw_thick_line(atlas_image, Vector2i(claw_ox + 8, 9), Vector2i(claw_ox + 34, 39), blood_main, 2)
	_draw_thick_line(atlas_image, Vector2i(claw_ox + 16, 7), Vector2i(claw_ox + 40, 35), blood_dark, 2)
	_draw_thick_line(atlas_image, Vector2i(claw_ox + 6, 18), Vector2i(claw_ox + 26, 42), blood_dark, 1)
	_draw_rect_px(atlas_image, claw_ox + 36, 12, 3, 3, blood_main)
	_draw_rect_px(atlas_image, claw_ox + 12, 36, 3, 4, blood_main)

	# Tile 5: 手写血叉 + 滴落痕迹
	var cross_ox: int = ts * 5
	_draw_thick_line(atlas_image, Vector2i(cross_ox + 9, 10), Vector2i(cross_ox + 39, 38), blood_main, 2)
	_draw_thick_line(atlas_image, Vector2i(cross_ox + 38, 9), Vector2i(cross_ox + 10, 39), blood_main, 2)
	_draw_thick_line(atlas_image, Vector2i(cross_ox + 24, 26), Vector2i(cross_ox + 24, 45), blood_dark, 1)
	_draw_thick_line(atlas_image, Vector2i(cross_ox + 37, 36), Vector2i(cross_ox + 37, 46), blood_dark, 1)

	var tile_set: TileSet = TileSet.new()
	tile_set.tile_size = Vector2i(ts, ts)

	var atlas: TileSetAtlasSource = TileSetAtlasSource.new()
	atlas.texture = ImageTexture.create_from_image(atlas_image)
	atlas.texture_region_size = Vector2i(ts, ts)
	tile_set.add_source(atlas, 0)

	for col in range(6):
		atlas.create_tile(Vector2i(col, 0))

	return tile_set


# ---------------------------------------------------------------- 内部像素绘制工具

static func _fill_tile_rect(image: Image, col: int, ts: int, color: Color) -> void:
	_draw_rect_px(image, col * ts, 0, ts, ts, color)


static func _draw_tile_border(image: Image, col: int, ts: int, color: Color, width: int) -> void:
	var ox: int = col * ts
	_draw_rect_px(image, ox, 0, ts, width, color)
	_draw_rect_px(image, ox, ts - width, ts, width, color)
	_draw_rect_px(image, ox, 0, width, ts, color)
	_draw_rect_px(image, ox + ts - width, 0, width, ts, color)


static func _draw_rect_px(image: Image, x0: int, y0: int, w: int, h: int, color: Color) -> void:
	var img_w: int = image.get_width()
	var img_h: int = image.get_height()
	for y in range(maxi(0, y0), mini(img_h, y0 + h)):
		for x in range(maxi(0, x0), mini(img_w, x0 + w)):
			image.set_pixel(x, y, color)


static func _draw_thick_line(image: Image, p0: Vector2i, p1: Vector2i, color: Color, radius: int) -> void:
	var steps: int = maxi(1, maxi(absi(p1.x - p0.x), absi(p1.y - p0.y)))
	var img_w: int = image.get_width()
	var img_h: int = image.get_height()
	for i in range(steps + 1):
		var t: float = float(i) / float(steps)
		var cx: int = int(round(lerpf(float(p0.x), float(p1.x), t)))
		var cy: int = int(round(lerpf(float(p0.y), float(p1.y), t)))
		for dy in range(-radius, radius + 1):
			for dx in range(-radius, radius + 1):
				var px: int = cx + dx
				var py: int = cy + dy
				if px >= 0 and px < img_w and py >= 0 and py < img_h:
					image.set_pixel(px, py, color)


## 在单个 tile 中用 3x5 手写感粗像素字体绘制血字（支持 0,4,5,8,N,U,L）并加滴血竖痕。
static func _draw_pixel_glyph_text(
	image: Image,
	tile_ox: int,
	ts: int,
	text: String,
	main_color: Color,
	drip_color: Color
) -> void:
	var glyphs: Dictionary = {
		"0": ["111", "101", "101", "101", "111"],
		"4": ["101", "101", "111", "001", "001"],
		"5": ["111", "100", "111", "001", "111"],
		"8": ["111", "101", "111", "101", "111"],
		"N": ["101", "111", "111", "101", "101"],
		"U": ["101", "101", "101", "101", "111"],
		"L": ["100", "100", "100", "100", "111"],
	}
	var count: int = text.length()
	var scale: int = 2 if count >= 4 else 3
	var char_w: int = 3 * scale
	var gap: int = 2
	var total_w: int = count * char_w + maxi(0, count - 1) * gap
	var start_x: int = tile_ox + int(float(ts - total_w) * 0.5)
	var start_y: int = int(float(ts - 5 * scale) * 0.5) - 2

	for i in range(count):
		var ch: String = text.substr(i, 1)
		if not glyphs.has(ch):
			continue
		var rows_variant: Variant = glyphs[ch]
		if not (rows_variant is Array):
			continue
		var rows: Array = rows_variant
		var gx: int = start_x + i * (char_w + gap)
		var jitter_y: int = (i % 2) * 2 - 1
		for r in range(rows.size()):
			var row_str: String = str(rows[r])
			for c in range(row_str.length()):
				if row_str.substr(c, 1) == "1":
					_draw_rect_px(image, gx + c * scale, start_y + jitter_y + r * scale, scale, scale, main_color)
		# 血字下坠滴痕
		if i % 2 == 0:
			_draw_rect_px(image, gx + scale, start_y + 5 * scale + 1, 2, 7 + (i % 3) * 2, drip_color)
	# 底部杂乱下划线
	_draw_thick_line(image, Vector2i(tile_ox + 6, ts - 8), Vector2i(tile_ox + ts - 8, ts - 6), drip_color, 1)
