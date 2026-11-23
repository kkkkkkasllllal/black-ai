#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Slice approved 42x26 outdoor pixel-art maps into native RPG Maker MV tilesets & Map003/Map004."""

import copy
import json
from collections import deque
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TILESET_OUT = ROOT / "img" / "tilesets"
BATTLEBACK_OUT = ROOT / "img" / "battlebacks1"
MAP_ART_DIR = ROOT / ".image" / ".map"
SCRATCH_DIR = Path(r"C:\Users\MECHREVO\.gemini\antigravity\brain\4c9f9400-f7c6-4fcb-bb5c-b26cf1a1c1ac\scratch")

TILE = 48
W, H = 42, 26  # 1092 tiles -> fits 100% natively in A5 (128) + B (255) + C (256) + D (256) + E (256) = 1151 slots!


def load_json(name):
    return json.loads((DATA / (name + ".json")).read_text(encoding="utf-8-sig"))


def save_json(name, obj):
    (DATA / (name + ".json")).write_bytes(
        (json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    )


def command(code, *params, **kwargs):
    return {"code": code, "indent": kwargs.get("indent", 0), "parameters": list(params)}


def make_transfer_event(ev_id, name, x, y, target_map, tx, ty, direction, template_page):
    page = copy.deepcopy(template_page)
    page.update(
        list=[command(201, 0, target_map, tx, ty, direction, 0), command(0)],
        trigger=1,       # Player Touch
        priorityType=0,  # Below characters
        stepAnime=False,
        through=False,
    )
    page["image"].update(characterName="", characterIndex=0, direction=2, pattern=1)
    return {"id": ev_id, "name": name, "x": x, "y": y, "note": "", "pages": [page]}


def make_talk_event(ev_id, name, x, y, doc_id, section, char_id, template_page,
                    image="", index=0, direction=2, note="", step_anime=False):
    page = copy.deepcopy(template_page)
    cmd_str = "BlackAI MV Talk {} {} {}".format(doc_id, section, char_id or doc_id)
    page.update(
        list=[command(356, cmd_str), command(0)],
        trigger=0,       # Action Button
        priorityType=1,  # Same as characters
        stepAnime=step_anime,
        through=False,
    )
    page["image"].update(characterName=image, characterIndex=index, direction=direction, pattern=1)
    return {"id": ev_id, "name": name, "x": x, "y": y, "note": note, "pages": [page]}


def make_autorun_once_event(ev_id, name, x, y, doc_id, section, char_id, template_page):
    p1 = copy.deepcopy(template_page)
    cmd_str = "BlackAI MV Talk {} {} {}".format(doc_id, section, char_id or doc_id)
    p1.update(
        list=[command(356, cmd_str), command(123, "A", 0), command(0)],
        trigger=3,       # Autorun
        priorityType=0,
        stepAnime=False,
        through=True,
    )
    p1["image"].update(characterName="", characterIndex=0, direction=2, pattern=1)

    p2 = copy.deepcopy(template_page)
    p2["conditions"] = copy.deepcopy(p1["conditions"])
    p2["conditions"]["selfSwitchCh"] = "A"
    p2["conditions"]["selfSwitchValid"] = True
    p2.update(
        list=[command(0)],
        trigger=0,
        priorityType=0,
        stepAnime=False,
        through=True,
    )
    p2["image"].update(characterName="", characterIndex=0, direction=2, pattern=1)
    return {"id": ev_id, "name": name, "x": x, "y": y, "note": "", "pages": [p1, p2]}


def tile_id_for_index(idx):
    """Map sequential index 0..1091 onto native MV A5 (1536..1663) + B (1..255) + C/D/E (256..1023)."""
    if idx < 128:
        return 1536 + idx
    return 1 + (idx - 128)


def slice_42x26_map_to_native_tileset(src_png, prefix, blocked_grid):
    """
    Slice a 2016x1248 (42x26) map into 5 native MV tileset sheets (A5, B, C, D, E),
    returning (tileset_names, flags_list, map_data_6layers).
    """
    with Image.open(str(src_png)) as im:
        art = im.convert("RGB").resize((W * TILE, H * TILE), Image.LANCZOS)

    sheet_a5 = Image.new("RGBA", (8 * TILE, 16 * TILE), (0, 0, 0, 0))
    sheets_bcde = [Image.new("RGBA", (16 * TILE, 16 * TILE), (0, 0, 0, 0)) for _ in range(4)]

    # Standard MV tileset flags length = 8192 (indices 0..8191); flag[0] = 16 (no effect on passage)
    flags = [0] * 8192
    flags[0] = 16

    layer0 = [0] * (W * H)
    layer2 = [0] * (W * H)

    for y in range(H):
        for x in range(W):
            idx = y * W + x
            tid = tile_id_for_index(idx)
            crop = art.crop((x * TILE, y * TILE, (x + 1) * TILE, (y + 1) * TILE)).convert("RGBA")

            if 1536 <= tid <= 1663:
                k = tid - 1536
                sx = (k % 8) * TILE
                sy = (k // 8) * TILE
                sheet_a5.paste(crop, (sx, sy))
                layer0[idx] = tid
            else:
                sheet_idx = tid // 256  # 0=B, 1=C, 2=D, 3=E
                sx = ((tid // 128) % 2 * 8 + (tid % 8)) * TILE
                sy = ((tid % 256) // 8 % 16) * TILE
                sheets_bcde[sheet_idx].paste(crop, (sx, sy))
                layer2[idx] = tid

            flags[tid] = 15 if blocked_grid[y][x] else 0

    names = [
        prefix + "_A5",
        prefix + "_B",
        prefix + "_C",
        prefix + "_D",
        prefix + "_E",
    ]
    sheet_a5.save(str(TILESET_OUT / (names[0] + ".png")))
    for s_im, s_name in zip(sheets_bcde, names[1:]):
        s_im.save(str(TILESET_OUT / (s_name + ".png")))

    tileset_names = ["", "", "", "", names[0], names[1], names[2], names[3], names[4]]
    empty = [0] * (W * H)
    map_data = layer0 + empty + layer2 + empty + empty + empty
    return tileset_names, flags, map_data, art


# ---------------------------------------------------------------------------
# Hand-Crafted Collision Masks (42x26) + Automated BFS Connectivity Verification
# ---------------------------------------------------------------------------

def set_rect(grid, x0, y0, x1, y1, val):
    for y in range(max(0, y0), min(H, y1 + 1)):
        for x in range(max(0, x0), min(W, x1 + 1)):
            grid[y][x] = val


def build_map3_collision():
    """Map003: 废土电子巷道 · 疯茶会 (ewaste-alley.png)."""
    # Start blocked everywhere (ragged outer junk mountain perimeter), then carve roads/alleys/courtyards!
    b = [[True] * W for _ in range(H)]

    # 1. Diagonal main cracked asphalt highway (SW -> Mid -> NE) + South spur
    set_rect(b, 0, 19, 14, 22, False)   # SW highway entry
    set_rect(b, 12, 16, 17, 25, False)  # Mid-SW intersection & south spur
    set_rect(b, 15, 13, 21, 17, False)  # Diagonal ascending stretch 1
    set_rect(b, 19, 9, 27, 14, False)   # Diagonal ascending stretch 2
    set_rect(b, 24, 6, 41, 10, False)   # NE highway exit

    # 2. West & NW cobblestone back-alleys + NW Camp/Doubao Alcove
    set_rect(b, 4, 6, 17, 9, False)     # NW alcove courtyard & northern alley
    set_rect(b, 15, 6, 21, 9, False)    # Connects NW alley -> main road
    set_rect(b, 4, 9, 8, 19, False)     # West vertical alley
    set_rect(b, 7, 15, 13, 18, False)   # West shortcut into diagonal road

    # 3. East / SE-Mid Mad Tea Party Courtyard + Lower & East Loops
    set_rect(b, 24, 13, 35, 20, False)  # Mad Tea Party courtyard
    set_rect(b, 16, 19, 38, 22, False)  # Lower cross-alley behind tea courtyard + SE alley
    set_rect(b, 35, 9, 38, 25, False)   # East perimeter maintenance lane -> SE exit
    set_rect(b, 26, 10, 31, 14, False)  # Road descending into Tea Courtyard

    # 4. Block interior physical obstacles & landmarks (precise visual footprints!)
    # Central-West L-shaped e-waste ridge, ruin wall, KEEP OUT fence, wrecked mainframe
    set_rect(b, 9, 10, 16, 13, True)
    set_rect(b, 14, 9, 19, 10, True)    # Ruin wall & KEEP OUT gate upper facade (y=6..8 stays 3 tiles wide!)
    set_rect(b, 10, 13, 12, 14, True)
    set_rect(b, 17, 12, 18, 13, False)  # Smooth 2-tile wide diagonal highway throat!
    set_rect(b, 18, 10, 19, 11, True)   # KEEP OUT gate & black car
    set_rect(b, 19, 14, 22, 17, True)   # Central mainframe & scrap island

    # North-Central blockade & storefronts
    set_rect(b, 18, 0, 36, 5, True)     # Monitor wall, vault door, north ruins

    # East-Center junk wall & ruin shielding Tea Courtyard
    set_rect(b, 31, 9, 35, 13, True)
    set_rect(b, 39, 10, 41, 15, True)   # Radio tower & east junk

    # Vehicles & props along roads (still leaving 2-tile bypass clearance around each!)
    set_rect(b, 5, 19, 6, 20, True)     # Stalled city bus on SW road (passable above y=18 or below y=21!)
    set_rect(b, 4, 18, 12, 18, False)   # Extra clearance north of bus
    set_rect(b, 9, 22, 10, 22, True)    # Red car
    set_rect(b, 12, 19, 12, 19, True)   # Barricade
    set_rect(b, 4, 15, 4, 16, True)     # Vending machine
    set_rect(b, 27, 8, 28, 9, True)     # Cargo truck on NE road (passable at y=6..7!)

    # NW Alcove props (tent, phone booth, glass sphere, campfire)
    set_rect(b, 6, 4, 8, 5, True)       # Tent
    set_rect(b, 11, 5, 12, 5, True)     # Doubao phone booth
    set_rect(b, 14, 4, 15, 5, True)     # Glass sphere
    set_rect(b, 9, 7, 9, 7, True)       # Campfire

    # Mad Tea Party props (center motherboard table, grand piano, tarp tent, side tables, railing)
    set_rect(b, 28, 15, 31, 18, True)   # Motherboard tea table (walkable ring all around!)
    set_rect(b, 25, 15, 27, 16, True)   # Grand piano
    set_rect(b, 32, 15, 32, 15, True)   # Cake side table
    set_rect(b, 33, 18, 33, 18, True)   # Teapot side table
    set_rect(b, 34, 15, 36, 17, True)   # Pale tarp tent (east lane passes cleanly at x=37..38!)
    set_rect(b, 25, 19, 28, 19, True)   # Courtyard railing
    set_rect(b, 24, 22, 26, 24, True)   # South red awning stall
    set_rect(b, 21, 22, 23, 24, True)   # Fallen servers

    # Keep active border exits crisply open (cap dead-end bottom edge at y=25)
    set_rect(b, 0, 19, 3, 21, False)    # SW exit back to PSU Altar
    set_rect(b, 38, 6, 41, 8, False)    # NE exit to 404 Flooded Street
    set_rect(b, 0, 25, 41, 25, True)    # Prevent walking off unused bottom edge
    return b


def build_map4_collision():
    """Map004: 404 洪涝废街 (sunken-street-404.png)."""
    b = [[True] * W for _ in range(H)]

    # 1. North wet waterfront street (y=4..6 across full width, plus x=20..21 at y=7 bridge mouth)
    set_rect(b, 0, 4, 41, 6, False)
    set_rect(b, 20, 7, 21, 7, False)

    # 2. Single Central Bridge + Pump Island (y=8..18)
    set_rect(b, 20, 8, 21, 10, False)   # North concrete bridge span
    set_rect(b, 16, 11, 25, 15, False)  # Central Pump Island deck
    set_rect(b, 20, 16, 21, 18, False)  # South concrete bridge span

    # 3. South wet waterfront street (y=19..23 across full width)
    set_rect(b, 0, 19, 41, 23, False)

    # 4. Block specific street & island obstacles (keeping smooth 2-tile bypasses!)
    # North street props
    set_rect(b, 0, 6, 2, 7, True)       # NW curbside e-waste mound
    set_rect(b, 26, 3, 27, 4, True)     # Stalled bus (passable at y=5..6!)
    set_rect(b, 30, 5, 32, 6, True)     # NE curbside e-waste mound (passable at y=4!)
    set_rect(b, 38, 3, 40, 4, True)     # Radio tower base

    # Central Pump Island props
    set_rect(b, 17, 11, 19, 12, True)   # KEEP OUT fence
    set_rect(b, 22, 11, 25, 12, True)   # Monitor console bank
    set_rect(b, 16, 14, 17, 14, True)   # Traffic cone
    set_rect(b, 24, 14, 25, 14, True)   # Barricade

    # South street props
    set_rect(b, 5, 22, 6, 22, True)     # White car
    set_rect(b, 2, 23, 3, 23, True)     # Garbage heap
    set_rect(b, 9, 23, 11, 24, True)    # SW e-waste mound
    set_rect(b, 13, 23, 14, 23, True)   # Bench
    set_rect(b, 16, 23, 17, 23, True)   # Hydrant
    set_rect(b, 20, 23, 23, 24, True)   # Mid-south e-waste mound
    set_rect(b, 25, 22, 27, 23, True)   # Black car
    set_rect(b, 31, 23, 33, 24, True)   # Drums/boxes beside Grok stall
    set_rect(b, 33, 20, 39, 22, True)   # Grok's dual stalls (walkable at y=19 & y=23!)
    return b


def verify_connectivity(name, blocked, waypoints):
    """BFS check that every key waypoint in a map is walkable and mutually reachable."""
    sx, sy = waypoints[0]
    assert not blocked[sy][sx], "{} start waypoint {} is blocked!".format(name, (sx, sy))
    visited = {(sx, sy)}
    q = deque([(sx, sy)])
    while q:
        cx, cy = q.popleft()
        for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
            if 0 <= nx < W and 0 <= ny < H and not blocked[ny][nx] and (nx, ny) not in visited:
                visited.add((nx, ny))
                q.append((nx, ny))
    for wp in waypoints:
        assert not blocked[wp[1]][wp[0]], "{} waypoint {} is blocked!".format(name, wp)
        assert wp in visited, "{} waypoint {} is NOT reachable from {}!".format(name, wp, (sx, sy))
    print("[OK] {} BFS connectivity verified ({} walkable tiles, {} waypoints connected).".format(name, len(visited), len(waypoints)))
    return visited


def render_collision_debug(art3, b3, t3, i3, art4, b4, t4, i4):
    """Render side-by-side collision verification overlay (green=walkable, red=blocked, cyan=transfer, gold=NPC/story)."""
    def overlay(art, blocked, transfers, interactables):
        im = art.convert("RGBA")
        ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        tset = set(transfers)
        iset = set(interactables)
        for y in range(H):
            for x in range(W):
                box = [x * TILE + 2, y * TILE + 2, (x + 1) * TILE - 2, (y + 1) * TILE - 2]
                if (x, y) in tset:
                    d.rectangle(box, fill=(0, 255, 255, 115), outline=(0, 255, 255, 220))
                elif (x, y) in iset:
                    d.rectangle(box, fill=(255, 215, 55, 130), outline=(255, 245, 130, 240))
                elif blocked[y][x]:
                    d.rectangle(box, fill=(255, 35, 55, 78))
                else:
                    d.rectangle(box, fill=(40, 230, 110, 48))
        im.alpha_composite(ov)
        return im.convert("RGB").resize((1008, 624), Image.LANCZOS)

    o3 = overlay(art3, b3, t3, i3)
    o4 = overlay(art4, b4, t4, i4)
    sheet = Image.new("RGB", (1008, 624 * 2 + 64), (16, 18, 26))
    sd = ImageDraw.Draw(sheet)
    sd.text((12, 8), "Map003 QA: Green=Walk  Red=Block  Cyan=Transfer  Gold=NPC/Story", fill=(235, 240, 255))
    sheet.paste(o3, (0, 30))
    sd.text((12, 662), "Map004 QA: Green=Walk  Red=Block  Cyan=Transfer  Gold=NPC/Story", fill=(235, 240, 255))
    sheet.paste(o4, (0, 686))
    SCRATCH_DIR.mkdir(parents=True, exist_ok=True)
    out = SCRATCH_DIR / "collision_verify_map3_map4.png"
    sheet.save(str(out))
    print("Saved collision verification preview:", out)


def main():
    # 1. Read approved final master artworks directly from .image/.map/
    dst3 = MAP_ART_DIR / "ewaste-alley.png"
    dst4 = MAP_ART_DIR / "sunken-street-404.png"
    assert dst3.is_file(), "Missing master artwork: {}".format(dst3)
    assert dst4.is_file(), "Missing master artwork: {}".format(dst4)

    # 2. Build & BFS-verify collision grids
    b3 = build_map3_collision()
    b4 = build_map4_collision()
    reach3 = verify_connectivity("Map003", b3, [(1, 20), (6, 12), (10, 8), (22, 11), (29, 14), (32, 17), (32, 19), (37, 23), (40, 7)])
    reach4 = verify_connectivity("Map004", b4, [(1, 5), (15, 5), (20, 8), (20, 13), (21, 17), (10, 20), (35, 23), (40, 20)])

    # 3. Slice into native MV A5 + B..E tilesets & battlebacks
    ts3_names, ts3_flags, data3, art3 = slice_42x26_map_to_native_tileset(dst3, "BlackAI_EWasteAlley", b3)
    ts4_names, ts4_flags, data4, art4 = slice_42x26_map_to_native_tileset(dst4, "BlackAI_Sunken404", b4)
    art3.resize((1280, 720), Image.LANCZOS).save(str(BATTLEBACK_OUT / "BlackAI_EWasteAlley.png"))
    art4.resize((1280, 720), Image.LANCZOS).save(str(BATTLEBACK_OUT / "BlackAI_Sunken404.png"))

    # 4. Update data/Tilesets.json (Tileset 9 & 10 + open south grate exit on Tileset 7 for Map002)
    tilesets = load_json("Tilesets")
    while len(tilesets) <= 10:
        tilesets.append(None)

    # Make Map002 bottom-center metal grate doorway (15, 18) & (16, 18) passable on Tileset 7!
    # In build_native_altar.py: tile_id = 256 + y * 32 + x
    for gx in (15, 16):
        tid_m2 = 256 + 18 * 32 + gx
        tilesets[7]["flags"][tid_m2] = 0

    tilesets[9] = {
        "id": 9,
        "flags": ts3_flags,
        "mode": 0,
        "name": "BLACK AI · 废土电子巷道",
        "note": "",
        "tilesetNames": ts3_names,
    }
    tilesets[10] = {
        "id": 10,
        "flags": ts4_flags,
        "mode": 0,
        "name": "BLACK AI · 404 洪涝废街",
        "note": "",
        "tilesetNames": ts4_names,
    }
    save_json("Tilesets", tilesets)

    # 5. Build Map003.json, Map004.json, and add south exit transfers on Map002.json
    map2 = load_json("Map002")
    template_page = copy.deepcopy(map2["events"][20]["pages"][0])

    # Ensure Map002 Giant PSU front events (1, 2, 3) include 「切换外观」
    psu_labels = ["清理缓存", "升级基础 HP", "整理装备", "切换外观", "保存", "读取存档", "离开"]
    psu_actions = ["cache", "upgrade", "equip", "skin", "save", "load", ""]
    psu_list = [command(101, "", 0, 0, 2), command(401, "巨型大 PSU 电源。\n风扇转动得很平稳。"), command(102, psu_labels, -2, 0, 2, 0)]
    for idx_opt, (lbl, act) in enumerate(zip(psu_labels, psu_actions)):
        psu_list.append(command(402, idx_opt, lbl))
        if act:
            psu_list.append(command(356, "BlackAI MV PSU " + act, indent=1))
        psu_list.append(command(0, indent=1))
    psu_list.extend([command(404), command(0)])
    for psu_eid in (1, 2, 3):
        if psu_eid < len(map2["events"]) and map2["events"][psu_eid]:
            map2["events"][psu_eid]["pages"][0]["list"] = copy.deepcopy(psu_list)

    # Add Map002 south grate doorway -> Map003 SW entrance (2, 20) + one-time arrival banter skit
    while len(map2["events"]) <= 25:
        map2["events"].append(None)
    map2["events"][23] = make_transfer_event(23, "前往废土电子巷道", 15, 18, 3, 2, 20, 6, template_page)
    map2["events"][24] = make_transfer_event(24, "前往废土电子巷道", 16, 18, 3, 2, 20, 6, template_page)
    map2["events"][25] = make_autorun_once_event(25, "圣坛初遇 · 姐妹拌嘴", 1, 1, "outdoor_scenes", "altar_arrival", "big_fish", template_page)
    save_json("Map002", map2)

    def make_map(display_name, tileset_id, data_arr, battleback, region_tag, events_list,
                 extra_note="", autoplay_bgs=False, bgs=None):
        base = copy.deepcopy(map2)
        base.update(
            displayName=display_name,
            tilesetId=tileset_id,
            width=W,
            height=H,
            data=data_arr,
            battleback1Name=battleback,
            battleback2Name="",
            specifyBattleback=True,
            autoplayBgs=autoplay_bgs,
            bgs=bgs or {"name": "", "pan": 0, "pitch": 100, "volume": 90},
            note="<blackai_region:{}><blackai_native>{}".format(region_tag, extra_note),
            events=[None] + events_list,
        )
        return base

    # Map003 transfer events + outdoor story NPCs & landmarks
    m3_events = []
    m3_tcoords = []
    m3_icoords = []
    eid = 1
    for ty in (19, 20, 21):
        m3_events.append(make_transfer_event(eid, "返回巨型电源圣坛", 0, ty, 2, 16, 17, 8, template_page))
        m3_tcoords.append((0, ty))
        eid += 1
    for ty in (6, 7, 8):
        m3_events.append(make_transfer_event(eid, "前往 404 洪涝废街", 41, ty, 4, 2, 5, 6, template_page))
        m3_tcoords.append((41, ty))
        eid += 1

    m3_story_specs = [
        ("豆包 · 废弃语音亭", 11, 5, "doubao", "start", "doubao", "", 0, 2, ""),
        ("豆包 · 废弃语音亭", 12, 5, "doubao", "start", "doubao", "", 0, 2, ""),
        ("claude-fish（贴胶带翻车）", 21, 11, "outdoor_scenes", "fake_c_alley", "fake_c", "$claude-fish", 0, 2, "<blackai_type:heroine><blackai_id:fake_c>"),
        ("GLM（帽子屋）", 29, 14, "mad_tea_party", "glm", "glm", "People3", 5, 2, ""),
        ("通义千问（三月兔）", 32, 16, "mad_tea_party", "qwen", "qwen", "People1", 1, 4, ""),
        ("Kimi（睡鼠）", 29, 19, "mad_tea_party", "kimi", "kimi", "Actor3", 6, 8, ""),
        ("疯茶会桌底铁盒", 30, 18, "mad_tea_party", "tin_box", "kimi", "", 0, 2, ""),
        ("电子垃圾堆 · 废机柜", 10, 14, "outdoor_scenes", "ewaste_heap_west", "big_fish", "", 0, 2, ""),
        ("电子垃圾堆 · 旧纸箱", 33, 13, "outdoor_scenes", "ewaste_heap_east", "big_fish", "", 0, 2, ""),
    ]
    for name, ex, ey, doc, sec, cid, img, idx, dirn, note in m3_story_specs:
        m3_events.append(make_talk_event(eid, name, ex, ey, doc, sec, cid, template_page, image=img, index=idx, direction=dirn, note=note))
        m3_icoords.append((ex, ey))
        eid += 1

    map3 = make_map(
        "废土电子巷道 · 疯茶会", 9, data3, "BlackAI_EWasteAlley", "fan_forest", m3_events,
        autoplay_bgs=True, bgs={"name": "", "pan": 0, "pitch": 100, "volume": 90},
    )
    save_json("Map003", map3)

    # Map004 transfer events + rainy 404 street NPCs & landmarks
    m4_events = []
    m4_tcoords = []
    m4_icoords = []
    eid = 1
    for ty in (4, 5):
        m4_events.append(make_transfer_event(eid, "返回废土电子巷道", 0, ty, 3, 39, 7, 4, template_page))
        m4_tcoords.append((0, ty))
        eid += 1

    m4_story_specs = [
        ("Gemini 猫猫（雨夜看河）", 13, 6, "outdoor_scenes", "gemini_canal_rain", "gemini_cat", "Nature", 1, 2, "<blackai_type:heroine><blackai_id:gemini_cat>"),
        ("404 泵岛水位监控台", 23, 12, "outdoor_scenes", "pump_island_console", "gemini_cat", "", 0, 2, ""),
        ("404 泵岛水位监控台", 24, 12, "outdoor_scenes", "pump_island_console", "gemini_cat", "", 0, 2, ""),
        ("Grok（暗巷军火商）", 32, 22, "grok", "start", "grok", "Actor3", 2, 4, ""),
        ("Grok 黑市摊柜台", 34, 22, "grok", "start", "grok", "", 0, 2, ""),
        ("Grok 黑市摊柜台", 35, 22, "grok", "start", "grok", "", 0, 2, ""),
    ]
    for name, ex, ey, doc, sec, cid, img, idx, dirn, note in m4_story_specs:
        m4_events.append(make_talk_event(eid, name, ex, ey, doc, sec, cid, template_page, image=img, index=idx, direction=dirn, note=note))
        m4_icoords.append((ex, ey))
        eid += 1

    for tx, ty in m3_tcoords:
        assert not b3[ty][tx], "Map003 transfer ({}, {}) is blocked!".format(tx, ty)
    for tx, ty in m4_tcoords:
        assert not b4[ty][tx], "Map004 transfer ({}, {}) is blocked!".format(tx, ty)

    def assert_interactable(name, reach_set, coords):
        for ex, ey in coords:
            adj = [(ex - 1, ey), (ex + 1, ey), (ex, ey - 1), (ex, ey + 1)]
            assert any(p in reach_set for p in adj), "{} interactable ({}, {}) has NO reachable adjacent tile!".format(name, ex, ey)
    assert_interactable("Map003", reach3, m3_icoords)
    assert_interactable("Map004", reach4, m4_icoords)

    map4 = make_map(
        "404 洪涝废街", 10, data4, "BlackAI_Sunken404", "sunken_pool_404", m4_events,
        extra_note="<blackai_rain><blackai_rain_canal:8.5,17.8>",
        autoplay_bgs=True, bgs={"name": "Storm2", "pan": 0, "pitch": 100, "volume": 24},
    )
    save_json("Map004", map4)

    # 6. Register Map003 & Map004 in data/MapInfos.json
    infos = load_json("MapInfos")
    while len(infos) <= 4:
        infos.append(None)
    infos[3] = {"id": 3, "expanded": False, "name": "废土电子巷道 · 疯茶会", "order": 3, "parentId": 0, "scrollX": 1008, "scrollY": 624}
    infos[4] = {"id": 4, "expanded": False, "name": "404 洪涝废街", "order": 4, "parentId": 0, "scrollX": 1008, "scrollY": 624}
    save_json("MapInfos", infos)

    # 7. Bump System.json versionId cleanly
    system = load_json("System")
    system["versionId"] = int(system.get("versionId", 57618948)) + 1
    save_json("System", system)

    # 8. Render collision visual QA overlay
    render_collision_debug(art3, b3, m3_tcoords, m3_icoords, art4, b4, m4_tcoords, m4_icoords)
    print("[OK] Map003 & Map004 built with {} + {} story events and registered in RPG Maker MV!".format(len(m3_icoords), len(m4_icoords)))


if __name__ == "__main__":
    main()
