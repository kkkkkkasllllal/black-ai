/*:
 * @plugindesc BLACK AI 原生 MV 战斗及队伍数据桥接
 * @help 地图的「战斗处理」事件使用 MV 的敌群、战斗场景、技能及道具窗口。
 */
(function() {
    'use strict';
    var B = window.BlackAI;
    var st = B.State;
    var actorId = 1;
    var inventoryRows = null;

    function itemId(row) {
        return row && row.meta && row.meta.blackai_id;
    }

    function records() {
        if (!inventoryRows) {
            inventoryRows = $dataItems.filter(itemId).concat($dataWeapons.filter(function(row) {
                var id = itemId(row);
                return id && B.Data.getItem(id).slot === 'main';
            }), $dataArmors.filter(itemId));
        }
        return inventoryRows;
    }

    function actor() { return $gameActors.actor(actorId); }
    function managed(battler) { return battler.isActor() && battler.actorId() === actorId; }
    function supplies() { return B.Data.getConfigInt('combat.token_regen_per_turn', 10); }

    function toEngine() {
        var member = actor();
        var rows = records();
        st.EQUIPMENT_SLOTS.forEach(function(slot, i) {
            var id = st.equipment[slot];
            var item = rows.find(function(row) { return itemId(row) === id; }) || null;
            if (member.equips()[i] !== item) {
                member.forceChangeEquip(i, item);
            }
        });
        rows.forEach(function(row) {
            $gameParty.gainItem(row, st.getItemCount(itemId(row)) - $gameParty.numItems(row));
        });
        $gameParty.gainGold(st.weight_shards - $gameParty.gold());
        member.setHp(st.hp);
        member.setMp(st.token);
        if (B.MVScenes && B.MVScenes.applyPlayerSkin) {
            B.MVScenes.applyPlayerSkin(st.player_skin || 'default', true);
        }
    }

    function fromEngine() {
        var member = actor();
        records().forEach(function(row) {
            var id = itemId(row);
            var diff = $gameParty.numItems(row) - st.getItemCount(id);
            if (diff > 0) st.addItem(id, diff);
            if (diff < 0) st.removeItem(id, -diff);
        });
        var equipment = member.equips();
        st.EQUIPMENT_SLOTS.forEach(function(slot, i) {
            st.equipment[slot] = itemId(equipment[i]) || '';
        });
        st.addWeightShards($gameParty.gold() - st.weight_shards);
        st.setHp(member.hp);
        st.setToken(member.mp);
    }

    B.NativeParty = { toEngine: toEngine, fromEngine: fromEngine };

    var paramBase = Game_Actor.prototype.paramBase;
    Game_Actor.prototype.paramBase = function(id) {
        if (managed(this) && B.Data.isLoaded) {
            if (id === 0) return st.base_max_hp;
            if (id === 1) return st.max_token;
        }
        return paramBase.call(this, id);
    };

    var paramMax = Game_Actor.prototype.paramMax;
    Game_Actor.prototype.paramMax = function(id) {
        if (managed(this) && B.Data.isLoaded && id === 0) {
            return B.Data.getConfigInt('player.max_hp_cap', 400);
        }
        return paramMax.call(this, id);
    };

    var paramPlus = Game_Actor.prototype.paramPlus;
    Game_Actor.prototype.paramPlus = function(id) {
        var total = paramPlus.call(this, id);
        var chassis = managed(this) && st.is_case_broken && this.equips()[1];
        return id === 3 && chassis ? total - chassis.params[3] : total;
    };

    function mapSync() {
        if (B.MVScenes) B.MVScenes.refreshEntities();
    }

    var mapStart = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function() {
        mapStart.call(this);
        toEngine();
        mapSync();
    };

    function syncOnClose(sceneClass) {
        var terminate = sceneClass.prototype.terminate;
        sceneClass.prototype.terminate = function() {
            fromEngine();
            terminate.call(this);
        };
    }
    syncOnClose(Scene_Item);
    syncOnClose(Scene_Skill);
    syncOnClose(Scene_Equip);
    syncOnClose(Scene_Shop);
    var equipChange = Game_Actor.prototype.changeEquip;
    Game_Actor.prototype.changeEquip = function(slot, item) {
        equipChange.call(this, slot, item);
        if (managed(this) && this.equips()[slot] === item && st.EQUIPMENT_SLOTS[slot]) {
            st.equipment[st.EQUIPMENT_SLOTS[slot]] = itemId(item) || '';
        }
    };

    var saveOk = Scene_Save.prototype.onSavefileOk;
    Scene_Save.prototype.onSavefileOk = function() {
        fromEngine();
        saveOk.call(this);
    };

    function artEnemy() {
        var members = $gameTroop.members();
        return members.find(function(enemy) {
            var meta = enemy.enemy().meta;
            return meta.blackai_monster_id || meta.blackai_boss_id;
        });
    }

    function addLog(message) {
        if (BattleManager._logWindow) BattleManager._logWindow.push('addText', message);
    }

    function isNativeBattle() { return Boolean(BattleManager._blackaiNative && $gameParty.inBattle()); }

    var setup = BattleManager.setup;
    BattleManager.setup = function(troopId, canEscape, canLose) {
        setup.call(this, troopId, canEscape, canLose);
        var enemy = artEnemy();
        this._blackaiNative = Boolean(enemy);
        this._blackaiNoEscape = Boolean(enemy && enemy.enemy().meta.blackai_boss_id && st.isContextOverflow());
        if (this._blackaiNative) toEngine();
        if (this._blackaiNoEscape) this._canEscape = false;
    };

    var startBattle = BattleManager.startBattle;
    BattleManager.startBattle = function() {
        startBattle.call(this);
        if (this._blackaiNoEscape) addLog('【里世界溢出】' + artEnemy().name() + '封死退路。');
    };

    var endBattle = BattleManager.endBattle;
    BattleManager.endBattle = function(result) {
        if (this._blackaiNative) {
            fromEngine();
            st.repairGlassCase();
            var enemy = artEnemy();
            if (enemy && result === 0) {
                var meta = enemy.enemy().meta;
                if (meta.blackai_boss_id) {
                    st.killCharacter(meta.blackai_boss_id);
                } else {
                    st.defeated_world_enemies[meta.blackai_monster_id] = true;
                }
            }
        }
        endBattle.call(this, result);
        this._blackaiNative = false;
    };

    var turnEnd = Game_Battler.prototype.onTurnEnd;
    Game_Battler.prototype.onTurnEnd = function() {
        turnEnd.call(this);
        if (isNativeBattle() && this.isAlive()) this.gainMp(supplies());
    };

    function canForce(battler, skill) {
        var cost = battler.skillMpCost(skill);
        return isNativeBattle() && cost > battler.mp && battler.mp < battler.mmp * 0.2 && cost >= battler.mmp * 0.2;
    }
    var canPay = Game_BattlerBase.prototype.canPaySkillCost;
    Game_BattlerBase.prototype.canPaySkillCost = function(skill) {
        return canPay.call(this, skill) || (this.tp >= this.skillTpCost(skill) && canForce(this, skill));
    };

    var pay = Game_BattlerBase.prototype.paySkillCost;
    Game_BattlerBase.prototype.paySkillCost = function(skill) {
        var force = canForce(this, skill);
        var cut = force && Math.random() < 0.65;
        this._blackaiCutSkill = cut ? skill.id : 0;
        if (force) {
            this.setMp(0);
            this.gainTp(-this.skillTpCost(skill));
        } else {
            pay.call(this, skill);
        }
        if (cut) {
            var spec = B.Data.getPlayerSkill(skill.meta.blackai_skill_id);
            addLog('【输出截断】' + this.name() + '：' + (spec.truncated_line || '「我将——」[输出中断]'));
        }
    };

    function statusId(name) {
        var row = $dataStates.find(function(entry) { return entry && entry.meta.blackai_status === name; });
        return row ? row.id : 0;
    }

    function isCut(action) {
        return action.isSkill() && action.subject()._blackaiCutSkill === action.item().id;
    }
    var applyGlobal = Game_Action.prototype.applyGlobal;
    Game_Action.prototype.applyGlobal = function() {
        if (!isCut(this)) applyGlobal.call(this);
    };

    var testApply = Game_Action.prototype.testApply;
    Game_Action.prototype.testApply = function(target) {
        var id = this.isItem() && itemId(this.item());
        if (id && this.item().occasion !== 3 && B.Data.getItem(id).use_effects && target.isAlive()) {
            return true;
        }
        return testApply.call(this, target);
    };

    function applyHardware(target, id) {
        var spec = B.Data.getItem(id);
        if (id === 'water' && target.isEnemy() && target.enemy().meta.ai_unit) {
            var water = spec.effects.find(function(effect) { return effect.type === 'ai_crash'; });
            if (target.enemy().meta.blackai_monster_id && Math.random() < water.instakill_chance) {
                target.gainHp(-target.hp);
            } else if (target.isAlive()) {
                target.addState(statusId('crash'));
            }
            addLog('【AI 宕机】' + target.name() + '的电路进水短路。');
        } else if (id === 'cement_resistor' && target.isAlive()) {
            target.addState(statusId('throttled'));
        } else if (id === 'bulging_capacitor' && target.isAlive()) {
            var cap = spec.effects.find(function(effect) { return effect.type === 'aoe_lightning'; });
            if (Math.random() < cap.stun_chance) target.addState(statusId('short_circuit'));
        }
        if (target.isActor()) {
            (spec.use_effects || []).forEach(function(effect) {
                if (effect.type === 'restore_context') st.changeContext(effect.amount);
                if (effect.type === 'repair_case' && st.repairGlassCase()) addLog('【黑胶带】已修补侧透玻璃机箱。');
                if (effect.type === 'cure_status') {
                    if (effect.statuses.indexOf('all') >= 0) target.clearStates();
                    else effect.statuses.forEach(function(name) { target.removeState(statusId(name)); });
                }
            });
            target.result().success = true;
        }
    }

    var apply = Game_Action.prototype.apply;
    Game_Action.prototype.apply = function(target) {
        if (isCut(this)) {
            target.clearResult();
            return;
        }
        apply.call(this, target);
        if (!target.result().isHit()) return;
        if (this.isItem() && itemId(this.item())) {
            applyHardware(target, itemId(this.item()));
        } else if (this.isSkill() && isNativeBattle()) {
            var id = this.item().meta.blackai_skill_id;
            var skill = target.isActor() ? B.Data.getEnemySkill(id) : {};
            if (skill.context_damage) st.changeContext(-skill.context_damage);
            if (id === 'context_focus' && this.subject().isActor()) {
                st.changeContext(B.Data.getPlayerSkill(id).restore_context);
            }
            if (id === 'steal_gpu_580' && target.isActor()) {
                var chassis = itemId(target.equips()[1]);
                if (chassis === 'integrity_case') {
                    addLog('【廉政机箱】拦下了抢卡。');
                } else {
                    var gpu = records().find(function(row) { return itemId(row) === 'gpu_580'; });
                    if ($gameParty.numItems(gpu) > 0) {
                        $gameParty.loseItem(gpu, 1);
                        addLog(artEnemy().name() + '夺走了一张 580 矿卡。');
                    }
                }
            }
        }
        if (target.isActor() && isNativeBattle() && !st.is_case_broken &&
            itemId(target.equips()[1]) === 'tempered_glass_case') {
            var threshold = B.Data.getItem('tempered_glass_case').effects.find(function(effect) {
                return effect.type === 'glass_break';
            }).threshold;
            if (target.result().hpDamage > threshold) {
                st.breakGlassCase();
                addLog('【玻璃碎裂】侧透机箱的防御归零。');
            }
        }
        if (isNativeBattle() && !BattleManager._blackaiNoEscape && artEnemy().enemy().meta.blackai_boss_id &&
            st.isContextOverflow()) {
            BattleManager._blackaiNoEscape = true;
            BattleManager._canEscape = false;
            addLog('【里世界溢出】退路被划掉。');
        }
    };

    var crit = Game_Action.prototype.itemCri;
    Game_Action.prototype.itemCri = function(target) {
        if (isNativeBattle()) {
            if (target.isGuard()) return 0;
            var attacker = this.subject();
            if (this.isAttack() && attacker.isActor() && itemId(attacker.weapons()[0]) === 'ssd_sword' &&
                $gameTroop.turnCount() === 1) return 1;
        }
        return crit.call(this, target);
    };

    var drawPartyCommand = Window_PartyCommand.prototype.drawItem;
    Window_PartyCommand.prototype.drawItem = function(index) {
        drawPartyCommand.call(this, index);
        if (BattleManager._blackaiNoEscape && this.commandSymbol(index) === 'escape') {
            var rect = this.itemRectForText(index);
            this.contents.fillRect(rect.x, rect.y + rect.height / 2, this.textWidth(this.commandName(index)), 2, '#ff374b');
        }
    };
})();
