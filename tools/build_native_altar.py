"""Build the authored altar as native RPG Maker MV tiles and events."""

import argparse
import copy
import json
import re
import shutil
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
WIDTH, HEIGHT, TILE = 32, 20, 48
SHEETS = ("BlackAI_Altar_C", "BlackAI_Altar_D", "BlackAI_Altar_E")
CHARACTER_SOURCE = ROOT / ".image/.characters"
KILL_CHOICE = r"\C[18]杀害\C[0]"
WRITE_DATA = {}


def read(name):
    return json.loads((DATA / (name + ".json")).read_text(encoding="utf-8-sig"))


def write(name, value):
    WRITE_DATA[name] = value


def command(code, *parameters, **kwargs):
    return dict(code=code, indent=kwargs.get("indent", 0), parameters=list(parameters))


def script(*args, **kwargs):
    return command(356, "BlackAI MV " + " ".join(args), **kwargs)


def selection(title, labels, branches):
    events = [command(101, "", 0, 0, 2), command(401, title), command(102, labels, -2, 0, 2, 0)]
    for index, branch in enumerate(branches):
        events.append(command(402, index, labels[index]))
        events.extend(dict(step, indent=step["indent"] + 1) for step in branch)
        events.append(command(0, indent=1))
    return events + [command(404), command(0)]


def battle(troop_id, can_escape=True):
    return [command(301, 0, troop_id, can_escape, True), command(601),
            command(0, indent=1), command(602), command(0, indent=1),
            command(603), script("Recover", indent=1), command(0, indent=1), command(604)]


def build_tiles(flags):
    source = ROOT / ".image/.map/psu-altar.png"
    with Image.open(str(source)) as original:
        art = original.convert("RGB").resize((WIDTH * TILE, HEIGHT * TILE), Image.LANCZOS)
    atlases = [Image.new("RGBA", (16 * TILE, 16 * TILE)) for _ in SHEETS]
    ids = []
    for y in range(HEIGHT):
        for x in range(WIDTH):
            tile_id = 256 + y * WIDTH + x
            px = (tile_id // 128 % 2 * 8 + tile_id % 8) * TILE
            py = (tile_id % 256 // 8 % 16) * TILE
            atlases[tile_id // 256 - 1].paste(
                art.crop((x * TILE, y * TILE, (x + 1) * TILE, (y + 1) * TILE)), (px, py))
            outer_wall = x in (0, 31) or y >= 18 or (y <= 2 and x not in (15, 16))
            cabinets = ((x <= 2 or x >= 29) and (4 <= y <= 8 or 11 <= y <= 13 or y >= 15))
            fan = 13 <= x <= 18 and 7 <= y <= 12
            flags[tile_id] = 15 if outer_wall or cabinets or fan else 0
            ids.append(tile_id)
    for atlas, name in zip(atlases, SHEETS):
        atlas.save(str(ROOT / "img/tilesets" / (name + ".png")))
    return [0] * (WIDTH * HEIGHT * 2) + ids + [0] * (WIDTH * HEIGHT * 3)


def character_frames(sheet):
    frames = []
    for row in range(4):
        for col in range(3):
            cell = sheet.crop((round(col * sheet.width / 3), round(row * sheet.height / 4),
                               round((col + 1) * sheet.width / 3), round((row + 1) * sheet.height / 4)))
            bounds = cell.getchannel("A").point(lambda alpha: 255 if alpha >= 128 else 0).getbbox()
            if bounds is None:
                raise ValueError("Empty character frame at row {}, column {}".format(row + 1, col + 1))
            left, top, right, bottom = bounds
            frames.append(cell.crop((max(0, left - 2), max(0, top - 2),
                                     min(cell.width, right + 2), min(cell.height, bottom + 2))))
    return frames


def sprite_sheet(frames, width, height, padding):
    scale = min((width - 2 * padding) / max(frame.width for frame in frames),
                (height - 2 * padding) / max(frame.height for frame in frames))
    sheet = Image.new("RGBA", (width * 3, height * 4))
    for index, frame in enumerate(frames):
        frame = frame.resize((round(frame.width * scale), round(frame.height * scale)), Image.LANCZOS)
        sheet.paste(frame, (index % 3 * width + (width - frame.width) // 2,
                            index // 3 * height + height - padding - frame.height))
    return sheet


def sync_altar_cast():
    cast = {char["id"]: char for char in read("black_ai/characters")["characters"] if char.get("map_sprite")}
    faces = Image.new("RGBA", (576, 288))
    for char_id, char in cast.items():
        filename = char["map_sprite"][1:] + ".png"
        with Image.open(CHARACTER_SOURCE / "originals" / filename) as source:
            frames = character_frames(source.convert("RGBA"))
        sprite_sheet(frames, 362, 362, 4).save(CHARACTER_SOURCE / filename)
        sprite_sheet(frames, 80, 96, 2).save(ROOT / "img/characters" / (char["map_sprite"] + ".png"))

        standing = frames[1]
        side = round(standing.height * 0.60)
        x = (standing.width - side) // 2
        face = standing.crop((x, 0, x + side, side)).resize((144, 144), Image.LANCZOS)
        index = char["face_index"]
        faces.paste(face, (index % 4 * 144, index // 4 * 144))

        battler = standing.copy()
        battler.thumbnail((228, 228), Image.LANCZOS)
        canvas = Image.new("RGBA", (240, 240))
        canvas.paste(battler, ((240 - battler.width) // 2, 238 - battler.height))
        canvas.save(ROOT / "img/enemies" / ("BlackAI_" + char_id + ".png"))
    faces.save(ROOT / "img/faces/BlackAI_AltarCast.png")

    altar = WRITE_DATA.get("Map002") or read("Map002")
    for event in altar["events"]:
        if not event or "<blackai_type:heroine>" not in event["note"]:
            continue
        match = re.search(r"<blackai_id:([^>]+)>", event["note"])
        char = cast.get(match.group(1)) if match else None
        if not char:
            continue
        old_name = event["name"]
        event["name"] = char["name"]
        for page in event["pages"]:
            if page["image"]["characterName"]:
                page["image"].update(characterName=char["map_sprite"], characterIndex=0)
            for step in page["list"]:
                if step["code"] == 401 and step["parameters"] == [old_name]:
                    step["parameters"] = [char["name"]]
    write("Map002", altar)

    enemies = WRITE_DATA.get("Enemies") or read("Enemies")
    renamed_bosses = {}
    for enemy in enemies[1:]:
        match = re.search(r"<blackai_boss_id:([^>]+)>", enemy["note"]) if enemy else None
        char = cast.get(match.group(1)) if match else None
        if char:
            enemy["name"] = char["name"]
            renamed_bosses[enemy["id"]] = char["name"]
    troops = WRITE_DATA.get("Troops") or read("Troops")
    for troop in troops[1:]:
        if troop and len(troop["members"]) == 1:
            name = renamed_bosses.get(troop["members"][0]["enemyId"])
            if name:
                troop["name"] = name + "（BOSS）"
    write("Enemies", enemies)
    write("Troops", troops)

    system = WRITE_DATA.get("System") or read("System")
    system["versionId"] = max(system.get("versionId", 0), 57618948)
    write("System", system)


def build_maps(troop_ids):
    tilesets = read("Tilesets")
    tileset = tilesets[7]
    tileset.update(name="BLACK AI · 巨型电源圣坛", tilesetNames=["", "", "", "", "", "", *SHEETS])
    altar = read("Map002")
    altar.update(data=build_tiles(tileset["flags"]), note="<blackai_region:psu_altar><blackai_native>",
                 specifyBattleback=True, battleback1Name="BlackAI_Altar", battleback2Name="")
    if not (ROOT / "img/battlebacks1/BlackAI_Altar.png").is_file():
        with Image.open(str(ROOT / ".image/.map/psu-altar.png")) as original:
            original.convert("RGB").resize((1280, 720), Image.LANCZOS).save(str(ROOT / "img/battlebacks1/BlackAI_Altar.png"))

    hall = read("Map001")
    if not any(event and "<blackai_cage_role:" in event["note"] for event in hall["events"]):
        hall_script = (ROOT / "dialogue/dual_core_hall.dialogue").read_text(encoding="utf-8")
        for event, section in zip(hall["events"][1:3], ("claude", "deepseek")):
            page = event["pages"][0]
            text = hall_script.split("~ " + section + "\n", 1)[1].split("=> END", 1)[0]
            lines = [line.split(": ", 1)[1] for line in text.splitlines() if ": " in line]
            page["list"] = [page["list"][0]] + [command(401, line) for line in lines] + [command(0)]
        write("Map001", hall)

    old_events = altar["events"]
    template = copy.deepcopy(hall["events"][1]["pages"][0])

    def event(event_id, name, xy, actions, note="", image="", index=0, trigger=0, priority=1):
        page = copy.deepcopy(template)
        page.update(list=actions, trigger=trigger, priorityType=priority, stepAnime=False, through=False)
        page["image"].update(characterName=image, characterIndex=index, direction=2, pattern=1)
        return dict(id=event_id, name=name, x=xy[0], y=xy[1], note=note, pages=[page])

    menu = selection("巨型大 PSU 电源。\n风扇转动得很平稳。",
        ["清理缓存", "升级基础 HP", "整理装备", "保存", "读取存档", "离开"],
        [[script("PSU", action)] if action else [] for action in ("cache", "upgrade", "equip", "save", "load", "")])
    events = [None] * 23
    for i, x in enumerate((16, 15, 17), 1):
        events[i] = event(i, "巨型大 PSU 电源 · 正面", (x, 12), menu)
    events[4] = event(4, "巨型大 PSU 电源 · 背面开关", (16, 7), [script("PSU", "switch"), command(0)])
    spawn = [(11, 13), (21, 13), (7, 7), (7, 13), (12, 4), (19, 4), (24, 9)]
    characters = read("black_ai/characters")["characters"]
    for i, xy in enumerate(spawn, 7):
        old = old_events[i]
        cid = old["note"].split("<blackai_id:", 1)[1].split(">")[0]
        char = next(entry for entry in characters if entry["id"] == cid)
        old_image = old["pages"][0]["image"]
        art = char.get("map_sprite") or ("$DeepSeek" if cid == "big_fish" else None)
        actions = selection(char["name"], ["交谈", "赠送显卡", KILL_CHOICE, "离开"],
                            [[script("Talk", cid)], [script("Gift", cid)], battle(troop_ids[cid]), []])
        events[i] = event(i, char["name"], xy, actions, old["note"],
                          art or old_image["characterName"], 0 if art else old_image["characterIndex"])

    positions = [(8, 10), (23, 10), (5, 5), (26, 5), (6, 15), (26, 15)]
    for i, xy in enumerate(positions, 14):
        old = old_events[i]
        mid = old["note"].split("<blackai_id:", 1)[1].split(">")[0]
        old_image = old["pages"][0]["image"]
        actions = ([command(101, "", 0, 0, 2), command(401, "您、您、您好……请问……")] if i == 14 else [])
        actions += battle(troop_ids[mid]) + [command(0)]
        events[i] = event(i, old["name"], xy, actions, old["note"], old_image["characterName"],
                          old_image["characterIndex"], trigger=1)

    for i, x in ((20, 16), (22, 15)):
        events[i] = event(i, "返回双核大厅", (x, 1), [command(201, 0, 1, 12, 14, 8, 0), command(0)],
                          trigger=1, priority=0)
    events[21] = event(21, "圣坛补给箱", (16, 4), [script("Supplies"), command(0)], image="!Chest")
    altar["events"] = events
    write("Tilesets", tilesets)
    write("Map002", altar)


def battle_tables():
    skills, enemies, troops = read("Skills"), read("Enemies"), read("Troops")
    items, weapons, armors, states = read("Items"), read("Weapons"), read("Armors"), read("States")
    system, classes = read("System"), read("Classes")
    data = read("black_ai/skills")
    defs = {row["id"]: row for row in data["player_skills"] + data["enemy_skills"]}
    state_ids = {row["note"].split(":")[-1].rstrip(">"): row["id"] for row in states[2:] if row}
    for status, sid in state_ids.items():
        row = states[sid]
        row.update(autoRemovalTiming=2, minTurns=2, maxTurns=2, removeAtBattleEnd=True,
                   message1="进入" + row["name"] + "状态。", message2="进入" + row["name"] + "状态。",
                   message3="", message4="恢复正常。", traits=[])
        if status in ("crash", "short_circuit", "lock"):
            row["restriction"] = 4
        if status == "throttled":
            row["traits"] = [dict(code=21, dataId=2, value=0.6), dict(code=21, dataId=6, value=0.5)]

    guard = next((row for row in states if row and "<blackai_guard>" in row["note"]), None)
    if guard is None:
        guard = copy.deepcopy(states[1])
        guard.update(id=len(states), name="防御中", note="<blackai_guard>")
        states.append(guard)
    guard.update(priority=20, restriction=0, traits=[dict(code=62, dataId=1, value=0)], autoRemovalTiming=2,
                 minTurns=1, maxTurns=1, removeAtBattleEnd=True, message1="进入防御姿态。",
                 message2="进入防御姿态。", message3="", message4="")
    skills[1].update(effects=[], message1="发动了普攻！", tpGain=0)
    skills[1]["damage"].update(formula="Math.max(1, a.atk - b.def)", variance=0)
    skills[2].update(effects=[dict(code=21, dataId=guard["id"], value1=1, value2=0),
                               dict(code=12, dataId=0, value1=0, value2=5)], message1="架起了防御姿态。", tpGain=0)

    def add_skill(row):
        tagged = "<blackai_skill_id:{}>".format(row["id"])
        skill = next((entry for entry in skills if entry and tagged in entry["note"]), None)
        if skill is None:
            skill = copy.deepcopy(skills[1])
            skill.update(id=len(skills), note=tagged)
            skills.append(skill)
        support = row["kind"] == "support"
        mode = row.get("damage_type", "physical")
        damage = dict(type=3 if support else 1, elementId=0, critical=not support, variance=0,
                      formula=str(row.get("restore_hp", 0)) if support else
                      "Math.max(1, a.atk * {} - b.def * {})".format(row.get("power_mult", 1), 1 - row.get("armor_pierce", 0)))
        effects = []
        if row.get("apply_status") in state_ids:
            effects.append(dict(code=21, dataId=state_ids[row["apply_status"]], value1=row.get("status_chance", 1), value2=0))
        skill.update(name=row["name"], description=row["description"], mpCost=row.get("token_cost", 0),
                     scope=11 if support else 1, stypeId=1, repeats=row.get("hits", 1), effects=effects,
                     hitType=0 if support else 1, damage=damage, message1="使用了 " + row["name"] + "。", message2="", tpGain=0)
        if mode in ("overheat", "dark", "lightning"):
            damage["elementId"] = {"overheat": 2, "lightning": 3, "dark": 4}[mode]
        return skill["id"]

    skill_ids = {key: add_skill(row) for key, row in defs.items() if row["kind"] != "mode_switch"}
    classes[1]["learnings"] = [dict(level=1, skillId=skill_ids[row["id"]], note="") for row in data["player_skills"]]
    classes[1]["traits"] = [entry for entry in classes[1]["traits"] if entry["code"] not in (51, 52)] + [
        dict(code=51, dataId=1, value=0), *[dict(code=52, dataId=i, value=0) for i in (1, 2, 3)]]
    system["terms"]["basic"][4:6] = ["Token", "Token"]
    system["skillTypes"][1] = "Token 技能"
    system["optDisplayTp"] = False

    item_defs = read("black_ai/items")
    consumables = {row["id"]: row for row in item_defs["consumables"]}
    throwables = {row["id"]: row for row in item_defs["weapons"] if row["slot"] == "throwable"}
    for item in items[1:]:
        item_id = item["note"].split("<blackai_id:", 1)[1].split(">")[0]
        item.update(effects=[], occasion=3, scope=7, tpGain=0)
        if item_id in consumables:
            item["occasion"] = 0
            item["effects"] = [dict(code=11, dataId=0, value1=0, value2=eff["amount"])
                               for eff in consumables[item_id]["use_effects"] if eff["type"] == "restore_hp"]
        elif item_id == "gpu_580":
            item.update(occasion=1, scope=1, damage=dict(type=1, elementId=0, formula="10", critical=False, variance=0))

    for item_id, spec in throwables.items():
        marker = "<blackai_id:{}>".format(item_id)
        item = next((row for row in items[1:] if marker in row["note"]), None)
        if item is None:
            item = copy.deepcopy(items[1])
            item.update(id=len(items), note=marker)
            items.append(item)
        if "<blackai_throwable>" not in item["note"]:
            item["note"] += "\n<blackai_throwable>"
        item.update(name=spec["name"], description=spec["description"], price=spec["price"], tpGain=0,
                    effects=[], occasion=1, scope=1, damage=dict(type=1, elementId=0, critical=False, variance=0,
                    formula={"water": "max(1, 18 - b.def)", "cement_resistor": "a.atk + 10 - b.def",
                             "bulging_capacitor": "60 - b.def / 2"}[item_id].replace("max(", "Math.max(")))
    for equipment in weapons[1:] + armors[1:]:
        if not equipment:
            continue
        item_id = equipment["note"].split("<blackai_id:", 1)[1].split(">")[0]
        config_row = next((row for group in item_defs.values() if isinstance(group, list) for row in group if row.get("id") == item_id), {})
        for stat, xparam in (("evasion", 1), ("crit_rate", 2)):
            value = config_row.get("stats", {}).get(stat, 0)
            if value:
                existing = [trait for trait in equipment["traits"] if trait["code"] == 22 and trait["dataId"] == xparam]
                if not existing or existing[0]["value"] != value:
                    equipment["traits"] = [trait for trait in equipment["traits"] if trait not in existing]
                    equipment["traits"].append(dict(code=22, dataId=xparam, value=value))

    monsters = {row["id"]: row for row in read("black_ai/monsters")["monsters"]}
    troop_ids = {}
    for troop in troops[1:]:
        enemy = enemies[troop["members"][0]["enemyId"]]
        key = enemy["note"].split(":", 1)[1].split(">", 1)[0]
        troop_ids[key] = troop["id"]
        troop["members"][0].update(x=640, y=410)
        enemy["params"][1] = 100
        enemy["traits"] = [dict(code=22, dataId=0, value=0.95), dict(code=22, dataId=1, value=0.05)]
        profile = monsters.get(key, {})
        if key not in monsters or any(tag in profile.get("tags", []) for tag in ("ai", "electronic")):
            if "<ai_unit>" not in enemy["note"]:
                enemy["note"] += "\n<ai_unit>"
        actions = [{"skillId": 1, "rating": 5, "conditionType": 0, "conditionParam1": 0, "conditionParam2": 0}]
        actions += [dict(actions[0], skillId=skill_ids[sid], rating=6) for sid in profile.get("skills", []) if sid in skill_ids]
        enemy["actions"] = actions
    for name, rows in ((name, rows) for name, rows in locals().copy().items() if name in
                       ("skills", "enemies", "troops", "items", "weapons", "armors", "states", "system", "classes")):
        write(name.capitalize(), rows)
    return troop_ids


def main(characters_only=False):
    WRITE_DATA.clear()
    if not characters_only:
        build_maps(battle_tables())
    sync_altar_cast()
    backup = Path(tempfile.mkdtemp(prefix="black-ai-mv-data-"))
    for name, value in WRITE_DATA.items():
        path = DATA / (name + ".json")
        shutil.copy2(path, backup / path.name)
        path.write_bytes((json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
    print("[OK] MV native data synchronized. Backup: " + str(backup))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--characters-only", action="store_true", help="Update altar cast, portraits and Boss entries only")
    main(parser.parse_args().characters_only)
