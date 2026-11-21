shader_type canvas_item;

// 上下文溢出（里世界）屏幕暗角、暗红压迫脉动与轻微横线抖动着色器（GL Compatibility 安全实现）
uniform float intensity : hint_range(0.0, 1.0) = 0.0;
uniform vec4 tint_color : source_color = vec4(0.36, 0.02, 0.05, 1.0);
uniform float pulse_speed = 2.4;

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

void fragment() {
	if (intensity <= 0.001) {
		COLOR = vec4(0.0);
	} else {
		vec2 centered = UV - vec2(0.5);
		float dist = length(centered * vec2(1.18, 1.0));
		float pulse = 0.88 + 0.12 * sin(TIME * pulse_speed);
		float edge_start = mix(0.54, 0.24, intensity);
		float vignette = smoothstep(edge_start, 0.84, dist);

		// 轻微随机横条纹抖动，营造墨水/信号失真感
		float line_band = floor(UV.y * 180.0);
		float time_tick = floor(TIME * 18.0);
		float line_noise = hash12(vec2(line_band, time_tick));
		float glitch_bar = step(0.965 - 0.03 * intensity, line_noise) * 0.22 * intensity;

		// 暗红暗角与极暗边缘混合
		vec3 dark_edge = mix(tint_color.rgb, vec3(0.02, 0.0, 0.01), smoothstep(0.48, 0.86, dist));
		float alpha = clamp((vignette * 0.84 * pulse * intensity) + glitch_bar, 0.0, 0.90);
		COLOR = vec4(dark_edge, alpha);
	}
}
