class_name PlaceholderFactory
extends RefCounted
## Programmatic Placeholder 工具类（M1 骨架预置，供 M2+ 场景使用）
## 现阶段所有角色、大 PSU 电源、怪物和墙体均用纯色色块 / 线框占位，
## 优先保证玩法逻辑 100% 可运行。


## 生成纯色带 1px 描边的 ImageTexture，供 Sprite2D / TextureRect 直接使用。
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

	var label: Label = Label.new()
	label.text = label_text
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.position = Vector2(-size.x, -size.y * 0.5 - 22.0)
	label.custom_minimum_size = Vector2(size.x * 2.0, 20.0)
	root.add_child(label)

	return root
