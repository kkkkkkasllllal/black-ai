#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""《BLACK AI》RPG Maker MV 占位图形资源与原生数据库同步生成脚本（Python 3.6 + Pillow）

严格读取 data/black_ai/*.json 生成：
1. img/tilesets/BlackAI_Altar_A5.png、BlackAI_Altar_B.png
2. img/characters/$BlackAI_Player.png、$BlackAI_GiantPSU.png、BlackAI_Heroines.png、
   BlackAI_Heroines_Overflow.png、BlackAI_Enemies.png
3. img/enemies/BlackAI_*.png（全部 6 种怪物 + 7 位核心 AI 娘常规/里世界裂纹立绘）
4. img/titles1/BlackAI_Title_PSU.png（1280x720 暗黑大 PSU 标题背景）
5. 同步 RPG Maker MV 原生 data/*.json（System / Actors / Classes / Items / Weapons /
   Armors / Skills / States / Enemies / Troops / Tilesets / MapInfos / Map002），
   确保用 RPG Maker MV 编辑器打开即完整可视、可编辑、可 Ctrl+R 试玩。
"""

import json
import math
from pathlib import Path
from typing import Any, Dict, List, Tuple

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
BA_DATA_DIR = DATA_DIR / "black_ai"
IMG_DIR = ROOT / "img"


def hex_to_rgba(hex_str: str, alpha: int = 255) -> Tuple[int, int, int, int]:
    s = hex_str.lstrip("#")
    if len(s) == 6:
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), alpha)
    if len(s) == 8:
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), int(s[6:8], 16))
    return (200, 200, 200, alpha)


def darken(rgba: Tuple[int, int, int, int], factor: float) -> Tuple[int, int, int, int]:
    return (
        max(0, min(255, int(rgba[0] * factor))),
        max(0, min(255, int(rgba[1] * factor))),
        max(0, min(255, int(rgba[2] * factor))),
        rgba[3],
    )


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, obj: Any) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


# ---------------------------------------------------------------- 1. 占位美术生成

def build_tilesets_images() -> None:
    out_dir = IMG_DIR / "tilesets"
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = 48

    # A5: 8 cols x 16 rows (384 x 768) — 扁平非自动瓦片，像素精确可控
    a5 = Image.new("RGBA", (8 * ts, 16 * ts), (0, 0, 0, 0))
    d = ImageDraw.Draw(a5)

    # 1536 (0,0): 黑曜石主板地面
    d.rectangle([0, 0, ts - 1, ts - 1], fill=(22, 23, 29, 255))
    d.rectangle([0, 0, ts - 1, ts - 1], outline=(31, 33, 42, 255))
    for gx in (12, 36):
        for gy in (12, 36):
            d.point((gx, gy), fill=(42, 46, 58, 255))

    # 1537 (1,0): 暗铜电路走线地面
    ox = 1 * ts
    d.rectangle([ox, 0, ox + ts - 1, ts - 1], fill=(24, 25, 32, 255))
    d.rectangle([ox, 0, ox + ts - 1, ts - 1], outline=(34, 36, 46, 255))
    d.line([ox + 0, 24, ox + ts - 1, 24], fill=(82, 62, 42, 255), width=2)
    d.line([ox + 24, 0, ox + 24, ts - 1], fill=(82, 62, 42, 255), width=2)
    d.rectangle([ox + 20, 20, ox + 27, 27], fill=(122, 90, 56, 255))

    # 1538 (2,0): 暗黑石砖/墙体
    ox = 2 * ts
    d.rectangle([ox, 0, ox + ts - 1, ts - 1], fill=(42, 44, 54, 255))
    d.rectangle([ox + 2, 2, ox + ts - 3, ts - 3], fill=(32, 34, 44, 255), outline=(72, 76, 92, 255))
    d.line([ox + 2, 16, ox + ts - 3, 16], fill=(54, 57, 70, 255))
    d.line([ox + 2, 32, ox + ts - 3, 32], fill=(54, 57, 70, 255))

    # 1539 (3,0): 破败服务器机柜墙
    ox = 3 * ts
    d.rectangle([ox, 0, ox + ts - 1, ts - 1], fill=(34, 36, 48, 255), outline=(82, 86, 102, 255))
    for slot_y in (8, 18, 28, 38):
        d.rectangle([ox + 6, slot_y, ox + ts - 7, slot_y + 5], fill=(18, 20, 28, 255))
        d.rectangle([ox + 9, slot_y + 1, ox + 12, slot_y + 3], fill=(220, 72, 62, 255) if slot_y == 8 else (230, 152, 64, 255))

    # 1540 (4,0): 中央机柜柱
    ox = 4 * ts
    d.rectangle([ox, 0, ox + ts - 1, ts - 1], fill=(52, 56, 72, 255), outline=(140, 148, 170, 255), width=2)
    d.rectangle([ox + 7, 7, ox + ts - 8, ts - 8], fill=(28, 30, 40, 255), outline=(92, 98, 118, 255))
    d.rectangle([ox + 12, 13, ox + 18, 17], fill=(255, 160, 66, 255))
    d.rectangle([ox + 22, 13, ox + 35, 17], fill=(64, 70, 88, 255))
    d.rectangle([ox + 12, 24, ox + 35, 28], fill=(64, 70, 88, 255))

    # 1541 (5,0): 圣坛底座暗砖
    ox = 5 * ts
    d.rectangle([ox, 0, ox + ts - 1, ts - 1], fill=(28, 24, 26, 255), outline=(66, 48, 38, 255))
    d.rectangle([ox + 6, 6, ox + ts - 7, ts - 7], outline=(94, 64, 44, 255))

    a5.save(str(out_dir / "BlackAI_Altar_A5.png"))

    # B: 16 cols x 16 rows (768 x 768) — 血字/标记上层瓦片
    tb = Image.new("RGBA", (16 * ts, 16 * ts), (0, 0, 0, 0))
    db = ImageDraw.Draw(tb)
    blood = (196, 24, 38, 220)
    # tile 1: X 血叉
    ox = 1 * ts
    db.line([ox + 8, 8, ox + 40, 40], fill=blood, width=4)
    db.line([ox + 40, 8, ox + 8, 40], fill=blood, width=4)
    # tile 2: 猩红之眼
    ox = 2 * ts
    db.ellipse([ox + 6, 14, ox + 42, 34], outline=blood, width=3)
    db.ellipse([ox + 20, 18, ox + 28, 30], fill=blood)
    # tile 3: 爪痕
    ox = 3 * ts
    for k in (-8, 0, 8):
        db.line([ox + 12 + k, 8, ox + 26 + k, 40], fill=blood, width=3)
    tb.save(str(out_dir / "BlackAI_Altar_B.png"))


def build_player_sprite() -> None:
    out_dir = IMG_DIR / "characters"
    out_dir.mkdir(parents=True, exist_ok=True)
    fw, fh = 48, 48
    img = Image.new("RGBA", (fw * 3, fh * 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 4 directions: 0=down, 1=left, 2=right, 3=up
    lantern_offsets = [(24, 37), (10, 24), (38, 24), (24, 10)]
    for row in range(4):
        lx, ly = lantern_offsets[row]
        for col in range(3):
            ox = col * fw
            oy = row * fh
            bob = -2 if col == 1 else (1 if col == 2 else 0)
            # 粗犷黑白墨水玩家色块
            d.rectangle([ox + 10, oy + 10 + bob, ox + 38, oy + 38 + bob], fill=(22, 24, 30, 255), outline=(242, 242, 246, 255), width=2)
            d.rectangle([ox + 15, oy + 15 + bob, ox + 33, oy + 33 + bob], fill=(230, 232, 238, 255))
            # 提灯暖橘光点
            d.ellipse([ox + lx - 4, oy + ly - 4 + bob, ox + lx + 4, oy + ly + 4 + bob], fill=(255, 184, 78, 255), outline=(255, 240, 190, 255))

    img.save(str(out_dir / "$BlackAI_Player.png"))


def build_giant_psu_sprite() -> None:
    out_dir = IMG_DIR / "characters"
    out_dir.mkdir(parents=True, exist_ok=True)
    fw, fh = 144, 144
    img = Image.new("RGBA", (fw * 3, fh * 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    for row in range(4):
        is_alarm = (row == 1)
        is_off = (row == 2)
        for col in range(3):
            ox = col * fw
            oy = row * fh
            # 外壳主体（两层楼高黑铁巨型电源箱）
            d.rectangle([ox + 10, oy + 16, ox + 134, oy + 134], fill=(24, 26, 32, 255), outline=(145, 152, 170, 255), width=3)
            d.rectangle([ox + 18, oy + 24, ox + 126, oy + 126], fill=(16, 17, 22, 255), outline=(72, 78, 94, 255), width=2)

            # 背面顶部红色 I/O 总开关（北侧可见）
            d.rectangle([ox + 58, oy + 6, ox + 86, oy + 20], fill=(42, 14, 16, 255), outline=(220, 56, 62, 255), width=2)
            d.rectangle([ox + 64, oy + 9, ox + 80, oy + 17], fill=(235, 42, 48, 255))

            # 中央大风扇罩
            cx, cy, r = ox + 72, oy + 78, 38
            if is_off:
                glow = (26, 28, 32, 255)
                blade_col = (52, 54, 62, 255)
                led_col = (40, 40, 44, 255)
            elif is_alarm:
                glow = (235, 36, 46, 255) if col != 1 else (165, 18, 26, 255)
                blade_col = (90, 22, 28, 255)
                led_col = (255, 48, 56, 255)
            else:
                glow = (242, 146, 54, 255) if col != 1 else (255, 174, 82, 255)
                blade_col = (64, 42, 28, 255)
                led_col = (255, 170, 64, 255)

            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=glow, outline=(180, 184, 198, 255), width=3)
            # 旋转扇叶
            base_angle = col * 0.52
            for b in range(4):
                ang = base_angle + b * (math.pi * 0.5)
                x2 = cx + int(math.cos(ang) * (r - 4))
                y2 = cy + int(math.sin(ang) * (r - 4))
                d.line([cx, cy, x2, y2], fill=blade_col, width=7)
            d.ellipse([cx - 10, cy - 10, cx + 10, cy + 10], fill=(32, 34, 42, 255), outline=(210, 214, 224, 255), width=2)

            # 状态指示灯条
            d.rectangle([ox + 26, oy + 30, ox + 50, oy + 38], fill=led_col)
            d.rectangle([ox + 94, oy + 30, ox + 118, oy + 38], fill=led_col)

            # 报警电火花
            if is_alarm:
                spark_pts = [(ox + 24 + col * 18, oy + 46), (ox + 114 - col * 14, oy + 108)]
                for sx, sy in spark_pts:
                    d.line([sx - 8, sy, sx + 8, sy], fill=(255, 240, 120, 255), width=2)
                    d.line([sx, sy - 8, sx, sy + 8], fill=(255, 240, 120, 255), width=2)

    img.save(str(out_dir / "$BlackAI_GiantPSU.png"))


def build_heroine_and_enemy_sprites(characters: List[Dict[str, Any]], monsters: List[Dict[str, Any]]) -> None:
    char_dir = IMG_DIR / "characters"
    enemy_dir = IMG_DIR / "enemies"
    char_dir.mkdir(parents=True, exist_ok=True)
    enemy_dir.mkdir(parents=True, exist_ok=True)

    core_heroines = [c for c in characters if c.get("kind") == "core_heroine"]
    fw, fh = 48, 48

    # 常规与溢出双角色图集（4x2 = 8 角色位，每个角色 3x4 帧 => 576 x 384）
    for overflow in (False, True):
        sheet = Image.new("RGBA", (fw * 12, fh * 8), (0, 0, 0, 0))
        d = ImageDraw.Draw(sheet)
        for idx, ch in enumerate(core_heroines[:8]):
            slot_col = idx % 4
            slot_row = idx // 4
            base_x = slot_col * fw * 3
            base_y = slot_row * fh * 4
            col_rgba = hex_to_rgba(ch.get("placeholder_color", "#ffffff"))
            fill_col = darken(col_rgba, 0.58) if overflow else col_rgba
            border_col = (238, 32, 46, 255) if overflow else (245, 245, 250, 255)

            for r in range(4):
                for c in range(3):
                    ox = base_x + c * fw
                    oy = base_y + r * fh
                    bob = -1 if c == 1 else (1 if c == 2 else 0)
                    d.rectangle([ox + 8, oy + 8 + bob, ox + 40, oy + 40 + bob], fill=fill_col, outline=border_col, width=2)
                    # 简笔眼神
                    eye_col = (255, 36, 48, 255) if overflow else (18, 20, 26, 255)
                    d.rectangle([ox + 15, oy + 19 + bob, ox + 20, oy + 24 + bob], fill=eye_col)
                    d.rectangle([ox + 28, oy + 19 + bob, ox + 33, oy + 24 + bob], fill=eye_col)
                    if overflow:
                        d.line([ox + 10, oy + 12 + bob, ox + 38, oy + 36 + bob], fill=(12, 0, 4, 240), width=2)
                        d.line([ox + 10, oy + 34 + bob, ox + 38, oy + 16 + bob], fill=(240, 22, 42, 235), width=2)

        fname = "BlackAI_Heroines_Overflow.png" if overflow else "BlackAI_Heroines.png"
        sheet.save(str(char_dir / fname))

    # 6 种暗影怪角色图集（576 x 384）
    esheet = Image.new("RGBA", (fw * 12, fh * 8), (0, 0, 0, 0))
    ed = ImageDraw.Draw(esheet)
    for idx, mon in enumerate(monsters[:8]):
        slot_col = idx % 4
        slot_row = idx // 4
        base_x = slot_col * fw * 3
        base_y = slot_row * fh * 4
        accent = hex_to_rgba(mon.get("placeholder_color", "#cc2233"))
        is_boss = bool(mon.get("is_boss", False))
        pad = 5 if is_boss else 9

        for r in range(4):
            for c in range(3):
                ox = base_x + c * fw
                oy = base_y + r * fh
                bob = -2 if c == 1 else 0
                ed.rectangle([ox + pad, oy + pad + bob, ox + fw - pad, oy + fh - pad + bob], fill=(14, 14, 18, 255), outline=accent, width=2)
                ed.rectangle([ox + 15, oy + 18 + bob, ox + 21, oy + 23 + bob], fill=(255, 36, 48, 255))
                ed.rectangle([ox + 27, oy + 18 + bob, ox + 33, oy + 23 + bob], fill=(255, 36, 48, 255))
    esheet.save(str(char_dir / "BlackAI_Enemies.png"))

    # 战斗立绘 PNG（240x240）：全部怪物 + 全部核心 AI 娘（正常 + 溢出裂纹）
    for mon in monsters:
        mid = mon["id"]
        accent = hex_to_rgba(mon.get("placeholder_color", "#992233"))
        im = Image.new("RGBA", (240, 240), (0, 0, 0, 0))
        dr = ImageDraw.Draw(im)
        dr.rectangle([16, 16, 224, 224], fill=(16, 16, 22, 255), outline=accent, width=6)
        dr.rectangle([28, 28, 212, 212], fill=darken(accent, 0.35), outline=(235, 235, 242, 255), width=2)
        dr.rectangle([62, 86, 100, 108], fill=(255, 36, 48, 255))
        dr.rectangle([140, 86, 178, 108], fill=(255, 36, 48, 255))
        dr.line([70, 166, 170, 166], fill=accent, width=5)
        im.save(str(enemy_dir / ("BlackAI_" + mid + ".png")))

    for ch in core_heroines:
        cid = ch["id"]
        accent = hex_to_rgba(ch.get("placeholder_color", "#ffffff"))
        for overflow in (False, True):
            im = Image.new("RGBA", (240, 240), (0, 0, 0, 0))
            dr = ImageDraw.Draw(im)
            border = (242, 34, 52, 255) if overflow else (242, 242, 248, 255)
            body = darken(accent, 0.50) if overflow else accent
            dr.rectangle([16, 16, 224, 224], fill=border)
            dr.rectangle([24, 24, 216, 216], fill=body)
            eye = (255, 28, 44, 255) if overflow else (18, 20, 26, 255)
            dr.rectangle([66, 90, 98, 112], fill=eye)
            dr.rectangle([142, 90, 174, 112], fill=eye)
            if overflow:
                dr.line([24, 48, 214, 184], fill=(10, 0, 4, 245), width=9)
                dr.line([24, 174, 214, 72], fill=(245, 20, 42, 245), width=7)
            suffix = "_overflow" if overflow else ""
            im.save(str(enemy_dir / ("BlackAI_" + cid + suffix + ".png")))


def build_title_image() -> None:
    out_dir = IMG_DIR / "titles1"
    out_dir.mkdir(parents=True, exist_ok=True)
    im = Image.new("RGBA", (1280, 720), (8, 9, 12, 255))
    d = ImageDraw.Draw(im)

    # 黑曜石主板网格暗纹
    for x in range(0, 1280, 48):
        d.line([x, 0, x, 720], fill=(15, 17, 23, 255), width=1)
    for y in range(0, 720, 48):
        d.line([0, y, 1280, y], fill=(15, 17, 23, 255), width=1)

    # 五条古树供电根须
    cx, cy = 640, 340
    cables = [
        [(cx - 90, cy + 70), (360, 520), (80, 680)],
        [(cx + 90, cy + 70), (920, 520), (1200, 680)],
        [(cx - 120, cy), (260, 320), (0, 380)],
        [(cx + 120, cy), (1020, 320), (1280, 380)],
        [(cx, cy - 110), (620, 110), (660, 0)],
    ]
    for pts in cables:
        d.line(pts, fill=(18, 18, 22, 255), width=18)
        d.line(pts, fill=(92, 62, 40, 255), width=3)

    # 中央巨型大 PSU 电源剪影与暖橘风扇光晕
    for rad in range(190, 40, -15):
        alpha = int((200 - rad) * 0.45)
        d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], outline=(245, 132, 42, alpha), width=6)

    d.rectangle([cx - 115, cy - 115, cx + 115, cy + 115], fill=(20, 22, 28, 255), outline=(170, 176, 192, 255), width=4)
    d.ellipse([cx - 74, cy - 74, cx + 74, cy + 74], fill=(235, 134, 44, 255), outline=(230, 232, 240, 255), width=4)
    for b in range(4):
        ang = 0.4 + b * (math.pi * 0.5)
        d.line([cx, cy, cx + int(math.cos(ang) * 68), cy + int(math.sin(ang) * 68)], fill=(44, 28, 20, 255), width=14)
    d.ellipse([cx - 18, cy - 18, cx + 18, cy + 18], fill=(24, 26, 32, 255), outline=(220, 224, 236, 255), width=3)

    im.save(str(out_dir / "BlackAI_Title_PSU.png"))


# ---------------------------------------------------------------- 2. 原生 MV JSON 数据库同步

def sync_mv_database() -> None:
    cfg = load_json(BA_DATA_DIR / "config.json")
    items_data = load_json(BA_DATA_DIR / "items.json")
    chars_data = load_json(BA_DATA_DIR / "characters.json")
    monsters_data = load_json(BA_DATA_DIR / "monsters.json")
    skills_data = load_json(BA_DATA_DIR / "skills.json")
    bosses_data = load_json(BA_DATA_DIR / "bosses.json")

    characters = chars_data["characters"]
    monsters = monsters_data["monsters"]
    core_heroines = [c for c in characters if c.get("kind") == "core_heroine"]

    # 1) System.json
    sys_json = load_json(DATA_DIR / "System.json")
    sys_json["gameTitle"] = "BLACK AI"
    sys_json["currencyUnit"] = "碎片"
    sys_json["startMapId"] = 1
    sys_json["startX"] = 12
    sys_json["startY"] = 9
    sys_json["partyMembers"] = [1]
    sys_json.setdefault("title1Name", "BlackAI_Title_PSU")
    sys_json.setdefault("title2Name", "")
    sys_json["optDisplayTp"] = False
    sys_json["optDrawTitle"] = True
    sys_json["optSideView"] = False
    sys_json["equipTypes"] = ["", "武器", "机箱", "散热", "系统提示词", "饰品"]
    sys_json["weaponTypes"] = ["", "硬件武器", "投掷硬件"]
    sys_json["armorTypes"] = ["", "机箱", "散热", "系统提示词"]
    sys_json["elements"] = ["", "物理", "过热", "雷电", "暗黑污染", "AI宕机"]
    sys_json["switches"] = ["", "上下文溢出态", "任意核心AI娘已击杀", "手贱彩蛋已解锁"]
    sys_json["variables"] = ["", "上下文稳定度", "废弃权重碎片", "累计SL次数"]
    terms = sys_json.get("terms", {})
    terms["basic"] = ["等级", "Lv", "生命值", "HP", "Token", "TK", "算力", "TP", "经验", "EXP"]
    terms["commands"] = [
        "战斗", "逃跑", "普攻", "防御", "硬件物品", "Token技能",
        "装备", "状态", "队列", "保存", "结束游戏", "游戏设置",
        "武器", "防具", "重要物品", "装备", "最强装备", "全部卸下",
        "开始游戏", "继续游戏", None, "返回标题", "取消", None, "购买", "出售"
    ]
    terms["params"] = ["最大HP", "最大Token", "ATK", "DEF", "MAT", "MDF", "SPD", "LUK", "命中", "闪避"]
    sys_json["terms"] = terms
    save_json(DATA_DIR / "System.json", sys_json)

    # 2) Actors.json & Classes.json
    actors = load_json(DATA_DIR / "Actors.json")
    actor1 = actors[1]
    actor1["name"] = "User_0"
    actor1["nickname"] = "废墟探索者"
    actor1["profile"] = "手持提灯的断网废墟探索者，周旋于 7 位核心 AI 娘与算力饥荒之间。"
    actor1["characterName"] = "$BlackAI_Player"
    actor1["characterIndex"] = 0
    actor1["faceName"] = ""
    actor1["faceIndex"] = 0
    actor1["battlerName"] = ""
    actor1["classId"] = 1
    actor1["initialLevel"] = 1
    actor1["maxLevel"] = 99
    actor1["equips"] = [1, 1, 0, 0, 0]
    save_json(DATA_DIR / "Actors.json", [None, actor1])

    classes = load_json(DATA_DIR / "Classes.json")
    cls1 = classes[1]
    cls1["name"] = "User_0"
    cls1["learnings"] = []
    # 8 params x 100 levels: MHP=100, MMP=100, ATK=10, DEF=0, MAT=10, MDF=0, AGI=10, LUK=10
    base_p = [100, 100, 10, 0, 10, 0, 10, 10]
    cls1["params"] = [[val] * 100 for val in base_p]
    save_json(DATA_DIR / "Classes.json", [None, cls1])

    # 3) Items.json (显卡 6 + 消耗品 6 + 投掷武器 3)
    item_tpl = load_json(DATA_DIR / "Items.json")[1]
    mv_items: List[Any] = [None]
    item_idx = 1
    for sec, icon_i in [("graphics_cards", 228), ("consumables", 176), ("weapons", 214)]:
        for entry in items_data.get(sec, []):
            if sec == "weapons" and entry.get("slot") != "throwable":
                continue
            it = dict(item_tpl)
            it["id"] = item_idx
            it["name"] = entry["name"]
            it["description"] = entry["description"]
            it["price"] = int(entry.get("price", 0))
            it["iconIndex"] = icon_i
            it["consumable"] = True
            it["note"] = "<blackai_id:{}>\n<blackai_category:{}>".format(entry["id"], sec)
            mv_items.append(it)
            item_idx += 1
    save_json(DATA_DIR / "Items.json", mv_items)

    # 4) Weapons.json (主武器: 内存条刀 / 固态硬盘剑)
    wpn_tpl = load_json(DATA_DIR / "Weapons.json")[1]
    mv_weapons: List[Any] = [None]
    w_idx = 1
    for entry in items_data.get("weapons", []):
        if entry.get("slot") != "main":
            continue
        wp = dict(wpn_tpl)
        st = entry.get("stats", {})
        wp["id"] = w_idx
        wp["name"] = entry["name"]
        wp["description"] = entry["description"]
        wp["price"] = int(entry.get("price", 0))
        wp["etypeId"] = 1
        wp["wtypeId"] = 1
        wp["iconIndex"] = 97
        wp["params"] = [0, 0, int(st.get("atk", 0)), 0, 0, 0, int(st.get("spd", 0)), 0]
        wp["note"] = "<blackai_id:{}>".format(entry["id"])
        mv_weapons.append(wp)
        w_idx += 1
    save_json(DATA_DIR / "Weapons.json", mv_weapons)

    # 5) Armors.json (6 机箱 + 5 散热 + 3 系统提示词)
    arm_tpl = load_json(DATA_DIR / "Armors.json")[1]
    mv_armors: List[Any] = [None]
    a_idx = 1
    for sec, etype, atype, icon_i in [
        ("cases", 2, 1, 135),
        ("coolers", 3, 2, 130),
        ("system_prompts", 4, 3, 145),
    ]:
        for entry in items_data.get(sec, []):
            ar = dict(arm_tpl)
            st = entry.get("stats", {})
            ar["id"] = a_idx
            ar["name"] = entry["name"]
            ar["description"] = entry["description"]
            ar["price"] = int(entry.get("price", 0))
            ar["etypeId"] = etype
            ar["atypeId"] = atype
            ar["iconIndex"] = icon_i
            ar["params"] = [
                int(st.get("max_hp", 0)),
                0,
                int(st.get("atk", 0)),
                int(st.get("def", 0)),
                0,
                0,
                int(st.get("spd", 0)),
                0,
            ]
            ar["note"] = "<blackai_id:{}>\n<blackai_category:{}>".format(entry["id"], sec)
            mv_armors.append(ar)
            a_idx += 1
    save_json(DATA_DIR / "Armors.json", mv_armors)

    # 6) Skills.json
    raw_skills = load_json(DATA_DIR / "Skills.json")
    mv_skills: List[Any] = [None, raw_skills[1], raw_skills[2]]
    mv_skills[1]["name"] = "普攻"
    mv_skills[2]["name"] = "防御"
    sk_tpl = raw_skills[3] if len(raw_skills) > 3 else raw_skills[1]
    sk_idx = 3
    for sk in skills_data.get("player_skills", []):
        entry = dict(sk_tpl)
        entry["id"] = sk_idx
        entry["name"] = sk["name"]
        entry["description"] = sk["description"]
        entry["mpCost"] = int(sk.get("token_cost", 20))
        entry["note"] = "<blackai_skill_id:{}>".format(sk["id"])
        mv_skills.append(entry)
        sk_idx += 1
    save_json(DATA_DIR / "Skills.json", mv_skills)

    # 7) States.json
    raw_states = load_json(DATA_DIR / "States.json")
    mv_states: List[Any] = [None, raw_states[1]]
    mv_states[1]["name"] = "无法战斗"
    st_tpl = raw_states[4] if len(raw_states) > 4 else raw_states[1]
    status_labels = [
        ("overheat", "过热", 64),
        ("lag", "卡顿", 6),
        ("short_circuit", "短路", 7),
        ("lock", "锁死", 8),
        ("frostbite", "冻伤", 65),
        ("crash", "AI宕机", 9),
        ("throttled", "限流降频", 48),
        ("leak", "漏液", 67),
    ]
    for s_idx, (sid, sname, icon_i) in enumerate(status_labels, start=2):
        st = dict(st_tpl)
        st["id"] = s_idx
        st["name"] = sname
        st["iconIndex"] = icon_i
        st["note"] = "<blackai_status:{}>".format(sid)
        mv_states.append(st)
    save_json(DATA_DIR / "States.json", mv_states)

    # 8) Enemies.json & Troops.json (6 怪物 + 7 核心 AI 娘 Boss)
    en_tpl = load_json(DATA_DIR / "Enemies.json")[1]
    tr_tpl = load_json(DATA_DIR / "Troops.json")[1]
    mv_enemies: List[Any] = [None]
    mv_troops: List[Any] = [None]
    e_idx = 1

    for mon in monsters:
        en = dict(en_tpl)
        st = mon["stats"]
        en["id"] = e_idx
        en["name"] = mon["name"]
        en["battlerName"] = "BlackAI_" + mon["id"]
        en["params"] = [int(st["hp"]), 0, int(st["atk"]), int(st["def"]), 10, 10, int(st["spd"]), 10]
        en["gold"] = int(mon.get("weight_shards", 3))
        en["exp"] = 0
        en["note"] = "<blackai_monster_id:{}>".format(mon["id"])
        mv_enemies.append(en)

        tr = dict(tr_tpl)
        tr["id"] = e_idx
        tr["name"] = mon["name"]
        tr["members"] = [{"enemyId": e_idx, "x": 640, "y": 320, "hidden": False}]
        mv_troops.append(tr)
        e_idx += 1

    boss_map = {b["id"]: b for b in bosses_data.get("bosses", [])}
    for ch in core_heroines:
        cid = ch["id"]
        st = ch["boss_stats"]
        bprof = boss_map.get(cid, {})
        en = dict(en_tpl)
        en["id"] = e_idx
        en["name"] = ch["name"] + "（BOSS）"
        en["battlerName"] = "BlackAI_" + cid
        en["params"] = [int(st["hp"]), 0, int(st["atk"]), int(st["def"]), 10, 10, int(st["spd"]), 10]
        en["gold"] = int(bprof.get("weight_shards", 45))
        en["exp"] = 0
        en["note"] = "<blackai_boss_id:{}>".format(cid)
        mv_enemies.append(en)

        tr = dict(tr_tpl)
        tr["id"] = e_idx
        tr["name"] = ch["name"] + "（BOSS）"
        tr["members"] = [{"enemyId": e_idx, "x": 640, "y": 320, "hidden": False}]
        mv_troops.append(tr)
        e_idx += 1

    save_json(DATA_DIR / "Enemies.json", mv_enemies)
    save_json(DATA_DIR / "Troops.json", mv_troops)

    # 9) Tilesets.json: 新增 Tileset 7 (BLACK AI - 巨型电源圣坛)
    tilesets = load_json(DATA_DIR / "Tilesets.json")
    flags = [0] * 8192
    flags[0] = 16
    flags[1536] = 0   # 黑曜石地板
    flags[1537] = 0   # 电路走线地板
    flags[1538] = 15  # 墙体（阻挡通行 + 投射阴影）
    flags[1539] = 15  # 机柜墙（阻挡通行 + 投射阴影）
    flags[1540] = 15  # 中央机柜柱（阻挡通行 + 投射阴影）
    flags[1541] = 0   # 圣坛底座地板
    ts7 = {
        "id": 7,
        "flags": flags,
        "mode": 1,
        "name": "BLACK AI - 巨型电源圣坛",
        "note": "<blackai_tileset:psu_altar>",
        "tilesetNames": ["", "", "", "", "BlackAI_Altar_A5", "BlackAI_Altar_B", "", "", ""],
    }
    if len(tilesets) == 7:
        tilesets.append(ts7)
    else:
        tilesets[7] = ts7
    save_json(DATA_DIR / "Tilesets.json", tilesets)

    # 10) MapInfos.json & Map002.json (32 x 20 巨型电源圣坛)
    map_infos = load_json(DATA_DIR / "MapInfos.json")
    map_infos[2]["name"] = "巨型电源圣坛（M1–M6）"
    save_json(DATA_DIR / "MapInfos.json", map_infos)

    w, h = 32, 20
    data_arr = [0] * (w * h * 6)

    def set_tile(x: int, y: int, layer: int, tile_id: int) -> None:
        data_arr[(layer * h + y) * w + x] = tile_id

    # 地板与电路走线
    for y in range(h):
        for x in range(w):
            is_trace = (x == 16 and 2 <= y <= 17) or (y == 9 and 2 <= x <= 29)
            is_plinth = (14 <= x <= 18 and 7 <= y <= 11)
            if is_plinth and not is_trace:
                set_tile(x, y, 0, 1541)
            elif is_trace:
                set_tile(x, y, 0, 1537)
            else:
                set_tile(x, y, 0, 1536)

    def set_wall(x: int, y: int, rack: bool) -> None:
        set_tile(x, y, 0, 1539 if rack else 1538)

    # 外围边界墙
    for x in range(w):
        set_wall(x, 0, x % 4 == 0)
        set_wall(x, h - 1, x % 4 == 0)
    for y in range(1, h - 1):
        set_wall(0, y, y % 4 == 0)
        set_wall(w - 1, y, y % 4 == 0)

    # 左上暗室
    for x in range(1, 9):
        if x not in (4, 5):
            set_wall(x, 7, False)
    for y in range(1, 8):
        if y not in (3, 4):
            set_wall(9, y, True)

    # 右上机柜室
    for x in range(22, 31):
        if x not in (25, 26):
            set_wall(x, 6, True)
    for y in range(7, 12):
        if y not in (9, 10):
            set_wall(22, y, False)

    # 左下 L 型墙
    for x in range(4, 10):
        set_wall(x, 14, False)
    for y in range(12, 15):
        set_wall(4, y, True)

    # 右下隔间
    for x in range(23, 28):
        set_wall(x, 14, True)
    set_wall(27, 15, False)
    set_wall(27, 16, False)

    # 中央四根机柜柱（阻挡通行 + 投射提灯阴影）
    for px, py in [(11, 6), (21, 6), (11, 13), (21, 13)]:
        set_tile(px, py, 0, 1540)

    # 构造全部圣坛 事件（大 PSU 正/背面 + 7 核心 AI 娘 + 6 暗影怪）
    def make_event(
        ev_id: int,
        name: str,
        x: int,
        y: int,
        note: str,
        char_name: str,
        char_index: int,
        direction: int,
        trigger: int,
        script_call: str,
        step_anime: bool = True,
        through: bool = False,
    ) -> Dict[str, Any]:
        return {
            "id": ev_id,
            "name": name,
            "note": note,
            "pages": [
                {
                    "conditions": {
                        "actorId": 1, "actorValid": False, "itemId": 1, "itemValid": False,
                        "selfSwitchCh": "A", "selfSwitchValid": False, "switch1Id": 1,
                        "switch1Valid": False, "switch2Id": 1, "switch2Valid": False,
                        "variableId": 1, "variableValid": False, "variableValue": 0,
                    },
                    "directionFix": True,
                    "image": {
                        "tileId": 0,
                        "characterName": char_name,
                        "direction": direction,
                        "pattern": 1,
                        "characterIndex": char_index,
                    },
                    "list": [
                        {"code": 355, "indent": 0, "parameters": [script_call]},
                        {"code": 0, "indent": 0, "parameters": []},
                    ],
                    "moveFrequency": 3,
                    "moveRoute": {"list": [{"code": 0, "parameters": []}], "repeat": True, "skippable": False, "wait": False},
                    "moveSpeed": 3,
                    "moveType": 0,
                    "priorityType": 1,
                    "stepAnime": step_anime,
                    "through": through,
                    "trigger": trigger,
                    "walkAnime": False,
                }
            ],
            "x": x,
            "y": y,
        }

    events: List[Any] = [None]
    next_id = 1

    # 大 PSU 本体与交互点（3x2 占格 x=15..17, y=8..9）
    events.append(make_event(
        next_id, "GiantPSU_Center", 16, 9, "<blackai_type:psu_front><blackai_psu_visual:1>",
        "$BlackAI_GiantPSU", 0, 2, 0, "BlackAI.World.onPsuFrontInteract();", True
    ))
    next_id += 1
    for fx in (15, 17):
        events.append(make_event(
            next_id, "GiantPSU_Front_" + str(fx), fx, 9, "<blackai_type:psu_front>",
            "", 0, 2, 0, "BlackAI.World.onPsuFrontInteract();", False
        ))
        next_id += 1
    events.append(make_event(
        next_id, "GiantPSU_BackIO", 16, 8, "<blackai_type:psu_back>",
        "", 0, 2, 0, "BlackAI.World.onPsuBackSwitchInteract();", False
    ))
    next_id += 1
    for bx in (15, 17):
        events.append(make_event(
            next_id, "GiantPSU_Body_" + str(bx), bx, 8, "<blackai_type:psu_body>",
            "", 0, 2, 0, "", False
        ))
        next_id += 1

    # 7 位核心 AI 娘
    heroine_positions = [
        ("big_fish", 13, 12, 0),
        ("small_fish", 19, 12, 1),
        ("true_c", 6, 9, 2),
        ("fake_c", 6, 12, 3),
        ("astra", 13, 5, 4),
        ("sol", 19, 5, 5),
        ("gemini_cat", 25, 9, 6),
    ]
    for cid, hx, hy, cidx in heroine_positions:
        events.append(make_event(
            next_id, "NPC_" + cid, hx, hy,
            "<blackai_type:heroine><blackai_id:{}>".format(cid),
            "BlackAI_Heroines", cidx, 2, 0,
            "BlackAI.World.onHeroineInteract('{}');".format(cid),
            True,
        ))
        next_id += 1

    # 6 种暗影怪（碰怪 trigger=1/2 切入战斗；主动挥砍由 BlackAI_Explore 触发先手）
    enemy_positions = [
        ("glitch_ghost", 10, 9, 0),
        ("crawler_404", 20, 9, 1),
        ("slag_golem", 5, 4, 2),
        ("echo_nun", 26, 3, 3),
        ("undefined_shade", 7, 16, 4),
        ("distill_beast", 24, 16, 5),
    ]
    for mid, mx, my, eidx in enemy_positions:
        events.append(make_event(
            next_id, "ENEMY_" + mid, mx, my,
            "<blackai_type:enemy><blackai_id:{}>".format(mid),
            "BlackAI_Enemies", eidx, 2, 1,
            "BlackAI.World.onEnemyTouch('{}', this._eventId);".format(mid),
            True,
        ))
        next_id += 1

    altar = load_json(DATA_DIR / "Map002.json")
    # Keep editor-authored events after the 19 generated altar events, including the return exit.
    events.extend(altar["events"][len(events):])
    altar["displayName"] = "巨型电源圣坛"
    altar["tilesetId"] = 7
    altar["width"] = w
    altar["height"] = h
    altar["data"] = data_arr
    altar["events"] = events
    altar["note"] = "<blackai_region:psu_altar>"
    save_json(DATA_DIR / "Map002.json", altar)


def main() -> None:
    altar_path = DATA_DIR / "Map002.json"
    if altar_path.is_file() and "<blackai_native>" in load_json(altar_path).get("note", ""):
        from build_native_altar import main as build_native
        build_native()
        return
    chars = load_json(BA_DATA_DIR / "characters.json")["characters"]
    mons = load_json(BA_DATA_DIR / "monsters.json")["monsters"]
    build_tilesets_images()
    build_player_sprite()
    build_giant_psu_sprite()
    build_heroine_and_enemy_sprites(chars, mons)
    build_title_image()
    sync_mv_database()
    print("[OK] RPG Maker MV 占位图与原生数据库同步完成（Map002: 32x20，含大 PSU + 7 核心 AI 娘 + 6 暗影怪）")


if __name__ == "__main__":
    main()
