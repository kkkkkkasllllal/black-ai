/*:
 * @plugindesc 《BLACK AI》M3 巨型大 PSU 电源据点菜单（清理缓存 / 升级 HP / 四槽装备背包 / 三槽存读档）与背面 I/O 总开关断电蓝屏彩蛋
 * @author BLACK AI Team
 * @help
 * 配合 BlackAI_Core.js 与 BlackAI_AltarWorld.js 使用。
 */

(function(globalScope) {
    'use strict';

    var BlackAI = globalScope.BlackAI || {};
    globalScope.BlackAI = BlackAI;

    // ------------------------------------------------------------------------
    // 1. Scene_BlackAIPsu —— 巨型大 PSU 电源四标签据点菜单
    // ------------------------------------------------------------------------

    function Scene_BlackAIPsu() {
        this.initialize.apply(this, arguments);
    }
    Scene_BlackAIPsu.prototype = Object.create(Scene_Base.prototype);
    Scene_BlackAIPsu.prototype.constructor = Scene_BlackAIPsu;

    Scene_BlackAIPsu.prototype.initialize = function() {
        Scene_Base.prototype.initialize.call(this);
        this._tab = 0; // 0=缓存 1=升级HP 2=装备背包 3=存读档
        this._equipSlot = 'weapon';
        this._feedback = '暖橘电源风扇发出低沉嗡鸣。请选择据点操作。';
        this._tabButtons = [];
        this._dynamicButtons = [];
    };

    Scene_BlackAIPsu.prototype.create = function() {
        Scene_Base.prototype.create.call(this);
        this._bgSprite = new Sprite(SceneManager.backgroundBitmap());
        this.addChild(this._bgSprite);

        this._canvas = new Sprite(new Bitmap(1280, 720));
        this.addChild(this._canvas);

        this._dynLayer = new Sprite();
        this.addChild(this._dynLayer);

        var self = this;
        var tabTitles = ['清理缓存（回上下文/刷怪）', '升级血量（上限 400）', '整理装备 / 背包', '保存 / 读取存档（SL 计数）'];
        var tx = 86;
        for (var i = 0; i < tabTitles.length; i++) {
            (function(idx, x) {
                var btn = BlackAI.UI.createRectButton(x, 126, 266, 38, tabTitles[idx], function() {
                    self._tab = idx;
                    self._rebuild();
                }, { fontSize: 15 });
                self._tabButtons.push(btn);
                self.addChild(btn);
            })(i, tx);
            tx += 276;
        }

        this._closeBtn = BlackAI.UI.createRectButton(1058, 42, 134, 36, '离开电源 (Esc)', function() {
            SceneManager.pop();
        }, { bg: '#262834', border: '#929cb4', fontSize: 15 });
        this.addChild(this._closeBtn);

        this._rebuild();
    };

    Scene_BlackAIPsu.prototype.update = function() {
        Scene_Base.prototype.update.call(this);
        if (this._closeBtn.updateButton()) {
            return;
        }
        for (var t = 0; t < this._tabButtons.length; t++) {
            if (this._tabButtons[t].updateButton()) {
                return;
            }
        }
        for (var i = 0; i < this._dynamicButtons.length; i++) {
            if (this._dynamicButtons[i].updateButton()) {
                return;
            }
        }
        if (Input.isTriggered('cancel')) {
            SoundManager.playCancel();
            SceneManager.pop();
        }
    };

    Scene_BlackAIPsu.prototype._clearDyn = function() {
        while (this._dynLayer.children.length > 0) {
            this._dynLayer.removeChildAt(0);
        }
        this._dynamicButtons = [];
    };

    Scene_BlackAIPsu.prototype._rebuild = function() {
        this._clearDyn();
        for (var t = 0; t < this._tabButtons.length; t++) {
            var active = (t === this._tab);
            this._tabButtons[t]._bg = active ? '#3c2a18' : '#181c28';
            this._tabButtons[t]._border = active ? '#ffad54' : '#525c74';
            this._tabButtons[t].redraw();
        }

        var b = this._canvas.bitmap;
        b.clear();
        b.fillRect(0, 0, 1280, 720, 'rgba(6, 7, 11, 0.78)');
        var alarm = BlackAI.State.isContextOverflow() || BlackAI.State.hasAnyCoreHeroineKilled();
        b.fillRect(64, 28, 1152, 664, alarm ? '#d42c3c' : '#d6893e');
        b.fillRect(67, 31, 1146, 658, '#11141e');

        var st = BlackAI.State;
        b.fontFace = '"Microsoft YaHei", "SimHei", GameFont, sans-serif';
        b.fontSize = 22;
        b.textColor = alarm ? '#ff5966' : '#ffb866';
        b.drawText('【巨型大 PSU 电源据点】' + (alarm ? '  [⚠ 红灯报警态]' : '  [暖橘运行中]'), 86, 42, 920, 32, 'left');

        b.fillRect(86, 84, 1106, 32, '#181d2b');
        b.fontSize = 15;
        b.textColor = '#dce6f5';
        b.drawText(
            'HP ' + st.hp + ' / ' + st.getEffectiveMaxHp() + '（基础 ' + st.base_max_hp + '）  |  Token ' + st.token + ' / ' + st.max_token +
            '  |  上下文 ' + st.context + '%（' + (st.isContextOverflow() ? '里世界溢出' : '表世界稳定') + '）  |  废弃权重碎片：' + st.weight_shards,
            98, 88, 1082, 24, 'left'
        );

        if (this._tab === 0) {
            this._drawCacheTab(b);
        } else if (this._tab === 1) {
            this._drawUpgradeTab(b);
        } else if (this._tab === 2) {
            this._drawEquipTab(b);
        } else {
            this._drawSaveTab(b);
        }

        b.fillRect(86, 636, 1106, 38, '#171c29');
        b.fontSize = 15;
        b.textColor = '#ffd86b';
        b.drawText(this._feedback, 98, 642, 1082, 26, 'left');
    };

    Scene_BlackAIPsu.prototype._drawCacheTab = function(b) {
        var self = this;
        var restoreTo = BlackAI.Data.getConfigInt('context.psu_restore_to', 80);
        b.fillRect(86, 182, 1106, 200, '#161b28');
        BlackAI.UI.drawWrappedText(
            b,
            '【清理缓存】（魂系篝火休息机制）\n\n' +
            '· 将上下文稳定度恢复至安全线（至少 ' + restoreTo + '%），并立即回满 Token。\n' +
            '· 代价：当前地图全部已击败的普通暗影怪将立刻重新生成。\n' +
            '· 提示：大 PSU 电源背面（北侧）藏着一枚红色物理总开关 [I / O]，千万别手贱连按三次……',
            112, 206, 1054, 28, 18, '#e3ebf7'
        );

        var btn = BlackAI.UI.createRectButton(440, 420, 400, 54, '执行清理缓存（回上下文至 ' + restoreTo + '% 并刷怪）', function() {
            var count = BlackAI.State.psuClearCache();
            self._feedback = '缓存清理完成！上下文已回稳至 ' + BlackAI.State.context + '%，Token 回满，全图普通暗影怪已刷新（复活 ' + count + ' 只）！';
            self._rebuild();
        }, { bg: '#3e2715', bgHover: '#59371c', border: '#ffad54', textColor: '#ffe8c2', fontSize: 17 });
        this._dynamicButtons.push(btn);
        this._dynLayer.addChild(btn);
    };

    Scene_BlackAIPsu.prototype._drawUpgradeTab = function(b) {
        var self = this;
        var st = BlackAI.State;
        var cap = BlackAI.Data.getConfigInt('player.max_hp_cap', 400);
        var step = BlackAI.Data.getConfigInt('player.hp_upgrade_step', 20);
        var cost = st.getHpUpgradeCost();
        var effMax = st.getEffectiveMaxHp();
        var atCap = (st.base_max_hp >= cap || effMax >= cap);

        b.fillRect(86, 182, 1106, 210, '#161b28');
        BlackAI.UI.drawWrappedText(
            b,
            '【废弃权重碎片强化 · 血量上限升级】\n\n' +
            '· 当前基础 HP 上限：' + st.base_max_hp + '  |  当前有效 HP 上限（含机箱加成）：' + effMax + ' / ' + cap + '\n' +
            '· 每次升级基础 HP +' + step + '（受全游最高上限 ' + cap + ' 限制）。\n' +
            '· 下一次升级消耗：' + cost + ' 废弃权重碎片（当前持有：' + st.weight_shards + '）',
            112, 206, 1054, 30, 18, '#e3ebf7'
        );

        var label = atCap
            ? ('已达 HP 上限 ' + cap + '（不可继续升级）')
            : ('消耗 ' + cost + ' 碎片升级基础 HP（+' + step + '）');
        var btn = BlackAI.UI.createRectButton(440, 426, 400, 54, label, function() {
            if (st.upgradeBaseHp()) {
                self._feedback = '升级成功！基础 HP 提升至 ' + st.base_max_hp + '，有效 HP 上限 ' + st.getEffectiveMaxHp() + '。';
            } else {
                self._feedback = atCap ? ('有效 HP 上限已封顶 ' + cap + '，无法继续升级。') : ('废弃权重碎片不足（需要 ' + cost + '）。');
            }
            self._rebuild();
        }, {
            disabled: atCap || st.weight_shards < cost,
            bg: '#1f3a30', bgHover: '#2b5244', border: '#66e0a8', fontSize: 17
        });
        this._dynamicButtons.push(btn);
        this._dynLayer.addChild(btn);
    };

    Scene_BlackAIPsu.prototype._drawEquipTab = function(b) {
        var self = this;
        var st = BlackAI.State;
        var Data = BlackAI.Data;

        // 左侧：四槽装备与衍生面板
        b.fillRect(86, 178, 500, 442, '#151926');
        b.fontSize = 17;
        b.textColor = '#7ce8ff';
        b.drawText('四槽硬件装备（点击槽位切换右侧列表）', 104, 190, 464, 24, 'left');

        var slotLabels = { weapon: '主武器', case: '机箱', cooler: '散热', system_prompt: '系统提示词' };
        var sy = 224;
        for (var i = 0; i < st.EQUIPMENT_SLOTS.length; i++) {
            (function(slot, y) {
                var curId = st.equipment[slot] || '';
                var curName = curId ? Data.getItemName(curId) : '（空）';
                if (slot === 'case' && st.is_case_broken) {
                    curName += ' [已碎裂!]';
                }
                var selBtn = BlackAI.UI.createRectButton(104, y, 362, 42, slotLabels[slot] + '：' + curName, function() {
                    self._equipSlot = slot;
                    self._rebuild();
                }, {
                    align: 'left',
                    fontSize: 15,
                    bg: self._equipSlot === slot ? '#294066' : '#1b2030',
                    border: self._equipSlot === slot ? '#7ce8ff' : '#556078'
                });
                var unBtn = BlackAI.UI.createRectButton(474, y, 94, 42, '卸下', function() {
                    st.unequipSlot(slot, true);
                    self._feedback = '已卸下【' + slotLabels[slot] + '】槽位装备。';
                    self._rebuild();
                }, { disabled: !curId, fontSize: 14, bg: '#2c2028', border: '#9c6876' });
                self._dynamicButtons.push(selBtn, unBtn);
                self._dynLayer.addChild(selBtn);
                self._dynLayer.addChild(unBtn);
            })(st.EQUIPMENT_SLOTS[i], sy);
            sy += 52;
        }

        b.fillRect(104, 446, 464, 158, '#101420');
        BlackAI.UI.drawWrappedText(
            b,
            '有效战斗面板：\n' +
            'MaxHP ' + st.getEffectiveMaxHp() + '  |  ATK ' + st.getEffectiveAtk() + '  |  DEF ' + st.getEffectiveDef() + '  |  SPD ' + st.getEffectiveSpd() + '\n' +
            '闪避 ' + Math.round(st.getEffectiveEvasion() * 100) + '%  |  暴击 ' + Math.round(st.getEffectiveCritRate() * 100) + '%\n\n' +
            '说明：战斗消耗品（如硅脂/黑胶带/酒精棉片）可直接在右侧点击使用；投掷硬件（水/水泥电阻/鼓包电容）在战斗「硬件物品」中使用。',
            116, 458, 440, 24, 14, '#cbd6e6'
        );

        // 右侧：当前槽位可装备物品 + 探索可用消耗品
        b.fillRect(602, 178, 590, 442, '#151926');
        b.fontSize = 17;
        b.textColor = '#ffd166';
        b.drawText('背包 · 可装备【' + slotLabels[this._equipSlot] + '】与探索消耗品', 620, 190, 554, 24, 'left');

        var expectedCat = st.SLOT_CATEGORY_MAP[this._equipSlot];
        var entries = [];
        var invKeys = Object.keys(st.inventory).sort();
        for (var k = 0; k < invKeys.length; k++) {
            var iid = invKeys[k];
            var cnt = st.getItemCount(iid);
            if (cnt <= 0) {
                continue;
            }
            var item = Data.getItem(iid);
            var cat = Data.getItemCategory(iid);
            if (cat === expectedCat) {
                if (this._equipSlot === 'weapon' && item.slot !== 'main') {
                    continue;
                }
                entries.push({ id: iid, item: item, count: cnt, mode: 'equip' });
            }
        }
        for (var k2 = 0; k2 < invKeys.length; k2++) {
            var iid2 = invKeys[k2];
            var cnt2 = st.getItemCount(iid2);
            if (cnt2 <= 0) {
                continue;
            }
            var item2 = Data.getItem(iid2);
            var usable = Array.isArray(item2.usable_in) ? item2.usable_in : [];
            if (usable.indexOf('field') !== -1) {
                entries.push({ id: iid2, item: item2, count: cnt2, mode: 'use' });
            }
        }

        if (entries.length === 0) {
            b.fontSize = 15;
            b.textColor = '#7d8699';
            b.drawText('（背包中暂无该槽位装备或可用消耗品；可按 Esc 领取 M3/M5 测试包）', 620, 236, 554, 24, 'left');
            return;
        }

        var ry = 224;
        var maxRows = Math.min(entries.length, 9);
        for (var r = 0; r < maxRows; r++) {
            (function(ent, y) {
                var btnText = ent.mode === 'equip'
                    ? ('[装备] ' + ent.item.name + ' ×' + ent.count + ' — ' + (ent.item.description || ''))
                    : ('[使用] ' + ent.item.name + ' ×' + ent.count + ' — ' + (ent.item.description || ''));
                if (btnText.length > 44) {
                    btnText = btnText.slice(0, 43) + '…';
                }
                var btn = BlackAI.UI.createRectButton(618, y, 558, 38, btnText, function() {
                    if (ent.mode === 'equip') {
                        if (st.equipItem(self._equipSlot, ent.id, true)) {
                            self._feedback = '已装备【' + ent.item.name + '】！';
                        }
                    } else {
                        var res = st.useFieldItem(ent.id);
                        self._feedback = res.summary;
                    }
                    self._rebuild();
                }, {
                    align: 'left',
                    fontSize: 14,
                    bg: ent.mode === 'equip' ? '#1f2b42' : '#1b342b',
                    border: ent.mode === 'equip' ? '#6d98d4' : '#63c496'
                });
                self._dynamicButtons.push(btn);
                self._dynLayer.addChild(btn);
            })(entries[r], ry);
            ry += 43;
        }
    };

    Scene_BlackAIPsu.prototype._drawSaveTab = function(b) {
        var self = this;
        b.fillRect(86, 178, 1106, 442, '#151926');
        b.fontSize = 16;
        b.textColor = '#cbd6e6';
        b.drawText('三槽常规存档（每次读取存档将自动递增 GlobalMemory 跨存档 SL 计数，当前 SL = ' + BlackAI.GlobalMemory.sl_count + '）：', 108, 196, 1060, 26, 'left');

        var y = 244;
        for (var slot = 1; slot <= 3; slot++) {
            (function(slotId, rowY) {
                var exists = DataManager.isThisGameFile(slotId);
                var info = exists ? DataManager.loadSavefileInfo(slotId) : null;
                var summary = (info && info.blackAISummary)
                    ? ('槽位 ' + slotId + '：' + info.blackAISummary)
                    : (exists ? ('槽位 ' + slotId + '：已有存档') : ('槽位 ' + slotId + '：（空存档位）'));

                b.fillRect(108, rowY, 1060, 82, '#1c2233');
                b.fontSize = 18;
                b.textColor = exists ? '#eef4fc' : '#7a8396';
                b.drawText(summary, 128, rowY + 26, 680, 28, 'left');

                var saveBtn = BlackAI.UI.createRectButton(826, rowY + 20, 150, 42, '保存至槽 ' + slotId, function() {
                    $gameSystem.onBeforeSave();
                    if (DataManager.saveGame(slotId)) {
                        StorageManager.cleanBackup(slotId);
                        self._feedback = '已成功保存至存档槽 ' + slotId + '！';
                    } else {
                        self._feedback = '保存失败，请检查文件权限。';
                    }
                    self._rebuild();
                }, { bg: '#223b5e', border: '#6ec4ff', fontSize: 15 });

                var loadBtn = BlackAI.UI.createRectButton(990, rowY + 20, 160, 42, '读取槽 ' + slotId + ' (SL+1)', function() {
                    if (DataManager.loadGame(slotId)) {
                        SoundManager.playLoad();
                        if ($gameSystem.versionId() !== $dataSystem.versionId) {
                            $gamePlayer.reserveTransfer($gameMap.mapId(), $gamePlayer.x, $gamePlayer.y);
                            $gamePlayer.requestMapReload();
                        }
                        SceneManager.goto(Scene_Map);
                        $gameSystem.onAfterLoad();
                    } else {
                        self._feedback = '读取槽 ' + slotId + ' 失败。';
                        self._rebuild();
                    }
                }, { disabled: !exists, bg: '#3e2948', border: '#c486e6', fontSize: 15 });

                self._dynamicButtons.push(saveBtn, loadBtn);
                self._dynLayer.addChild(saveBtn);
                self._dynLayer.addChild(loadBtn);
            })(slot, y);
            y += 104;
        }
    };

    // ------------------------------------------------------------------------
    // 2. Scene_BlackAIPowerOffEgg —— 背面 I/O 总开关 3 连按 5 秒断电蓝屏彩蛋
    // ------------------------------------------------------------------------

    function Scene_BlackAIPowerOffEgg() {
        this.initialize.apply(this, arguments);
    }
    Scene_BlackAIPowerOffEgg.prototype = Object.create(Scene_Base.prototype);
    Scene_BlackAIPowerOffEgg.prototype.constructor = Scene_BlackAIPowerOffEgg;

    Scene_BlackAIPowerOffEgg.prototype.initialize = function() {
        Scene_Base.prototype.initialize.call(this);
        this._elapsed = 0;
        this._duration = BlackAI.Data.getConfigFloat('psu.easter_egg_duration', 5.0);
        this._firstUnlock = false;
        this._bsodDrawn = false;
    };

    Scene_BlackAIPowerOffEgg.prototype.create = function() {
        Scene_Base.prototype.create.call(this);
        this._firstUnlock = BlackAI.GlobalMemory.unlockEnding('joke_itchy_fingers');
        BlackAI.State._syncToMvSwitchesAndVars();
        this._canvas = new Sprite(new Bitmap(1280, 720));
        this._canvas.bitmap.fillRect(0, 0, 1280, 720, '#000000');
        this.addChild(this._canvas);
    };

    Scene_BlackAIPowerOffEgg.prototype.update = function() {
        Scene_Base.prototype.update.call(this);
        this._elapsed += 1 / 60;
        if (!this._bsodDrawn && this._elapsed >= 0.85) {
            this._bsodDrawn = true;
            this._drawBsod();
        }
        if (this._elapsed >= this._duration) {
            BlackAI.State.psu_back_switch_presses = 0;
            if (BlackAI.World && BlackAI.World.showHudNotice) {
                var suf = this._firstUnlock ? '（首次解锁《手贱的代价》！）' : '（《手贱的代价》已收录）';
                BlackAI.World.showHudNotice('大 PSU 电源重新通电——别再乱按背面红色总开关了！' + suf, 4.0);
            }
            SceneManager.pop();
        }
    };

    Scene_BlackAIPowerOffEgg.prototype._drawBsod = function() {
        var b = this._canvas.bitmap;
        b.clear();
        b.fillRect(0, 0, 1280, 720, '#093482');
        b.fontFace = '"Microsoft YaHei", "SimHei", GameFont, sans-serif';
        b.fontSize = 72;
        b.textColor = '#ffffff';
        b.drawText(':(', 96, 84, 300, 90, 'left');
        b.fontSize = 30;
        b.drawText('彩蛋结局解锁：《手贱的代价》', 96, 196, 1080, 42, 'left');
        BlackAI.UI.drawWrappedText(
            b,
            '你的【巨型大 PSU 电源】因为背面物理总开关 [I / O] 被连续手贱按了三次，已经彻底断电。\n\n' +
            'STOP_CODE: ITCHY_FINGERS_PSU_OFF (0x00000580)\n' +
            '状态：全图 7 位核心 AI 娘的显存瞬间清空……才怪，正在紧急重启供电线。\n\n' +
            '已写入 GlobalMemory 结局图鉴：joke_itchy_fingers\n' +
            '约 4 秒后自动重新通电并返回巨型电源圣坛……',
            96, 266, 1060, 34, 20, '#dcebff'
        );
    };

    BlackAI.Scene_Psu = Scene_BlackAIPsu;
    BlackAI.Scene_PowerOffEgg = Scene_BlackAIPowerOffEgg;
})(typeof window !== 'undefined' ? window : global);
