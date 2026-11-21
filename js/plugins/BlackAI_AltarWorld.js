/*:
 * @plugindesc 《BLACK AI》Map001 巨型电源圣坛世界协调器（大 PSU 正背面交互、7 AI 娘对话/拔刀、6 暗影怪遇敌/刷新与调试补给）
 * @author BLACK AI Team
 * @help
 * 统一衔接 Map001 事件与 BlackAI_Core / Explore / PSU / Dialogue / BattleUI。
 */

(function(globalScope) {
    'use strict';

    var BlackAI = globalScope.BlackAI || {};
    globalScope.BlackAI = BlackAI;

    var World = {
        _enemyCooldowns: {},
        _heroineIndexMap: {
            big_fish: 0,
            small_fish: 1,
            true_c: 2,
            fake_c: 3,
            astra: 4,
            sol: 5,
            gemini_cat: 6
        },

        showHudNotice: function(msg, duration) {
            if (BlackAI.Explore) {
                BlackAI.Explore.showNotice(msg, duration);
            }
        },

        // ---------------------------------------------------------------- 事件交互入口

        onPsuFrontInteract: function() {
            SoundManager.playOk();
            SceneManager.push(BlackAI.Scene_Psu);
        },

        onPsuBackSwitchInteract: function() {
            var maxPress = BlackAI.Data.getConfigInt('psu.back_switch_max_presses', 3);
            BlackAI.State.psu_back_switch_presses += 1;
            var cur = BlackAI.State.psu_back_switch_presses;
            if (cur >= maxPress) {
                SoundManager.playBuzzer();
                SceneManager.push(BlackAI.Scene_PowerOffEgg);
            } else if (cur === 1) {
                SoundManager.playCancel();
                this.showHudNotice('你按了一下背面红色物理总开关 [I / O]……大 PSU 风扇猛抖了一下。（1 / ' + maxPress + '）', 3.2);
            } else {
                SoundManager.playBuzzer();
                this.showHudNotice('大 PSU 爆出电火花发出刺耳嗡鸣！再按一次就要彻底断电了！（' + cur + ' / ' + maxPress + '）', 3.4);
            }
        },

        onHeroineInteract: function(characterId) {
            if (!BlackAI.State.isCharacterAlive(characterId)) {
                return;
            }
            SoundManager.playOk();
            BlackAI.Scene_Dialogue.openForCharacter(characterId, 'start');
        },

        onEnemyTouch: function(monsterId, eventId) {
            if (!this._isMonsterActive(monsterId)) {
                return;
            }
            if ((this._enemyCooldowns[eventId] || 0) > 0) {
                return;
            }
            SoundManager.playBattleStart();
            BlackAI.Scene_Battle.startBattle({
                targetId: monsterId,
                isHeroineBoss: false,
                eventId: eventId,
                isPreemptive: false
            });
        },

        startHeroineBossBattle: function(characterId, isPreemptive, replaceScene) {
            if (!BlackAI.State.isCharacterAlive(characterId)) {
                return;
            }
            var evId = this._findEventIdByMeta('heroine', characterId);
            SoundManager.playBattleStart();
            BlackAI.Scene_Battle.startBattle({
                targetId: characterId,
                isHeroineBoss: true,
                eventId: evId,
                isPreemptive: Boolean(isPreemptive)
            }, replaceScene);
        },

        onPlayerMeleeSlash: function(aimAngle) {
            if (!$gameMap || !$gamePlayer) {
                return;
            }
            var px = $gamePlayer._realX + 0.5;
            var py = $gamePlayer._realY + 0.5;
            var ax = Math.cos(aimAngle);
            var ay = Math.sin(aimAngle);
            var maxRangeTiles = 1.9;

            var events = $gameMap.events();
            var bestEnemy = null;
            var bestEnemyDist = 999;
            var bestNpc = null;
            var bestNpcDist = 999;

            for (var i = 0; i < events.length; i++) {
                var ev = events[i];
                if (!ev || ev.isTransparent()) {
                    continue;
                }
                var meta = ev.event().meta || {};
                var dx = (ev._realX + 0.5) - px;
                var dy = (ev._realY + 0.5) - py;
                var dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > maxRangeTiles) {
                    continue;
                }
                if (dist > 0.95) {
                    var dot = (dx * ax + dy * ay) / dist;
                    if (dot < 0.10) {
                        continue;
                    }
                }
                if (meta.blackai_type === 'enemy' && meta.blackai_id) {
                    var mid = String(meta.blackai_id);
                    if (this._isMonsterActive(mid) && dist < bestEnemyDist) {
                        bestEnemyDist = dist;
                        bestEnemy = { id: mid, eventId: ev.eventId() };
                    }
                } else if (meta.blackai_type === 'heroine' && meta.blackai_id) {
                    var cid = String(meta.blackai_id);
                    if (BlackAI.State.isCharacterAlive(cid) && dist < bestNpcDist) {
                        bestNpcDist = dist;
                        bestNpc = { id: cid, eventId: ev.eventId() };
                    }
                }
            }

            if (bestEnemy) {
                SoundManager.playBattleStart();
                BlackAI.Scene_Battle.startBattle({
                    targetId: bestEnemy.id,
                    isHeroineBoss: false,
                    eventId: bestEnemy.eventId,
                    isPreemptive: true
                });
                return;
            }
            if (bestNpc) {
                this.startHeroineBossBattle(bestNpc.id, true);
            }
        },

        onBattleFinished: function(outcome, targetId, isHeroineBoss, eventId) {
            var name = isHeroineBoss
                ? BlackAI.Data.getCharacterName(targetId)
                : String(BlackAI.Data.getMonster(targetId).name || targetId);

            if (outcome === 'victory') {
                if (isHeroineBoss) {
                    this.showHudNotice('Boss 击杀：【' + name + '】已从当前局消失并写入 GlobalMemory，大 PSU 红灯报警！', 4.6);
                } else {
                    BlackAI.State.defeated_world_enemies[targetId] = true;
                    this.showHudNotice('战斗胜利！已击败【' + name + '】并无缝返回原坐标。', 3.4);
                }
            } else if (outcome === 'escaped') {
                if (!isHeroineBoss && eventId) {
                    this._enemyCooldowns[eventId] = 2.5;
                }
                this.showHudNotice('已脱离与【' + name + '】的战斗，返回原地。', 2.8);
            } else if (outcome === 'defeat') {
                var st = BlackAI.State;
                var revHp = Math.max(50, Math.floor(st.getEffectiveMaxHp() * 0.5));
                st.setHp(revHp);
                st.setToken(st.max_token);
                var safeCtx = BlackAI.Data.getConfigInt('context.psu_restore_to', 80);
                if (st.context < safeCtx) {
                    st.setContext(safeCtx);
                }
                if ($gamePlayer) {
                    $gamePlayer.locate(16, 12);
                    $gamePlayer.setDirection(8);
                }
                if ($gameMap) {
                    var evs = $gameMap.events();
                    for (var i = 0; i < evs.length; i++) {
                        if (evs[i]) {
                            this._enemyCooldowns[evs[i].eventId()] = 2.0;
                        }
                    }
                }
                this.showHudNotice('战斗败北……你被供电线拖回巨型大 PSU 电源前重新苏醒。', 4.2);
            }

            this.syncMapEvents();
        },

        // ---------------------------------------------------------------- 地图事件同步与靠近提示

        _isMonsterActive: function(monsterId) {
            if (BlackAI.State.defeated_world_enemies[monsterId]) {
                return false;
            }
            if (monsterId === 'undefined_shade' && !BlackAI.State.isContextOverflow()) {
                return false;
            }
            return true;
        },

        _findEventIdByMeta: function(type, id) {
            if (!$gameMap) {
                return 0;
            }
            var evs = $gameMap.events();
            for (var i = 0; i < evs.length; i++) {
                var ev = evs[i];
                if (!ev) {
                    continue;
                }
                var meta = ev.event().meta || {};
                if (meta.blackai_type === type && String(meta.blackai_id) === id) {
                    return ev.eventId();
                }
            }
            return 0;
        },

        syncMapEvents: function() {
            if (!$gameMap) {
                return;
            }
            var alarm = BlackAI.State.isContextOverflow() || BlackAI.State.hasAnyCoreHeroineKilled();
            var evs = $gameMap.events();
            for (var i = 0; i < evs.length; i++) {
                var ev = evs[i];
                if (!ev) {
                    continue;
                }
                var meta = ev.event().meta || {};
                if (meta.blackai_psu_visual) {
                    ev.setDirectionFix(false);
                    ev.setDirection(alarm ? 4 : 2);
                    ev.setDirectionFix(true);
                } else if (meta.blackai_type === 'heroine' && meta.blackai_id) {
                    var cid = String(meta.blackai_id);
                    var alive = BlackAI.State.isCharacterAlive(cid);
                    ev.setTransparent(!alive);
                    ev.setThrough(!alive);
                    if (alive) {
                        var ov = BlackAI.State.isContextOverflow() || BlackAI.State.getAffection(cid) >= 101;
                        var sheet = ov ? 'BlackAI_Heroines_Overflow' : 'BlackAI_Heroines';
                        var idx = this._heroineIndexMap[cid] !== undefined ? this._heroineIndexMap[cid] : 0;
                        ev.setImage(sheet, idx);
                    }
                } else if (meta.blackai_type === 'enemy' && meta.blackai_id) {
                    var mid = String(meta.blackai_id);
                    var active = this._isMonsterActive(mid);
                    ev.setTransparent(!active);
                    ev.setThrough(!active);
                }
            }
        },

        updateWorldTick: function() {
            var keys = Object.keys(this._enemyCooldowns);
            for (var i = 0; i < keys.length; i++) {
                var k = keys[i];
                this._enemyCooldowns[k] = Math.max(0, this._enemyCooldowns[k] - 1 / 60);
                if (this._enemyCooldowns[k] === 0) {
                    delete this._enemyCooldowns[k];
                }
            }
            this._updateProximityPrompt();
        },

        _updateProximityPrompt: function() {
            if (!$gameMap || !$gamePlayer || !BlackAI.Explore) {
                return;
            }
            var px = $gamePlayer.x;
            var py = $gamePlayer.y;

            // 大 PSU 正面（南侧 y=10, x=15..17）
            if (py === 10 && px >= 15 && px <= 17) {
                var alarmTag = (BlackAI.State.isContextOverflow() || BlackAI.State.hasAnyCoreHeroineKilled()) ? ' [⚠ 红灯报警]' : '';
                BlackAI.Explore.promptText = '[E] 打开【巨型大 PSU 电源】据点菜单（清理缓存 / 升级 HP / 整理装备 / 存读档）' + alarmTag;
                return;
            }
            // 大 PSU 背面红色物理总开关（北侧 y=7, x=16）
            if (py === 7 && px === 16) {
                var maxP = BlackAI.Data.getConfigInt('psu.back_switch_max_presses', 3);
                BlackAI.Explore.promptText = '[E] 按动背面红色物理总开关 [I / O]（已按 ' + BlackAI.State.psu_back_switch_presses + ' / ' + maxP + ' 次……）';
                return;
            }

            // 最近存活核心 AI 娘
            var evs = $gameMap.events();
            var bestCid = '';
            var bestDist = 1.6;
            for (var i = 0; i < evs.length; i++) {
                var ev = evs[i];
                if (!ev || ev.isTransparent()) {
                    continue;
                }
                var meta = ev.event().meta || {};
                if (meta.blackai_type === 'heroine' && meta.blackai_id) {
                    var cid = String(meta.blackai_id);
                    if (!BlackAI.State.isCharacterAlive(cid)) {
                        continue;
                    }
                    var d = Math.sqrt(Math.pow(ev.x - px, 2) + Math.pow(ev.y - py, 2));
                    if (d <= bestDist) {
                        bestDist = d;
                        bestCid = cid;
                    }
                }
            }
            if (bestCid) {
                var aff = BlackAI.State.getAffection(bestCid);
                var tier = BlackAI.State.getAffectionTier(bestCid).name || '初见';
                var ovStr = (BlackAI.State.isContextOverflow() || aff >= 101) ? ' [里世界态]' : '';
                BlackAI.Explore.promptText = '[E] 对话/拔刀【' + BlackAI.Data.getCharacterName(bestCid) + '】· 左键/J 先手（好感 ' + aff + '% · ' + tier + '）' + ovStr;
            } else {
                BlackAI.Explore.promptText = '';
            }
        },

        // ---------------------------------------------------------------- 调试工具集（M2–M6）

        toggleContextOverflowDebug: function() {
            if (BlackAI.State.isContextOverflow()) {
                var safe = BlackAI.Data.getConfigInt('context.psu_restore_to', 80);
                BlackAI.State.setContext(safe);
                this.showHudNotice('上下文恢复至 ' + safe + '% — 表世界稳定，西南角未定义黑影消退', 3.0);
            } else {
                BlackAI.State.setContext(15);
                this.showHudNotice('上下文降至 15% — 里世界溢出！血字、暗角与西南角【未定义黑影】显现！', 3.4);
            }
            this.syncMapEvents();
        },

        grantM3Kit: function() {
            var st = BlackAI.State;
            st.addWeightShards(50);
            st.addItem('ram_knife', 1);
            st.addItem('integrity_case', 1);
            st.addItem('dual_tower_air', 1);
            st.addItem('prompt_catgirl', 1);
            st.addItem('thermal_paste', 2);
            st.addItem('black_tape', 2);
            this.showHudNotice('M3 调试补给已发放：碎片 +50 与四槽示例装备、消耗品。', 3.6);
        },

        grantM4GpuKit: function() {
            var st = BlackAI.State;
            st.addItem('gpu_580', 5);
            st.addItem('gpu_10600', 3);
            st.addItem('gpu_20600', 3);
            st.addItem('gpu_50900', 4);
            st.addItem('gpu_huawei', 4);
            st.addItem('gpu_600900', 1);
            this.showHudNotice('M4 测试显卡已发放：580×5 / 10600×3 / 20600×3 / 50900×4 / 华为×4 / 600900×1', 4.0);
        },

        grantM5BattleKit: function() {
            var st = BlackAI.State;
            var kit = [
                ['ram_knife', 1], ['ssd_sword', 1], ['water', 5], ['cement_resistor', 5], ['bulging_capacitor', 3],
                ['thermal_paste', 3], ['compressed_air', 3], ['cmos_battery', 3], ['alcohol_wipe', 3],
                ['black_tape', 4], ['wd40', 3], ['gpu_580', 3],
                ['integrity_case', 1], ['shoebox_open_case', 1], ['rusty_iron_case', 1],
                ['tempered_glass_case', 1], ['rog_case', 1],
                ['stock_fan', 1], ['dual_tower_air', 1], ['leaky_water_cooler', 1], ['aio_360', 1], ['ln2_cannon', 1]
            ];
            for (var i = 0; i < kit.length; i++) {
                st.addItem(kit[i][0], kit[i][1]);
            }
            this.showHudNotice('M5 全套战斗硬件测试包已入库！请在大 PSU 正面「整理装备 / 背包」换装。', 4.4);
        },

        drainTokenDebug: function() {
            BlackAI.State.setToken(10);
            this.showHudNotice('调试：Token 已降至 10 / ' + BlackAI.State.max_token + '，开战强放技能可验【输出截断】！', 3.6);
        },

        prepM6AssistDebug: function() {
            var targets = ['fake_c', 'small_fish'];
            for (var i = 0; i < targets.length; i++) {
                var cid = targets[i];
                var cur = BlackAI.State.getAffection(cid);
                if (cur < 75) {
                    BlackAI.State.addAffection(cid, 75 - cur, false);
                }
            }
            if (BlackAI.State.isCharacterAlive('fake_c')) {
                BlackAI.State.setAssistPartner('fake_c');
                this.showHudNotice('调试：假小 C / 小肥鱼好感已升至 ≥75%，已自动将【假小 C】设为 API 并发助战！', 4.2);
            } else if (BlackAI.State.isCharacterAlive('small_fish')) {
                BlackAI.State.setAssistPartner('small_fish');
                this.showHudNotice('调试：假小 C / 小肥鱼好感已升至 ≥75%，已自动将【小肥鱼】设为 API 并发助战！', 4.2);
            } else {
                this.showHudNotice('调试：好感已拉高，但假小 C 与小肥鱼当前局已阵亡，请先复活核心 AI 娘。', 3.8);
            }
            this.syncMapEvents();
        },

        reviveAllHeroinesDebug: function() {
            for (var i = 0; i < BlackAI.State.CORE_HEROINE_IDS.length; i++) {
                BlackAI.State.reviveCharacter(BlackAI.State.CORE_HEROINE_IDS[i]);
            }
            this.syncMapEvents();
            this.showHudNotice('调试：已恢复全部 7 位核心 AI 娘当前局存活状态（GlobalMemory 跨存档击杀记录保留）。', 3.8);
        },

        toggleBigFishKillDebug: function() {
            if (BlackAI.State.isCharacterAlive('big_fish')) {
                BlackAI.State.killCharacter('big_fish');
                this.showHudNotice('调试：已标记击杀大肥鱼 → 大 PSU 红灯报警并爆电火花！', 3.4);
            } else {
                BlackAI.State.reviveCharacter('big_fish');
                this.showHudNotice('调试：已恢复大肥鱼当前局存活状态。', 3.0);
            }
            this.syncMapEvents();
        }
    };

    BlackAI.World = World;

    // 绑定状态事件实时同步地图精灵
    BlackAI.State.on('context_changed', function() { World.syncMapEvents(); });
    BlackAI.State.on('character_killed', function() { World.syncMapEvents(); });
    BlackAI.State.on('character_revived', function() { World.syncMapEvents(); });
    BlackAI.State.on('affection_changed', function() { World.syncMapEvents(); });
    BlackAI.State.on('world_enemies_respawn_requested', function() { World.syncMapEvents(); });
    BlackAI.State.on('save_loaded', function() { World.syncMapEvents(); });

    var _Scene_Map_start = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function() {
        _Scene_Map_start.call(this);
        World.syncMapEvents();
    };

    var _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function() {
        _Scene_Map_update.call(this);
        World.updateWorldTick();
    };

    // 邻近智能 E 交互：即使玩家未严格正对目标，只要已显示 [E] 交互提示即可直接触发
    var _Game_Player_triggerButtonAction = Game_Player.prototype.triggerButtonAction;
    Game_Player.prototype.triggerButtonAction = function() {
        if (_Game_Player_triggerButtonAction.call(this)) {
            return true;
        }
        if (Input.isTriggered('ok') && $gameMap && !$gameMap.isEventRunning()) {
            var px = this.x;
            var py = this.y;
            if (py === 10 && px >= 15 && px <= 17) {
                World.onPsuFrontInteract();
                return true;
            }
            if (py === 7 && px === 16) {
                World.onPsuBackSwitchInteract();
                return true;
            }
            var evs = $gameMap.events();
            var bestCid = '';
            var bestDist = 1.6;
            for (var i = 0; i < evs.length; i++) {
                var ev = evs[i];
                if (!ev || ev.isTransparent()) {
                    continue;
                }
                var meta = ev.event().meta || {};
                if (meta.blackai_type === 'heroine' && meta.blackai_id) {
                    var cid = String(meta.blackai_id);
                    if (!BlackAI.State.isCharacterAlive(cid)) {
                        continue;
                    }
                    var d = Math.sqrt(Math.pow(ev.x - px, 2) + Math.pow(ev.y - py, 2));
                    if (d <= bestDist) {
                        bestDist = d;
                        bestCid = cid;
                    }
                }
            }
            if (bestCid) {
                World.onHeroineInteract(bestCid);
                return true;
            }
        }
        return false;
    };
})(typeof window !== 'undefined' ? window : global);
