/*:
 * @plugindesc 《BLACK AI》M5+M6 BS2 高难回合制战斗界面（含输出截断横幅、并发助战按钮、小claude 封锁、红线划掉逃跑与 1-bit 血条乱码）
 * @author BLACK AI Team
 * @help
 * 由 BlackAI_AltarWorld.js 调用 Scene_BlackAIBattle.startBattle(...) 启动，战后无缝返回地图原坐标。
 */

(function(globalScope) {
    'use strict';

    var BlackAI = globalScope.BlackAI || {};
    globalScope.BlackAI = BlackAI;

    var GLITCH_CHARS = ['█', '▓', '▒', '░', '?', '#', '4', '0'];

    function glitchDigits(source) {
        if (!source || source.length < 4) {
            return source;
        }
        var out = '';
        for (var i = 0; i < source.length; i++) {
            var ch = source.charAt(i);
            if (ch >= '0' && ch <= '9' && Math.random() < 0.45) {
                out += GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
            } else {
                out += ch;
            }
        }
        return out;
    }

    function Scene_BlackAIBattle() {
        this.initialize.apply(this, arguments);
    }
    Scene_BlackAIBattle.prototype = Object.create(Scene_Base.prototype);
    Scene_BlackAIBattle.prototype.constructor = Scene_BlackAIBattle;

    Scene_BlackAIBattle._pendingConfig = null;

    Scene_BlackAIBattle.startBattle = function(cfg, replaceScene) {
        this._pendingConfig = cfg;
        if (replaceScene) {
            SceneManager.goto(Scene_BlackAIBattle);
        } else {
            SceneManager.push(Scene_BlackAIBattle);
        }
    };

    Scene_BlackAIBattle.prototype.initialize = function() {
        Scene_Base.prototype.initialize.call(this);
        var cfg = Scene_BlackAIBattle._pendingConfig || {
            targetId: 'glitch_ghost',
            isHeroineBoss: false,
            eventId: 0,
            isPreemptive: false
        };
        this._targetId = cfg.targetId;
        this._isHeroineBoss = Boolean(cfg.isHeroineBoss);
        this._eventId = Number(cfg.eventId || 0);
        this._isPreemptive = Boolean(cfg.isPreemptive);
        this._engine = new BlackAI.BattleEngine();
        this._logLines = [];
        this._submenu = ''; // '' / 'skills' / 'items'
        this._itemPage = 0;
        this._fxTimer = 0;
        this._fxKind = '';
        this._glitchTimer = 0;
        this._glitchEnemyHp = '';
        this._glitchPlayerHp = '';
        this._cmdButtons = [];
        this._subButtons = [];
        this._finishBtn = null;
    };

    Scene_BlackAIBattle.prototype.create = function() {
        Scene_Base.prototype.create.call(this);
        this._canvas = new Sprite(new Bitmap(1280, 720));
        this.addChild(this._canvas);

        // 敌方立绘精灵（支持受击震动与着色）
        this._portraitSprite = new Sprite();
        this._portraitSprite.x = 64;
        this._portraitSprite.y = 74;
        this._portraitBaseX = 64;
        this._portraitBaseY = 74;
        this.addChild(this._portraitSprite);

        this._cmdLayer = new Sprite();
        this.addChild(this._cmdLayer);

        this._subLayer = new Sprite();
        this.addChild(this._subLayer);

        var self = this;
        var cy = 472;
        var specs = [
            { key: 'attack', x: 468, w: 102, text: '普攻', fn: function() { self._executeTurn('attack', ''); } },
            { key: 'skill',  x: 576, w: 122, text: 'Token技能', fn: function() { self._toggleSubmenu('skills'); } },
            { key: 'defend', x: 704, w: 126, text: '防御(-50%)', fn: function() { self._executeTurn('defend', ''); } },
            { key: 'item',   x: 836, w: 118, text: '硬件物品', fn: function() { self._toggleSubmenu('items'); } },
            { key: 'assist', x: 960, w: 138, text: '助战(未设)', fn: function() { self._executeTurn('assist', ''); } },
            { key: 'escape', x: 1104, w: 114, text: '逃跑', fn: function() { self._executeTurn('escape', ''); } }
        ];
        this._btnByKey = {};
        for (var i = 0; i < specs.length; i++) {
            var sp = specs[i];
            var btn = BlackAI.UI.createRectButton(sp.x, cy, sp.w, 38, sp.text, sp.fn, {
                fontSize: 15, bg: '#1d2436', border: '#7588ab'
            });
            this._btnByKey[sp.key] = btn;
            this._cmdButtons.push(btn);
            this._cmdLayer.addChild(btn);
        }

        this._finishBtn = BlackAI.UI.createRectButton(468, 636, 750, 44, '返回探索地图（Enter）', function() {
            self._finishAndReturn();
        }, { bg: '#223d5a', border: '#7ce8ff', fontSize: 17 });
        this._finishBtn.visible = false;
        this.addChild(this._finishBtn);

        var introLogs = this._isHeroineBoss
            ? this._engine.startHeroineBossBattle(this._targetId, this._isPreemptive)
            : this._engine.startMonsterBattle(this._targetId, this._isPreemptive);
        this._appendLogs(introLogs);
        this._refreshAll();
    };

    Scene_BlackAIBattle.prototype.update = function() {
        Scene_Base.prototype.update.call(this);

        // 受击震动特效
        if (this._fxTimer > 0) {
            this._fxTimer = Math.max(0, this._fxTimer - 1 / 60);
            if (this._fxTimer > 0) {
                var amp = (this._fxKind === 'crit' || this._fxKind === 'lightning') ? 8 : 4;
                this._portraitSprite.x = this._portraitBaseX + Math.round((Math.random() * 2 - 1) * amp);
                this._portraitSprite.y = this._portraitBaseY + Math.round((Math.random() * 2 - 1) * amp);
            } else {
                this._portraitSprite.x = this._portraitBaseX;
                this._portraitSprite.y = this._portraitBaseY;
                this._portraitSprite.setColorTone([0, 0, 0, 0]);
            }
        }

        // 上下文溢出 Boss 战：1-bit 乱码糊血条定时刷新
        if (this._engine.hp_bar_glitched) {
            this._glitchTimer += 1 / 60;
            if (this._glitchTimer >= 0.18) {
                this._glitchTimer = 0;
                this._redrawCanvas();
            }
        }

        if (this._engine.isBattleOver()) {
            if (this._finishBtn.updateButton() || Input.isTriggered('ok') || Input.isTriggered('cancel')) {
                SoundManager.playOk();
                this._finishAndReturn();
            }
            return;
        }

        for (var i = 0; i < this._cmdButtons.length; i++) {
            if (this._cmdButtons[i].updateButton()) {
                return;
            }
        }
        for (var j = 0; j < this._subButtons.length; j++) {
            if (this._subButtons[j].updateButton()) {
                return;
            }
        }
        if (Input.isTriggered('cancel') && this._submenu) {
            SoundManager.playCancel();
            this._submenu = '';
            this._rebuildSubmenu();
            this._redrawCanvas();
        }
    };

    Scene_BlackAIBattle.prototype._toggleSubmenu = function(mode) {
        this._submenu = (this._submenu === mode) ? '' : mode;
        this._itemPage = 0;
        this._rebuildSubmenu();
        this._redrawCanvas();
    };

    Scene_BlackAIBattle.prototype._executeTurn = function(actionType, actionArg) {
        if (this._engine.isBattleOver()) {
            return;
        }
        this._submenu = '';
        var logs = this._engine.executePlayerTurn(actionType, actionArg);
        this._appendLogs(logs);
        if (this._engine.last_visual_fx) {
            this._triggerFx(this._engine.last_visual_fx);
        }
        this._refreshAll();
    };

    Scene_BlackAIBattle.prototype._triggerFx = function(kind) {
        this._fxKind = kind;
        this._fxTimer = 0.28;
        if (kind === 'water_crash') {
            this._portraitSprite.setColorTone([-40, 60, 120, 0]);
        } else if (kind === 'lightning') {
            this._portraitSprite.setColorTone([90, 90, -20, 0]);
        } else if (kind === 'crit' || kind === 'truncated' || kind === 'glass_break') {
            this._portraitSprite.setColorTone([120, -30, -30, 0]);
        } else {
            this._portraitSprite.setColorTone([80, 20, 20, 0]);
        }
    };

    Scene_BlackAIBattle.prototype._appendLogs = function(entries) {
        if (!Array.isArray(entries)) {
            return;
        }
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (typeof e === 'string') {
                this._logLines.push({ color: '#e6ecf5', text: e });
            } else if (e && e.text) {
                this._logLines.push({ color: e.color || '#e6ecf5', text: String(e.text) });
            }
        }
        while (this._logLines.length > 40) {
            this._logLines.shift();
        }
    };

    Scene_BlackAIBattle.prototype._refreshAll = function() {
        this._refreshPortrait();
        this._refreshCommandButtons();
        this._rebuildSubmenu();
        this._redrawCanvas();
    };

    Scene_BlackAIBattle.prototype._refreshPortrait = function() {
        var corrupted = this._engine.is_overflow_boss || this._engine.boss_enraged;
        var baseName = 'BlackAI_' + this._targetId + (this._isHeroineBoss && corrupted ? '_overflow' : '');
        var bmp = ImageManager.loadEnemy(baseName, 0);
        this._portraitSprite.bitmap = bmp;
        this._portraitSprite.scale.x = 0.64;
        this._portraitSprite.scale.y = 0.64;
    };

    Scene_BlackAIBattle.prototype._refreshCommandButtons = function() {
        var over = this._engine.isBattleOver();
        this._cmdLayer.visible = !over;
        this._finishBtn.visible = over;

        if (over) {
            var ph = this._engine.phase;
            this._finishBtn.setLabel(
                ph === 'victory' ? '领取战利品并返回地图（Enter）'
                    : (ph === 'defeat' ? '在巨型大 PSU 电源前重新苏醒（Enter）' : '返回探索坐标（Enter）')
            );
            return;
        }

        var locked = this._engine.locked_command;
        var crossed = this._engine.escape_crossed_out;

        var setLockStyle = function(btn, isLocked, normalLabel, lockLabel) {
            btn._disabled = isLocked;
            btn._label = isLocked ? lockLabel : normalLabel;
            btn._border = isLocked ? '#ff4f5e' : '#7588ab';
            btn._textColor = isLocked ? '#ff8b96' : '#eef2f8';
            btn.redraw();
        };

        setLockStyle(this._btnByKey.skill, locked === 'skill', 'Token技能', '技能[封锁]');
        setLockStyle(this._btnByKey.defend, locked === 'defend', '防御(-50%)', '防御[封锁]');
        setLockStyle(this._btnByKey.item, locked === 'item', '硬件物品', '物品[封锁]');

        var assist = this._engine.canUseAssist();
        var ab = this._btnByKey.assist;
        ab._disabled = !assist.ok;
        if (assist.ok) {
            var shortName = assist.partner_name.length > 5 ? assist.partner_name.slice(0, 4) : assist.partner_name;
            ab._label = '助战:' + shortName;
            ab._border = '#7ce8ff';
            ab._textColor = '#c8f5ff';
        } else if (assist.partner_name) {
            ab._label = '助战(CD)';
            ab._border = '#4f5769';
            ab._textColor = '#7d8596';
        } else {
            ab._label = '助战(未设)';
            ab._border = '#4f5769';
            ab._textColor = '#7d8596';
        }
        ab.redraw();

        var eb = this._btnByKey.escape;
        eb._disabled = crossed;
        eb._strikeRed = crossed;
        eb._label = crossed ? '逃跑[划掉]' : '逃跑';
        eb._border = crossed ? '#ff2a3c' : '#7588ab';
        eb._textColor = crossed ? '#ff6470' : '#eef2f8';
        eb.redraw();
    };

    Scene_BlackAIBattle.prototype._clearSubmenu = function() {
        while (this._subLayer.children.length > 0) {
            this._subLayer.removeChildAt(0);
        }
        this._subButtons = [];
    };

    Scene_BlackAIBattle.prototype._rebuildSubmenu = function() {
        this._clearSubmenu();
        if (this._engine.isBattleOver()) {
            return;
        }
        var self = this;
        var State = BlackAI.State;
        var Data = BlackAI.Data;
        var sx = 468;
        var sy = 544;
        var sw = 750;

        if (this._submenu === 'skills') {
            var sids = Data.getPlayerSkillIds();
            for (var i = 0; i < sids.length; i++) {
                (function(sid, idx) {
                    var sk = Data.getPlayerSkill(sid);
                    var cost = Number(sk.token_cost || 20);
                    var willTrunc = State.token < cost;
                    var text = sk.name + '（' + cost + ' Token）— ' + (sk.description || '') + (willTrunc ? '  [⚠ Token不足→强放截断!]' : '');
                    var btn = BlackAI.UI.createRectButton(sx, sy + idx * 36, sw, 32, text, function() {
                        self._executeTurn('skill', sid);
                    }, {
                        align: 'left',
                        fontSize: 14,
                        bg: willTrunc ? '#3c1b1d' : '#1b263b',
                        border: willTrunc ? '#ff6454' : '#6ea8dc',
                        textColor: willTrunc ? '#ffb2a8' : '#e8f1fb'
                    });
                    self._subButtons.push(btn);
                    self._subLayer.addChild(btn);
                })(sids[i], i);
            }
        } else if (this._submenu === 'items') {
            var items = this._collectBattleItems();
            var perPage = 4;
            var totalPages = Math.max(1, Math.ceil(items.length / perPage));
            this._itemPage = Math.max(0, Math.min(totalPages - 1, this._itemPage));
            var start = this._itemPage * perPage;
            var end = Math.min(items.length, start + perPage);

            for (var k = start; k < end; k++) {
                (function(iid, row) {
                    var item = Data.getItem(iid);
                    var cnt = State.getItemCount(iid);
                    var label = item.name + ' ×' + cnt + ' — ' + self._battleItemHint(iid, item);
                    var btn = BlackAI.UI.createRectButton(sx, sy + row * 34, sw, 30, label, function() {
                        self._executeTurn('item', iid);
                    }, { align: 'left', fontSize: 14, bg: '#1a2d28', border: '#65bf95' });
                    self._subButtons.push(btn);
                    self._subLayer.addChild(btn);
                })(items[k], k - start);
            }

            if (totalPages > 1) {
                var prevBtn = BlackAI.UI.createRectButton(sx + sw - 180, 514, 84, 24, '◀ 上页', function() {
                    self._itemPage = (self._itemPage + totalPages - 1) % totalPages;
                    self._rebuildSubmenu();
                    self._redrawCanvas();
                }, { fontSize: 13, bg: '#22283a', border: '#7484a6' });
                var nextBtn = BlackAI.UI.createRectButton(sx + sw - 88, 514, 88, 24, '下页 ▶', function() {
                    self._itemPage = (self._itemPage + 1) % totalPages;
                    self._rebuildSubmenu();
                    self._redrawCanvas();
                }, { fontSize: 13, bg: '#22283a', border: '#7484a6' });
                this._subButtons.push(prevBtn, nextBtn);
                this._subLayer.addChild(prevBtn);
                this._subLayer.addChild(nextBtn);
            }
        }
    };

    Scene_BlackAIBattle.prototype._collectBattleItems = function() {
        var State = BlackAI.State;
        var Data = BlackAI.Data;
        var out = [];
        var keys = Object.keys(State.inventory).sort();
        for (var i = 0; i < keys.length; i++) {
            var iid = keys[i];
            if (State.getItemCount(iid) <= 0) {
                continue;
            }
            var item = Data.getItem(iid);
            var cat = Data.getItemCategory(iid);
            if (cat === 'weapons' && item.slot === 'throwable') {
                out.push(iid);
            } else if (cat === 'consumables' && Array.isArray(item.usable_in) && item.usable_in.indexOf('battle') !== -1) {
                out.push(iid);
            } else if (iid === 'gpu_580') {
                out.push(iid);
            }
        }
        return out;
    };

    Scene_BlackAIBattle.prototype._battleItemHint = function(iid, item) {
        var hints = {
            water: '投掷（对电子/AI 单位触发【AI 宕机】瘫痪 2 回合 / 打断深度思考）',
            cement_resistor: '投掷（强行限流 2 回合降攻降速 + 100% 打断敌方蓄力）',
            bulging_capacitor: '投掷（巨额雷电伤害 + 概率短路眩晕；带身上吃重击有自爆风险）',
            black_tape: '回复 HP +40，紧急修补碎裂的【侧透玻璃机箱】',
            alcohol_wipe: '回复 HP +25，解除短路/卡顿',
            thermal_paste: '回复上下文 +20%，解除过热',
            compressed_air: '回复上下文 +35%，解除卡顿',
            cmos_battery: '回复上下文 +40%，清全异常（克制乱码游魂/未定义黑影）',
            wd40: '解除锁死，下回合先手 SPD +50',
            gpu_580: '捏碎矿卡闪光（克制【未定义黑影】）'
        };
        return hints[iid] || (item.description || '');
    };

    Scene_BlackAIBattle.prototype._redrawCanvas = function() {
        var b = this._canvas.bitmap;
        var eng = this._engine;
        var en = eng.enemy;
        var st = BlackAI.State;
        var Data = BlackAI.Data;
        var ov = eng.is_overflow_boss;
        var enr = eng.boss_enraged;

        b.clear();
        b.fillRect(0, 0, 1280, 720, ov ? '#140307' : '#090a0f');
        b.fillRect(36, 18, 1208, 684, (ov || enr) ? '#a61c2e' : '#4a556e');
        b.fillRect(39, 21, 1202, 678, ov ? '#17060b' : '#10131d');

        b.fontFace = '"Microsoft YaHei", "SimHei", GameFont, sans-serif';

        // 顶部栏
        var titleSuffix = '';
        if (this._isHeroineBoss) {
            if (en.title) titleSuffix += '（' + en.title + '）';
            if (ov) titleSuffix += ' [里世界黑化]';
            if (enr) titleSuffix += ' [狂暴锁定!]';
        } else if (en.is_boss) {
            titleSuffix = ' [区域精英]' + (en.mode === 'deep_think' ? ' · 重型深思态' : (en.mode === 'flash' ? ' · 闪速抢答态' : ''));
        }
        b.fontSize = 22;
        b.textColor = (ov || enr) ? '#ff596c' : '#ffffff';
        b.drawText(en.name + titleSuffix, 60, 32, 860, 32, 'left');

        var modeTop = ov ? '里世界异变 BOSS 战' : (this._isHeroineBoss ? '核心 AI 娘 BOSS 战' : 'BS2 高难回合制');
        b.fontSize = 16;
        b.textColor = '#9ab8db';
        b.drawText('第 ' + eng.turn_number + ' 回合  |  ' + modeTop, 920, 36, 300, 26, 'right');

        // 敌方信息面板（右侧）
        var ex = 240;
        var ew = 980;
        var cleanEnemyHp = '敌方 HP：' + en.hp + ' / ' + en.max_hp;
        var shownEnemyHp = eng.hp_bar_glitched ? (glitchDigits(cleanEnemyHp) + ' [ERR_0x580]') : cleanEnemyHp;
        b.fontSize = 18;
        b.textColor = eng.hp_bar_glitched ? '#ff4f64' : '#f4f7fc';
        b.drawText(shownEnemyHp, ex, 74, ew, 26, 'left');

        b.fillRect(ex, 104, ew, 18, '#231922');
        var eRatio = Math.max(0, Math.min(1, en.hp / Math.max(1, en.max_hp)));
        var eBarCol = eng.hp_bar_glitched ? (Math.random() < 0.5 ? '#ff243c' : '#9c0d24') : '#e63946';
        b.fillRect(ex + 1, 105, Math.round((ew - 2) * eRatio), 16, eBarCol);

        b.fontSize = 15;
        b.textColor = '#c8d4e6';
        b.drawText(
            'ATK ' + eng.getEnemyEffectiveAtk() + '  |  DEF ' + eng.getEnemyEffectiveDef() + '  |  SPD ' + eng.getEnemyEffectiveSpd() +
            '  |  标签：[' + (en.tags || []).join(', ') + ']',
            ex, 128, ew, 24, 'left'
        );

        b.textColor = '#7ce8ff';
        b.drawText('敌方状态：' + eng.formatStatusBadges(en.statuses, true), ex, 154, ew, 24, 'left');

        BlackAI.UI.drawWrappedText(
            b,
            eng.getEnemyIntentText(),
            ex, 182, ew, 22, 15,
            (en.charging_skill_id || enr) ? '#ff7659' : '#f0dc9e'
        );

        // 顶部警示横幅
        var bannerText = '';
        var bannerCol = '#ff4d5c';
        if (eng.last_truncation_banner) {
            bannerText = eng.last_truncation_banner;
            bannerCol = '#ff4d4d';
        } else if (eng.boss_rivalry_banner) {
            bannerText = eng.boss_rivalry_banner;
            bannerCol = '#ff385c';
        } else if (st.is_case_broken) {
            bannerText = '警告：【侧透玻璃机箱】已碎裂，机箱防御归零！请在【硬件物品】中使用【黑胶带】紧急修补！';
            bannerCol = '#ff7086';
        }
        if (bannerText) {
            b.fillRect(58, 232, 1164, 30, 'rgba(120, 12, 24, 0.72)');
            b.fontSize = 15;
            b.textColor = bannerCol;
            b.drawText(bannerText, 68, 235, 1144, 24, 'center');
        }

        // 中部战斗日志框
        var logTop = bannerText ? 268 : 238;
        var logH = 446 - logTop;
        b.fillRect(58, logTop, 1164, logH, '#0c0f17');
        var maxVisible = Math.floor((logH - 12) / 22);
        var startIdx = Math.max(0, this._logLines.length - maxVisible);
        var ly = logTop + 6;
        for (var i = startIdx; i < this._logLines.length; i++) {
            var entry = this._logLines[i];
            b.fontSize = 14;
            b.textColor = entry.color;
            b.drawText(entry.text, 70, ly, 1140, 22, 'left');
            ly += 22;
        }

        // 左下玩家状态卡
        b.fillRect(58, 458, 392, 228, '#141926');
        var pmax = st.getEffectiveMaxHp();
        var cleanPHp = 'HP：' + st.hp + ' / ' + pmax;
        var shownPHp = eng.hp_bar_glitched ? (glitchDigits(cleanPHp) + ' [CORRUPT]') : cleanPHp;
        b.fontSize = 16;
        b.textColor = eng.hp_bar_glitched ? '#ff5568' : '#eef4fc';
        b.drawText(shownPHp, 72, 466, 364, 24, 'left');

        b.fillRect(72, 492, 364, 14, '#1f2533');
        var pRatio = Math.max(0, Math.min(1, st.hp / Math.max(1, pmax)));
        b.fillRect(73, 493, Math.round(362 * pRatio), 12, st.hp > pmax * 0.35 ? '#5fd987' : '#f23d46');

        b.fontSize = 13;
        b.textColor = '#b4d8f2';
        b.drawText('Token：' + st.token + ' / ' + st.max_token + '（不足强放触发输出截断）', 72, 512, 364, 20, 'left');
        b.fillRect(72, 534, 364, 12, '#1f2533');
        b.fillRect(73, 535, Math.round(362 * Math.max(0, Math.min(1, st.token / Math.max(1, st.max_token)))), 10, st.token >= 25 ? '#59c7f5' : '#ff9438');

        b.fontSize = 14;
        b.textColor = st.isContextOverflow() ? '#ff5964' : '#d2e2f5';
        b.drawText('上下文稳定度：' + st.context + '%（' + (st.isContextOverflow() ? '里世界溢出！' : '表世界稳定') + '）', 72, 552, 364, 22, 'left');

        b.fontSize = 13;
        b.textColor = '#d2e2f5';
        b.drawText(
            'ATK ' + st.getEffectiveAtk() + ' | DEF ' + st.getEffectiveDef() + ' | SPD ' + eng.getPlayerBattleSpd() +
            ' | 闪避 ' + Math.round(st.getEffectiveEvasion() * 100) + '% | 暴击 ' + Math.round(st.getEffectiveCritRate() * 100) + '%',
            72, 576, 364, 20, 'left'
        );

        var slotName = function(s) {
            var id = st.equipment[s];
            var n = id ? Data.getItemName(id) : '无';
            if (s === 'case' && st.is_case_broken) {
                n += '[已碎裂!]';
            }
            return n;
        };
        b.fontSize = 12;
        b.textColor = '#9faec4';
        b.drawText('武器：' + slotName('weapon') + ' | 机箱：' + slotName('case'), 72, 600, 364, 18, 'left');
        b.drawText('散热：' + slotName('cooler') + ' | 提示词：' + slotName('system_prompt'), 72, 620, 364, 18, 'left');

        var assistStr = st.assist_partner_id ? Data.getCharacterName(st.assist_partner_id) : '无';
        b.fontSize = 13;
        b.textColor = '#ffc87a';
        b.drawText('我方状态：' + eng.formatStatusBadges(eng.player_statuses, false) + ' | 助战：' + assistStr, 72, 648, 364, 22, 'left');

        // 右下指令卡与子菜单标题
        b.fillRect(460, 458, 764, 228, '#141926');
        b.fontSize = 14;
        b.textColor = '#cfd8e8';
        var subTitle = '请选择本回合行动（普攻 / Token技能 / 防御减伤50% / 硬件物品 / API并发助战 / 逃跑）';
        if (eng.isBattleOver()) {
            if (eng.phase === 'victory') {
                subTitle = this._isHeroineBoss ? '【核心 AI 娘已清空】战利品已入库，击杀记录已写入 GlobalMemory！' : '【战斗胜利】已清理敌方进程！';
            } else if (eng.phase === 'defeat') {
                subTitle = '【战斗败北】你倒在了废墟之中……';
            } else {
                subTitle = '【脱离战斗】成功撤回探索地图。';
            }
        } else if (this._submenu === 'skills') {
            subTitle = '选择 Token 技能（Token 不足也可强行释放 → 触发【输出截断】！）';
        } else if (this._submenu === 'items') {
            subTitle = '选择战斗可用硬件武器 / 消耗品（背包空时可回地图按 Esc 领取 M5 测试包）';
        }
        b.drawText(subTitle, 470, 514, 560, 24, 'left');
    };

    Scene_BlackAIBattle.prototype._finishAndReturn = function() {
        var outcome = this._engine.phase;
        var tid = this._targetId;
        var isBoss = this._isHeroineBoss;
        var evId = this._eventId;
        SceneManager.pop();
        if (BlackAI.World && BlackAI.World.onBattleFinished) {
            BlackAI.World.onBattleFinished(outcome, tid, isBoss, evId);
        }
    };

    BlackAI.Scene_Battle = Scene_BlackAIBattle;
})(typeof window !== 'undefined' ? window : global);
