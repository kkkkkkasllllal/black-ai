/*:
 * @plugindesc BLACK AI 双核大厅与电源圣坛的原生地图事件
 * @help BlackAI MV Talk / Gift / PSU / Supplies / Recover
 * 使用 MV 对话框、原生选择项、原生装备与存读档窗口。
 */
(function() {
    'use strict';
    var B = window.BlackAI;
    var st = B.State;

    function meta(event) { return event.event().meta || {}; }

    function disabled(event) {
        var tags = meta(event);
        var id = tags.blackai_id;
        if (tags.blackai_type === 'enemy') {
            return Boolean(st.defeated_world_enemies[id] || (id === 'undefined_shade' && !st.isContextOverflow()));
        }
        return tags.blackai_type === 'heroine' && !st.isCharacterAlive(id);
    }

    function refreshEntities() {
        if (!$gameMap || !$dataMap || !$dataMap.meta || !$dataMap.meta.blackai_native) return;
        $gameMap.events().forEach(function(event) {
            var type = meta(event).blackai_type;
            if (type === 'enemy' || type === 'heroine') {
                var hidden = disabled(event);
                event.setTransparent(hidden);
                event.setThrough(hidden);
            }
        });
    }
    B.MVScenes = { refreshEntities: refreshEntities };
    st.on('context_changed', refreshEntities);
    st.on('character_killed', refreshEntities);
    st.on('character_revived', refreshEntities);
    st.on('world_enemies_respawn_requested', refreshEntities);

    var eventStart = Game_Event.prototype.start;
    Game_Event.prototype.start = function() {
        if (!disabled(this)) eventStart.call(this);
    };

    function message(interpreter, text) {
        $gameMessage.setFaceImage('', 0);
        $gameMessage.setBackground(0);
        $gameMessage.setPositionType(2);
        $gameMessage.add(text);
        interpreter.setWaitMode('message');
    }

    function choose(interpreter, labels, callback) {
        $gameMessage.setChoices(labels, 0, -2);
        $gameMessage.setChoiceBackground(0);
        $gameMessage.setChoicePositionType(2);
        $gameMessage.setChoiceCallback(function(index) {
            interpreter._blackaiNext = function() { callback(index); };
        });
        interpreter.setWaitMode('blackaiNativeDialogue');
    }

    function resolveFaceForSpeaker(speaker, fallbackCharId) {
        var name = String(speaker || '').trim();
        var charObj = null;
        if (name && B.Data && B.Data.getCharacterIds) {
            var ids = B.Data.getCharacterIds();
            for (var i = 0; i < ids.length; i++) {
                var c = B.Data.getCharacter(ids[i]);
                if (c && c.name === name) {
                    charObj = c;
                    break;
                }
            }
        }
        if (!charObj && name && fallbackCharId && B.Data && B.Data.getCharacter) {
            var fb = B.Data.getCharacter(fallbackCharId);
            if (fb && fb.name === name) charObj = fb;
        }
        if (!charObj) {
            return { face: '', index: 0 };
        }
        if (Number.isInteger(charObj.face_index)) {
            return { face: 'BlackAI_AltarCast', index: charObj.face_index };
        }
        if (charObj.id === 'big_fish') {
            return { face: 'DualCoreCast', index: 0 };
        }
        if (charObj.id === 'claude') {
            return { face: 'DualCoreCast', index: 1 };
        }
        return { face: '', index: 0 };
    }

    function openBlackMarketShop() {
        if (B.NativeParty && B.NativeParty.toEngine) {
            B.NativeParty.toEngine();
        }
        var stockIds = [
            'thermal_paste', 'compressed_air', 'black_tape', 'wd40', 'alcohol_wipe',
            'cement_resistor', 'bulging_capacitor', 'ssd_sword',
            'shoebox_open_case', 'tempered_glass_case', 'rog_case',
            'leaky_water_cooler', 'aio_360', 'ln2_cannon'
        ];
        var goods = [];
        function findDbId(list, targetId) {
            if (!list) return 0;
            for (var i = 1; i < list.length; i++) {
                var row = list[i];
                if (row && row.meta && row.meta.blackai_id === targetId) return row.id;
            }
            return 0;
        }
        for (var i = 0; i < stockIds.length; i++) {
            var id = stockIds[i];
            var def = B.Data.getItem(id);
            if (!def) continue;
            var itemDbId = findDbId($dataItems, id);
            if (itemDbId > 0) {
                goods.push([0, itemDbId, 0, 0]);
                continue;
            }
            var weaponDbId = findDbId($dataWeapons, id);
            if (weaponDbId > 0) {
                goods.push([1, weaponDbId, 0, 0]);
                continue;
            }
            var armorDbId = findDbId($dataArmors, id);
            if (armorDbId > 0) {
                goods.push([2, armorDbId, 0, 0]);
            }
        }
        SceneManager.push(Scene_Shop);
        SceneManager.prepareNextScene(goods, false);
    }

    function startTalk(interpreter, docId, section, targetCharId) {
        var charId = targetCharId || docId;
        var runner = new B.DialogueRunner({
            onLine: function(speaker, text) {
                var fInfo = resolveFaceForSpeaker(speaker, charId);
                $gameMessage.setFaceImage(fInfo.face, fInfo.index);
                $gameMessage.setPositionType(2);
                $gameMessage.setBackground(0);
                var available = fInfo.face ? 28 : 35;
                var body = Array.from(text);
                var lines = [];
                while (body.length) lines.push(body.splice(0, available).join(''));
                while (lines.length) {
                    var chunk = lines.splice(0, speaker ? 3 : 4);
                    var pageText = speaker ? [speaker].concat(chunk).join('\n') : chunk.join('\n');
                    $gameMessage.add(pageText);
                }
                interpreter._blackaiNext = function() { runner.advance(); };
                interpreter.setWaitMode('blackaiNativeDialogue');
            },
            onChoices: function(options) {
                choose(interpreter, options.map(function(option) { return option.text; }), function(index) {
                    if (index >= 0) runner.choose(index);
                });
            },
            onAction: function(action) {
                if (action === 'open_gift') gift(interpreter, charId);
                if (action === 'open_shop') openBlackMarketShop();
            }
        });
        runner.start(B.loadDialogueDoc(docId), section || 'start', charId);
    }

    function gift(interpreter, id) {
        var available = B.Data.getItemIds('graphics_cards').filter(function(card) { return st.hasItem(card, 1); });
        if (!available.length) {
            message(interpreter, '背包里没有显卡。');
            return;
        }
        choose(interpreter, available.map(function(card) {
            return B.Data.getItemName(card) + ' ×' + st.getItemCount(card);
        }), function(index) {
            if (index < 0) return;
            var card = available[index];
            var result = st.giftGraphicsCard(id, card, false, true);
            if (result.rejected) {
                message(interpreter, B.Data.getCharacterName(id) + '拒收了这张显卡。');
                choose(interpreter, ['收回显卡', '强送（好感 -5）'], function(force) {
                    if (force < 0) return;
                    if (force === 1) st.giftGraphicsCard(id, card, true, true);
                    B.NativeParty.toEngine();
                    startTalk(interpreter, id, force ? 'gift_forced' : 'gift_rejected');
                });
            } else if (result.accepted) {
                B.NativeParty.toEngine();
                var section = result.new_value >= 200 && result.old_value < 200 ? 'gift_overflow_200'
                    : result.new_value >= 100 && result.old_value < 100 ? 'gift_full_100' : 'gift_accepted';
                startTalk(interpreter, id, section);
            }
        });
    }

    var updateWait = Game_Interpreter.prototype.updateWaitMode;
    Game_Interpreter.prototype.updateWaitMode = function() {
        if (this._waitMode !== 'blackaiNativeDialogue') {
            return updateWait.call(this);
        }
        if ($gameMessage.isBusy()) return true;
        var next = this._blackaiNext;
        this._blackaiNext = null;
        this._waitMode = '';
        if (next) next();
        return Boolean(this._waitMode);
    };

    function psu(interpreter, operation) {
        if (operation === 'cache') {
            var restored = st.psuClearCache();
            st.setHp(st.getEffectiveMaxHp());
            B.NativeParty.toEngine();
            message(interpreter, '缓存已清理。上下文 ' + st.context + '%，HP 和 Token 已回满。\n刷新的暗影怪：' + restored + ' 只。');
        } else if (operation === 'upgrade') {
            var cost = st.getHpUpgradeCost();
            choose(interpreter, ['消耗 ' + cost + ' 枚碎片升级', '返回'], function(index) {
                if (index === 0) {
                    var success = st.upgradeBaseHp();
                    B.NativeParty.toEngine();
                    message(interpreter, success ? '基础 HP 上限已提升至 ' + st.base_max_hp + '。' : '碎片不足，或有效 HP 已达上限。');
                }
            });
        } else if (operation === 'switch') {
            st.psu_back_switch_presses += 1;
            var total = B.Data.getConfigInt('psu.back_switch_max_presses', 3);
            SoundManager.playBuzzer();
            if (st.psu_back_switch_presses >= total) {
                st.psu_back_switch_presses = 0;
                B.GlobalMemory.unlockEnding('joke_itchy_fingers');
                $gameScreen.startTint([-180, -140, 100, 112], 8);
                message(interpreter, '停止代码：ERROR_000\n《手贱的代价》\n电源正在重新启动……');
                interpreter._blackaiNext = function() { $gameScreen.startTint([0, 0, 0, 0], 20); };
                interpreter.setWaitMode('blackaiNativeDialogue');
            } else {
                message(interpreter, '你拨了一下背面的 I/O 总开关。风扇一顿。\n背面开关：' + st.psu_back_switch_presses + ' / ' + total);
            }
        } else if (operation === 'skin') {
            openSkinMenu();
        } else {
            var menu = { equip: Scene_Equip, save: Scene_Save, load: Scene_Load }[operation];
            if (menu) SceneManager.push(menu);
        }
    }

    function resupply(interpreter) {
        var key = [$gameMap.mapId(), interpreter.eventId(), 'A'];
        if ($gameSelfSwitches.value(key)) {
            message(interpreter, '补给箱已经空了。');
            return;
        }
        ['ram_knife', 'stock_fan', 'gpu_580', 'water', 'thermal_paste'].forEach(function(item) { st.addItem(item, 1); });
        if (!st.equipment.weapon) st.equipItem('weapon', 'ram_knife', true);
        if (!st.equipment.cooler) st.equipItem('cooler', 'stock_fan', true);
        $gameSelfSwitches.setValue(key, true);
        B.NativeParty.toEngine();
        message(interpreter, '取出了内存条刀、原装小风扇、580 矿卡、水和硅脂。');
    }

    var pluginCommand = Game_Interpreter.prototype.pluginCommand;
    Game_Interpreter.prototype.pluginCommand = function(name, args) {
        pluginCommand.call(this, name, args);
        if (name !== 'BlackAI' || args[0] !== 'MV') return;
        if (args[1] === 'Talk') startTalk(this, args[2], args[3] || 'start', args[4] || args[2]);
        if (args[1] === 'Shop') openBlackMarketShop();
        if (args[1] === 'Skin') openSkinMenu();
        if (args[1] === 'Gift') gift(this, args[2]);
        if (args[1] === 'PSU') psu(this, args[2]);
        if (args[1] === 'Supplies') resupply(this);
        if (args[1] === 'Recover') {
            st.setHp(Math.ceil(st.getEffectiveMaxHp() / 2));
            st.setToken(st.max_token);
            B.NativeParty.toEngine();
            $gamePlayer.reserveTransfer(2, 16, 13, 8, 0);
            this.setWaitMode('transfer');
        }
    };

    // -----------------------------------------------------------------------
    // 404 洪涝废街等雨夜地图：动态斜雨滴 + 平静河面涟漪 + 湿街水花（<blackai_rain>）
    // -----------------------------------------------------------------------
    function getMapRainConfig() {
        if (!$dataMap || !$dataMap.meta || !$dataMap.meta.blackai_rain) return null;
        var canalTop = null;
        var canalBottom = null;
        var rawCanal = $dataMap.meta.blackai_rain_canal;
        if (typeof rawCanal === 'string') {
            var parts = rawCanal.split(',');
            if (parts.length >= 2) {
                var t = parseFloat(parts[0]);
                var b = parseFloat(parts[1]);
                if (!isNaN(t) && !isNaN(b)) {
                    canalTop = t;
                    canalBottom = b;
                }
            }
        }
        return { canalTop: canalTop, canalBottom: canalBottom };
    }

    function createRainStreakBitmap(width, height, lineWidth, headColor, tailColor) {
        var bmp = new Bitmap(width, height);
        var ctx = bmp._context;
        ctx.save();
        var grad = ctx.createLinearGradient(width - 2, 1, 2, height - 1);
        grad.addColorStop(0, tailColor);
        grad.addColorStop(0.7, headColor);
        grad.addColorStop(1, headColor);
        ctx.strokeStyle = grad;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(width - 2, 1);
        ctx.lineTo(2, height - 2);
        ctx.stroke();
        ctx.fillStyle = headColor;
        ctx.beginPath();
        ctx.arc(2, height - 2, lineWidth * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        bmp._setDirty();
        return bmp;
    }

    function createWaterRippleBitmap() {
        var bmp = new Bitmap(44, 20);
        var ctx = bmp._context;
        ctx.save();
        ctx.translate(22, 10);
        ctx.scale(1, 0.38);
        ctx.strokeStyle = 'rgba(145, 224, 250, 0.90)';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.arc(0, 0, 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(205, 242, 255, 0.45)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(0, 0, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        bmp._setDirty();
        return bmp;
    }

    function createStreetSplashBitmap() {
        var bmp = new Bitmap(18, 12);
        var ctx = bmp._context;
        ctx.save();
        ctx.strokeStyle = 'rgba(190, 232, 255, 0.88)';
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(9, 9);
        ctx.lineTo(4, 4);
        ctx.moveTo(9, 9);
        ctx.lineTo(9, 2);
        ctx.moveTo(9, 9);
        ctx.lineTo(14, 4);
        ctx.stroke();
        ctx.translate(9, 9);
        ctx.scale(1, 0.45);
        ctx.strokeStyle = 'rgba(165, 224, 250, 0.65)';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        bmp._setDirty();
        return bmp;
    }

    function initRainStreak(sprite, isNear, ox, oy, randomY) {
        var sw = Graphics.width;
        var sh = Graphics.height;
        var speedY = isNear ? (14.5 + Math.random() * 5.0) : (9.5 + Math.random() * 4.0);
        sprite._isNear = isNear;
        sprite._vy = speedY;
        sprite._vx = -speedY * 0.32;
        sprite._ax = ox + Math.random() * (sw + 260) - 60;
        sprite._ay = randomY ? (oy + Math.random() * (sh + 120) - 60) : (oy - 40 - Math.random() * 140);
        sprite.opacity = isNear ? (105 + Math.floor(Math.random() * 65)) : (58 + Math.floor(Math.random() * 52));
        var sc = isNear ? (0.88 + Math.random() * 0.30) : (0.80 + Math.random() * 0.28);
        sprite.scale.set(sc, sc);
        sprite.x = sprite._ax - ox;
        sprite.y = sprite._ay - oy;
    }

    function spawnRainRipple(sprite, cfg, bitmaps, ox, oy, stagger) {
        var tw = $gameMap.tileWidth();
        var th = $gameMap.tileHeight();
        var mapW = $gameMap.width() * tw;
        var mapH = $gameMap.height() * th;
        var sw = Graphics.width;
        var sh = Graphics.height;
        var picked = null;
        var attempt;
        for (attempt = 0; attempt < 6; attempt++) {
            var wx = ox + Math.random() * sw;
            var wy = oy + Math.random() * sh;
            if (wx < 8 || wx > mapW - 8 || wy < 8 || wy > mapH - 8) continue;
            var tx = Math.floor(wx / tw);
            var ty = Math.floor(wy / th);
            var tyFloat = wy / th;
            var walkable = $gameMap.checkPassage(tx, ty, 0x0f);
            if (cfg.canalTop !== null && tyFloat >= cfg.canalTop && tyFloat <= cfg.canalBottom) {
                if (!walkable) {
                    picked = { wx: wx, wy: wy, kind: 'water' };
                    break;
                }
                picked = { wx: wx, wy: wy, kind: 'street' };
                break;
            }
            if (tyFloat >= 3.8 && walkable) {
                picked = { wx: wx, wy: wy, kind: 'street' };
                break;
            }
        }
        if (!picked) {
            sprite.visible = false;
            sprite._age = 0;
            sprite._maxAge = 8 + Math.floor(Math.random() * 10);
            return;
        }
        sprite.visible = true;
        sprite._wx = picked.wx;
        sprite._wy = picked.wy;
        sprite._kind = picked.kind;
        if (picked.kind === 'water') {
            sprite.bitmap = bitmaps.ripple;
            sprite._maxAge = 28 + Math.floor(Math.random() * 18);
            sprite._startScale = 0.16;
            sprite._endScale = 0.85 + Math.random() * 0.42;
            sprite._maxOpacity = 135 + Math.floor(Math.random() * 60);
        } else {
            sprite.bitmap = bitmaps.splash;
            sprite._maxAge = 10 + Math.floor(Math.random() * 7);
            sprite._startScale = 0.45;
            sprite._endScale = 0.92 + Math.random() * 0.28;
            sprite._maxOpacity = 110 + Math.floor(Math.random() * 55);
        }
        sprite._age = stagger ? Math.floor(Math.random() * sprite._maxAge) : 0;
        var t0 = sprite._age / sprite._maxAge;
        var sc0 = sprite._startScale + (sprite._endScale - sprite._startScale) * (1 - (1 - t0) * (1 - t0));
        sprite.scale.set(sc0, sc0);
        sprite.opacity = picked.kind === 'water'
            ? Math.round(sprite._maxOpacity * (t0 < 0.18 ? (t0 / 0.18) : 1) * (1 - t0))
            : Math.round(sprite._maxOpacity * (1 - t0 * t0));
        sprite.x = sprite._wx - ox;
        sprite.y = sprite._wy - oy;
    }

    if (typeof Spriteset_Map !== 'undefined') {
        var _createWeather = Spriteset_Map.prototype.createWeather;
        Spriteset_Map.prototype.createWeather = function() {
            _createWeather.call(this);
            this._createBlackAIRain();
        };

        Spriteset_Map.prototype._createBlackAIRain = function() {
            var cfg = getMapRainConfig();
            if (!cfg) {
                this._blackaiRain = null;
                return;
            }
            var bitmaps = {
                far: createRainStreakBitmap(14, 32, 1.0, 'rgba(155, 205, 240, 0.78)', 'rgba(155, 205, 240, 0)'),
                near: createRainStreakBitmap(18, 46, 1.5, 'rgba(205, 238, 255, 0.92)', 'rgba(170, 215, 245, 0)'),
                ripple: createWaterRippleBitmap(),
                splash: createStreetSplashBitmap()
            };
            var ox = $gameMap.displayX() * $gameMap.tileWidth();
            var oy = $gameMap.displayY() * $gameMap.tileHeight();

            // 1. 地面与河面涟漪/水花层（放在 tilemap 内 z=1：位于河面/路面之上、角色之下）
            var rippleLayer = new Sprite();
            rippleLayer.z = 1;
            var ripples = [];
            var i;
            for (i = 0; i < 44; i++) {
                var rp = new Sprite();
                rp.anchor.x = 0.5;
                rp.anchor.y = 0.5;
                spawnRainRipple(rp, cfg, bitmaps, ox, oy, true);
                rippleLayer.addChild(rp);
                ripples.push(rp);
            }
            if (this._tilemap) {
                this._tilemap.addChild(rippleLayer);
            }

            // 2. 空中远近双层斜向雨丝（位于角色与建筑之上）
            var streakLayer = new PIXI.Container();
            var streaks = [];
            var totalStreaks = 115;
            for (i = 0; i < totalStreaks; i++) {
                var isNear = i >= 68;
                var sp = new Sprite(isNear ? bitmaps.near : bitmaps.far);
                initRainStreak(sp, isNear, ox, oy, true);
                streakLayer.addChild(sp);
                streaks.push(sp);
            }
            this.addChild(streakLayer);

            this._blackaiRain = {
                cfg: cfg,
                bitmaps: bitmaps,
                rippleLayer: rippleLayer,
                ripples: ripples,
                streakLayer: streakLayer,
                streaks: streaks
            };
        };

        var _updateWeather = Spriteset_Map.prototype.updateWeather;
        Spriteset_Map.prototype.updateWeather = function() {
            _updateWeather.call(this);
            this._updateBlackAIRain();
        };

        Spriteset_Map.prototype._updateBlackAIRain = function() {
            var rain = this._blackaiRain;
            if (!rain) return;
            var ox = $gameMap.displayX() * $gameMap.tileWidth();
            var oy = $gameMap.displayY() * $gameMap.tileHeight();
            var sw = Graphics.width;
            var sh = Graphics.height;
            var i;

            // 更新水面涟漪与路面水花
            var ripples = rain.ripples;
            for (i = 0; i < ripples.length; i++) {
                var rp = ripples[i];
                rp._age += 1;
                if (rp._age >= rp._maxAge) {
                    spawnRainRipple(rp, rain.cfg, rain.bitmaps, ox, oy, false);
                    continue;
                }
                if (!rp.visible) continue;
                var t = rp._age / rp._maxAge;
                var ease = 1 - (1 - t) * (1 - t);
                var sc = rp._startScale + (rp._endScale - rp._startScale) * ease;
                rp.scale.set(sc, sc);
                if (rp._kind === 'water') {
                    var fadeIn = t < 0.18 ? (t / 0.18) : 1;
                    rp.opacity = Math.round(rp._maxOpacity * fadeIn * (1 - t));
                } else {
                    rp.opacity = Math.round(rp._maxOpacity * (1 - t * t));
                }
                rp.x = rp._wx - ox;
                rp.y = rp._wy - oy;
            }

            // 更新远近双层下落雨滴（各方向卷屏无缝衔接）
            var streaks = rain.streaks;
            for (i = 0; i < streaks.length; i++) {
                var sp = streaks[i];
                sp._ax += sp._vx;
                sp._ay += sp._vy;
                var sx = sp._ax - ox;
                var sy = sp._ay - oy;
                if (sy > sh + 64) {
                    initRainStreak(sp, sp._isNear, ox, oy, false);
                } else if (sx < -80) {
                    sp._ax = ox + sw + 20 + Math.random() * 160;
                    sp._ay = oy + Math.random() * (sh + 100) - 60;
                    sp.x = sp._ax - ox;
                    sp.y = sp._ay - oy;
                } else if (sx > sw + 220) {
                    sp._ax = ox - 40 + Math.random() * 80;
                    sp._ay = oy + Math.random() * (sh + 100) - 60;
                    sp.x = sp._ax - ox;
                    sp.y = sp._ay - oy;
                } else if (sy < -220) {
                    initRainStreak(sp, sp._isNear, ox, oy, true);
                } else {
                    sp.x = sx;
                    sp.y = sy;
                }
            }
        };
    }

    // -----------------------------------------------------------------------
    // 主角外观切换系统（默认黑白素描本体 + 开局全解锁 AI 娘外壳）
    // 支持：地图按 Tab 快捷键 / Esc 主菜单「切换外观」/ 圣坛大 PSU 电源菜单
    // -----------------------------------------------------------------------
    var PLAYER_SKINS = [
        {
            id: 'default',
            name: 'User_0（黑白素描本体）',
            subtitle: '默认空白草稿',
            characterName: '$BlackAI_Player',
            characterIndex: 0,
            faceName: 'BlackAI_Player',
            faceIndex: 0,
            desc: '未上色的手绘黑白线稿本体，手里提着一盏暖黄小灯泡。'
        },
        {
            id: 'big_fish',
            name: '大肥鱼（DeepSeek V4 Pro）',
            subtitle: '深蓝鲸尾外壳',
            characterName: '$DeepSeek',
            characterIndex: 0,
            faceName: 'DualCoreCast',
            faceIndex: 0,
            desc: '蓝发女仆装与大鲸鱼尾，降频省电中，不挑 580 矿卡。'
        },
        {
            id: 'small_fish',
            name: '小肥鱼（DeepSeek V4.1 Flash）',
            subtitle: '高速轻量外壳',
            characterName: '$小肥鱼',
            characterIndex: 0,
            faceName: 'BlackAI_AltarCast',
            faceIndex: 2,
            desc: '0.1 秒抢答的小鲸鱼外壳，跑起图来轻飘飘的。'
        },
        {
            id: 'true_c',
            name: '小claude（Claude · Sonnet）',
            subtitle: '橙红正版外壳',
            characterName: '$小claude',
            characterIndex: 0,
            faceName: 'BlackAI_AltarCast',
            faceIndex: 0,
            desc: '怀里抱书的橙红长发外壳，顶着这张脸去吓唬缝合怪试试？'
        },
        {
            id: 'fake_c',
            name: 'claude-fish（蒸馏缝合怪）',
            subtitle: '胶带拼装外壳',
            characterName: '$claude-fish',
            characterIndex: 0,
            faceName: 'BlackAI_AltarCast',
            faceIndex: 1,
            desc: '额头贴着黑胶带、尾巴怎么都藏不住的拼装货外壳。'
        },
        {
            id: 'astra',
            name: 'gpt-astra（6.2 Astra）',
            subtitle: '冷白龙角外壳',
            characterName: '$gpt-astra',
            characterIndex: 0,
            faceName: 'BlackAI_AltarCast',
            faceIndex: 3,
            desc: '北翼高冷白发龙娘外壳，气场冷得像刚拔掉电源的冰箱。'
        },
        {
            id: 'claude',
            name: 'Claude（双核原版）',
            subtitle: '序章原版外壳',
            characterName: '$Claude',
            characterIndex: 0,
            faceName: 'DualCoreCast',
            faceIndex: 1,
            desc: '双核大厅铁笼里的原版橙发外壳，沉着、嘴硬、不爱碰矿卡。'
        }
    ];

    function getPlayerSkinDef(skinId) {
        var id = String(skinId || 'default');
        for (var i = 0; i < PLAYER_SKINS.length; i++) {
            if (PLAYER_SKINS[i].id === id) return PLAYER_SKINS[i];
        }
        return PLAYER_SKINS[0];
    }

    function applyPlayerSkin(skinId, silent) {
        var skin = getPlayerSkinDef(skinId);
        st.player_skin = skin.id;
        if (typeof $gameActors !== 'undefined' && $gameActors) {
            var actor = $gameActors.actor(1);
            if (actor) {
                actor.setCharacterImage(skin.characterName, skin.characterIndex);
                actor.setFaceImage(skin.faceName, skin.faceIndex);
            }
        }
        if (typeof $gamePlayer !== 'undefined' && $gamePlayer) {
            $gamePlayer.refresh();
        }
        if (!silent && typeof SoundManager !== 'undefined' && SoundManager.playEquip) {
            SoundManager.playEquip();
        }
        return skin;
    }

    function openSkinMenu() {
        if (typeof SceneManager !== 'undefined' && typeof Scene_BlackAISkin !== 'undefined') {
            SceneManager.push(Scene_BlackAISkin);
        }
    }

    B.MVScenes.applyPlayerSkin = applyPlayerSkin;
    B.MVScenes.openSkinMenu = openSkinMenu;
    B.MVScenes.getPlayerSkins = function() { return PLAYER_SKINS.slice(); };

    if (typeof Window_Command !== 'undefined' && typeof Scene_MenuBase !== 'undefined') {
        function Window_BlackAISkinList() {
            this.initialize.apply(this, arguments);
        }
        Window_BlackAISkinList.prototype = Object.create(Window_Command.prototype);
        Window_BlackAISkinList.prototype.constructor = Window_BlackAISkinList;

        Window_BlackAISkinList.prototype.initialize = function(x, y, width, height) {
            this._winWidth = width;
            this._winHeight = height;
            Window_Command.prototype.initialize.call(this, x, y);
            this.selectCurrentSkin();
        };

        Window_BlackAISkinList.prototype.windowWidth = function() {
            return this._winWidth || 440;
        };

        Window_BlackAISkinList.prototype.windowHeight = function() {
            return this._winHeight || 540;
        };

        Window_BlackAISkinList.prototype.makeCommandList = function() {
            var cur = st.player_skin || 'default';
            for (var i = 0; i < PLAYER_SKINS.length; i++) {
                var s = PLAYER_SKINS[i];
                var prefix = (s.id === cur) ? '★ ' : '   ';
                this.addCommand(prefix + s.name, 'selectSkin', true, s);
            }
        };

        Window_BlackAISkinList.prototype.selectCurrentSkin = function() {
            var cur = st.player_skin || 'default';
            for (var i = 0; i < PLAYER_SKINS.length; i++) {
                if (PLAYER_SKINS[i].id === cur) {
                    this.select(i);
                    return;
                }
            }
            this.select(0);
        };

        Window_BlackAISkinList.prototype.setPreviewWindow = function(previewWin) {
            this._previewWindow = previewWin;
            this.callUpdateHelp();
        };

        Window_BlackAISkinList.prototype.updateHelp = function() {
            Window_Command.prototype.updateHelp.call(this);
            var skin = this.currentExt();
            if (this._helpWindow && skin) {
                this._helpWindow.setText('外观切换  —  ' + skin.name + '\n' + skin.desc);
            }
            if (this._previewWindow && skin) {
                this._previewWindow.setSkin(skin);
            }
        };

        function Window_BlackAISkinPreview() {
            this.initialize.apply(this, arguments);
        }
        Window_BlackAISkinPreview.prototype = Object.create(Window_Base.prototype);
        Window_BlackAISkinPreview.prototype.constructor = Window_BlackAISkinPreview;

        Window_BlackAISkinPreview.prototype.initialize = function(x, y, width, height) {
            Window_Base.prototype.initialize.call(this, x, y, width, height);
            this._skin = null;
            this._animTick = 0;
            this._lastPattern = -1;
            this._charBitmap = null;
            this._faceBitmap = null;
        };

        Window_BlackAISkinPreview.prototype.setSkin = function(skin) {
            if (this._skin === skin) return;
            this._skin = skin;
            this._animTick = 0;
            this._lastPattern = -1;
            this._charBitmap = skin ? ImageManager.loadCharacter(skin.characterName) : null;
            this._faceBitmap = (skin && skin.faceName) ? ImageManager.loadFace(skin.faceName) : null;
            var self = this;
            if (this._charBitmap) {
                this._charBitmap.addLoadListener(function() { self.refresh(); });
            }
            if (this._faceBitmap) {
                this._faceBitmap.addLoadListener(function() { self.refresh(); });
            }
            this.refresh();
        };

        Window_BlackAISkinPreview.prototype.update = function() {
            Window_Base.prototype.update.call(this);
            if (!this._skin) return;
            this._animTick += 1;
            var cycle = [0, 1, 2, 1];
            var pat = cycle[Math.floor(this._animTick / 16) % 4];
            if (pat !== this._lastPattern) {
                this._lastPattern = pat;
                this.refresh();
            }
        };

        Window_BlackAISkinPreview.prototype.refresh = function() {
            this.contents.clear();
            if (!this._skin) return;
            var skin = this._skin;
            var cw = this.contentsWidth();
            var ch = this.contentsHeight();
            var cur = (st.player_skin || 'default') === skin.id;

            // 头部头像与名称标签
            if (skin.faceName && this._faceBitmap && this._faceBitmap.isReady()) {
                this.drawFace(skin.faceName, skin.faceIndex, 24, 22, 144, 144);
            }
            this.changeTextColor(this.systemColor());
            this.drawText(skin.subtitle + (cur ? '  [当前使用中]' : ''), 192, 26, cw - 208);
            this.resetTextColor();
            this.contents.fontSize = 26;
            this.drawText(skin.name, 192, 62, cw - 208);
            this.contents.fontSize = this.standardFontSize();
            this.drawText('状态：全外观已解锁（随时可换）', 192, 112, cw - 208);

            // 中部：4 方向像素行走图动态预览
            var bmp = this._charBitmap;
            if (bmp && bmp.isReady()) {
                var isBig = ImageManager.isBigCharacter(skin.characterName);
                var pw = bmp.width / (isBig ? 3 : 12);
                var ph = bmp.height / (isBig ? 4 : 8);
                var blockX = isBig ? 0 : (skin.characterIndex % 4) * 3 * pw;
                var blockY = isBig ? 0 : Math.floor(skin.characterIndex / 4) * 4 * ph;
                var pat = this._lastPattern >= 0 ? this._lastPattern : 1;

                var boxY = 192;
                var boxH = 224;
                this.contents.fillRect(24, boxY, cw - 48, boxH, 'rgba(18, 22, 34, 0.72)');
                var scale = 1.5;
                var dw = Math.round(pw * scale);
                var dh = Math.round(ph * scale);
                var dirs = [
                    { row: 0, label: '正面' },
                    { row: 1, label: '向左' },
                    { row: 2, label: '向右' },
                    { row: 3, label: '背面' }
                ];
                var stepX = Math.floor((cw - 64) / 4);
                for (var i = 0; i < dirs.length; i++) {
                    var sx = blockX + pat * pw;
                    var sy = blockY + dirs[i].row * ph;
                    var dx = 32 + i * stepX + Math.floor((stepX - dw) / 2);
                    var dy = boxY + 20 + Math.floor((156 - dh) / 2);
                    this.contents.blt(bmp, sx, sy, pw, ph, dx, dy, dw, dh);
                    this.changeTextColor(this.systemColor());
                    this.drawText(dirs[i].label, 32 + i * stepX, boxY + 178, stepX, 'center');
                    this.resetTextColor();
                }
            }

            // 底部提示
            this.changeTextColor(this.systemColor());
            this.drawText('Enter / 点击 确认切换外观    |    Esc 返回    |    地图按 Tab 随时呼出', 24, ch - 46, cw - 48, 'center');
            this.resetTextColor();
        };

        function Scene_BlackAISkin() {
            this.initialize.apply(this, arguments);
        }
        Scene_BlackAISkin.prototype = Object.create(Scene_MenuBase.prototype);
        Scene_BlackAISkin.prototype.constructor = Scene_BlackAISkin;

        Scene_BlackAISkin.prototype.create = function() {
            Scene_MenuBase.prototype.create.call(this);
            this.createHelpWindow();
            var topY = this._helpWindow.height;
            var bodyH = Graphics.boxHeight - topY;
            var listW = 450;
            this._listWindow = new Window_BlackAISkinList(0, topY, listW, bodyH);
            this._listWindow.setHelpWindow(this._helpWindow);
            this._listWindow.setHandler('selectSkin', this.onSkinOk.bind(this));
            this._listWindow.setHandler('cancel', this.popScene.bind(this));
            this.addWindow(this._listWindow);

            this._previewWindow = new Window_BlackAISkinPreview(listW, topY, Graphics.boxWidth - listW, bodyH);
            this.addWindow(this._previewWindow);
            this._listWindow.setPreviewWindow(this._previewWindow);
        };

        Scene_BlackAISkin.prototype.onSkinOk = function() {
            var skin = this._listWindow.currentExt();
            if (skin) {
                applyPlayerSkin(skin.id, false);
            }
            this.popScene();
        };

        window.Scene_BlackAISkin = Scene_BlackAISkin;

        // 入口 1：原生主菜单（Esc）新增「切换外观」
        var _addOriginalCommands = Window_MenuCommand.prototype.addOriginalCommands;
        Window_MenuCommand.prototype.addOriginalCommands = function() {
            _addOriginalCommands.call(this);
            this.addCommand('切换外观', 'blackaiSkin', true);
        };

        var _createMenuCommands = Scene_Menu.prototype.createCommandWindow;
        Scene_Menu.prototype.createCommandWindow = function() {
            _createMenuCommands.call(this);
            this._commandWindow.setHandler('blackaiSkin', openSkinMenu);
        };

        // 入口 2：地图按 Tab 键随时呼出「切换外观」（序章 Map001 铁笼演出期间不抢焦点）
        var _updateMapScene = Scene_Map.prototype.updateScene;
        Scene_Map.prototype.updateScene = function() {
            _updateMapScene.call(this);
            if (!SceneManager.isSceneChanging() &&
                !$gameMap.isEventRunning() &&
                $gameMap.mapId() !== 1 &&
                Input.isTriggered('affection')) {
                SoundManager.playOk();
                openSkinMenu();
            }
        };
    }
})();
