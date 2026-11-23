/*:
 * @plugindesc 《BLACK AI》M4+M6 纯文本 .dialogue 分支对话解析器、对话框 UI、6 档显卡送礼与 0–200% 好感/API 并发助战面板
 * @author BLACK AI Team
 * @help
 * 直接解析根目录 dialogue/*.dialogue 剧本文件（兼容 Godot Dialogue Manager 语法）。
 * 支持表/里世界双态立绘裂纹、送礼反应段落回播、580 拒收强送二次确认、以及 Tab 打开全员好感度与并发助战设置。
 */

(function(globalScope) {
    'use strict';

    var IS_NODE = (typeof module !== 'undefined' && module.exports && typeof window === 'undefined');
    var BlackAI = globalScope.BlackAI || (IS_NODE ? require('./BlackAI_Core.js') : {});
    globalScope.BlackAI = BlackAI;

    // ------------------------------------------------------------------------
    // 1. 纯文本 .dialogue 解析器与运行器（零平台依赖，可在 Node.js 测试）
    // ------------------------------------------------------------------------

    function countIndent(line) {
        var n = 0;
        for (var i = 0; i < line.length; i++) {
            var ch = line.charAt(i);
            if (ch === '\t') {
                n += 4;
            } else if (ch === ' ') {
                n += 1;
            } else {
                break;
            }
        }
        return n;
    }

    var DialogueParser = {
        parseText: function(rawText) {
            var lines = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
            var sections = {};
            var errors = [];
            var curName = '';
            var curBlock = [];

            function flushSection() {
                if (curName) {
                    sections[curName] = parseBlock(curBlock, 0, curBlock.length, 0);
                }
            }

            for (var i = 0; i < lines.length; i++) {
                var raw = lines[i];
                var trimmed = raw.trim();
                if (!trimmed || trimmed.charAt(0) === '#') {
                    continue;
                }
                if (trimmed.charAt(0) === '~') {
                    flushSection();
                    curName = trimmed.slice(1).trim();
                    curBlock = [];
                    if (!curName) {
                        errors.push('line ' + (i + 1) + ': empty section');
                    }
                    continue;
                }
                if (!curName) {
                    errors.push('line ' + (i + 1) + ': statement outside section');
                    continue;
                }
                curBlock.push({ indent: countIndent(raw), text: trimmed, lineNo: i + 1 });
            }
            flushSection();
            return { ok: errors.length === 0, sections: sections, errors: errors };
        }
    };

    function parseBlock(items, startIdx, endIdx, baseIndent) {
        var nodes = [];
        var i = startIdx;
        while (i < endIdx) {
            var cur = items[i];
            if (cur.indent < baseIndent) {
                break;
            }
            var txt = cur.text;

            if (txt.indexOf('if ') === 0 && txt.charAt(txt.length - 1) === ':') {
                var branches = [];
                var condExpr = txt.slice(3, -1).trim();
                var bodyStart = i + 1;
                var bodyEnd = findBlockEnd(items, bodyStart, endIdx, cur.indent);
                branches.push({ cond: condExpr, body: parseBlock(items, bodyStart, bodyEnd, cur.indent + 1) });
                i = bodyEnd;

                while (i < endIdx && items[i].indent === cur.indent) {
                    var nt = items[i].text;
                    if (nt.indexOf('elif ') === 0 && nt.charAt(nt.length - 1) === ':') {
                        var eCond = nt.slice(5, -1).trim();
                        var eStart = i + 1;
                        var eEnd = findBlockEnd(items, eStart, endIdx, cur.indent);
                        branches.push({ cond: eCond, body: parseBlock(items, eStart, eEnd, cur.indent + 1) });
                        i = eEnd;
                    } else if (nt === 'else:') {
                        var elStart = i + 1;
                        var elEnd = findBlockEnd(items, elStart, endIdx, cur.indent);
                        branches.push({ cond: null, body: parseBlock(items, elStart, elEnd, cur.indent + 1) });
                        i = elEnd;
                        break;
                    } else {
                        break;
                    }
                }
                nodes.push({ type: 'if', branches: branches });
                continue;
            }

            if (txt.indexOf('- ') === 0) {
                var choices = [];
                while (i < endIdx && items[i].indent === cur.indent && items[i].text.indexOf('- ') === 0) {
                    var cRaw = items[i].text.slice(2).trim();
                    var arrowIdx = cRaw.lastIndexOf('=>');
                    var label = arrowIdx !== -1 ? cRaw.slice(0, arrowIdx).trim() : cRaw;
                    var target = arrowIdx !== -1 ? cRaw.slice(arrowIdx + 2).trim() : 'END';
                    choices.push({ text: label, target: target });
                    i += 1;
                }
                nodes.push({ type: 'choices', options: choices });
                continue;
            }

            if (txt.indexOf('=>') === 0) {
                nodes.push({ type: 'jump', target: txt.slice(2).trim() });
                i += 1;
                continue;
            }

            if (txt.indexOf('do ') === 0) {
                nodes.push({ type: 'do', expr: txt.slice(3).trim() });
                i += 1;
                continue;
            }

            var colonIdx = txt.indexOf(':');
            if (colonIdx > 0) {
                nodes.push({
                    type: 'say',
                    speaker: txt.slice(0, colonIdx).trim(),
                    text: txt.slice(colonIdx + 1).trim()
                });
            } else {
                nodes.push({ type: 'say', speaker: '', text: txt });
            }
            i += 1;
        }
        return nodes;
    }

    function findBlockEnd(items, startIdx, endIdx, parentIndent) {
        var i = startIdx;
        while (i < endIdx && items[i].indent > parentIndent) {
            i += 1;
        }
        return i;
    }

    function DialogueRunner(callbacks) {
        this._cb = callbacks || {};
        this._doc = null;
        this._characterId = '';
        this._stack = [];
        this._waitingChoice = false;
        this._currentChoices = [];
        this._running = false;
    }

    DialogueRunner.prototype.isRunning = function() {
        return this._running;
    };

    DialogueRunner.prototype.isWaitingForChoice = function() {
        return this._waitingChoice;
    };

    DialogueRunner.prototype.start = function(doc, sectionName, characterId) {
        this._doc = doc;
        this._characterId = characterId || '';
        this._waitingChoice = false;
        this._currentChoices = [];
        this._running = true;
        if (!this.jumpToSection(sectionName || 'start')) {
            this._finish();
        }
    };

    DialogueRunner.prototype.jumpToSection = function(sectionName) {
        if (!this._doc || !this._doc.sections || !this._doc.sections[sectionName]) {
            return false;
        }
        this._waitingChoice = false;
        this._currentChoices = [];
        this._stack = [{ list: this._doc.sections[sectionName], index: 0 }];
        this._running = true;
        this.advance();
        return true;
    };

    DialogueRunner.prototype.choose = function(optionIdx) {
        if (!this._waitingChoice || optionIdx < 0 || optionIdx >= this._currentChoices.length) {
            return;
        }
        var opt = this._currentChoices[optionIdx];
        this._waitingChoice = false;
        this._currentChoices = [];
        this._handleJump(opt.target);
    };

    DialogueRunner.prototype.advance = function() {
        if (!this._running || this._waitingChoice) {
            return;
        }
        while (this._stack.length > 0) {
            var frame = this._stack[this._stack.length - 1];
            if (frame.index >= frame.list.length) {
                this._stack.pop();
                continue;
            }
            var node = frame.list[frame.index];
            frame.index += 1;

            if (node.type === 'if') {
                for (var b = 0; b < node.branches.length; b++) {
                    var br = node.branches[b];
                    if (br.cond === null || this._evalCondition(br.cond)) {
                        this._stack.push({ list: br.body, index: 0 });
                        break;
                    }
                }
                continue;
            }

            if (node.type === 'do') {
                this._execDo(node.expr);
                continue;
            }

            if (node.type === 'jump') {
                this._handleJump(node.target);
                return;
            }

            if (node.type === 'choices') {
                this._waitingChoice = true;
                this._currentChoices = node.options.slice();
                if (this._cb.onChoices) {
                    this._cb.onChoices(this._currentChoices);
                }
                return;
            }

            if (node.type === 'say') {
                var rendered = this._interpolate(node.text);
                if (this._cb.onLine) {
                    this._cb.onLine(node.speaker, rendered);
                }
                return;
            }
        }
        this._finish();
    };

    DialogueRunner.prototype._handleJump = function(target) {
        if (target === 'END') {
            this._finish();
        } else if (target === 'OPEN_GIFT') {
            if (this._cb.onAction) {
                this._cb.onAction('open_gift');
            }
        } else if (target === 'OPEN_SHOP') {
            if (this._cb.onAction) {
                this._cb.onAction('open_shop');
            }
        } else if (!this.jumpToSection(target)) {
            this._finish();
        }
    };

    DialogueRunner.prototype._finish = function() {
        this._running = false;
        this._waitingChoice = false;
        this._stack = [];
        if (this._cb.onFinish) {
            this._cb.onFinish();
        }
    };

    DialogueRunner.prototype._evalCondition = function(expr) {
        var orParts = String(expr).split(/\s+or\s+/);
        for (var i = 0; i < orParts.length; i++) {
            var andParts = orParts[i].split(/\s+and\s+/);
            var allOk = true;
            for (var j = 0; j < andParts.length; j++) {
                if (!this._evalAtom(andParts[j].trim())) {
                    allOk = false;
                    break;
                }
            }
            if (allOk) {
                return true;
            }
        }
        return false;
    };

    DialogueRunner.prototype._evalAtom = function(atom) {
        if (!atom) {
            return false;
        }
        if (atom.indexOf('not ') === 0) {
            return !this._evalAtom(atom.slice(4).trim());
        }
        var cmp = atom.match(/^(.+?)\s*(>=|<=|==|!=|>|<)\s*(.+)$/);
        if (cmp) {
            var lv = this._resolveValue(cmp[1].trim());
            var rv = this._resolveValue(cmp[3].trim());
            var op = cmp[2];
            if (op === '>=') return lv >= rv;
            if (op === '<=') return lv <= rv;
            if (op === '==') return lv == rv;
            if (op === '!=') return lv != rv;
            if (op === '>') return lv > rv;
            if (op === '<') return lv < rv;
        }
        return Boolean(this._resolveValue(atom));
    };

    DialogueRunner.prototype._resolveValue = function(token) {
        var State = BlackAI.State;
        var GM = BlackAI.GlobalMemory;
        if (token === 'true') return true;
        if (token === 'false') return false;
        if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
        if ((token.charAt(0) === '"' && token.charAt(token.length - 1) === '"') ||
            (token.charAt(0) === "'" && token.charAt(token.length - 1) === "'")) {
            return token.slice(1, -1);
        }
        if (token === 'affection') return State.getAffection(this._characterId);
        if (token === 'context') return State.context;
        if (token === 'sl_count') return GM.sl_count;
        if (token === 'eliminated') return State.eliminated_character || '';
        if (token === 'player_skin') return State.player_skin || 'default';
        if (token === 'GameState.is_context_overflow()') return State.isContextOverflow();
        if (token === 'GameState.is_context_critical()') return State.isContextCritical();

        var mAff = token.match(/^GameState\.get_affection\(["']([^"']+)["']\)$/);
        if (mAff) return State.getAffection(mAff[1]);
        var mAlive = token.match(/^GameState\.is_character_alive\(["']([^"']+)["']\)$/);
        if (mAlive) return State.isCharacterAlive(mAlive[1]);
        var mFlag = token.match(/^GameState\.get_flag\(["']([^"']+)["']\)$/);
        if (mFlag) return (State.story_flags && State.story_flags[mFlag[1]]) || false;
        var mItem = token.match(/^GameState\.has_item\(["']([^"']+)["']\)$/);
        if (mItem) return State.hasItem(mItem[1], 1);
        return false;
    };

    DialogueRunner.prototype._execDo = function(expr) {
        var State = BlackAI.State;
        var mCtx = expr.match(/^GameState\.change_context\(\s*(-?\d+)\s*\)$/);
        if (mCtx) {
            State.changeContext(Number(mCtx[1]));
            return;
        }
        var mAff = expr.match(/^GameState\.add_affection\(\s*["']([^"']+)["']\s*,\s*(-?\d+)\s*(?:,\s*(true|false)\s*)?\)$/);
        if (mAff) {
            var allow = mAff[3] ? (mAff[3] === 'true') : true;
            State.addAffection(mAff[1], Number(mAff[2]), allow);
            return;
        }
        var mHp = expr.match(/^GameState\.change_hp\(\s*(-?\d+)\s*\)$/);
        if (mHp) {
            State.changeHp(Number(mHp[1]));
            return;
        }
        var mSetFlag = expr.match(/^GameState\.set_flag\(\s*["']([^"']+)["']\s*,\s*(true|false|["'][^"']*["'])\s*\)$/);
        if (mSetFlag) {
            var rawVal = mSetFlag[2];
            var parsedVal = rawVal === 'true' ? true : (rawVal === 'false' ? false : rawVal.slice(1, -1));
            State.story_flags = State.story_flags || {};
            State.story_flags[mSetFlag[1]] = parsedVal;
            return;
        }
        var mAddItem = expr.match(/^GameState\.add_item\(\s*["']([^"']+)["']\s*(?:,\s*(\d+)\s*)?\)$/);
        if (mAddItem) {
            var cnt = mAddItem[2] ? Number(mAddItem[2]) : 1;
            State.addItem(mAddItem[1], cnt);
            if (BlackAI.NativeParty && BlackAI.NativeParty.toEngine) {
                BlackAI.NativeParty.toEngine();
            }
            return;
        }
        var mShards = expr.match(/^GameState\.add_shards\(\s*(-?\d+)\s*\)$/);
        if (mShards) {
            State.addWeightShards(Number(mShards[1]));
            if (BlackAI.NativeParty && BlackAI.NativeParty.toEngine) {
                BlackAI.NativeParty.toEngine();
            }
            return;
        }
    };

    DialogueRunner.prototype._interpolate = function(text) {
        var State = BlackAI.State;
        var GM = BlackAI.GlobalMemory;
        var aff = State.getAffection(this._characterId);
        var tier = State.getAffectionTier(this._characterId).name || '初见';
        return String(text)
            .replace(/\{affection\}/g, String(aff))
            .replace(/\{tier\}/g, String(tier))
            .replace(/\{context\}/g, String(State.context))
            .replace(/\{sl_count\}/g, String(GM.sl_count));
    };

    BlackAI.DialogueParser = DialogueParser;
    BlackAI.DialogueRunner = DialogueRunner;

    if (IS_NODE) {
        module.exports = { DialogueParser: DialogueParser, DialogueRunner: DialogueRunner };
        return;
    }

    // ------------------------------------------------------------------------
    // 2. 剧本读取缓存（优先 NW.js fs，兼容浏览器 XHR）
    // ------------------------------------------------------------------------

    BlackAI.DialogueCache = {};

    BlackAI.loadDialogueDoc = function(characterId) {
        if (BlackAI.DialogueCache[characterId]) {
            return BlackAI.DialogueCache[characterId];
        }
        var relPath = 'dialogue/' + characterId + '.dialogue';
        var raw = '';
        try {
            if (Utils.isNwjs()) {
                var fs = require('fs');
                var path = require('path');
                var base = path.dirname(process.mainModule.filename);
                var full = path.join(base, relPath);
                if (fs.existsSync(full)) {
                    raw = fs.readFileSync(full, 'utf8');
                }
            }
            if (!raw) {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', relPath, false);
                xhr.send();
                if (xhr.status === 0 || xhr.status === 200) {
                    raw = xhr.responseText;
                }
            }
        } catch (err) {
            console.error('[BlackAI_Dialogue] 无法读取剧本:', relPath, err);
        }
        var parsed = DialogueParser.parseText(raw);
        if (parsed.ok) {
            BlackAI.DialogueCache[characterId] = parsed;
        }
        return parsed;
    };

    // ------------------------------------------------------------------------
    // 3. Scene_BlackAIDialogue —— 分支对话框（表里双态立绘 + 送礼 + 拔刀开战）
    // ------------------------------------------------------------------------

    function Scene_BlackAIDialogue() {
        this.initialize.apply(this, arguments);
    }
    Scene_BlackAIDialogue.prototype = Object.create(Scene_Base.prototype);
    Scene_BlackAIDialogue.prototype.constructor = Scene_BlackAIDialogue;

    Scene_BlackAIDialogue._pendingCharacterId = 'big_fish';
    Scene_BlackAIDialogue._pendingSection = 'start';
    Scene_BlackAIDialogue._pendingReaction = '';

    Scene_BlackAIDialogue.openForCharacter = function(characterId, section) {
        this._pendingCharacterId = characterId;
        this._pendingSection = section || 'start';
        this._pendingReaction = '';
        SceneManager.push(Scene_BlackAIDialogue);
    };

    Scene_BlackAIDialogue.prototype.initialize = function() {
        Scene_Base.prototype.initialize.call(this);
        this._characterId = Scene_BlackAIDialogue._pendingCharacterId || 'big_fish';
        this._speaker = '';
        this._text = '';
        this._choices = [];
        this._choiceButtons = [];
        this._footerButtons = [];
        this._selectedChoice = 0;
        this._time = 0;
        this._runner = null;
    };

    Scene_BlackAIDialogue.prototype.create = function() {
        Scene_Base.prototype.create.call(this);
        this._bgSprite = new Sprite(SceneManager.backgroundBitmap());
        this.addChild(this._bgSprite);

        this._panelSprite = new Sprite(new Bitmap(1280, 720));
        this.addChild(this._panelSprite);

        this._choiceContainer = new Sprite();
        this.addChild(this._choiceContainer);

        var self = this;
        var fy = 640;
        this._giftBtn = BlackAI.UI.createRectButton(274, fy, 152, 40, '送 6 档显卡', function() {
            self._openGiftPanel();
        }, { bg: '#22385c', border: '#6ec4ff', fontSize: 16 });
        this._challengeBtn = BlackAI.UI.createRectButton(440, fy, 136, 40, '拔刀开战', function() {
            self._challengeBoss();
        }, { bg: '#4b1620', bgHover: '#6e1c2b', border: '#ff5263', textColor: '#ffd4da', fontSize: 16 });
        this._nextBtn = BlackAI.UI.createRectButton(890, fy, 166, 40, '继续 (E/Enter)', function() {
            if (self._runner) {
                self._runner.advance();
            }
        }, { bg: '#233245', border: '#95b2d6', fontSize: 15 });
        this._closeBtn = BlackAI.UI.createRectButton(1070, fy, 146, 40, '结束对话 (Esc)', function() {
            SceneManager.pop();
        }, { bg: '#23242c', border: '#7b8294', fontSize: 15 });

        this._footerButtons = [this._giftBtn, this._challengeBtn, this._nextBtn, this._closeBtn];
        for (var i = 0; i < this._footerButtons.length; i++) {
            this.addChild(this._footerButtons[i]);
        }

        this._runner = new DialogueRunner({
            onLine: function(speaker, text) {
                self._speaker = speaker;
                self._text = text;
                self._choices = [];
                self._rebuildChoices();
                self._nextBtn.visible = true;
                self._redraw();
            },
            onChoices: function(opts) {
                self._choices = opts.slice();
                self._selectedChoice = 0;
                self._nextBtn.visible = false;
                self._rebuildChoices();
                self._redraw();
            },
            onAction: function(act) {
                if (act === 'open_gift') {
                    self._openGiftPanel();
                }
            },
            onFinish: function() {
                SceneManager.pop();
            }
        });

        var doc = BlackAI.loadDialogueDoc(this._characterId);
        this._runner.start(doc, Scene_BlackAIDialogue._pendingSection || 'start', this._characterId);
    };

    Scene_BlackAIDialogue.prototype.start = function() {
        Scene_Base.prototype.start.call(this);
        if (Scene_BlackAIDialogue._pendingReaction !== '') {
            var react = Scene_BlackAIDialogue._pendingReaction;
            Scene_BlackAIDialogue._pendingReaction = '';
            if (react && react !== '__none__') {
                this._runner.jumpToSection(react);
            } else {
                this._redraw();
            }
        }
    };

    Scene_BlackAIDialogue.prototype._openGiftPanel = function() {
        Scene_BlackAIGift.openForDialogueGift(this._characterId);
    };

    Scene_BlackAIDialogue.prototype._challengeBoss = function() {
        if (BlackAI.World && BlackAI.World.startHeroineBossBattle) {
            BlackAI.World.startHeroineBossBattle(this._characterId, false, true);
        }
    };

    Scene_BlackAIDialogue.prototype._rebuildChoices = function() {
        while (this._choiceContainer.children.length > 0) {
            this._choiceContainer.removeChildAt(0);
        }
        this._choiceButtons = [];
        var self = this;
        var baseY = 486;
        var rowH = 34;
        for (var i = 0; i < this._choices.length; i++) {
            (function(idx) {
                var opt = self._choices[idx];
                var btn = BlackAI.UI.createRectButton(274, baseY + idx * (rowH + 4), 942, rowH, (idx + 1) + '. ' + opt.text, function() {
                    self._runner.choose(idx);
                }, {
                    align: 'left',
                    fontSize: 16,
                    bg: idx === self._selectedChoice ? '#2d3a54' : '#1b2030',
                    border: idx === self._selectedChoice ? '#ffd166' : '#5e6d88'
                });
                self._choiceButtons.push(btn);
                self._choiceContainer.addChild(btn);
            })(i);
        }
    };

    Scene_BlackAIDialogue.prototype.update = function() {
        Scene_Base.prototype.update.call(this);
        this._time += 1 / 60;

        for (var i = 0; i < this._footerButtons.length; i++) {
            if (this._footerButtons[i].updateButton()) {
                return;
            }
        }
        for (var c = 0; c < this._choiceButtons.length; c++) {
            if (this._choiceButtons[c].updateButton()) {
                return;
            }
        }

        if (Input.isTriggered('cancel')) {
            SoundManager.playCancel();
            SceneManager.pop();
            return;
        }
        if (this._choices.length > 0) {
            if (Input.isTriggered('up')) {
                this._selectedChoice = (this._selectedChoice + this._choices.length - 1) % this._choices.length;
                SoundManager.playCursor();
                this._rebuildChoices();
            } else if (Input.isTriggered('down')) {
                this._selectedChoice = (this._selectedChoice + 1) % this._choices.length;
                SoundManager.playCursor();
                this._rebuildChoices();
            } else if (Input.isTriggered('ok')) {
                SoundManager.playOk();
                this._runner.choose(this._selectedChoice);
            }
        } else if (Input.isTriggered('ok')) {
            SoundManager.playOk();
            this._runner.advance();
        }
    };

    Scene_BlackAIDialogue.prototype._redraw = function() {
        var b = this._panelSprite.bitmap;
        b.clear();
        b.fillRect(0, 0, 1280, 720, 'rgba(6, 7, 11, 0.50)');

        var px = 52;
        var py = 358;
        var pw = 1176;
        var ph = 338;

        var ch = BlackAI.Data.getCharacter(this._characterId);
        var cname = ch.name || this._characterId;
        var proto = ch.prototype || '';
        var aff = BlackAI.State.getAffection(this._characterId);
        var tier = BlackAI.State.getAffectionTier(this._characterId).name || '初见';
        var overflowCtx = BlackAI.State.isContextOverflow();
        var obsessed = aff >= 101;
        var corrupted = overflowCtx || obsessed;

        b.fillRect(px, py, pw, ph, corrupted ? '#c91c2b' : '#707c94');
        b.fillRect(px + 3, py + 3, pw - 6, ph - 6, corrupted ? '#190a0e' : '#111520');

        // 左侧占位立绘框
        var lx = px + 26;
        var ly = py + 24;
        var lsize = 160;
        b.fillRect(lx, ly, lsize, lsize, corrupted ? '#ef233c' : '#eceef5');
        var accent = ch.placeholder_color || '#3b6fd8';
        b.fillRect(lx + 5, ly + 5, lsize - 10, lsize - 10, accent);
        if (corrupted) {
            b.fillRect(lx + 5, ly + 5, lsize - 10, lsize - 10, 'rgba(10, 0, 4, 0.42)');
            var ctx = b._context;
            ctx.save();
            ctx.strokeStyle = '#080002';
            ctx.lineWidth = 7;
            ctx.beginPath();
            ctx.moveTo(lx + 14, ly + 30);
            ctx.lineTo(lx + lsize - 14, ly + lsize - 40);
            ctx.stroke();
            ctx.strokeStyle = '#ff1630';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(lx + 14, ly + lsize - 32);
            ctx.lineTo(lx + lsize - 14, ly + 42);
            ctx.stroke();
            ctx.restore();
            b._setDirty();
        }
        // 立绘眼睛
        var eyeCol = corrupted ? '#ff182e' : '#14171f';
        b.fillRect(lx + 42, ly + 62, 22, 14, eyeCol);
        b.fillRect(lx + 96, ly + 62, 22, 14, eyeCol);

        b.fontFace = '"Microsoft YaHei", "SimHei", GameFont, sans-serif';
        b.fontSize = 18;
        b.textColor = '#f4f7fc';
        b.drawText(cname, lx, ly + lsize + 10, lsize, 26, 'center');

        b.fontSize = 14;
        b.textColor = obsessed ? '#ff5568' : (aff >= 100 ? '#ffd866' : '#b7cbe2');
        b.drawText('好感：' + aff + '%（' + tier + '）', lx - 6, ly + lsize + 38, lsize + 12, 22, 'center');

        // 好感条（常规 0-100 / 偏执 101-200）
        var barY = ly + lsize + 66;
        b.fillRect(lx, barY, lsize, 14, '#242938');
        var ratio = Math.min(1, aff > 100 ? (aff / 200) : (aff / 100));
        b.fillRect(lx + 1, barY + 1, Math.round((lsize - 2) * ratio), 12, aff > 100 ? '#f2243b' : (aff >= 100 ? '#ffca47' : '#6ec4ff'));

        // 右侧标题与台词区
        var rx = 274;
        var rw = 942;
        b.fontSize = 22;
        b.textColor = '#ffffff';
        var headerName = (this._speaker || cname) + (proto ? ('（' + proto + '）') : '');
        b.drawText(headerName, rx, py + 20, 620, 30, 'left');

        var badge = '[表世界稳定]';
        var badgeCol = '#84d2f6';
        if (obsessed && overflowCtx) {
            badge = '[双溢出：偏执 + 里世界]';
            badgeCol = '#ff2a3e';
        } else if (obsessed) {
            badge = '[偏执溢出态 101–200%]';
            badgeCol = '#ff4d5f';
        } else if (overflowCtx) {
            badge = '[里世界 · 上下文溢出]';
            badgeCol = '#ff686b';
        }
        b.fontSize = 16;
        b.textColor = badgeCol;
        b.drawText(badge, rx + 620, py + 22, 322, 28, 'right');

        b.fillRect(rx, py + 56, rw, 2, corrupted ? '#7e1a26' : '#313a4e');
        BlackAI.UI.drawWrappedText(b, this._text, rx, py + 68, rw, 28, 19, '#eef3fa');

        var isCore = BlackAI.State.isCoreHeroine(this._characterId);
        this._giftBtn.visible = isCore;
        this._challengeBtn.visible = isCore && BlackAI.State.isCharacterAlive(this._characterId);
    };

    // ------------------------------------------------------------------------
    // 4. Scene_BlackAIGift —— 6 档显卡送礼 + 全员好感度（0–200%）& API 并发助战面板
    // ------------------------------------------------------------------------

    function Scene_BlackAIGift() {
        this.initialize.apply(this, arguments);
    }
    Scene_BlackAIGift.prototype = Object.create(Scene_Base.prototype);
    Scene_BlackAIGift.prototype.constructor = Scene_BlackAIGift;

    Scene_BlackAIGift._mode = 'overview'; // 'dialogue_gift' / 'overview'
    Scene_BlackAIGift._targetId = 'big_fish';

    Scene_BlackAIGift.openForDialogueGift = function(characterId) {
        this._mode = 'dialogue_gift';
        this._targetId = characterId || 'big_fish';
        SceneManager.push(Scene_BlackAIGift);
    };

    Scene_BlackAIGift.openOverview = function(characterId, replaceScene) {
        this._mode = 'overview';
        if (characterId) {
            this._targetId = characterId;
        }
        if (replaceScene) {
            SceneManager.goto(Scene_BlackAIGift);
        } else {
            SceneManager.push(Scene_BlackAIGift);
        }
    };

    Scene_BlackAIGift.prototype.initialize = function() {
        Scene_Base.prototype.initialize.call(this);
        this._lockedToDialogue = (Scene_BlackAIGift._mode === 'dialogue_gift');
        this._targetId = Scene_BlackAIGift._targetId || 'big_fish';
        this._tab = this._lockedToDialogue ? 0 : 1;
        this._feedback = this._lockedToDialogue
            ? ('选择要赠送给【' + BlackAI.Data.getCharacterName(this._targetId) + '】的显卡。')
            : '常规满好感为 100%，满后再投喂或送 600900 可冲至 200%（偏执溢出）；好感 ≥ 70% 可设为 API 并发助战。';
        this._lastReaction = '__none__';
        this._rejectGpuId = '';
        this._dynamicButtons = [];
        this._popupButtons = [];
    };

    Scene_BlackAIGift.prototype.create = function() {
        Scene_Base.prototype.create.call(this);
        this._bgSprite = new Sprite(SceneManager.backgroundBitmap());
        this.addChild(this._bgSprite);

        this._canvas = new Sprite(new Bitmap(1280, 720));
        this.addChild(this._canvas);

        this._dynLayer = new Sprite();
        this.addChild(this._dynLayer);

        this._popupCanvas = new Sprite(new Bitmap(1280, 720));
        this._popupCanvas.visible = false;
        this.addChild(this._popupCanvas);

        this._popupLayer = new Sprite();
        this._popupLayer.visible = false;
        this.addChild(this._popupLayer);

        var self = this;
        this._tab0Btn = BlackAI.UI.createRectButton(96, 90, 220, 38, '赠送 6 档显卡', function() {
            self._tab = 0;
            self._rebuild();
        }, { fontSize: 16 });
        this._tab1Btn = BlackAI.UI.createRectButton(326, 90, 310, 38, '全员好感度（0–200%）与并发助战', function() {
            self._tab = 1;
            self._rebuild();
        }, { fontSize: 16 });
        this._closeBtn = BlackAI.UI.createRectButton(1062, 42, 122, 36, '关闭 (Esc)', function() {
            self._close();
        }, { bg: '#262834', border: '#8c96ac', fontSize: 15 });

        this.addChild(this._tab0Btn);
        this.addChild(this._tab1Btn);
        this.addChild(this._closeBtn);

        this._rebuild();
    };

    Scene_BlackAIGift.prototype._close = function() {
        if (this._lockedToDialogue) {
            Scene_BlackAIDialogue._pendingReaction = this._lastReaction;
        }
        SceneManager.pop();
    };

    Scene_BlackAIGift.prototype.update = function() {
        Scene_Base.prototype.update.call(this);

        if (this._rejectGpuId) {
            for (var p = 0; p < this._popupButtons.length; p++) {
                if (this._popupButtons[p].updateButton()) {
                    return;
                }
            }
            if (Input.isTriggered('cancel')) {
                SoundManager.playCancel();
                this._resolveReject(false);
            }
            return;
        }

        if (this._tab0Btn.updateButton() || this._tab1Btn.updateButton() || this._closeBtn.updateButton()) {
            return;
        }
        for (var i = 0; i < this._dynamicButtons.length; i++) {
            if (this._dynamicButtons[i].updateButton()) {
                return;
            }
        }
        if (Input.isTriggered('cancel') || (!this._lockedToDialogue && Input.isTriggered('affection'))) {
            SoundManager.playCancel();
            this._close();
        }
    };

    Scene_BlackAIGift.prototype._clearLayer = function(layer) {
        while (layer.children.length > 0) {
            layer.removeChildAt(0);
        }
    };

    Scene_BlackAIGift.prototype._rebuild = function() {
        this._clearLayer(this._dynLayer);
        this._dynamicButtons = [];

        this._tab0Btn._bg = (this._tab === 0) ? '#29436b' : '#181c28';
        this._tab0Btn._border = (this._tab === 0) ? '#7ce8ff' : '#525c74';
        this._tab0Btn.redraw();

        this._tab1Btn._bg = (this._tab === 1) ? '#29436b' : '#181c28';
        this._tab1Btn._border = (this._tab === 1) ? '#7ce8ff' : '#525c74';
        this._tab1Btn.redraw();

        var b = this._canvas.bitmap;
        b.clear();
        b.fillRect(0, 0, 1280, 720, 'rgba(6, 7, 11, 0.78)');
        b.fillRect(76, 30, 1128, 660, '#5a6680');
        b.fillRect(79, 33, 1122, 654, '#11141e');

        b.fontFace = '"Microsoft YaHei", "SimHei", GameFont, sans-serif';
        b.fontSize = 22;
        b.textColor = '#f4f7fc';
        b.drawText('【6 档显卡送礼 · 全员好感度（0–200%）与 API 并发助战】', 98, 44, 920, 32, 'left');

        if (this._tab === 0) {
            this._drawGiftTab(b);
        } else {
            this._drawAffectionTab(b);
        }

        b.fillRect(96, 636, 1088, 38, '#171c29');
        b.fontSize = 15;
        b.textColor = '#ffd86b';
        b.drawText(this._feedback, 108, 642, 1064, 26, 'left');
    };

    Scene_BlackAIGift.prototype._drawGiftTab = function(b) {
        var self = this;
        var State = BlackAI.State;
        var Data = BlackAI.Data;

        var topY = 142;
        if (!this._lockedToDialogue) {
            var sx = 96;
            for (var h = 0; h < State.CORE_HEROINE_IDS.length; h++) {
                (function(cid, bx) {
                    var btn = BlackAI.UI.createRectButton(bx, topY, 148, 32, Data.getCharacterName(cid), function() {
                        self._targetId = cid;
                        self._rebuild();
                    }, {
                        fontSize: 14,
                        disabled: !State.isCharacterAlive(cid),
                        bg: cid === self._targetId ? '#2d4b78' : '#1b2030',
                        border: cid === self._targetId ? '#7ce8ff' : '#556078'
                    });
                    self._dynamicButtons.push(btn);
                    self._dynLayer.addChild(btn);
                })(State.CORE_HEROINE_IDS[h], sx);
                sx += 156;
            }
            topY += 44;
        }

        var ch = Data.getCharacter(this._targetId);
        var aff = State.getAffection(this._targetId);
        var tier = State.getAffectionTier(this._targetId).name || '初见';
        var group = ch.gift_group || 'general';

        b.fillRect(96, topY, 1088, 92, '#181d2b');
        b.fillRect(112, topY + 18, 56, 56, ch.placeholder_color || '#ffffff');
        b.fontSize = 19;
        b.textColor = '#ffffff';
        b.drawText((ch.name || this._targetId) + '（' + (ch.prototype || '') + '）  |  好感：' + aff + '%（' + tier + '）', 184, topY + 10, 960, 26, 'left');
        b.fontSize = 14;
        b.textColor = (group === 'deepseek') ? '#7ce8ff' : '#ffb87a';
        b.drawText(group === 'deepseek'
            ? '偏好：DeepSeek 三姐妹——收 580 矿卡，所有显卡获额外高额加成（华为 +35）'
            : '偏好：通用显卡——拒收 580 矿卡（硬塞触发 -5 好感惩罚）', 184, topY + 38, 960, 22, 'left');

        // 常规/偏执双槽
        b.fillRect(184, topY + 66, 460, 14, '#252a3a');
        b.fillRect(185, topY + 67, Math.round(458 * Math.min(1, aff / 100)), 12, aff >= 100 ? '#ffd452' : '#6ec4ff');
        b.fillRect(664, topY + 66, 460, 14, '#252a3a');
        b.fillRect(665, topY + 67, Math.round(458 * Math.max(0, Math.min(1, (aff - 100) / 100))), 12, '#f2243b');

        var gpus = Data.getItemIds('graphics_cards');
        var rowY = topY + 108;
        var alive = State.isCharacterAlive(this._targetId);
        for (var i = 0; i < gpus.length; i++) {
            (function(gpuId, y) {
                var card = Data.getItem(gpuId);
                var owned = State.getItemCount(gpuId);
                var preview = self._describeGpu(card, group, aff);

                b.fillRect(96, y, 1088, 46, '#151926');
                b.fillRect(110, y + 12, 22, 22, card.placeholder_color || '#888888');
                b.fontSize = 16;
                b.textColor = '#f2f5fb';
                b.drawText((card.name || gpuId) + ' ×' + owned, 146, y + 10, 220, 26, 'left');
                b.fontSize = 15;
                b.textColor = preview.color;
                b.drawText(preview.text, 376, y + 10, 660, 26, 'left');

                var btn = BlackAI.UI.createRectButton(1062, y + 6, 108, 34, '赠送', function() {
                    self._onGiveGpu(gpuId);
                }, { disabled: (owned <= 0 || !alive), fontSize: 15, bg: '#233b5e', border: '#6ec4ff' });
                self._dynamicButtons.push(btn);
                self._dynLayer.addChild(btn);
            })(gpus[i], rowY);
            rowY += 54;
        }
    };

    Scene_BlackAIGift.prototype._describeGpu = function(card, group, curAff) {
        var gift = card.gift || {};
        if (gift.mode === 'fill') {
            var fillTo = Number(gift.fill_to || 100);
            var ovTo = Number(gift.overflow_fill_to || 200);
            if (curAff >= ovTo) return { text: '好感已达 ' + ovTo + '% 偏执极限', color: '#ff5c6c' };
            if (curAff >= fillTo) return { text: '已满 ' + fillTo + '% → 直接冲至 ' + ovTo + '%（偏执溢出态！）', color: '#ff4258' };
            return { text: '直接拉满至 ' + fillTo + '% 满好感（满后再送可冲至 ' + ovTo + '%）', color: '#ffe066' };
        }
        var per = gift.per_character || {};
        var gain = Object.prototype.hasOwnProperty.call(per, this._targetId)
            ? per[this._targetId]
            : (group === 'deepseek' ? gift.deepseek : gift.general);
        if (gain === null || gain === undefined) {
            return { text: '拒收！（若选择强送：好感 ' + (gift.reject_penalty || -5) + '）', color: '#ff7070' };
        }
        return {
            text: '好感 +' + gain + '% ' + (group === 'deepseek' ? '（三姐妹专属高加成）' : '（通用加成）'),
            color: '#8ef2a8'
        };
    };

    Scene_BlackAIGift.prototype._drawAffectionTab = function(b) {
        var self = this;
        var State = BlackAI.State;
        var Data = BlackAI.Data;
        var assistMin = Data.getConfigInt('affection.assist_min', 70);
        var curAssist = State.assist_partner_id ? Data.getCharacterName(State.assist_partner_id) : '无';

        b.fontSize = 15;
        b.textColor = '#b7cbe2';
        b.drawText('左槽：0–100% 常规 | 右槽（红）：101–200% 偏执溢出   |   当前 API 并发助战：' + curAssist + '（好感 ≥ ' + assistMin + '% 可设）', 96, 138, 1088, 26, 'left');

        var y = 172;
        for (var i = 0; i < State.CORE_HEROINE_IDS.length; i++) {
            (function(cid, rowY) {
                var ch = Data.getCharacter(cid);
                var alive = State.isCharacterAlive(cid);
                var aff = State.getAffection(cid);
                var tier = State.getAffectionTier(cid).name || '初见';
                var isCur = (State.assist_partner_id === cid);

                b.fillRect(96, rowY, 1088, 58, '#161a26');
                b.fillRect(110, rowY + 14, 30, 30, alive ? (ch.placeholder_color || '#ffffff') : '#383a42');

                var hint = '';
                if (aff >= 200) hint = ' · 偏执溢出极限';
                else if (aff >= 101) hint = ' · 突破常规上限';
                else if (aff >= 100) hint = ' · 满好感达成';
                else if (aff >= assistMin) hint = ' · 可设并发助战';

                b.fontSize = 16;
                b.textColor = !alive ? '#6e7382' : (aff >= 101 ? '#ff4d61' : (aff >= 100 ? '#ffd866' : '#eef3fa'));
                b.drawText((ch.name || cid) + '（' + (ch.prototype || '') + '）' + (alive ? '' : ' [已清空]') + '  —  ' + aff + '% [' + tier + ']' + hint, 154, rowY + 6, 740, 24, 'left');

                b.fillRect(154, rowY + 36, 360, 12, '#242938');
                b.fillRect(155, rowY + 37, Math.round(358 * Math.min(1, aff / 100)), 10, aff >= 100 ? '#ffd452' : '#6ec4ff');
                b.fillRect(524, rowY + 36, 360, 12, '#242938');
                b.fillRect(525, rowY + 37, Math.round(358 * Math.max(0, Math.min(1, (aff - 100) / 100))), 10, '#f2243b');

                var assistBtn = BlackAI.UI.createRectButton(902, rowY + 12, 162, 34, isCur ? '已设助战(取消)' : '设并发助战', function() {
                    if (isCur) {
                        State.setAssistPartner('');
                        self._feedback = '已取消 API 并发助战伙伴。';
                    } else if (State.setAssistPartner(cid)) {
                        self._feedback = '已将【' + Data.getCharacterName(cid) + '】设为 API 并发助战伙伴！（战斗中可随时呼叫，小心修罗场！）';
                    } else {
                        self._feedback = '设置助战失败：需要好感 ≥ ' + assistMin + '% 且角色存活。';
                    }
                    self._rebuild();
                }, {
                    fontSize: 14,
                    disabled: !isCur && (!alive || aff < assistMin),
                    bg: isCur ? '#1e4a59' : '#222b3e',
                    border: isCur ? '#7ce8ff' : '#6a7a99'
                });
                self._dynamicButtons.push(assistBtn);
                self._dynLayer.addChild(assistBtn);

                if (!self._lockedToDialogue) {
                    var jumpBtn = BlackAI.UI.createRectButton(1074, rowY + 12, 96, 34, '送显卡', function() {
                        self._targetId = cid;
                        self._tab = 0;
                        self._rebuild();
                    }, { fontSize: 14, disabled: !alive, bg: '#26344d', border: '#7596c4' });
                    self._dynamicButtons.push(jumpBtn);
                    self._dynLayer.addChild(jumpBtn);
                }
            })(State.CORE_HEROINE_IDS[i], y);
            y += 64;
        }
    };

    Scene_BlackAIGift.prototype._onGiveGpu = function(gpuId) {
        var State = BlackAI.State;
        var Data = BlackAI.Data;
        var res = State.giftGraphicsCard(this._targetId, gpuId, false, true);
        if (!res.ok) {
            this._feedback = '赠送失败（' + res.reason + '）。';
            this._rebuild();
            return;
        }
        if (res.rejected) {
            this._openRejectPopup(gpuId);
            return;
        }
        if (res.new_value >= 200 && res.old_value < 200) {
            this._lastReaction = 'gift_overflow_200';
        } else if (res.new_value >= 100 && res.old_value < 100) {
            this._lastReaction = 'gift_full_100';
        } else {
            this._lastReaction = 'gift_accepted';
        }
        var tier = State.getAffectionTier(this._targetId).name || '';
        this._feedback = '赠送【' + Data.getItemName(gpuId) + '】给【' + Data.getCharacterName(this._targetId) + '】成功！好感 ' + res.old_value + '% → ' + res.new_value + '%（+' + res.delta + '% · ' + tier + '）';
        this._rebuild();
    };

    Scene_BlackAIGift.prototype._openRejectPopup = function(gpuId) {
        this._rejectGpuId = gpuId;
        var self = this;
        var cname = BlackAI.Data.getCharacterName(this._targetId);
        var gname = BlackAI.Data.getItemName(gpuId);
        var b = this._popupCanvas.bitmap;
        b.clear();
        b.fillRect(0, 0, 1280, 720, 'rgba(6, 2, 4, 0.78)');
        b.fillRect(350, 210, 580, 270, '#ff4858');
        b.fillRect(353, 213, 574, 264, '#180d12');
        b.fontFace = '"Microsoft YaHei", "SimHei", GameFont, sans-serif';
        b.fontSize = 22;
        b.textColor = '#ff6270';
        b.drawText('警告：对方拒收 580 矿卡！', 370, 232, 540, 32, 'center');
        BlackAI.UI.drawWrappedText(
            b,
            '【' + cname + '】一脸嫌弃地推开了【' + gname + '】！\n（只有 DeepSeek 三姐妹接收 580 矿卡，其余 AI 娘全员拒收）\n\n是否强行塞给她？（强送惩罚：好感 -5%）',
            382, 280, 516, 26, 17, '#f2dfe4'
        );

        this._clearLayer(this._popupLayer);
        var cancelBtn = BlackAI.UI.createRectButton(396, 412, 224, 42, '算了，收回 580 矿卡', function() {
            self._resolveReject(false);
        }, { fontSize: 15, bg: '#222836', border: '#8fa1c2' });
        var forceBtn = BlackAI.UI.createRectButton(656, 412, 234, 42, '硬塞给她！（强送，好感 -5）', function() {
            self._resolveReject(true);
        }, { fontSize: 15, bg: '#5a1622', bgHover: '#7a1c2d', border: '#ff5263' });
        this._popupButtons = [cancelBtn, forceBtn];
        this._popupLayer.addChild(cancelBtn);
        this._popupLayer.addChild(forceBtn);
        this._popupCanvas.visible = true;
        this._popupLayer.visible = true;
    };

    Scene_BlackAIGift.prototype._resolveReject = function(doForce) {
        var gpuId = this._rejectGpuId;
        this._rejectGpuId = '';
        this._popupCanvas.visible = false;
        this._popupLayer.visible = false;
        this._clearLayer(this._popupLayer);
        this._popupButtons = [];

        var cname = BlackAI.Data.getCharacterName(this._targetId);
        var gname = BlackAI.Data.getItemName(gpuId);
        if (!doForce) {
            this._lastReaction = 'gift_rejected';
            this._feedback = '你收回了【' + gname + '】。（【' + cname + '】拒收此卡）';
        } else {
            var res = BlackAI.State.giftGraphicsCard(this._targetId, gpuId, true, true);
            this._lastReaction = 'gift_forced';
            this._feedback = '强送【' + gname + '】遭【' + cname + '】当场拍飞！触发拒收惩罚：好感 ' + res.old_value + '% → ' + res.new_value + '%（' + res.delta + '%）';
        }
        this._rebuild();
    };

    BlackAI.Scene_Dialogue = Scene_BlackAIDialogue;
    BlackAI.Scene_Gift = Scene_BlackAIGift;
})(typeof window !== 'undefined' ? window : global);
