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

    function startTalk(interpreter, id, section) {
        var character = B.Data.getCharacter(id);
        var faceIndex = character.face_index;
        var face = Number.isInteger(faceIndex) ? 'BlackAI_AltarCast' : (id === 'big_fish' ? 'DualCoreCast' : '');
        var runner = new B.DialogueRunner({
            onLine: function(speaker, text) {
                $gameMessage.setFaceImage(face, faceIndex || 0);
                $gameMessage.setPositionType(2);
                $gameMessage.setBackground(0);
                var available = face ? 29 : 35;
                var body = Array.from(text);
                var lines = [];
                while (body.length) lines.push(body.splice(0, available).join(''));
                while (lines.length) {
                    var first = [speaker].concat(lines.splice(0, 3)).join('\n');
                    $gameMessage.add(first);
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
                if (action === 'open_gift') gift(interpreter, id);
            }
        });
        runner.start(B.loadDialogueDoc(id), section, id);
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
        if (args[1] === 'Talk') startTalk(this, args[2], 'start');
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
})();
