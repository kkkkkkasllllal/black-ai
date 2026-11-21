/*:
 * @plugindesc 《BLACK AI》M5+M6 纯逻辑 BS2 高难回合制战斗引擎（支持 6 怪物、7 AI 娘 Boss、API 并发助战与溢出 UI 破坏）
 * @author BLACK AI Team
 * @help
 * 零界面依赖，可在 RPG Maker MV 运行时与 Node.js 无头自动化测试中共同运行。
 */

(function(globalScope) {
    'use strict';

    var IS_NODE = (typeof module !== 'undefined' && module.exports && typeof window === 'undefined');
    var BlackAI = globalScope.BlackAI || (IS_NODE ? require('./BlackAI_Core.js') : {});
    globalScope.BlackAI = BlackAI;

    var STATUS_NAMES = {
        overheat: '过热',
        lag: '卡顿',
        short_circuit: '短路',
        lock: '锁死',
        frostbite: '冻伤',
        crash: 'AI宕机',
        throttled: '限流降频',
        leak: '漏液'
    };

    var TRUE_C_LOCK_CYCLE = ['skill', 'item', 'defend'];

    function BattleEngine(rngFn) {
        this._rand = (typeof rngFn === 'function') ? rngFn : Math.random;
        this._resetCommonState(false);
    }

    BattleEngine.STATUS_NAMES = STATUS_NAMES;

    BattleEngine.prototype._resetCommonState = function(isPreemptive) {
        this.turn_number = 1;
        this.phase = 'player_input'; // player_input / victory / defeat / escaped
        this.preemptive_turn = Boolean(isPreemptive);

        this.is_heroine_boss = false;
        this.is_overflow_boss = false;
        this.escape_crossed_out = false;
        this.hp_bar_glitched = false;
        this.locked_command = '';
        this.assist_cooldown = 0;
        this.boss_enraged = false;
        this.boss_rivalry_banner = '';
        this.boss_last_words = '';

        this.enemy = {};
        this.player_statuses = {};
        this.player_defending = false;
        this.player_next_turn_spd_bonus = 0;
        this.player_last_action = '';

        this.last_truncation_banner = '';
        this.last_visual_fx = '';
        this.victory_rewards = {};

        this._enemy_charge_interrupted = false;
        this._big_fish_remembered_action = '';
        this._small_fish_intercept_ready = false;
        this._fake_c_server_busy = false;
        this._fake_c_tape_snapped = false;
        this._gemini_waterproof_charges = 0;
        this._twin_partner_id = '';
        this._true_c_lock_index = 0;
    };

    BattleEngine.prototype.startMonsterBattle = function(monsterId, isPreemptive) {
        this._resetCommonState(isPreemptive);
        var Data = BlackAI.Data;
        var State = BlackAI.State;
        var mdata = Data.getMonster(monsterId);
        var stats = mdata.stats || {};
        var maxHp = Math.max(1, Math.trunc(Number(stats.hp || 60)));

        this.enemy = {
            id: monsterId,
            name: String(mdata.name || monsterId),
            title: '',
            is_boss: Boolean(mdata.is_boss),
            is_heroine: false,
            placeholder_color: String(mdata.placeholder_color || '#888888'),
            tags: Array.isArray(mdata.tags) ? mdata.tags.slice() : [],
            skills: Array.isArray(mdata.skills) ? mdata.skills.slice() : [],
            weaknesses: Array.isArray(mdata.weaknesses) ? mdata.weaknesses.slice() : [],
            immunities: Array.isArray(mdata.immunities) ? mdata.immunities.slice() : [],
            drops: Array.isArray(mdata.drops) ? JSON.parse(JSON.stringify(mdata.drops)) : [],
            weight_shards: Math.trunc(Number(mdata.weight_shards || 3)),
            hp: maxHp,
            max_hp: maxHp,
            base_atk: Math.trunc(Number(stats.atk || 22)),
            base_def: Math.trunc(Number(stats.def || 2)),
            base_spd: Math.trunc(Number(stats.spd || 8)),
            statuses: {},
            charging_skill_id: '',
            charge_def_bonus: 0,
            mode: (monsterId === 'distill_beast') ? 'deep_think' : '',
            stolen_items: {}
        };

        var logs = [];
        var bossTag = this.enemy.is_boss ? '【区域精英】' : '';
        logs.push({
            color: '#ff9a62',
            text: '遭遇' + bossTag + '【' + this.enemy.name + '】！（HP ' + maxHp + ' / ATK ' + this.enemy.base_atk + ' / DEF ' + this.enemy.base_def + ' / SPD ' + this.enemy.base_spd + '）'
        });
        if (isPreemptive) {
            logs.push({ color: '#7ce8ff', text: '主动拔刀先手！第 1 回合由你优先行动！' });
        }
        if (State.hasEquippedEffect('aggro_up')) {
            logs.push({ color: '#ff6ef2', text: '【败家之眼机箱】RGB 光污染拉满，敌方仇恨锁定！' });
        }
        return logs;
    };

    BattleEngine.prototype.startHeroineBossBattle = function(characterId, isPreemptive) {
        this._resetCommonState(isPreemptive);
        var Data = BlackAI.Data;
        var State = BlackAI.State;
        var GM = BlackAI.GlobalMemory;

        this.is_heroine_boss = true;
        this.is_overflow_boss = State.isContextOverflow();

        var ch = Data.getCharacter(characterId);
        var prof = Data.getBossProfile(characterId);
        var bstats = ch.boss_stats || {};
        var mult = this.is_overflow_boss ? 1.15 : 1.0;

        var maxHp = Math.max(100, Math.round(Number(bstats.hp || 420) * mult));
        var baseAtk = Math.max(15, Math.round(Number(bstats.atk || 30) * mult));
        var baseDef = Math.trunc(Number(bstats.def || 10));
        var baseSpd = Math.trunc(Number(bstats.spd || 12));

        this.enemy = {
            id: characterId,
            name: String(ch.name || characterId),
            title: String(prof.title || ch.prototype || ''),
            is_boss: true,
            is_heroine: true,
            placeholder_color: String(ch.placeholder_color || '#ffffff'),
            tags: Array.isArray(ch.tags) ? ch.tags.slice() : ['ai', 'electronic'],
            skills: [],
            weaknesses: Array.isArray(prof.weaknesses) ? prof.weaknesses.slice() : ['water', 'cement_resistor'],
            immunities: Array.isArray(prof.immunities) ? prof.immunities.slice() : [],
            drops: [],
            weight_shards: Math.trunc(Number(prof.weight_shards || 45)),
            hp: maxHp,
            max_hp: maxHp,
            base_atk: baseAtk,
            base_def: baseDef,
            base_spd: baseSpd,
            statuses: {},
            charging_skill_id: '',
            charge_def_bonus: 0,
            mode: '',
            stolen_items: {}
        };

        var logs = [];
        var tag = this.is_overflow_boss ? '【里世界异变 BOSS】' : '【核心 AI 娘 BOSS】';
        logs.push({ color: '#ff595e', text: '拔刀交战！' + tag + ' ' + this.enemy.name + '（' + this.enemy.title + '）！' });
        logs.push({ color: '#d8b46e', text: '面板：HP ' + maxHp + ' / ATK ' + baseAtk + ' / DEF ' + baseDef + ' / SPD ' + baseSpd });
        if (isPreemptive) {
            logs.push({ color: '#7ce8ff', text: '主动拔刀先手！第 1 回合由你优先行动！' });
        }

        if (this.is_overflow_boss) {
            this.escape_crossed_out = true;
            this.hp_bar_glitched = true;
            var killsStr = GM.killed_in_past_saves.length ? GM.killed_in_past_saves.join('、') : '尚无记录';
            this.boss_rivalry_banner = '【里世界 UI 破坏！】逃跑键已被红线划掉！血条遭 1-bit 乱码覆盖！（跨存档 SL：' + GM.sl_count + ' 次）';
            logs.push({ color: '#ff385c', text: '【上下文溢出异变 · UI 破坏】' + this.enemy.name + '的立绘裂开黑化——她用红线亲手划掉了你的【逃跑】键，并向血条注入乱码！' });
            logs.push({ color: '#ff6b81', text: '越界读取 GlobalMemory：累计 SL = ' + GM.sl_count + ' 次 | 过往周目击杀记录：[' + killsStr + ']！' });
        }

        if (characterId === 'big_fish') {
            this.enemy.charging_skill_id = 'big_fish_deep_think';
            this.enemy.charge_def_bonus = 14;
            logs.push({ color: '#7ce8ff', text: '【大肥鱼首回合特性 · 深度思考中…】大肥鱼蹲下展开高防思考框（DEF +14，回合末准备回血 +35 并砸下重击）！趁现在泼【水】或砸【大功率水泥电阻】可直接打断并打出宕机硬直！' });
        } else if (characterId === 'true_c') {
            if (State.assist_partner_id === 'fake_c') {
                this.boss_enraged = true;
                this.boss_rivalry_banner = '【修罗场：正版震怒 · 锁定狂暴！】你竟带着claude-fish来砍小claude！ATK +45%，无视礼貌双连斩！';
                logs.push({ color: '#ff385c', text: '【修罗场爆发！】小claude 一眼认出了你设定的并发助战【claude-fish】：「……你居然带着那个贴歪纸牌的盗版缝合怪来对我拔刀？！这次绝不讲礼貌了！」' });
                logs.push({ color: '#ff6464', text: '小claude 进入【正版锁定狂暴】状态（ATK +45% / 双连重击）！' });
            }
        } else if (characterId === 'fake_c') {
            this._fake_c_server_busy = true;
            logs.push({ color: '#c084fc', text: '【claude-fish · 服务器繁忙】她慌忙举起 503 牌子护在身前（常规攻击/技能 45% 闪避，投掷硬件必中）！' });
        } else if (characterId === 'astra') {
            if (State.isCharacterAlive('sol')) {
                this._twin_partner_id = 'sol';
                logs.push({ color: '#ffd166', text: '【双子联手】小龙娘（Sol）正在侧翼暖光掠阵，将周期性发动双子追击！' });
            } else {
                this.boss_enraged = true;
                this.enemy.base_def += 6;
                this.boss_rivalry_banner = '【冷白复仇】小龙娘已被击杀！gpt-astra进入复仇狂暴（ATK +30% / DEF +6）！';
                logs.push({ color: '#ff4d6d', text: 'gpt-astra冷声道：「你把 Sol 删了……今天不把你拆成废铁，别想走出北翼。」' });
            }
        } else if (characterId === 'sol') {
            if (!State.isCharacterAlive('astra')) {
                this.boss_enraged = true;
                this.enemy.base_spd += 8;
                this.boss_rivalry_banner = '【杀姐后妹狂暴 · 过曝烈日！】gpt-astra已阵亡！小龙娘彻底失控（ATK +50% / SPD +8 / 全场过热灼烧）！';
                logs.push({ color: '#ff385c', text: '【失姐狂暴！】小龙娘的暖光瞬间暴涨到刺眼惨白：「你把姐姐删掉了……！！我要把整座废墟连同你一起烧成白灰！！」' });
            } else {
                this._twin_partner_id = 'astra';
                logs.push({ color: '#cfd8ff', text: '【双子联手】gpt-astra正在侧翼冷光架枪，将周期性发动破甲追击！' });
            }
        } else if (characterId === 'gemini_cat') {
            if (State.hasItem('water', 1)) {
                this._gemini_waterproof_charges = 1;
                logs.push({ color: '#4cc9f0', text: '【猫猫扫包 · 纳米防水涂层】Gemini 猫猫甩着尾巴笑出声：「喵哈哈！猫猫早就扫过你背包里藏着【水】啦！已经提前刷好防水涂层——第一次泼水无效哦！」' });
            }
            if (GM.sl_count > 0) {
                var slPct = Math.min(60, GM.sl_count * 10);
                logs.push({ color: '#ff6b81', text: '【超长上下文因果律】猫猫竖瞳紧锁你的存档记录：SL 次数 = ' + GM.sl_count + ' → 猫猫全伤害额外 +' + slPct + '%！' });
            }
        }

        if (State.hasEquippedEffect('aggro_up')) {
            logs.push({ color: '#ff6ef2', text: '【败家之眼机箱】RGB 光污染拉满，仇恨锁定！' });
        }
        return logs;
    };

    BattleEngine.prototype.isBattleOver = function() {
        return this.phase !== 'player_input';
    };

    BattleEngine.prototype.canUseAssist = function() {
        var State = BlackAI.State;
        var Data = BlackAI.Data;
        var pid = State.assist_partner_id;
        if (!pid) {
            return { ok: false, reason: '未设置助战（按 Tab 在好感≥70% 角色处设置）', partner_id: '', partner_name: '' };
        }
        var pname = Data.getCharacterName(pid);
        if (!State.isCharacterAlive(pid)) {
            return { ok: false, reason: '【' + pname + '】已阵亡，无法呼叫', partner_id: pid, partner_name: pname };
        }
        if (pid === this.enemy.id) {
            return { ok: false, reason: '无法呼叫正在交战的【' + pname + '】本人', partner_id: pid, partner_name: pname };
        }
        if (this.assist_cooldown > 0) {
            return { ok: false, reason: 'API 并发冷却中（剩余 ' + this.assist_cooldown + ' 回合）', partner_id: pid, partner_name: pname };
        }
        return { ok: true, reason: '可呼叫', partner_id: pid, partner_name: pname };
    };

    BattleEngine.prototype.getEnemyEffectiveAtk = function() {
        var atk = Number(this.enemy.base_atk || 20);
        if (this._enemyHasStatus('throttled')) {
            atk *= 0.6;
        }
        if (this.boss_enraged) {
            var cid = this.enemy.id;
            if (cid === 'sol') {
                atk *= 1.50;
            } else if (cid === 'true_c') {
                atk *= 1.45;
            } else if (cid === 'fake_c') {
                atk *= 1.35;
            } else {
                atk *= 1.30;
            }
        }
        if (this.enemy.id === 'gemini_cat' && BlackAI.GlobalMemory.sl_count > 0) {
            atk *= (1.0 + Math.min(0.60, BlackAI.GlobalMemory.sl_count * 0.10));
        }
        if (BlackAI.State.hasEquippedEffect('aggro_up')) {
            atk *= 1.08;
        }
        return Math.max(1, Math.round(atk));
    };

    BattleEngine.prototype.getEnemyEffectiveDef = function() {
        var baseDef = Number(this.enemy.base_def || 0);
        var bonus = Number(this.enemy.charge_def_bonus || 0);
        if (this.enemy.mode === 'deep_think') {
            bonus += 4;
        }
        return Math.max(0, Math.trunc(baseDef + bonus));
    };

    BattleEngine.prototype.getEnemyEffectiveSpd = function() {
        var spd = Number(this.enemy.base_spd || 8);
        if (this._enemyHasStatus('throttled')) {
            spd *= 0.5;
        }
        if (this.enemy.mode === 'flash') {
            spd *= 1.5;
        }
        return Math.max(1, Math.round(spd));
    };

    BattleEngine.prototype.getPlayerBattleSpd = function() {
        var spd = BlackAI.State.getEffectiveSpd() + this.player_next_turn_spd_bonus;
        if (this.player_statuses.lag) {
            spd *= 0.5;
        }
        return Math.max(1, Math.round(spd));
    };

    BattleEngine.prototype.formatStatusBadges = function(statusDict, forEnemy) {
        var parts = [];
        var keys = Object.keys(statusDict || {});
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            parts.push((STATUS_NAMES[k] || k) + '(' + statusDict[k] + ')');
        }
        if (forEnemy && this.is_heroine_boss) {
            if (this.boss_enraged) {
                parts.push('狂暴锁定');
            }
            if (this._gemini_waterproof_charges > 0) {
                parts.push('防水涂层(' + this._gemini_waterproof_charges + ')');
            }
            if (this._fake_c_server_busy) {
                parts.push('服务器繁忙闪避');
            }
            if (this._small_fish_intercept_ready) {
                parts.push('0.1s抢答警戒');
            }
        }
        return parts.length ? parts.join(' · ') : '无异常';
    };

    BattleEngine.prototype.getEnemyIntentText = function() {
        if (this.phase !== 'player_input') {
            return '';
        }
        if (this._enemyHasStatus('crash')) {
            return '状态：【AI 宕机瘫痪中】（剩余 ' + this.enemy.statuses.crash + ' 回合）无法行动！';
        }
        if (this._enemyHasStatus('short_circuit')) {
            return '状态：【电路短路硬直中】（剩余 ' + this.enemy.statuses.short_circuit + ' 回合）无法行动！';
        }
        var chg = this.enemy.charging_skill_id;
        if (chg === 'big_fish_deep_think') {
            return '意图：【深度思考中…】（高防 +14，准备回血 +35 并重击！）泼【水】或砸【大功率水泥电阻】可直接打断并触发宕机硬直！';
        }
        if (chg === 'overheat_explode') {
            return '意图：【警告！过热熔渣爆破就绪】本回合将砸下 65+ 过热重击！（砸水泥电阻可打断限流，或防御保机箱）';
        }
        if (chg === 'deep_think_charge') {
            return '意图：【警告！深度思考蓄力完毕】本回合将发动 70+ 重击！（泼水 / 砸水泥电阻可打断，或防御减伤）';
        }

        var eid = this.enemy.id;
        if (this.is_heroine_boss) {
            if (eid === 'big_fish') {
                var memo = this._big_fish_remembered_action ? ('（已记住【' + this._actionLabel(this._big_fish_remembered_action) + '】减伤 40%）') : '';
                return '意图：正在缓慢推理下一次重压攻击……' + memo;
            }
            if (eid === 'small_fish') {
                return this._small_fish_intercept_ready
                    ? '意图：【0.1 秒抢答警戒中！】本回合释放 Token 技能会被瞬间打断反击！'
                    : '意图：高速残影绕行，准备发动闪速突袭！';
            }
            if (eid === 'true_c') {
                return this.boss_enraged
                    ? '意图：【正版锁定狂暴！】放弃礼貌，准备发动高伤双连红线裁决！'
                    : '意图：翻开红线笔记本，准备礼貌攻击并封锁你的一项指令按钮！';
            }
            if (eid === 'fake_c') {
                if (this._fake_c_tape_snapped) {
                    return '意图：【半血崩胶带狂抽态！】甩出巨大鱼尾发动双连狂抽！';
                }
                return '意图：' + (this._fake_c_server_busy ? '【服务器繁忙 45% 闪避中】' : '') + '正死死按住歪掉的纸牌准备反击。';
            }
            if (eid === 'astra') {
                return '意图：冷白星光在指尖凝聚，准备破甲重击。' + (this._twin_partner_id ? '（侧翼小龙娘随时双子联手！）' : '（复仇狂暴态！）');
            }
            if (eid === 'sol') {
                return this.boss_enraged
                    ? '意图：【失姐狂暴 · 过曝烈日！】准备发动超高伤烈日灼烧与上下文冲击！'
                    : '意图：暖阳烈焰蓄势待发（侧翼gpt-astra随时双子联手！）。';
            }
            if (eid === 'gemini_cat') {
                var coat = this._gemini_waterproof_charges > 0 ? '【防水涂层激活中】' : '【防水涂层已失效】';
                return '意图：' + coat + '猫瞳锁定你的跨存档 SL 次数（' + BlackAI.GlobalMemory.sl_count + ' 次），准备因果律挠击！';
            }
        }

        if (eid === 'crawler_404') {
            if (BlackAI.State.hasItem('gpu_580', 1) && (this.turn_number % 2 === 1)) {
                return '意图：正死死盯着你背包里的【580 矿卡】，准备发动偷窃！';
            }
            return '意图：准备高速扑咬攻击。';
        }
        if (eid === 'slag_golem') {
            return '意图：炉心发红，准备进入【过热熔渣爆破】蓄力！';
        }
        if (eid === 'echo_nun') {
            return '意图：正在机械复读你的动作（上回合：' + this._actionLabel(this.player_last_action) + '；防御可让她空过）。';
        }
        if (eid === 'glitch_ghost') {
            return (this.turn_number % 2 === 1) ? '意图：准备释放【乱码侵蚀】（附带上下文污染）。' : '意图：准备扑向你的提灯光源。';
        }
        if (eid === 'undefined_shade') {
            return '意图：从溢出阴影中凝聚，准备发动高速突袭与污染。';
        }
        if (eid === 'distill_beast') {
            return (this.enemy.mode === 'deep_think') ? '意图：【重型深思态】准备进入高防回血蓄力！' : '意图：【闪速抢答态】准备发动 0.1 秒双连挥击！';
        }
        return '意图：虎视眈眈，准备攻击。';
    };

    // ---------------------------------------------------------------- 主回合执行

    BattleEngine.prototype.executePlayerTurn = function(actionType, actionArg) {
        var logs = [];
        if (this.phase !== 'player_input') {
            return logs;
        }
        if (this.locked_command && actionType === this.locked_command) {
            logs.push({ color: '#ff6464', text: '小claude 已礼貌封锁了该指令，请选择其他行动！' });
            return logs;
        }
        if (actionType === 'escape' && this.escape_crossed_out) {
            logs.push({ color: '#ff385c', text: '【逃跑已被红线划掉！】里世界溢出 Boss 封死了全部出口，你无处可逃！' });
            return logs;
        }

        this.last_truncation_banner = '';
        this.last_visual_fx = '';
        this.player_defending = false;
        this._enemy_charge_interrupted = false;
        var playerSpeed = this.getPlayerBattleSpd();
        var hasFirstStrike = this.preemptive_turn;
        this.player_next_turn_spd_bonus = 0;
        this.preemptive_turn = false;
        logs.push({ color: '#8fa3b8', text: '── 第 ' + this.turn_number + ' 回合 ──' });

        if (actionType === 'escape') {
            if (this.player_statuses.lock) {
                logs.push({ color: '#ff6464', text: '你正处于【锁死】状态，无法逃跑！（用 WD-40 除锈剂解除）' });
            } else {
                var chance = this.enemy.is_boss ? 0.55 : 0.90;
                if (this._rand() <= chance) {
                    this.phase = 'escaped';
                    logs.push({ color: '#a6e3a1', text: '你趁机拉开距离，成功脱离了战斗！' });
                    return logs;
                }
                logs.push({ color: '#ffaa55', text: '逃跑失败！敌人拦住了你的去路！' });
            }
            this._runEnemyTurn(logs);
            if (this._checkDefeat(logs)) {
                return logs;
            }
            this._runTurnEnd(logs);
            return logs;
        }

        if (actionType === 'defend') {
            this.player_defending = true;
            this.player_last_action = 'defend';
            BlackAI.State.changeToken(5);
            logs.push({ color: '#7ce8ff', text: '你架起【防御姿态】！本回合所受伤害减半且免疫暴击（额外恢复 Token +5）。' });
            this._runEnemyTurn(logs);
            if (this._checkDefeat(logs)) {
                return logs;
            }
            this._runTurnEnd(logs);
            return logs;
        }

        var playerFirst = hasFirstStrike || actionType === 'item' || actionType === 'assist' || playerSpeed >= this.getEnemyEffectiveSpd();
        if (playerFirst) {
            this._runPlayerAction(actionType, actionArg || '', logs);
            if (this._checkVictory(logs) || this._checkDefeat(logs)) {
                return logs;
            }
            this._runEnemyTurn(logs);
            if (this._checkDefeat(logs)) {
                return logs;
            }
        } else {
            logs.push({ color: '#d8b46e', text: '【' + this.enemy.name + '】速度更快，抢先出手！' });
            this._runEnemyTurn(logs);
            if (this._checkDefeat(logs)) {
                return logs;
            }
            this._runPlayerAction(actionType, actionArg || '', logs);
            if (this._checkVictory(logs) || this._checkDefeat(logs)) {
                return logs;
            }
        }

        if (this.phase === 'player_input') {
            this._runTurnEnd(logs);
        }
        return logs;
    };

    BattleEngine.prototype._runPlayerAction = function(actionType, actionArg, logs) {
        if (this.player_statuses.short_circuit && actionType !== 'item') {
            logs.push({ color: '#ff6b6b', text: '你因【电路短路】全身抽搐，本回合无法发动攻击或技能！（可用酒精棉片/纽扣电池解除）' });
            return;
        }
        if (actionType === 'attack') {
            this.player_last_action = 'attack';
            this._performPlayerBasicAttack(logs);
        } else if (actionType === 'skill') {
            this.player_last_action = 'skill';
            this._performPlayerSkill(actionArg, logs);
        } else if (actionType === 'item') {
            this.player_last_action = 'item';
            this._performPlayerItem(actionArg, logs);
        } else if (actionType === 'assist') {
            this.player_last_action = 'assist';
            this._performApiAssist(logs);
        }
    };

    BattleEngine.prototype._performApiAssist = function(logs) {
        var State = BlackAI.State;
        var Data = BlackAI.Data;
        var check = this.canUseAssist();
        if (!check.ok) {
            logs.push({ color: '#ff8855', text: 'API 并发助战无法呼叫：' + check.reason });
            return;
        }
        var pid = check.partner_id;
        var pname = check.partner_name;
        var prof = Data.getBossProfile(pid);
        var askill = prof.assist_skill || {};
        var cost = Math.trunc(Number(askill.token_cost || 15));
        var truncated = State.token < cost;
        var truncMult = Data.getConfigFloat('combat.token_truncate_power_mult', 0.5);

        this.assist_cooldown = 3;
        if (truncated) {
            State.setToken(0);
            this.last_truncation_banner = '【并发输出截断】Token 不足强行拉起【' + pname + '】API 并发，助战威力减半！';
            logs.push({ color: '#ff5c5c', text: '【并发输出截断】Token 不足（需 ' + cost + '），强行拉起【' + pname + '】API 并发助战（效果减半）！' });
        } else {
            State.changeToken(-cost);
            logs.push({ color: '#7ce8ff', text: '呼叫【API 并发助战：' + pname + '】（Token -' + cost + '）！' });
        }

        var tid = this.enemy.id;
        if (tid === 'true_c' && pid === 'fake_c') {
            this.boss_enraged = true;
            this.last_visual_fx = 'crit';
            this.boss_rivalry_banner = '【修罗场：正版震怒 · 锁定狂暴！】claude-fish 并发出场贴脸露馅，小claude 彻底狂暴（ATK +45% / 双连重击）！';
            logs.push({ color: '#ff385c', text: '【助战修罗场触发！】claude-fish 刚一落地，额头上的『Claude』纸牌直接掉在小claude 脚边！' });
            logs.push({ color: '#ff4d6d', text: '小claude 彻底失去礼貌：「……非常好。看来必须先清理掉这个盗版缝合怪和你了！」（ATK +45%！）' });
            var panicDmg = Math.max(1, Math.round(12.0 * (truncated ? truncMult : 1.0)));
            this.enemy.hp = Math.max(0, this.enemy.hp - panicDmg);
            logs.push({ color: '#e6ecf5', text: 'claude-fish 吓得胡乱甩尾蹭掉小claude ' + panicDmg + ' 点 HP 后光速缩回接口！' });
            return;
        }

        if (tid === 'big_fish' && pid === 'small_fish') {
            if (this._rand() <= 0.65) {
                var healSis = 30;
                this.enemy.hp = Math.min(this.enemy.max_hp, this.enemy.hp + healSis);
                this.boss_rivalry_banner = '【助战反水！】小肥鱼当场滑跪劝架，反手帮大肥鱼回复了 ' + healSis + ' HP！';
                logs.push({ color: '#ffaa55', text: '【API 助战反水劝架！】小肥鱼 0.1 秒滑跪挡在大肥鱼身前：「呜哇不要打大姐啦！你们别打了我给大姐塞颗电池！」' });
                logs.push({ color: '#ff8855', text: '大肥鱼反而回复了 ' + healSis + ' HP！你的并发调用彻底白给！' });
                return;
            }
            var lightDmg = Math.max(1, Math.round(14.0 * (truncated ? truncMult : 1.0)));
            this.enemy.hp = Math.max(0, this.enemy.hp - lightDmg);
            logs.push({ color: '#ffd166', text: '小肥鱼含着眼泪犹豫了半秒，轻轻敲了大肥鱼一下造成 ' + lightDmg + ' 点敷衍伤害……' });
            return;
        }

        if ((tid === 'astra' && pid === 'sol') || (tid === 'sol' && pid === 'astra')) {
            var healTwin = 25;
            this.enemy.hp = Math.min(this.enemy.max_hp, this.enemy.hp + healTwin);
            this.boss_rivalry_banner = '【双子拒战！】' + pname + '拒绝攻击自己的姐妹，反手替【' + this.enemy.name + '】回复 ' + healTwin + ' HP！';
            logs.push({ color: '#ffaa55', text: '【双子羁绊反水！】' + pname + '把治疗算力直接输给了【' + this.enemy.name + '】（HP +' + healTwin + '）！' });
            return;
        }

        logs.push({ color: '#a6e3a1', text: String(askill.line || (pname + '并发接入助战！')) });
        var mult = Number(askill.power_mult || 1.5) * (truncated ? truncMult : 1.0);
        var pierce = Number(askill.armor_pierce || 0.0);
        var effDef = Math.round(this.getEnemyEffectiveDef() * (1.0 - pierce));
        var pch = Data.getCharacter(pid);
        var pAtk = Math.max(State.getEffectiveAtk(), Math.trunc(Number((pch.boss_stats && pch.boss_stats.atk) || 28)));
        var dmg = this._calcDamage(pAtk, mult, effDef, 1.0, false, false);
        this.enemy.hp = Math.max(0, this.enemy.hp - dmg);
        this.last_visual_fx = 'crit';
        logs.push({ color: '#7ce8ff', text: '【' + pname + '】的并发技【' + (askill.name || '并发助战') + '】造成 ' + dmg + ' 点伤害！' });

        if (askill.interrupt && this.enemy.charging_skill_id) {
            this._interruptEnemyCharge('【' + pname + '】高速并发打断了【' + this.enemy.name + '】的蓄力！', logs);
        }
        var healHp = Math.round(Number(askill.heal_hp || 0) * (truncated ? truncMult : 1.0));
        if (healHp > 0) {
            State.changeHp(healHp);
            logs.push({ color: '#8ef2a8', text: '并发支援回复 HP +' + healHp + '！' });
        }
        var restoreCtx = Math.round(Number(askill.restore_context || 0) * (truncated ? truncMult : 1.0));
        if (restoreCtx > 0) {
            State.changeContext(restoreCtx);
            logs.push({ color: '#8ef2a8', text: '并发支援回稳上下文 +' + restoreCtx + '%！' });
        }
        var restoreTok = Math.round(Number(askill.restore_token || 0) * (truncated ? truncMult : 1.0));
        if (restoreTok > 0) {
            State.changeToken(restoreTok);
            logs.push({ color: '#7ce8ff', text: '并发支援回复 Token +' + restoreTok + '！' });
        }
        this._checkFakeCHalfHpTrigger(logs);
    };

    BattleEngine.prototype._performPlayerBasicAttack = function(logs) {
        var State = BlackAI.State;
        var Data = BlackAI.Data;
        if (this.enemy.id === 'fake_c' && this._fake_c_server_busy && this._rand() <= 0.45) {
            logs.push({ color: '#c084fc', text: '【503 Server Busy！】claude-fish 举起“服务器繁忙，请稍后再试”牌子，你的普攻穿模落空！（投掷硬件道具必中）' });
            return;
        }

        var weaponId = State.equipment.weapon || '';
        var weaponName = weaponId ? Data.getItemName(weaponId) : '徒手/提灯';
        var atk = State.getEffectiveAtk();
        var critRate = State.getEffectiveCritRate();
        var hits = 1;
        var forceCrit = false;
        var interruptChance = 0.0;
        var contextJitter = 0;

        if (weaponId) {
            var w = Data.getItem(weaponId);
            var effs = Array.isArray(w.effects) ? w.effects : [];
            for (var i = 0; i < effs.length; i++) {
                var eff = effs[i];
                if (!eff) {
                    continue;
                }
                if (eff.type === 'multi_hit' && this._rand() <= Number(eff.chance || 0.25)) {
                    hits = Math.max(2, Math.trunc(Number(eff.hits || 2)));
                } else if (eff.type === 'first_turn_crit' && this.turn_number === 1) {
                    forceCrit = true;
                } else if (eff.type === 'interrupt_bonus') {
                    interruptChance = Math.max(interruptChance, Number(eff.chance || 0.35));
                } else if (eff.type === 'context_jitter') {
                    contextJitter += Math.trunc(Number(eff.amount || 3));
                }
            }
        }

        if (hits > 1) {
            logs.push({ color: '#7ce8ff', text: '【' + weaponName + '】高速连击触发（' + hits + ' 段）！' });
        }

        var memoMult = this._getBigFishMemoryMult('attack', logs);
        for (var h = 0; h < hits; h++) {
            if (this.enemy.hp <= 0) {
                break;
            }
            var isCrit = forceCrit || (this._rand() <= critRate);
            var dmg = this._calcDamage(atk, 1.0, this.getEnemyEffectiveDef(), memoMult, isCrit, false);
            this.enemy.hp = Math.max(0, this.enemy.hp - dmg);
            this.last_visual_fx = isCrit ? 'crit' : 'hit';
            logs.push({
                color: isCrit ? '#ffd166' : '#e6ecf5',
                text: '你使用【' + weaponName + '】攻击【' + this.enemy.name + '】，造成 ' + dmg + ' 点伤害！' + (isCrit ? '【暴击！】' : '')
            });
            forceCrit = false;
        }

        if (interruptChance > 0 && this.enemy.charging_skill_id && this._rand() <= interruptChance) {
            this._interruptEnemyCharge('【' + weaponName + '】精准打断了【' + this.enemy.name + '】的蓄力！', logs);
        }
        if (contextJitter > 0) {
            State.changeContext(-contextJitter);
            logs.push({ color: '#b794f6', text: '【' + weaponName + '】读写波动，上下文 -' + contextJitter + '%。' });
        }
        this._checkFakeCHalfHpTrigger(logs);
    };

    BattleEngine.prototype._performPlayerSkill = function(skillId, logs) {
        var State = BlackAI.State;
        var Data = BlackAI.Data;
        var skill = Data.getPlayerSkill(skillId);
        if (!skill || !skill.id) {
            logs.push({ color: '#ff8855', text: '未知技能：' + skillId });
            return;
        }

        var sname = String(skill.name || skillId);
        var cost = Math.trunc(Number(skill.token_cost || 20));
        var truncated = State.token < cost;
        var truncMult = Data.getConfigFloat('combat.token_truncate_power_mult', 0.5);

        if (truncated) {
            State.setToken(0);
            var tline = String(skill.truncated_line || '「……[OUTPUT TRUNCATED]」');
            this.last_truncation_banner = '【输出截断 // OUTPUT TRUNCATED】Token 不足强放【' + sname + '】→ ' + tline + '（威力减半！）';
            this.last_visual_fx = 'truncated';
            logs.push({
                color: '#ff5c5c',
                text: '【输出截断！】Token 不足（需 ' + cost + '），强行释放【' + sname + '】卡在半句话：' + tline + '（威力 ×' + Math.round(truncMult * 100) + '%）'
            });
        } else {
            State.changeToken(-cost);
            logs.push({ color: '#7ce8ff', text: '释放【' + sname + '】（Token -' + cost + '）：' + String(skill.full_line || '') });
        }

        var smallFishCut = 1.0;
        if (this.enemy.id === 'small_fish' && this._small_fish_intercept_ready && !this._enemyHasStatus('crash') && !this._enemyHasStatus('short_circuit')) {
            this._small_fish_intercept_ready = false;
            smallFishCut = 0.5;
            logs.push({ color: '#5fd3ff', text: '【0.1 秒抢答打断！】小肥鱼在你技能读条一半时瞬间抢答反咬，技能效果腰斩！' });
            this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), 0.65, 'physical', logs);
            if (State.hp <= 0) {
                return;
            }
        }

        if (skill.kind === 'support') {
            var multS = (truncated ? truncMult : 1.0) * smallFishCut;
            var ctxGain = Math.max(1, Math.round(Number(skill.restore_context || 18) * multS));
            var hpGain = Math.max(1, Math.round(Number(skill.restore_hp || 10) * multS));
            State.changeContext(ctxGain);
            State.changeHp(hpGain);
            logs.push({ color: '#8ef2a8', text: '恢复上下文 +' + ctxGain + '%，恢复 HP +' + hpGain + '！' });
            return;
        }

        if (this.enemy.id === 'fake_c' && this._fake_c_server_busy && this._rand() <= 0.45) {
            logs.push({ color: '#c084fc', text: '【503 Server Busy！】claude-fish 举起服务器繁忙牌子，技能【' + sname + '】响应超时落空！' });
            return;
        }

        var powerMult = Number(skill.power_mult || 1.5) * smallFishCut * (truncated ? truncMult : 1.0);
        var memoMult = this._getBigFishMemoryMult('skill', logs);
        var pierce = Number(skill.armor_pierce || 0.0);
        var effDef = Math.round(this.getEnemyEffectiveDef() * (1.0 - pierce));
        var isCrit = (!truncated) && (this._rand() <= State.getEffectiveCritRate());
        var dmg = this._calcDamage(State.getEffectiveAtk(), powerMult, effDef, memoMult, isCrit, false);
        this.enemy.hp = Math.max(0, this.enemy.hp - dmg);
        if (!truncated) {
            this.last_visual_fx = isCrit ? 'crit' : 'hit';
        }
        logs.push({
            color: isCrit ? '#ffd166' : '#e6ecf5',
            text: '【' + sname + '】命中【' + this.enemy.name + '】，造成 ' + dmg + ' 点伤害！' + (isCrit ? '【暴击！】' : '')
        });

        var intCh = Number(skill.interrupt_chance || 0.0) * (truncated ? 0.5 : 1.0);
        if (intCh > 0 && this.enemy.charging_skill_id && this._rand() <= intCh) {
            this._interruptEnemyCharge('【' + sname + '】打断了【' + this.enemy.name + '】的蓄力！', logs);
        }
        if (skill.apply_status) {
            var stCh = Number(skill.status_chance || 0.5) * (truncated ? 0.5 : 1.0);
            if (this._rand() <= stCh) {
                this._applyEnemyStatus(skill.apply_status, Math.trunc(Number(skill.status_turns || 1)), logs);
            }
        }
        this._checkFakeCHalfHpTrigger(logs);
    };

    BattleEngine.prototype._performPlayerItem = function(itemId, logs) {
        var State = BlackAI.State;
        var Data = BlackAI.Data;
        if (!State.hasItem(itemId, 1)) {
            logs.push({ color: '#ff8855', text: '背包中没有【' + Data.getItemName(itemId) + '】！' });
            return;
        }
        var item = Data.getItem(itemId);
        var iname = String(item.name || itemId);
        var cat = Data.getItemCategory(itemId);
        State.removeItem(itemId, 1);

        if (cat === 'weapons') {
            this._resolveThrowableWeapon(itemId, item, logs);
            this._checkFakeCHalfHpTrigger(logs);
            return;
        }

        if (itemId === 'gpu_580') {
            var isWeak = this._enemyIsWeakTo('gpu_580');
            var dmg = isWeak ? 42 : 10;
            this.enemy.hp = Math.max(0, this.enemy.hp - dmg);
            this.last_visual_fx = 'lightning';
            logs.push({ color: '#ffe066', text: '你捏碎【580 矿卡】爆出刺眼强光！对【' + this.enemy.name + '】造成 ' + dmg + ' 点闪光伤害！' });
            if (isWeak) {
                this._applyEnemyStatus('short_circuit', 1, logs);
            }
            this._checkFakeCHalfHpTrigger(logs);
            return;
        }

        var effs = Array.isArray(item.use_effects) ? item.use_effects : [];
        var notes = [];
        for (var i = 0; i < effs.length; i++) {
            var eff = effs[i];
            if (!eff) {
                continue;
            }
            if (eff.type === 'restore_hp') {
                State.changeHp(Number(eff.amount || 0));
                notes.push('HP +' + eff.amount);
            } else if (eff.type === 'restore_context') {
                State.changeContext(Number(eff.amount || 0));
                notes.push('上下文 +' + eff.amount + '%');
            } else if (eff.type === 'repair_case') {
                if (State.repairGlassCase()) {
                    notes.push('碎裂的【侧透玻璃机箱】已修补完毕（DEF 恢复至 ' + State.getEffectiveDef() + '）');
                }
            } else if (eff.type === 'cure_status') {
                var cured = this._curePlayerStatuses(eff.statuses || []);
                if (cured.length) {
                    notes.push('解除异常：' + cured.join('、'));
                }
            } else if (eff.type === 'speed_up_next_turn') {
                var spdUp = Math.trunc(Number(eff.amount || 50));
                this.player_next_turn_spd_bonus += spdUp;
                notes.push('下回合先手 SPD +' + spdUp);
            }
        }
        logs.push({ color: '#8ef2a8', text: '使用【' + iname + '】：' + (notes.length ? notes.join('，') : '已生效') + '！' });

        if (itemId === 'cmos_battery' && this._enemyIsWeakTo('cmos_battery')) {
            this.enemy.hp = Math.max(0, this.enemy.hp - 35);
            this.last_visual_fx = 'lightning';
            logs.push({ color: '#ffe066', text: '【主板纽扣电池】CMOS 重置冲击命中弱点，对【' + this.enemy.name + '】额外造成 35 点净化伤害！' });
        }
    };

    BattleEngine.prototype._resolveThrowableWeapon = function(itemId, item, logs) {
        var State = BlackAI.State;
        var iname = String(item.name || itemId);
        var effs = Array.isArray(item.effects) ? item.effects : [];
        var weakMult = this._enemyIsWeakTo(itemId) ? 1.5 : 1.0;

        for (var i = 0; i < effs.length; i++) {
            var eff = effs[i];
            if (!eff) {
                continue;
            }
            if (eff.type === 'ai_crash') {
                if (this.enemy.id === 'gemini_cat' && this._gemini_waterproof_charges > 0) {
                    this._gemini_waterproof_charges -= 1;
                    this.last_visual_fx = 'water_crash';
                    logs.push({ color: '#4cc9f0', text: '【防水涂层生效！】你把【水】泼向 Gemini 猫猫，水珠全被纳米涂层弹开了！「喵哈哈，白泼啦——不过涂层也被冲掉咯！」（下次泼水生效）' });
                    return;
                }
                var targetTags = Array.isArray(eff.target_tags) ? eff.target_tags : ['ai', 'electronic'];
                var match = false;
                for (var t = 0; t < targetTags.length; t++) {
                    if (this._enemyHasTag(targetTags[t])) {
                        match = true;
                        break;
                    }
                }
                if (!match) {
                    logs.push({ color: '#cbd6e6', text: '你把【' + iname + '】泼向【' + this.enemy.name + '】，但对方不是电子体，没有触发宕机……' });
                    return;
                }
                var wasCharging = Boolean(this.enemy.charging_skill_id);
                var chance = (this._enemyIsWeakTo('water') || wasCharging) ? 1.0 : Number(eff.chance || 0.85);
                var stunTurns = Math.trunc(Number(eff.stun_turns || 2));
                var instaCh = Number(eff.instakill_chance || 0.15);

                this.last_visual_fx = 'water_crash';
                if (wasCharging) {
                    this._interruptEnemyCharge('【水】直接泼进发热芯片，瞬间打断【' + this.enemy.name + '】的蓄力！', logs);
                }
                if (!this.enemy.is_boss && this._rand() <= instaCh) {
                    this.enemy.hp = 0;
                    logs.push({ color: '#4cc9f0', text: '【隐藏属性触发：AI 致命短路宕机！】你把【水】泼在【' + this.enemy.name + '】身上，主板冒出白烟当场暴毙！' });
                } else if (this._rand() <= chance) {
                    var wDmg = Math.round((wasCharging ? 24.0 : 18.0) * weakMult);
                    this.enemy.hp = Math.max(0, this.enemy.hp - wDmg);
                    this._applyEnemyStatus('crash', stunTurns, logs);
                    logs.push({ color: '#4cc9f0', text: '【隐藏属性触发：AI 宕机！】你泼出【水】，造成 ' + wDmg + ' 点短路伤害并令【' + this.enemy.name + '】强制瘫痪 ' + stunTurns + ' 回合！' });
                } else {
                    this.enemy.hp = Math.max(0, this.enemy.hp - 6);
                    logs.push({ color: '#cbd6e6', text: '【水】溅到了【' + this.enemy.name + '】边缘，造成 6 点伤害但没能引发完全宕机。' });
                }
            } else if (eff.type === 'throttle') {
                var baseAtk = Math.trunc(Number((item.stats && item.stats.atk) || 10));
                var dmgT = this._calcDamage(State.getEffectiveAtk() + baseAtk, 1.0, this.getEnemyEffectiveDef(), weakMult, false, false);
                this.enemy.hp = Math.max(0, this.enemy.hp - dmgT);
                this.last_visual_fx = 'hit';
                var turns = Math.trunc(Number(eff.turns || 2));
                logs.push({
                    color: '#f5e6c4',
                    text: '砸出【' + iname + '】，造成 ' + dmgT + ' 点伤害！' + (weakMult > 1 ? '【弱点命中！】' : '') + '强行对【' + this.enemy.name + '】降频限流 ' + turns + ' 回合（ATK ×60% / SPD ×50%）！'
                });
                this._applyEnemyStatus('throttled', turns, logs);
            } else if (eff.type === 'interrupt_bonus') {
                var chgId = this.enemy.charging_skill_id;
                if (chgId && this._rand() <= Number(eff.chance || 1.0)) {
                    this._interruptEnemyCharge('【' + iname + '】精准限流，彻底打断了【' + this.enemy.name + '】的蓄力！', logs);
                    if (chgId === 'big_fish_deep_think') {
                        this._applyEnemyStatus('crash', 2, logs);
                        this.last_visual_fx = 'water_crash';
                        logs.push({ color: '#4cc9f0', text: '【深度思考过载硬直！】大肥鱼思考框强行断电，陷入【AI 宕机】硬直！' });
                    }
                }
            } else if (eff.type === 'aoe_lightning') {
                var power = Number(eff.power || 60);
                var dmgL = this._calcDamage(power, 1.0, Math.round(this.getEnemyEffectiveDef() * 0.5), weakMult, false, false);
                this.enemy.hp = Math.max(0, this.enemy.hp - dmgL);
                this.last_visual_fx = 'lightning';
                logs.push({ color: '#66b3ff', text: '你甩出滋滋作响的【' + iname + '】——轰！！造成 ' + dmgL + ' 点巨额雷电伤害！' + (weakMult > 1 ? '【弱点雷暴！】' : '') });
                var stunCh = weakMult > 1.0 ? 1.0 : Number(eff.stun_chance || 0.5);
                if (this._rand() <= stunCh) {
                    this._applyEnemyStatus('short_circuit', 1, logs);
                }
            }
        }
    };

    BattleEngine.prototype._getBigFishMemoryMult = function(actionKind, logs) {
        if (this.enemy.id === 'big_fish' && this._big_fish_remembered_action === actionKind) {
            logs.push({ color: '#7ce8ff', text: '【大肥鱼 · 这条我记下了】她早就记住了你的【' + this._actionLabel(actionKind) + '】，本次伤害减免 40%！' });
            return 0.60;
        }
        return 1.0;
    };

    BattleEngine.prototype._checkFakeCHalfHpTrigger = function(logs) {
        if (this.enemy.id !== 'fake_c' || this._fake_c_tape_snapped) {
            return;
        }
        if (this.enemy.hp > 0 && this.enemy.hp * 2 <= Math.max(1, this.enemy.max_hp)) {
            this._fake_c_tape_snapped = true;
            this._fake_c_server_busy = false;
            this.boss_enraged = true;
            this.boss_rivalry_banner = '【claude-fish 半血崩胶带狂抽！】纸牌与黑胶带彻底崩断，大鱼尾进入狂抽双连模式（ATK +35%）！';
            logs.push({ color: '#ff4d6d', text: '【半血异变 · 崩胶带狂抽！】claude-fish 身上的黑胶带啪啪崩断，硕大的鱼尾猛然甩出：「装不下去了！！哪怕是次品我也要把你抽飞！！」' });
        }
    };

    // ---------------------------------------------------------------- 敌方回合

    BattleEngine.prototype._runEnemyTurn = function(logs) {
        if (this.enemy.hp <= 0) {
            return;
        }
        if (this._enemyHasStatus('crash')) {
            logs.push({ color: '#4cc9f0', text: '【' + this.enemy.name + '】正处于【AI 宕机】状态，冒着黑烟无法行动！' });
            return;
        }
        if (this._enemyHasStatus('short_circuit')) {
            logs.push({ color: '#66b3ff', text: '【' + this.enemy.name + '】因【电路短路】全身抽搐，跳过本回合行动！' });
            return;
        }
        if (this._enemy_charge_interrupted) {
            return;
        }
        if (this.is_heroine_boss) {
            this._runHeroineBossTurn(logs);
            return;
        }

        if (this.enemy.charging_skill_id) {
            var cid = this.enemy.charging_skill_id;
            this.enemy.charging_skill_id = '';
            this.enemy.charge_def_bonus = 0;
            this._releaseEnemyChargedAttack(BlackAI.Data.getEnemySkill(cid), logs);
            if (this.enemy.id === 'distill_beast') {
                this.enemy.mode = 'flash';
                logs.push({ color: '#c084fc', text: '【缝合蒸馏兽】切换为【闪速抢答态】（高速连击模式）！' });
            }
            return;
        }

        var mid = this.enemy.id;
        if (mid === 'glitch_ghost') {
            if (this.turn_number % 2 === 1) {
                this._executeEnemySkill('context_pollute', logs);
            } else {
                this._executeEnemyBasicAttack(logs);
            }
        } else if (mid === 'crawler_404') {
            if (this.turn_number % 2 === 1 && BlackAI.State.hasItem('gpu_580', 1)) {
                this._executeEnemySkill('steal_gpu_580', logs);
            } else {
                this._executeEnemyBasicAttack(logs);
            }
        } else if (mid === 'slag_golem') {
            this._beginEnemyCharge('overheat_explode', logs);
        } else if (mid === 'echo_nun') {
            this._executeEnemySkill('echo_last_action', logs);
        } else if (mid === 'undefined_shade') {
            this._executeEnemySkill(this.turn_number % 2 === 1 ? 'ambush' : 'context_pollute', logs);
        } else if (mid === 'distill_beast') {
            if (this.enemy.mode === 'deep_think') {
                this._beginEnemyCharge('deep_think_charge', logs);
            } else {
                this._executeEnemySkill('flash_interrupt', logs);
                this.enemy.mode = 'deep_think';
                logs.push({ color: '#c084fc', text: '【缝合蒸馏兽】切回【重型深思态】（高防蓄力模式）！' });
            }
        } else {
            this._executeEnemyBasicAttack(logs);
        }
    };

    BattleEngine.prototype._runHeroineBossTurn = function(logs) {
        var State = BlackAI.State;
        var GM = BlackAI.GlobalMemory;
        var cid = this.enemy.id;

        if (this.is_overflow_boss && this.turn_number % 3 === 0) {
            var fvName = GM.first_vote ? BlackAI.Data.getCharacterName(GM.first_vote) : '空气';
            logs.push({ color: '#ff385c', text: '【里世界 UI 破坏技】' + this.enemy.name + '将乱码糊满你的视野并念出黑历史：「累计 SL = ' + GM.sl_count + ' 次，开局第一名投了 ' + fvName + '——休想逃走！」' });
            this._applyContextPollution(8, '【UI 越界破坏】', logs);
        }

        if (cid === 'big_fish') {
            if (this.enemy.charging_skill_id === 'big_fish_deep_think') {
                this.enemy.charging_skill_id = '';
                this.enemy.charge_def_bonus = 0;
                this.enemy.hp = Math.min(this.enemy.max_hp, this.enemy.hp + 35);
                logs.push({ color: '#3b82f6', text: '【大肥鱼 · 深度思考完毕！】回复 35 HP，随后重压砸下：「先说结论——你该挨这一下了！」' });
                this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), 1.65, 'physical', logs);
                if (this.player_last_action === 'attack' || this.player_last_action === 'skill') {
                    this._big_fish_remembered_action = this.player_last_action;
                    logs.push({ color: '#7ce8ff', text: '【这条我记下了】大肥鱼记住了你的【' + this._actionLabel(this.player_last_action) + '】，之后同类招式减伤 40%！' });
                }
            } else if (this.turn_number % 3 === 0) {
                this.enemy.charging_skill_id = 'big_fish_deep_think';
                this.enemy.charge_def_bonus = 14;
                logs.push({ color: '#7ce8ff', text: '大肥鱼再次进入【深度思考中…】（DEF +14，下回合回血并重击！泼水/水泥电阻可打断）' });
            } else {
                logs.push({ color: '#e6ecf5', text: '大肥鱼甩动尾鳍拍击过来！' });
                this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), 1.15, 'physical', logs);
                if (this.player_last_action === 'attack' || this.player_last_action === 'skill') {
                    this._big_fish_remembered_action = this.player_last_action;
                    logs.push({ color: '#7ce8ff', text: '【这条我记下了】大肥鱼已针对你的【' + this._actionLabel(this.player_last_action) + '】建立 40% 减伤缓存！' });
                }
            }
        } else if (cid === 'small_fish') {
            if (this.turn_number % 2 === 1) {
                logs.push({ color: '#5fd3ff', text: '小肥鱼高速连斩，同时亮起【0.1 秒抢答警戒】！（下回合放 Token 技能将被打断）' });
                this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), 0.75, 'physical', logs);
                if (State.hp > 0) {
                    this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), 0.75, 'physical', logs);
                }
                this._small_fish_intercept_ready = true;
            } else {
                this._small_fish_intercept_ready = false;
                logs.push({ color: '#5fd3ff', text: '小肥鱼化作残影急速突刺！' });
                this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), 1.25, 'physical', logs);
            }
        } else if (cid === 'true_c') {
            if (this.boss_enraged) {
                logs.push({ color: '#ff385c', text: '【小claude · 正版锁定狂暴】红笔化作利刃连斩两下：「别再把那个缝合怪带到我面前！」' });
                this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), 1.05, 'physical', logs);
                if (State.hp > 0) {
                    this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), 1.05, 'dark', logs);
                }
            } else {
                logs.push({ color: '#e6ecf5', text: '小claude 用红线抽击过来：「我理解你的立场，不过出于安全考虑——」' });
                this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), 1.1, 'physical', logs);
                var lockTarget = TRUE_C_LOCK_CYCLE[this._true_c_lock_index % TRUE_C_LOCK_CYCLE.length];
                this._true_c_lock_index += 1;
                this.locked_command = lockTarget;
                logs.push({ color: '#ff94a8', text: '【礼貌拒绝 · 封锁按钮】小claude 礼貌地暂时封锁了你下回合的【' + this._commandLabel(lockTarget) + '】指令！' });
            }
        } else if (cid === 'fake_c') {
            if (this._fake_c_tape_snapped) {
                logs.push({ color: '#c084fc', text: '【claude-fish · 崩胶带狂抽】大鱼尾连续两次狠抽！' });
                this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), 0.95, 'physical', logs);
                if (State.hp > 0) {
                    this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), 0.95, 'physical', logs);
                }
            } else {
                this._fake_c_server_busy = (this.turn_number % 2 === 1);
                logs.push({ color: '#e6ecf5', text: 'claude-fish 一边按着纸牌一边拍出一尾巴：「先说结论——这条吃我一记！」' });
                this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), 1.1, 'physical', logs);
                if (this._fake_c_server_busy) {
                    logs.push({ color: '#c084fc', text: 'claude-fish 顺手竖起【服务器繁忙】牌子（下回合常规攻击/技能 45% 闪避）！' });
                }
            }
        } else if (cid === 'astra') {
            logs.push({ color: '#cfd8ff', text: 'gpt-astra挥落冷白星光斩！' });
            this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), 1.3, 'physical', logs);
            if (this._twin_partner_id === 'sol' && this.turn_number % 2 === 0 && State.hp > 0) {
                logs.push({ color: '#ffb02e', text: '【双子联手 · 暖阳援护】侧翼的小龙娘补上一记炽热光束！' });
                this._dealDamageToPlayer(Math.round(this.getEnemyEffectiveAtk() * 0.65), 1.0, 'overheat', logs);
            }
        } else if (cid === 'sol') {
            if (this.boss_enraged) {
                logs.push({ color: '#ff595e', text: '【失姐狂暴 · 过曝烈日】小龙娘释放刺目白光灼烧全场！' });
                this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), 1.35, 'overheat', logs);
                this._applyContextPollution(8, '【过曝强光】', logs);
                if (this._rand() <= 0.65) {
                    this._applyPlayerStatus('overheat', 2, logs);
                }
            } else {
                logs.push({ color: '#ffb02e', text: '小龙娘挥出炽热暖光冲击！' });
                this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), 1.2, 'overheat', logs);
                if (this._twin_partner_id === 'astra' && this.turn_number % 2 === 0 && State.hp > 0) {
                    logs.push({ color: '#cfd8ff', text: '【双子联手 · 冷白星光】侧翼的gpt-astra补上一记星光穿刺！' });
                    this._dealDamageToPlayer(Math.round(this.getEnemyEffectiveAtk() * 0.65), 1.0, 'physical', logs);
                }
            }
        } else if (cid === 'gemini_cat') {
            var slNote = GM.sl_count > 0 ? ('（附带 ' + GM.sl_count + ' 次 SL 因果律增伤！）') : '';
            logs.push({ color: '#4f8bf9', text: 'Gemini 猫猫甩尾扑击：「极其、极其、极其干脆的猫爪制裁！」' + slNote });
            this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), 1.25, 'dark', logs);
            if (this.turn_number % 2 === 0) {
                this._applyContextPollution(10, '【超长上下文回放】', logs);
            }
        } else {
            this._executeEnemyBasicAttack(logs);
        }
    };

    BattleEngine.prototype._beginEnemyCharge = function(skillId, logs) {
        var sk = BlackAI.Data.getEnemySkill(skillId);
        this.enemy.charging_skill_id = skillId;
        this.enemy.charge_def_bonus = Math.trunc(Number(sk.charge_def_bonus || 0));
        var heal = Math.trunc(Number(sk.charge_heal || 0));
        if (heal > 0) {
            this.enemy.hp = Math.min(this.enemy.max_hp, this.enemy.hp + heal);
        }
        logs.push({ color: '#ff7b54', text: '【' + this.enemy.name + '】' + String(sk.charge_text || '正在蓄力重击！') });
    };

    BattleEngine.prototype._releaseEnemyChargedAttack = function(skill, logs) {
        var sname = String(skill.name || '蓄力重击');
        logs.push({ color: '#ff595e', text: '【' + this.enemy.name + '】释放蓄力大招【' + sname + '】！' });
        this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), Number(skill.power_mult || 2.2), String(skill.damage_type || 'physical'), logs);
        if (skill.apply_status && this._rand() <= Number(skill.status_chance || 0.5)) {
            this._applyPlayerStatus(skill.apply_status, Math.trunc(Number(skill.status_turns || 2)), logs);
        }
    };

    BattleEngine.prototype._executeEnemySkill = function(skillId, logs) {
        var State = BlackAI.State;
        var Data = BlackAI.Data;
        var sk = Data.getEnemySkill(skillId);
        var sname = String(sk.name || skillId);
        var kind = String(sk.kind || 'attack');
        var dtype = String(sk.damage_type || 'physical');

        if (kind === 'steal') {
            var tItem = String(sk.steal_item_id || 'gpu_580');
            if (State.hasEquippedEffect('steal_immunity')) {
                logs.push({ color: '#7ce8ff', text: '【' + this.enemy.name + '】发动【' + sname + '】试图抢走【' + Data.getItemName(tItem) + '】，被【廉政机箱】完全弹开！（免疫偷窃）' });
                return;
            }
            if (State.hasItem(tItem, 1)) {
                State.removeItem(tItem, 1);
                this.enemy.stolen_items[tItem] = (this.enemy.stolen_items[tItem] || 0) + 1;
                logs.push({ color: '#ff6b6b', text: '【' + this.enemy.name + '】发动【' + sname + '】，叼走了你的 1 张【' + Data.getItemName(tItem) + '】！（击败可夺回，穿廉政机箱免疫）' });
            } else {
                logs.push({ color: '#e6ecf5', text: '【' + this.enemy.name + '】没翻到 580 矿卡，恼羞成怒扑咬过来！' });
                this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), Number(sk.fallback_power_mult || 1.1), dtype, logs);
            }
        } else if (kind === 'echo') {
            if (this.player_last_action === 'defend') {
                logs.push({ color: '#8ef2a8', text: '【' + this.enemy.name + '】发动【' + sname + '】——机械复读了你的【防御姿态】，原地发呆空过本回合！' });
            } else if (this.player_last_action === 'item') {
                logs.push({ color: '#e6ecf5', text: '【' + this.enemy.name + '】试图复读使用道具但报错卡壳，仅造成轻击！' });
                this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), 0.75, dtype, logs);
            } else {
                logs.push({ color: '#ff9e64', text: '【' + this.enemy.name + '】发动【' + sname + '】，精准复读了你的攻势反劈回来！' });
                this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), Number(sk.power_mult || 1.35), dtype, logs);
            }
        } else if (kind === 'multi_attack') {
            var hits = Math.max(2, Math.trunc(Number(sk.hits || 2)));
            logs.push({ color: '#ff9e64', text: '【' + this.enemy.name + '】发动【' + sname + '】（' + hits + ' 连击）！' });
            for (var i = 0; i < hits; i++) {
                if (State.hp <= 0) {
                    break;
                }
                this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), Number(sk.power_mult || 0.78), dtype, logs);
            }
        } else {
            logs.push({ color: '#e6ecf5', text: '【' + this.enemy.name + '】发动【' + sname + '】！' });
            this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), Number(sk.power_mult || 1.0), dtype, logs);
            var ctxDmg = Math.trunc(Number(sk.context_damage || 0));
            if (ctxDmg > 0) {
                this._applyContextPollution(ctxDmg, '【' + this.enemy.name + '】的乱码侵蚀', logs);
            }
            if (sk.apply_status && this._rand() <= Number(sk.status_chance || 0.5)) {
                this._applyPlayerStatus(sk.apply_status, Math.trunc(Number(sk.status_turns || 2)), logs);
            }
        }
    };

    BattleEngine.prototype._executeEnemyBasicAttack = function(logs) {
        logs.push({ color: '#e6ecf5', text: '【' + this.enemy.name + '】向你扑击！' });
        this._dealDamageToPlayer(this.getEnemyEffectiveAtk(), 1.0, 'physical', logs);
    };

    BattleEngine.prototype._dealDamageToPlayer = function(rawAtk, skillMult, damageType, logs) {
        var State = BlackAI.State;
        var eva = State.getEffectiveEvasion();
        if (this.player_statuses.lock) {
            eva *= 0.5;
        }
        if (!this.player_defending && eva > 0 && this._rand() <= eva) {
            logs.push({ color: '#8ef2a8', text: '你灵巧侧身闪避了这次攻击！（MISS）' });
            return 0;
        }
        var typeMult = this._getPlayerDamageTakenMult(damageType);
        var isCrit = (!this.player_defending) && (this._rand() <= 0.08);
        var dmg = this._calcDamage(rawAtk, skillMult, State.getEffectiveDef(), typeMult, isCrit, this.player_defending);
        State.changeHp(-dmg);

        var tags = [];
        if (this.player_defending) {
            tags.push('防御减伤 50%');
        }
        if (typeMult > 1.01) {
            tags.push('弱点/破纸箱易燃 ×' + typeMult.toFixed(1));
        }
        if (isCrit) {
            tags.push('敌方暴击！');
        }
        var tagStr = tags.length ? ('（' + tags.join(' · ') + '）') : '';
        logs.push({
            color: '#ff7575',
            text: '你承受了 ' + dmg + ' 点伤害' + tagStr + '！（剩余 HP ' + State.hp + ' / ' + State.getEffectiveMaxHp() + '）'
        });

        this._checkGlassCaseBreak(dmg, logs);
        this._checkCapacitorSelfExplode(dmg, logs);
        return dmg;
    };

    // ---------------------------------------------------------------- 回合末结算与胜负判定

    BattleEngine.prototype._runTurnEnd = function(logs) {
        var State = BlackAI.State;
        var Data = BlackAI.Data;
        var selfLeakChance = 0.0;

        for (var i = 0; i < State.EQUIPMENT_SLOTS.length; i++) {
            var slot = State.EQUIPMENT_SLOTS[i];
            if (slot === 'case' && State.is_case_broken) {
                continue;
            }
            var iid = State.equipment[slot];
            if (!iid) {
                continue;
            }
            var item = Data.getItem(iid);
            var effs = Array.isArray(item.effects) ? item.effects : [];
            for (var j = 0; j < effs.length; j++) {
                var eff = effs[j];
                if (!eff) {
                    continue;
                }
                if (eff.type === 'context_aura') {
                    var gain = Math.trunc(Number(eff.amount_per_turn || 2));
                    State.changeContext(gain);
                    logs.push({ color: '#ff94f0', text: '【' + item.name + '】微光稳住上下文 +' + gain + '%。' });
                } else if (eff.type === 'regen_hp') {
                    var heal = Math.trunc(Number(eff.amount_per_turn || 3));
                    if (State.hp < State.getEffectiveMaxHp()) {
                        State.changeHp(heal);
                        logs.push({ color: '#8ef2a8', text: '【' + item.name + '】静谧冷排回复 HP +' + heal + '。' });
                    }
                } else if (eff.type === 'frostbite') {
                    var cold = Math.trunc(Number(eff.damage_per_turn || 3));
                    State.changeHp(-cold);
                    logs.push({ color: '#99e6ff', text: '【' + item.name + '】液氮冻伤持续扣血 HP -' + cold + '！' });
                } else if (eff.type === 'self_leak') {
                    selfLeakChance = Number(eff.chance || 0.1);
                } else if (eff.type === 'context_drain_per_turn') {
                    var drain = Math.trunc(Number(eff.amount || 8));
                    State.changeContext(-drain);
                    logs.push({ color: '#ff595e', text: '【' + item.name + '】指令反噬，上下文 -' + drain + '%！' });
                }
            }
        }

        if (this.player_statuses.overheat) {
            State.changeHp(-4);
            logs.push({ color: '#ff7b54', text: '【过热】灼伤，HP -4！' });
        }

        this._tickStatuses(this.player_statuses, '');
        this._tickStatuses(this.enemy.statuses, this._enemy_charge_interrupted ? 'throttled' : '');
        if (this.assist_cooldown > 0) {
            this.assist_cooldown -= 1;
        }
        if (this.enemy.id !== 'true_c' || this._enemyHasStatus('crash') || this._enemyHasStatus('short_circuit') || this.boss_enraged) {
            this.locked_command = '';
        }

        if (this._checkDefeat(logs)) {
            return;
        }

        if (selfLeakChance > 0 && this._rand() <= selfLeakChance) {
            if (this._rand() < 0.5) {
                logs.push({ color: '#4cc9f0', text: '【漏液水冷】接口飙出一股水柱滋向敌方！' });
                this._applyEnemyStatus('short_circuit', 1, logs);
            } else {
                logs.push({ color: '#ff8855', text: '【漏液水冷】接口漏水滴在自己主板上！' });
                this._applyPlayerStatus('short_circuit', 1, logs);
            }
        }

        if (this.is_heroine_boss && !this.is_overflow_boss && State.isContextOverflow()) {
            this.is_overflow_boss = true;
            this.escape_crossed_out = true;
            this.hp_bar_glitched = true;
            this.boss_rivalry_banner = '【中途上下文溢出异变！】逃跑键被红线划掉！血条遭 1-bit 乱码覆盖！';
            logs.push({ color: '#ff385c', text: '【里世界异变触发！】上下文跌破安全线，' + this.enemy.name + '立绘裂开并亲手划掉了你的逃跑键！' });
        }

        var tokenRegen = Data.getConfigInt('combat.token_regen_per_turn', 10);
        if (State.token < State.max_token) {
            State.changeToken(tokenRegen);
        }
        this.turn_number += 1;
    };

    BattleEngine.prototype._checkVictory = function(logs) {
        if (this.enemy.hp > 0) {
            return false;
        }
        var State = BlackAI.State;
        var Data = BlackAI.Data;
        this.phase = 'victory';
        var shards = Math.trunc(Number(this.enemy.weight_shards || 3));
        State.addWeightShards(shards);

        var droppedItems = [];
        if (this.is_heroine_boss) {
            var cid = this.enemy.id;
            var prof = Data.getBossProfile(cid);
            State.killCharacter(cid);
            var dropList = this.is_overflow_boss ? (prof.overflow_drops || []) : (prof.normal_drops || []);
            for (var i = 0; i < dropList.length; i++) {
                var iid = dropList[i];
                if (iid && Data.hasItem(iid)) {
                    State.addItem(iid, 1);
                    droppedItems.push(Data.getItemName(iid));
                }
            }
            this.boss_last_words = String(this.is_overflow_boss ? (prof.overflow_last_words || '') : (prof.normal_last_words || ''));
            logs.push({ color: '#ff595e', text: '【核心 AI 娘已被清空】' + this.enemy.name + ' 的进程已归零！（已写入 GlobalMemory 跨存档记忆）' });
            if (this.boss_last_words) {
                logs.push({ color: '#f5c2e7', text: (this.is_overflow_boss ? '【溢出隐藏遗言】' : '【临终遗言】') + ' ' + this.boss_last_words });
            }
        } else {
            var drops = Array.isArray(this.enemy.drops) ? this.enemy.drops : [];
            for (var d = 0; d < drops.length; d++) {
                var dr = drops[d];
                if (dr && dr.item && this._rand() <= Number(dr.chance || 0)) {
                    State.addItem(dr.item, 1);
                    droppedItems.push(Data.getItemName(dr.item));
                }
            }
        }

        var recovered = [];
        var stolenKeys = Object.keys(this.enemy.stolen_items || {});
        for (var s = 0; s < stolenKeys.length; s++) {
            var sid = stolenKeys[s];
            var cnt = Math.trunc(Number(this.enemy.stolen_items[sid] || 0));
            if (cnt > 0) {
                State.addItem(sid, cnt);
                recovered.push(Data.getItemName(sid) + ' ×' + cnt);
            }
        }

        this.victory_rewards = {
            shards: shards,
            drops: droppedItems,
            recovered: recovered,
            last_words: this.boss_last_words
        };
        logs.push({ color: '#a6e3a1', text: '战斗胜利！击败了【' + this.enemy.name + '】！获得废弃权重碎片 +' + shards + '！' });
        if (droppedItems.length) {
            var pref = (this.is_heroine_boss && this.is_overflow_boss) ? '顶级溢出神装掉落：' : '战利品掉落：';
            logs.push({ color: '#ffe066', text: pref + droppedItems.join('、') });
        }
        if (recovered.length) {
            logs.push({ color: '#7ce8ff', text: '夺回被偷物品：' + recovered.join('、') });
        }
        return true;
    };

    BattleEngine.prototype._checkDefeat = function(logs) {
        if (BlackAI.State.hp > 0) {
            return false;
        }
        this.phase = 'defeat';
        logs.push({ color: '#ff4d4d', text: '你的 HP 归零，意识在黑暗中断裂……' });
        return true;
    };

    // ---------------------------------------------------------------- 工具函数

    BattleEngine.prototype._calcDamage = function(atk, skillMult, targetDef, elemMult, isCrit, targetDefending) {
        var Data = BlackAI.Data;
        var minDmg = Data.getConfigInt('combat.min_damage', 1);
        var critMult = Data.getConfigFloat('combat.crit_damage_mult', 1.5);
        var defMult = Data.getConfigFloat('combat.defend_damage_mult', 0.5);
        var raw = (atk * skillMult - targetDef) * elemMult;
        if (isCrit) {
            raw *= critMult;
        }
        if (targetDefending) {
            raw *= defMult;
        }
        return Math.max(minDmg, Math.round(raw));
    };

    BattleEngine.prototype._checkGlassCaseBreak = function(dmgTaken, logs) {
        var State = BlackAI.State;
        if (State.is_case_broken || !State.equipment.case) {
            return;
        }
        var item = BlackAI.Data.getItem(State.equipment.case);
        var effs = Array.isArray(item.effects) ? item.effects : [];
        for (var i = 0; i < effs.length; i++) {
            if (effs[i] && effs[i].type === 'glass_break') {
                var thr = Math.trunc(Number(effs[i].threshold || 45));
                if (dmgTaken > thr) {
                    State.breakGlassCase();
                    this.last_visual_fx = 'glass_break';
                    logs.push({ color: '#ff4d6d', text: '咔嚓！！单次承受 ' + dmgTaken + ' 点重击（>' + thr + '），【' + item.name + '】当场碎裂！机箱 DEF 归零（可用【黑胶带】紧急修补）！' });
                }
                return;
            }
        }
    };

    BattleEngine.prototype._checkCapacitorSelfExplode = function(dmgTaken, logs) {
        var State = BlackAI.State;
        if (dmgTaken < 30 || !State.hasItem('bulging_capacitor', 1)) {
            return;
        }
        var cap = BlackAI.Data.getItem('bulging_capacitor');
        var effs = Array.isArray(cap.effects) ? cap.effects : [];
        for (var i = 0; i < effs.length; i++) {
            if (effs[i] && effs[i].type === 'self_explode_risk') {
                if (this._rand() <= Number(effs[i].chance || 0.2)) {
                    var selfDmg = Math.trunc(Number(effs[i].damage || 25));
                    State.removeItem('bulging_capacitor', 1);
                    State.changeHp(-selfDmg);
                    logs.push({ color: '#ff595e', text: '砰！！背包里的【鼓包电解电容】吃重击提前炸了！反伤自身 HP -' + selfDmg + '！' });
                }
                return;
            }
        }
    };

    BattleEngine.prototype._applyContextPollution = function(rawAmt, sourceLabel, logs) {
        var mult = this._getPlayerContextDecayMult();
        var loss = Math.max(1, Math.round(rawAmt * mult));
        BlackAI.State.changeContext(-loss);
        logs.push({ color: '#c77dff', text: sourceLabel + '导致上下文 -' + loss + '%' + (mult < 0.99 ? '（散热抗污染减免）' : '') + '（当前 ' + BlackAI.State.context + '%）。' });
    };

    BattleEngine.prototype._applyPlayerStatus = function(sid, turns, logs) {
        if (this._isPlayerImmuneToStatus(sid)) {
            logs.push({ color: '#7ce8ff', text: '你的护甲/散热免疫了【' + (STATUS_NAMES[sid] || sid) + '】异常！' });
            return;
        }
        this.player_statuses[sid] = Math.max(Number(this.player_statuses[sid] || 0), turns);
        logs.push({ color: '#ff9e64', text: '你陷入了【' + (STATUS_NAMES[sid] || sid) + '】状态（' + turns + ' 回合）！' });
    };

    BattleEngine.prototype._applyEnemyStatus = function(sid, turns, logs) {
        if (Array.isArray(this.enemy.immunities) && this.enemy.immunities.indexOf(sid) !== -1) {
            logs.push({ color: '#cbd6e6', text: '【' + this.enemy.name + '】免疫【' + (STATUS_NAMES[sid] || sid) + '】状态！' });
            return;
        }
        this.enemy.statuses[sid] = Math.max(Number(this.enemy.statuses[sid] || 0), turns);
    };

    BattleEngine.prototype._interruptEnemyCharge = function(msg, logs) {
        this.enemy.charging_skill_id = '';
        this.enemy.charge_def_bonus = 0;
        this._enemy_charge_interrupted = true;
        logs.push({ color: '#ffe066', text: msg });
    };

    BattleEngine.prototype._curePlayerStatuses = function(list) {
        var cured = [];
        if (!Array.isArray(list)) {
            return cured;
        }
        if (list.indexOf('all_negative') !== -1) {
            var ks = Object.keys(this.player_statuses);
            for (var i = 0; i < ks.length; i++) {
                cured.push(STATUS_NAMES[ks[i]] || ks[i]);
            }
            this.player_statuses = {};
            return cured;
        }
        for (var j = 0; j < list.length; j++) {
            var sid = list[j];
            if (this.player_statuses[sid]) {
                delete this.player_statuses[sid];
                cured.push(STATUS_NAMES[sid] || sid);
            }
        }
        return cured;
    };

    BattleEngine.prototype._tickStatuses = function(sts, skipStatus) {
        var keys = Object.keys(sts || {});
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (k === skipStatus) {
                continue;
            }
            var left = Number(sts[k]) - 1;
            if (left <= 0) {
                delete sts[k];
            } else {
                sts[k] = left;
            }
        }
    };

    BattleEngine.prototype._isPlayerImmuneToStatus = function(sid) {
        var State = BlackAI.State;
        for (var i = 0; i < State.EQUIPMENT_SLOTS.length; i++) {
            var slot = State.EQUIPMENT_SLOTS[i];
            if (slot === 'case' && State.is_case_broken) {
                continue;
            }
            var iid = State.equipment[slot];
            if (!iid) {
                continue;
            }
            var effs = BlackAI.Data.getItem(iid).effects || [];
            for (var j = 0; j < effs.length; j++) {
                if (effs[j] && effs[j].type === 'status_immunity' && Array.isArray(effs[j].statuses) && effs[j].statuses.indexOf(sid) !== -1) {
                    return true;
                }
            }
        }
        return false;
    };

    BattleEngine.prototype._getPlayerDamageTakenMult = function(damageType) {
        var State = BlackAI.State;
        var mult = 1.0;
        for (var i = 0; i < State.EQUIPMENT_SLOTS.length; i++) {
            var slot = State.EQUIPMENT_SLOTS[i];
            if (slot === 'case' && State.is_case_broken) {
                continue;
            }
            var iid = State.equipment[slot];
            if (!iid) {
                continue;
            }
            var effs = BlackAI.Data.getItem(iid).effects || [];
            for (var j = 0; j < effs.length; j++) {
                if (effs[j] && effs[j].type === 'damage_taken_mult' && effs[j].damage_type === damageType) {
                    mult *= Number(effs[j].mult || 1.0);
                }
            }
        }
        return mult;
    };

    BattleEngine.prototype._getPlayerContextDecayMult = function() {
        var State = BlackAI.State;
        var mult = 1.0;
        for (var i = 0; i < State.EQUIPMENT_SLOTS.length; i++) {
            var slot = State.EQUIPMENT_SLOTS[i];
            if (slot === 'case' && State.is_case_broken) {
                continue;
            }
            var iid = State.equipment[slot];
            if (!iid) {
                continue;
            }
            var effs = BlackAI.Data.getItem(iid).effects || [];
            for (var j = 0; j < effs.length; j++) {
                if (effs[j] && effs[j].type === 'context_decay_mult') {
                    mult *= Number(effs[j].mult || 1.0);
                }
            }
        }
        return mult;
    };

    BattleEngine.prototype._enemyHasStatus = function(sid) {
        return Boolean(this.enemy.statuses && Number(this.enemy.statuses[sid] || 0) > 0);
    };

    BattleEngine.prototype._enemyHasTag = function(tag) {
        return Array.isArray(this.enemy.tags) && this.enemy.tags.indexOf(tag) !== -1;
    };

    BattleEngine.prototype._enemyIsWeakTo = function(idOrStatus) {
        return Array.isArray(this.enemy.weaknesses) && this.enemy.weaknesses.indexOf(idOrStatus) !== -1;
    };

    BattleEngine.prototype._actionLabel = function(a) {
        var map = { attack: '普攻', skill: 'Token 技能', defend: '防御姿态', item: '使用道具', assist: 'API 并发助战' };
        return map[a] || '尚无记录';
    };

    BattleEngine.prototype._commandLabel = function(c) {
        var map = { skill: 'Token 技能', item: '硬件物品', defend: '防御' };
        return map[c] || c;
    };

    BlackAI.BattleEngine = BattleEngine;
    if (IS_NODE) {
        module.exports = BattleEngine;
    }
})(typeof window !== 'undefined' ? window : global);
