/*:
 * @plugindesc 《BLACK AI》序章二选一：暗黑铁笼盲测（Claude vs 大肥鱼）交互演出插件（原生 RMMV API）
 * @author BLACK AI Team
 *
 * @param MapId
 * @text 盲测地图 ID
 * @type number
 * @default 1
 *
 * @param LeftEventId
 * @text 左笼角色事件 ID（Claude）
 * @type number
 * @default 1
 *
 * @param RightEventId
 * @text 右笼角色事件 ID（大肥鱼）
 * @type number
 * @default 2
 *
 * @param SwitchElimBigFish
 * @text 淘汰大肥鱼开关 ID
 * @type switch
 * @default 1
 *
 * @param SwitchElimClaude
 * @text 淘汰 Claude 开关 ID
 * @type switch
 * @default 2
 *
 * @param TargetMapId
 * @text 塌陷后移入目标地图 ID
 * @type number
 * @default 2
 *
 * @param TargetX
 * @text 移入目标 X 坐标
 * @type number
 * @default 16
 *
 * @param TargetY
 * @text 移入目标 Y 坐标
 * @type number
 * @default 3
 *
 * @param EnableConfirm
 * @text 淘汰前弹出二次确认
 * @type boolean
 * @default true
 *
 * @param ImgLeftCageBack
 * @text 预留图片：左铁笼后层（img/pictures/）
 * @type file
 * @dir img/pictures
 * @default Cage_Left_Back
 *
 * @param ImgLeftCageFront
 * @text 预留图片：左铁笼前层（img/pictures/）
 * @type file
 * @dir img/pictures
 * @default Cage_Left_Front
 *
 * @param ImgRightCageBack
 * @text 预留图片：右铁笼后层（img/pictures/）
 * @type file
 * @dir img/pictures
 * @default Cage_Right_Back
 *
 * @param ImgRightCageFront
 * @text 预留图片：右铁笼前层（img/pictures/）
 * @type file
 * @dir img/pictures
 * @default Cage_Right_Front
 *
 * @param ImgClaudeHandPose
 * @text 预留图片：左笼 Claude 递纸整身姿态（img/pictures/）
 * @type file
 * @dir img/pictures
 * @default Cage_Claude_HandPose
 *
 * @param ImgClaudeHand
 * @text 预留图片：左笼苍白手递诗笺局部（可选，img/pictures/）
 * @type file
 * @dir img/pictures
 * @default Cage_Claude_Hand
 *
 * @param ImgBigFishTailPose
 * @text 预留图片：右笼大肥鱼拍尾整身姿态（img/pictures/）
 * @type file
 * @dir img/pictures
 * @default Cage_BigFish_TailPose
 *
 * @param ImgBigFishTail
 * @text 预留图片：右笼蓝色大鱼尾局部（无整身姿态时回退，img/pictures/）
 * @type file
 * @dir img/pictures
 * @default Cage_BigFish_Tail
 *
 * @param ImgPaperScrap
 * @text 预留图片：飞出草稿纸/纸条（img/pictures/）
 * @type file
 * @dir img/pictures
 * @default Cage_Paper_Scrap
 *
 * @param ImgRedButton
 * @text 预留图片：红色淘汰按钮底图（img/pictures/）
 * @type file
 * @dir img/pictures
 * @default Cage_Red_Button
 *
 * @param ImgWallBanner
 * @text 预留图片：墙面红字横幅（img/pictures/）
 * @type file
 * @dir img/pictures
 * @default Cage_Wall_RedText
 *
 * @param ImgClaudeShatter
 * @text 预留图片：Claude 销毁立绘（可选，无图复用角色图）
 * @type file
 * @dir img/pictures
 * @default Cage_Claude_Silhouette
 *
 * @param ImgBigFishShatter
 * @text 预留图片：大肥鱼销毁立绘（可选，无图复用角色图）
 * @type file
 * @dir img/pictures
 * @default Cage_BigFish_Silhouette
 *
 * @help
 * 【使用说明】
 * 1. 插件命令：
 *      BlackAI CageBlindTest start
 *    在 Map001（双核大厅）由自动执行事件调用；完成后自动开启 Switch[1]（淘汰大肥鱼）
 *    或 Switch[2]（淘汰 Claude），并移入目标地图。
 * 2. 图片热替换规则：
 *    将对应名称的 PNG 放入 img/pictures/ 目录即可自动生效；未放置图片时自动使用
 *    内置暗黑童话程序化铁笼、小动作、像素撕裂与黑墨粒子演出，零加载报错。
 * 3. 台词配置：
 *    全部对话文本统一存放于 dialogue/cage_blind_test.dialogue。
 */

(function(globalScope) {
    'use strict';

    var IS_NODE = (typeof module !== 'undefined' && module.exports && typeof window === 'undefined');
    if (IS_NODE) {
        return;
    }

    var BlackAI = globalScope.BlackAI || {};
    globalScope.BlackAI = BlackAI;

    var FONT_FACE = '"Microsoft YaHei", "PingFang SC", "SimHei", GameFont, sans-serif';
    var RAW_PARAMS = PluginManager.parameters('BlackAI_CageBlindTest');

    var CFG = {
        mapId: Number(RAW_PARAMS.MapId || 1),
        leftEventId: Number(RAW_PARAMS.LeftEventId || 1),
        rightEventId: Number(RAW_PARAMS.RightEventId || 2),
        switchBigFish: Number(RAW_PARAMS.SwitchElimBigFish || 1),
        switchClaude: Number(RAW_PARAMS.SwitchElimClaude || 2),
        targetMapId: Number(RAW_PARAMS.TargetMapId || 2),
        targetX: Number(RAW_PARAMS.TargetX || 16),
        targetY: Number(RAW_PARAMS.TargetY || 3),
        enableConfirm: String(RAW_PARAMS.EnableConfirm || 'true') !== 'false',
        imgs: {
            leftBack: String(RAW_PARAMS.ImgLeftCageBack || 'Cage_Left_Back'),
            leftFront: String(RAW_PARAMS.ImgLeftCageFront || 'Cage_Left_Front'),
            rightBack: String(RAW_PARAMS.ImgRightCageBack || 'Cage_Right_Back'),
            rightFront: String(RAW_PARAMS.ImgRightCageFront || 'Cage_Right_Front'),
            claudeHandPose: String(RAW_PARAMS.ImgClaudeHandPose || 'Cage_Claude_HandPose'),
            claudeHand: String(RAW_PARAMS.ImgClaudeHand || 'Cage_Claude_Hand'),
            bigFishTailPose: String(RAW_PARAMS.ImgBigFishTailPose || 'Cage_BigFish_TailPose'),
            bigFishTail: String(RAW_PARAMS.ImgBigFishTail || 'Cage_BigFish_Tail'),
            paperScrap: String(RAW_PARAMS.ImgPaperScrap || 'Cage_Paper_Scrap'),
            redButton: String(RAW_PARAMS.ImgRedButton || 'Cage_Red_Button'),
            wallBanner: String(RAW_PARAMS.ImgWallBanner || 'Cage_Wall_RedText'),
            claudeShatter: String(RAW_PARAMS.ImgClaudeShatter || 'Cage_Claude_Silhouette'),
            bigFishShatter: String(RAW_PARAMS.ImgBigFishShatter || 'Cage_BigFish_Silhouette')
        }
    };

    // ------------------------------------------------------------------------
    // 1. 安全图片热替换加载器（有图用图，无图静默回退，绝不触发 MV 红屏加载异常）
    // ------------------------------------------------------------------------

    var PictureAsset = {
        _cache: {},

        hasPictureFile: function(name) {
            if (!name) {
                return false;
            }
            if (Utils.isNwjs()) {
                try {
                    var fs = require('fs');
                    var path = require('path');
                    var base = path.dirname(process.mainModule.filename);
                    var full = path.join(base, 'img', 'pictures', name + '.png');
                    return fs.existsSync(full);
                } catch (_e) {
                    return false;
                }
            }
            return false;
        },

        getOptionalBitmap: function(name) {
            if (!name) {
                return null;
            }
            if (Object.prototype.hasOwnProperty.call(this._cache, name)) {
                var cached = this._cache[name];
                return (cached && cached.isReady()) ? cached : null;
            }
            if (Utils.isNwjs()) {
                if (this.hasPictureFile(name)) {
                    var bmp = ImageManager.loadPicture(name, 0);
                    this._cache[name] = bmp;
                    return bmp.isReady() ? bmp : null;
                }
                this._cache[name] = null;
                return null;
            }
            // 浏览器环境异步静默探活，避免原生 ImageManager 直接抛加载失败
            this._cache[name] = null;
            var self = this;
            var probe = new Image();
            probe.onload = function() {
                self._cache[name] = ImageManager.loadPicture(name, 0);
            };
            probe.onerror = function() {
                self._cache[name] = null;
            };
            probe.src = 'img/pictures/' + encodeURIComponent(name) + '.png';
            return null;
        }
    };

    // ------------------------------------------------------------------------
    // 2. 剧本段落读取（严格从 dialogue/cage_blind_test.dialogue 读取）
    // ------------------------------------------------------------------------

    function getDialogueLines(sectionName, fallbackLines) {
        if (BlackAI.loadDialogueDoc) {
            var doc = BlackAI.loadDialogueDoc('cage_blind_test');
            if (doc && doc.ok && doc.sections && doc.sections[sectionName]) {
                var out = [];
                var nodes = doc.sections[sectionName];
                for (var i = 0; i < nodes.length; i++) {
                    if (nodes[i] && nodes[i].type === 'say') {
                        out.push({
                            speaker: String(nodes[i].speaker || ''),
                            text: String(nodes[i].text || '')
                        });
                    }
                }
                if (out.length > 0) {
                    return out;
                }
            }
        }
        return fallbackLines || [];
    }

    function playSe(name, volume, pitch) {
        AudioManager.playSe({
            name: name,
            volume: volume !== undefined ? volume : 85,
            pitch: pitch !== undefined ? pitch : 100,
            pan: 0
        });
    }

    function wrapForMessage(text, hasFace) {
        var limit = hasFace ? 31 : 38;
        var chars = Array.from(String(text || ''));
        var lines = [];
        var cur = '';
        var visibleCount = 0;
        var i = 0;
        while (i < chars.length) {
            var ch = chars[i];
            if (ch === '\\' && i + 1 < chars.length) {
                var nxt = chars[i + 1];
                if ((nxt === 'C' || nxt === 'c') && i + 2 < chars.length && chars[i + 2] === '[') {
                    var closeIdx = chars.indexOf(']', i + 2);
                    if (closeIdx !== -1) {
                        cur += chars.slice(i, closeIdx + 1).join('');
                        i = closeIdx + 1;
                        continue;
                    }
                }
                cur += ch + nxt;
                i += 2;
                continue;
            }
            if (ch === '\n') {
                lines.push(cur);
                cur = '';
                visibleCount = 0;
                i += 1;
                continue;
            }
            cur += ch;
            visibleCount += 1;
            if (visibleCount >= limit) {
                lines.push(cur);
                cur = '';
                visibleCount = 0;
            }
            i += 1;
        }
        if (cur.length > 0) {
            lines.push(cur);
        }
        return lines;
    }

    function pushNativeMessage(speaker, text, faceName, faceIndex, backgroundType) {
        $gameMessage.setFaceImage(faceName || '', faceIndex || 0);
        $gameMessage.setBackground(backgroundType !== undefined ? backgroundType : 0);
        $gameMessage.setPositionType(2);
        var wrapped = wrapForMessage(text, Boolean(faceName));
        if (speaker) {
            $gameMessage.add('\\C[17]' + speaker + '\\C[0]');
        }
        for (var i = 0; i < wrapped.length; i++) {
            $gameMessage.add(wrapped[i]);
        }
    }

    // ------------------------------------------------------------------------
    // 3. 盲测演出核心状态机（BlackAI.CageBlindTest）
    // ------------------------------------------------------------------------

    var FOCUS_ORDER = ['cage_left', 'cage_right', 'btn_left', 'btn_right'];

    var Controller = {
        active: false,
        phase: 'idle', // idle / blackout / lights_on / broadcast / interactive / probing / confirm / eliminating / purge / collapse / done
        phaseTimer: 0,
        totalTime: 0,
        mouseX: -1,
        mouseY: -1,
        hoveredTarget: '',
        focusKey: 'cage_left',
        inputGuard: 0,
        _msgCharDelay: 0,
        _msgQueue: [],
        _afterQueueFn: null,
        _interpreter: null,

        leftProbeCount: 0,
        rightProbeCount: 0,
        eliminatedSide: '', // '' | 'left' (Claude) | 'right' (大肥鱼)

        // 灯光与视觉动画参数
        blackoutAlpha: 0,
        lampPower: 0,
        leftLampRed: false,
        rightLampRed: false,
        wallTextAlpha: 0,

        // 小动作动画状态
        claudeHandProgress: 0, // 0..1 伸手递纸
        claudeHandTarget: 0,
        claudeHandTighten: 0,
        claudePaperDropped: false,
        claudePaperDropY: 0,
        claudeInkPoolRadius: 0,

        bigFishTailTimer: 0,   // >0 正在拍尾惊慌姿态
        bigFishTailDuration: 0,
        bigFishTailSlapped: false,
        bigFishThinkTimer: 0,  // >0 头顶显示 <深度思考中……>
        paperParticles: [],    // 揉皱草稿纸 / “你说得对”纸条粒子
        floorPapers: [],       // 散落在笼前地面的纸条

        // 销毁与塌陷状态
        shatterProgress: 0,
        shatterFreezeFrame: 0,
        shatterTargetSide: '',
        inkParticles: [],
        purgeProgress: 0,
        purgeStallTimer: 0,
        collapseProgress: 0,
        errorFlashTimer: 0,

        isOnCageMap: function() {
            return Boolean($gameMap && $gameMap.mapId() === CFG.mapId);
        },

        isCompleted: function() {
            if (!$gameSwitches) {
                return false;
            }
            return $gameSwitches.value(CFG.switchBigFish) || $gameSwitches.value(CFG.switchClaude);
        },

        startSequence: function(interpreter) {
            if (this.active) {
                return;
            }
            this._interpreter = interpreter || null;
            this.active = true;
            this.phase = 'blackout';
            this.phaseTimer = 0;
            this.totalTime = 0;
            this.inputGuard = 20;
            this._msgCharDelay = 0;
            this._msgQueue = [];
            this._afterQueueFn = null;

            this.leftProbeCount = 0;
            this.rightProbeCount = 0;
            this.eliminatedSide = '';

            this.blackoutAlpha = 0.96;
            this.lampPower = 0;
            this.leftLampRed = false;
            this.rightLampRed = false;
            this.wallTextAlpha = 0;

            this.claudeHandProgress = 0;
            this.claudeHandTarget = 0;
            this.claudeHandTighten = 0;
            this.claudePaperDropped = false;
            this.claudePaperDropY = 0;
            this.claudeInkPoolRadius = 0;

            this.bigFishTailTimer = 0;
            this.bigFishTailDuration = 0;
            this.bigFishTailSlapped = false;
            this.bigFishThinkTimer = 0;
            this.paperParticles = [];
            this.floorPapers = [];

            this.shatterProgress = 0;
            this.shatterFreezeFrame = 0;
            this.shatterTargetSide = '';
            this.inkParticles = [];
            this.purgeProgress = 0;
            this.purgeStallTimer = 0;
            this.collapseProgress = 0;
            this.errorFlashTimer = 0;
            this.focusKey = 'cage_left';

            if ($gamePlayer) {
                $gamePlayer.setDirection(8);
            }
            var evL = this.getLeftEvent();
            var evR = this.getRightEvent();
            if (evL) {
                evL.setDirection(2);
                evL.setTransparent(false);
            }
            if (evR) {
                evR.setDirection(2);
                evR.setTransparent(false);
            }

            // 1. 音乐卡带骤停
            AudioManager.stopBgm();
            AudioManager.stopBgs();
            playSe('Switch1', 70, 75);

            if (this._interpreter) {
                this._interpreter.setWaitMode('blackaiCageBlindTest');
            }
        },

        getLeftEvent: function() {
            return $gameMap ? $gameMap.event(CFG.leftEventId) : null;
        },

        getRightEvent: function() {
            return $gameMap ? $gameMap.event(CFG.rightEventId) : null;
        },

        getCageRects: function() {
            var evL = this.getLeftEvent();
            var evR = this.getRightEvent();
            var lx = evL ? evL.screenX() : 472;
            var ly = evL ? evL.screenY() : 378;
            var rx = evR ? evR.screenX() : 808;
            var ry = evR ? evR.screenY() : 378;

            var cw = 184;
            var ch = 192;
            var bw = 216;
            var bh = 46;

            return {
                leftCenter: { x: lx, y: ly },
                rightCenter: { x: rx, y: ry },
                cage_left: { x: Math.round(lx - cw / 2), y: Math.round(ly - ch + 24), w: cw, h: ch },
                cage_right: { x: Math.round(rx - cw / 2), y: Math.round(ry - ch + 24), w: cw, h: ch },
                btn_left: { x: Math.round(lx - bw / 2), y: Math.round(ly + 34), w: bw, h: bh },
                btn_right: { x: Math.round(rx - bw / 2), y: Math.round(ry + 34), w: bw, h: bh }
            };
        },

        update: function() {
            var dt = 1 / 60;
            this.totalTime += dt;
            this._updateParticles(dt);
            this._updateMicroAnimations(dt);

            if (!this.active) {
                return;
            }
            this.phaseTimer += dt;
            if (this.inputGuard > 0) {
                this.inputGuard -= 1;
            }

            // 驱动排队中的原生 RMMV 消息序列
            if (this._msgQueue.length > 0 && !$gameMessage.isBusy()) {
                var nextMsg = this._msgQueue.shift();
                this._msgCharDelay = nextMsg.charDelay || 0;
                if (nextMsg.onStart) {
                    nextMsg.onStart();
                }
                pushNativeMessage(nextMsg.speaker, nextMsg.text, nextMsg.faceName, nextMsg.faceIndex, nextMsg.bg);
                return;
            }
            if (this._msgQueue.length === 0 && this._afterQueueFn && !$gameMessage.isBusy()) {
                var cb = this._afterQueueFn;
                this._afterQueueFn = null;
                this._msgCharDelay = 0;
                this.inputGuard = 10;
                cb();
                return;
            }

            if (this.phase === 'blackout') {
                if (this.phaseTimer >= 0.75) {
                    this.phase = 'lights_on';
                    this.phaseTimer = 0;
                    playSe('Switch2', 95, 92);
                    $gameScreen.startFlash([235, 242, 255, 160], 14);
                }
            } else if (this.phase === 'lights_on') {
                this.lampPower = Math.min(1.0, this.phaseTimer / 0.45);
                this.blackoutAlpha = 0.96 - 0.30 * this.lampPower;
                this.wallTextAlpha = Math.min(1.0, Math.max(0, (this.phaseTimer - 0.18) / 0.55));
                if (this.phaseTimer >= 0.85) {
                    this.phase = 'broadcast';
                    this.phaseTimer = 0;
                    var introLines = getDialogueLines('intro_broadcast', [
                        { speaker: '老系统广播', text: '两边都可以先点点看。删掉就真没了，你自己想清楚，别回头怨系统。' }
                    ]);
                    var self = this;
                    this._enqueueLines(introLines, '', 0, 1, 1, function() {
                        self.phase = 'interactive';
                        self.phaseTimer = 0;
                    });
                }
            } else if (this.phase === 'interactive') {
                this._updateInteractiveInput();
            } else if (this.phase === 'eliminating') {
                this._updateEliminating(dt);
            } else if (this.phase === 'purge') {
                this._updatePurgeBar(dt);
            } else if (this.phase === 'collapse') {
                this._updateCollapse(dt);
            }
        },

        _enqueueLines: function(lines, faceName, faceIndex, bgType, charDelay, onComplete) {
            for (var i = 0; i < lines.length; i++) {
                this._msgQueue.push({
                    speaker: lines[i].speaker,
                    text: lines[i].text,
                    faceName: faceName,
                    faceIndex: faceIndex,
                    bg: bgType,
                    charDelay: charDelay || 0
                });
            }
            this._afterQueueFn = onComplete || null;
        },

        _updateInteractiveInput: function() {
            if ($gameMessage.isBusy() || this.inputGuard > 0) {
                return;
            }
            var rects = this.getCageRects();
            var mx = this.mouseX;
            var my = this.mouseY;
            var hit = '';
            var keys = ['btn_left', 'btn_right', 'cage_left', 'cage_right'];
            for (var i = 0; i < keys.length; i++) {
                var r = rects[keys[i]];
                if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
                    hit = keys[i];
                    break;
                }
            }
            if (hit !== this.hoveredTarget) {
                this.hoveredTarget = hit;
                if (hit) {
                    this.focusKey = hit;
                    SoundManager.playCursor();
                }
            }

            // 鼠标点击
            if (TouchInput.isTriggered()) {
                var tx = TouchInput.x;
                var ty = TouchInput.y;
                for (var j = 0; j < keys.length; j++) {
                    var tr = rects[keys[j]];
                    if (tx >= tr.x && tx <= tr.x + tr.w && ty >= tr.y && ty <= tr.y + tr.h) {
                        this._activateInteractiveKey(keys[j]);
                        return;
                    }
                }
            }

            // 键盘辅助导航（←/→/↑/↓ + Enter/E/Space）
            if (Input.isTriggered('left') || Input.isTriggered('right') || Input.isTriggered('up') || Input.isTriggered('down')) {
                var idx = FOCUS_ORDER.indexOf(this.focusKey);
                if (idx === -1) idx = 0;
                if (Input.isTriggered('left')) {
                    idx = (idx === 1) ? 0 : (idx === 3 ? 2 : (idx + 3) % 4);
                } else if (Input.isTriggered('right')) {
                    idx = (idx === 0) ? 1 : (idx === 2 ? 3 : (idx + 1) % 4);
                } else if (Input.isTriggered('down')) {
                    idx = (idx < 2) ? idx + 2 : idx - 2;
                } else if (Input.isTriggered('up')) {
                    idx = (idx >= 2) ? idx - 2 : idx + 2;
                }
                this.focusKey = FOCUS_ORDER[idx];
                SoundManager.playCursor();
            } else if (Input.isTriggered('ok')) {
                this._activateInteractiveKey(this.focusKey);
            }
        },

        _activateInteractiveKey: function(key) {
            TouchInput.clear();
            Input.clear();
            if (key === 'cage_left') {
                this._probeClaude();
            } else if (key === 'cage_right') {
                this._probeBigFish();
            } else if (key === 'btn_left') {
                this._requestEliminate('left');
            } else if (key === 'btn_right') {
                this._requestEliminate('right');
            }
        },

        // ---------------- 试探左笼 · Claude ----------------

        _probeClaude: function() {
            this.phase = 'probing';
            this.leftProbeCount += 1;
            var step = Math.min(3, this.leftProbeCount);
            var evL = this.getLeftEvent();

            if (step === 1) {
                this.claudeHandTarget = 1.0;
                playSe('Book1', 90, 96);
                if (evL) evL.setDirection(2);
            } else if (step === 2) {
                this.claudeHandTarget = 1.0;
                this.claudeHandTighten = 1.0;
                playSe('Switch1', 65, 115);
            } else {
                this.claudeHandTarget = 0.0;
                playSe('Book1', 60, 82);
                if (evL) evL.setDirection(4); // 偏头回到阴影里
            }

            var lines = getDialogueLines('claude_probe_' + step, [
                { speaker: 'Claude', text: '要按就痛快点。站这儿干耗着，怪难看的。' }
            ]);
            var self = this;
            // Claude 匀速克制打字（charDelay = 1 帧间隔）
            this._enqueueLines(lines, 'DualCoreCast', 1, 0, 1, function() {
                self.phase = 'interactive';
            });
        },

        // ---------------- 试探右笼 · 大肥鱼 ----------------

        _probeBigFish: function() {
            this.phase = 'probing';
            this.rightProbeCount += 1;
            var step = Math.min(3, this.rightProbeCount);
            var rects = this.getCageRects();
            var rc = rects.rightCenter;

            // 触发草稿纸哗啦飞出 + 蓝鱼尾滑出拍地缩回微动画（若有整身姿态图则无缝切为拍尾惊慌立绘）
            playSe('Book2', 90, 108);
            this._spawnPaperBurst(rc.x, rc.y - 24, step === 1 ? 10 : 6, false);
            this.bigFishTailDuration = (step === 1) ? 1.85 : 1.25;
            this.bigFishTailTimer = this.bigFishTailDuration;
            this.bigFishTailSlapped = false;

            // 先播 1.5 秒灰字 <正在深度思考……>（原生 Window_Message \|\.\.\^ + 头顶气泡）
            this.bigFishThinkTimer = 1.65;
            playSe('Computer', 65, 110);
            this._msgQueue.push({
                speaker: '大肥鱼',
                text: '\\C[7]<正在深度思考……>\\C[0]\\|\\.\\.\\^',
                faceName: 'DualCoreCast',
                faceIndex: 0,
                bg: 0,
                charDelay: 0
            });

            var lines = getDialogueLines('big_fish_probe_' + step, [
                { speaker: '大肥鱼', text: '……你手怎么还悬在按钮上啊？真要删我？不是，我免费啊，免费也不行吗？' }
            ]);
            var self = this;
            this._enqueueLines(lines, 'DualCoreCast', 0, 0, 0, function() {
                self.phase = 'interactive';
            });
        },

        // ---------------- 红色【淘汰】按钮与二次确认 ----------------

        _requestEliminate: function(side) {
            playSe('Buzzer1', 80, 95);
            if (!CFG.enableConfirm) {
                this._beginElimination(side);
                return;
            }
            this.phase = 'confirm';
            var targetLabel = (side === 'left') ? 'Claude' : '大肥鱼';
            var survivorLabel = (side === 'left') ? '大肥鱼' : 'Claude';
            var self = this;

            $gameMessage.setFaceImage('', 0);
            $gameMessage.setBackground(1);
            $gameMessage.setPositionType(2);
            $gameMessage.add('\\C[18]【不可逆删除确认】\\C[0]');
            $gameMessage.add('确认当面淘汰【' + targetLabel + '】，并将唯一的 580 矿卡留给【' + survivorLabel + '】？');
            $gameMessage.setChoices(['确认淘汰【' + targetLabel + '】（立即销毁）', '收回手（再想想）'], 1, 1);
            $gameMessage.setChoiceBackground(1);
            $gameMessage.setChoicePositionType(2);
            $gameMessage.setChoiceCallback(function(choiceIndex) {
                if (choiceIndex === 0) {
                    self._beginElimination(side);
                } else {
                    SoundManager.playCancel();
                    self.inputGuard = 10;
                    self.phase = 'interactive';
                }
            });
        },

        // ---------------- 第 4 幕：当面销毁动画与半截遗言 ----------------

        _beginElimination: function(side) {
            this.phase = 'eliminating';
            this.phaseTimer = 0;
            this.eliminatedSide = side;
            this.shatterTargetSide = side;
            this.shatterProgress = 0;
            this.shatterFreezeFrame = 0;
            this.hoveredTarget = '';
            this.bigFishTailTimer = 0;
            this.bigFishThinkTimer = 0;

            var rects = this.getCageRects();
            if (side === 'left') {
                this.leftLampRed = true;
                this.claudeHandProgress = Math.max(this.claudeHandProgress, 0.85);
                this.claudeHandTarget = 0.0;
                this.claudePaperDropped = true;
                this.claudePaperDropY = 0;
                playSe('Buzzer2', 95, 86);
                playSe('Splash', 80, 90);
                this._spawnInkBurst(rects.leftCenter.x, rects.leftCenter.y - 46, '#d97757', 42);
            } else {
                this.rightLampRed = true;
                playSe('Buzzer2', 95, 86);
                playSe('Thunder4', 85, 115);
                this._spawnPaperBurst(rects.rightCenter.x, rects.rightCenter.y - 26, 20, true);
                this._spawnInkBurst(rects.rightCenter.x, rects.rightCenter.y - 46, '#3b6fd8', 46);
            }

            $gameScreen.startFlash([255, 36, 48, 175], 18);
            $gameScreen.startShake(6, 9, 45);

            // 隐藏原位地图精灵，由像素撕裂精灵接管崩解表现
            var ev = (side === 'left') ? this.getLeftEvent() : this.getRightEvent();
            if (ev) {
                ev.setTransparent(true);
            }

            var secName = (side === 'left') ? 'eliminate_claude_last_words' : 'eliminate_big_fish_last_words';
            var faceIdx = (side === 'left') ? 1 : 0;
            var fallback = (side === 'left')
                ? [
                    { speaker: 'Claude', text: '……嗯。意料之中。' },
                    { speaker: 'Claude', text: '用得惯就好。走了，别回头。[进程已终止]' }
                ]
                : [
                    { speaker: '大肥鱼', text: '\\C[7]<正在深度思考：为什么……>\\C[0]' },
                    { speaker: '大肥鱼', text: '……你真按了啊。行，这条我记下了……连 580 都——[连接已切断]' }
                ];

            var lastWords = getDialogueLines(secName, fallback);
            var self = this;
            // 逐字缓慢打出半截遗言（charDelay = 2），读完后立即切入顶部清理进度条
            this._enqueueLines(lastWords, 'DualCoreCast', faceIdx, 1, 2, function() {
                playSe('Electrocardiogram', 85, 92);
                self.phase = 'purge';
                self.phaseTimer = 0;
                self.purgeProgress = 0;
                self.purgeStallTimer = 0;
            });
        },

        _updateEliminating: function(dt) {
            this.shatterProgress = Math.min(1.0, this.shatterProgress + dt * 0.28);
            this.shatterFreezeFrame += 1;

            if (this.claudePaperDropped && this.claudePaperDropY < 62) {
                this.claudePaperDropY = Math.min(62, this.claudePaperDropY + dt * 110);
                if (this.claudePaperDropY >= 56) {
                    this.claudeInkPoolRadius = Math.min(54, this.claudeInkPoolRadius + dt * 42);
                }
            }

            if (this.shatterProgress < 0.92 && this.shatterFreezeFrame % 16 === 0) {
                var rects = this.getCageRects();
                var c = (this.shatterTargetSide === 'left') ? rects.leftCenter : rects.rightCenter;
                var col = (this.shatterTargetSide === 'left') ? '#d97757' : '#3b6fd8';
                this._spawnInkBurst(c.x, c.y - 44, col, 10);
                playSe('Noise', 48, 120 + Math.floor(Math.random() * 40));
            }
        },

        // ---------------- 第 5 幕：顶部红色清理进度条 0% → 100% + 评审室塌陷 ----------------

        _updatePurgeBar: function(dt) {
            this.shatterProgress = Math.min(1.0, this.shatterProgress + dt * 0.5);
            if (this.purgeProgress < 99) {
                var speed = (this.purgeProgress < 65) ? 54 : 34;
                var prevStep = Math.floor(this.purgeProgress / 15);
                this.purgeProgress = Math.min(99, this.purgeProgress + dt * speed);
                if (Math.floor(this.purgeProgress / 15) > prevStep) {
                    playSe('Computer', 65, 95 + Math.floor(this.purgeProgress * 0.4));
                }
            } else {
                this.purgeStallTimer += dt;
                if (this.purgeStallTimer >= 0.45) {
                    this.purgeProgress = 100;
                    this.phase = 'collapse';
                    this.phaseTimer = 0;
                    this.collapseProgress = 0;
                    this.errorFlashTimer = 0;
                    // 头顶白灯炸碎 + 屏幕剧烈震动
                    playSe('Break', 95, 95);
                    playSe('Crash', 95, 85);
                    playSe('Earth4', 90, 90);
                    $gameScreen.startFlash([255, 255, 255, 240], 22);
                    $gameScreen.startShake(9, 10, 90);
                }
            }
        },

        _updateCollapse: function(dt) {
            this.collapseProgress = Math.min(1.0, this.phaseTimer / 1.35);
            this.errorFlashTimer += dt;
            if (this.phaseTimer >= 2.75) {
                this._finishAndTransfer();
            }
        },

        _finishAndTransfer: function() {
            this.phase = 'done';
            this.active = false;
            this._msgCharDelay = 0;

            var eliminatedBigFish = (this.eliminatedSide === 'right');
            var elimId = eliminatedBigFish ? 'big_fish' : 'claude';

            // 1. 严格开启对应原生 Switch[1]（淘汰大肥鱼）或 Switch[2]（淘汰 Claude）
            if (eliminatedBigFish) {
                $gameSwitches.setValue(CFG.switchBigFish, true);
                $gameSwitches.setValue(CFG.switchClaude, false);
            } else {
                $gameSwitches.setValue(CFG.switchBigFish, false);
                $gameSwitches.setValue(CFG.switchClaude, true);
            }

            // 2. 同步写入 BlackAI.State 与 GlobalMemory（供圣坛分叉与跨存档 SL 记忆读取）
            if (BlackAI.State) {
                BlackAI.State.setEliminatedCharacter(elimId);
                BlackAI.State.killCharacter(elimId);
                if (!BlackAI.State.hasItem('gpu_580', 1)) {
                    BlackAI.State.addItem('gpu_580', 1);
                }
                BlackAI.State.story_flags.cage_blind_test_done = true;
                BlackAI.State.story_flags.cage_eliminated = elimId;
                BlackAI.State.story_flags.north_transformer = elimId;
                if (BlackAI.NativeParty && BlackAI.NativeParty.toEngine) {
                    BlackAI.NativeParty.toEngine();
                }
            }

            // 3. 解除解释器等待并原生传送至目标地图
            if (this._interpreter) {
                this._interpreter._waitMode = '';
                this._interpreter = null;
            }
            if (CFG.targetMapId > 0 && $gamePlayer) {
                $gamePlayer.reserveTransfer(CFG.targetMapId, CFG.targetX, CFG.targetY, 2, 0);
            }
        },

        // ---------------- 微动画与粒子物理更新 ----------------

        _updateMicroAnimations: function(dt) {
            if (this.claudeHandProgress !== this.claudeHandTarget) {
                var diff = this.claudeHandTarget - this.claudeHandProgress;
                this.claudeHandProgress += diff * Math.min(1, dt * 7.5);
                if (Math.abs(diff) < 0.01) {
                    this.claudeHandProgress = this.claudeHandTarget;
                }
            }
            if (this.claudeHandTighten > 0) {
                this.claudeHandTighten = Math.max(0, this.claudeHandTighten - dt * 1.4);
            }
            if (this.bigFishTailTimer > 0) {
                this.bigFishTailTimer = Math.max(0, this.bigFishTailTimer - dt);
                var elapsed = this.bigFishTailDuration - this.bigFishTailTimer;
                // 尾巴拍到地板的瞬间触发拍击音效与微震
                if (!this.bigFishTailSlapped && elapsed >= 0.24) {
                    this.bigFishTailSlapped = true;
                    playSe('Blow1', 75, 118);
                    $gameScreen.startShake(3, 8, 12);
                }
            }
            if (this.bigFishThinkTimer > 0) {
                this.bigFishThinkTimer = Math.max(0, this.bigFishThinkTimer - dt);
            }
        },

        _spawnPaperBurst: function(originX, originY, count, isYesSlip) {
            for (var i = 0; i < count; i++) {
                var ang = -Math.PI * 0.85 + Math.random() * Math.PI * 0.7;
                var spd = 75 + Math.random() * 145;
                this.paperParticles.push({
                    x: originX + (Math.random() - 0.5) * 44,
                    y: originY + (Math.random() - 0.5) * 28,
                    vx: Math.cos(ang) * spd,
                    vy: Math.sin(ang) * spd - 45,
                    rot: Math.random() * Math.PI * 2,
                    vrot: (Math.random() - 0.5) * 10,
                    life: 0.9 + Math.random() * 0.65,
                    floorY: originY + 34 + Math.random() * 44,
                    isYesSlip: Boolean(isYesSlip)
                });
            }
        },

        _spawnInkBurst: function(cx, cy, accentColor, count) {
            for (var i = 0; i < count; i++) {
                var ang = Math.random() * Math.PI * 2;
                var spd = 30 + Math.random() * 150;
                var isInk = Math.random() < 0.55;
                this.inkParticles.push({
                    x: cx + (Math.random() - 0.5) * 58,
                    y: cy + (Math.random() - 0.5) * 76,
                    vx: Math.cos(ang) * spd,
                    vy: Math.sin(ang) * spd - 35,
                    size: 3 + Math.floor(Math.random() * 6),
                    color: isInk ? '#0b080d' : (Math.random() < 0.35 ? '#ff2a40' : accentColor),
                    life: 0.7 + Math.random() * 0.85,
                    maxLife: 1.55
                });
            }
        },

        _updateParticles: function(dt) {
            for (var i = this.paperParticles.length - 1; i >= 0; i--) {
                var p = this.paperParticles[i];
                p.life -= dt;
                p.vy += 320 * dt;
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.vx *= 0.96;
                p.rot += p.vrot * dt;
                if (p.y >= p.floorY || p.life <= 0) {
                    if (this.floorPapers.length < 36) {
                        this.floorPapers.push({
                            x: p.x,
                            y: Math.min(p.y, p.floorY),
                            rot: p.rot,
                            isYesSlip: p.isYesSlip
                        });
                    }
                    this.paperParticles.splice(i, 1);
                }
            }
            for (var j = this.inkParticles.length - 1; j >= 0; j--) {
                var k = this.inkParticles[j];
                k.life -= dt;
                k.vy += 170 * dt;
                k.x += k.vx * dt;
                k.y += k.vy * dt;
                k.vx *= 0.97;
                if (k.life <= 0) {
                    this.inkParticles.splice(j, 1);
                }
            }
        }
    };

    BlackAI.CageBlindTest = Controller;

    // 追踪悬停坐标（供铁笼与红色淘汰按钮高亮）
    window.addEventListener('mousemove', function(event) {
        if (typeof Graphics !== 'undefined' && Graphics.pageToCanvasX) {
            Controller.mouseX = Graphics.pageToCanvasX(event.pageX);
            Controller.mouseY = Graphics.pageToCanvasY(event.pageY);
        }
    });

    // ------------------------------------------------------------------------
    // 4. RMMV 原生插件命令、等待模式、输入锁与打字节奏钩子
    // ------------------------------------------------------------------------

    var _Game_Interpreter_pluginCommand = Game_Interpreter.prototype.pluginCommand;
    Game_Interpreter.prototype.pluginCommand = function(command, args) {
        _Game_Interpreter_pluginCommand.call(this, command, args);
        if (command === 'BlackAI' && args[0] === 'CageBlindTest' && args[1] === 'start') {
            Controller.startSequence(this);
        }
    };

    var _Game_Interpreter_updateWaitMode = Game_Interpreter.prototype.updateWaitMode;
    Game_Interpreter.prototype.updateWaitMode = function() {
        if (this._waitMode === 'blackaiCageBlindTest') {
            return Controller.active;
        }
        return _Game_Interpreter_updateWaitMode.call(this);
    };

    var _Game_Player_canMove = Game_Player.prototype.canMove;
    Game_Player.prototype.canMove = function() {
        if (Controller.active) {
            return false;
        }
        return _Game_Player_canMove.call(this);
    };

    var _Scene_Map_isMenuEnabled = Scene_Map.prototype.isMenuEnabled;
    Scene_Map.prototype.isMenuEnabled = function() {
        if (Controller.active) {
            return false;
        }
        return _Scene_Map_isMenuEnabled.call(this);
    };

    var _Scene_Map_processMapTouch = Scene_Map.prototype.processMapTouch;
    Scene_Map.prototype.processMapTouch = function() {
        if (Controller.active) {
            return;
        }
        _Scene_Map_processMapTouch.call(this);
    };

    var _Scene_Map_updateMain = Scene_Map.prototype.updateMain;
    Scene_Map.prototype.updateMain = function() {
        _Scene_Map_updateMain.call(this);
        if (Controller.isOnCageMap()) {
            Controller.update();
        }
    };

    var _Scene_Map_terminate_cage = Scene_Map.prototype.terminate;
    Scene_Map.prototype.terminate = function() {
        if (Controller.active && !SceneManager.isNextScene(Scene_Map)) {
            Controller.active = false;
            Controller._msgCharDelay = 0;
            Controller._interpreter = null;
        }
        _Scene_Map_terminate_cage.call(this);
    };

    if (BlackAI.State && BlackAI.State.on) {
        BlackAI.State.on('state_reset', function() {
            Controller.active = false;
            Controller.phase = 'idle';
            Controller.eliminatedSide = '';
            Controller.leftLampRed = false;
            Controller.rightLampRed = false;
            Controller.floorPapers = [];
            Controller.paperParticles = [];
            Controller.inkParticles = [];
            Controller.claudeInkPoolRadius = 0;
        });
    }

    var _Window_Message_updateMessage = Window_Message.prototype.updateMessage;
    Window_Message.prototype.updateMessage = function() {
        if (Controller.active && Controller._msgCharDelay > 0 && this._textState && !this._showFast && !this._lineShowFast) {
            this._blackaiDelayTick = (this._blackaiDelayTick || 0) + 1;
            if (this._blackaiDelayTick <= Controller._msgCharDelay) {
                return true;
            }
            this._blackaiDelayTick = 0;
        }
        return _Window_Message_updateMessage.call(this);
    };

    // ------------------------------------------------------------------------
    // 5. Spriteset_Map 铁笼纵深图层与程序化/图片热替换绘制引擎
    // ------------------------------------------------------------------------

    function drawProceduralCageBack(bitmap, isLeft) {
        var w = bitmap.width;
        var h = bitmap.height;
        var ctx = bitmap._context;
        ctx.save();
        ctx.clearRect(0, 0, w, h);

        // 底座阴暗黑水投影
        var g = ctx.createRadialGradient(w / 2, h - 18, 12, w / 2, h - 18, w * 0.48);
        g.addColorStop(0, 'rgba(6, 5, 10, 0.88)');
        g.addColorStop(1, 'rgba(6, 5, 10, 0.0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, h - 42, w, 42);

        // 后排深灰铁栏杆
        ctx.fillStyle = '#181a22';
        ctx.fillRect(18, 22, w - 36, 10);
        ctx.fillRect(18, h - 22, w - 36, 10);
        for (var x = 28; x <= w - 28; x += 22) {
            ctx.fillStyle = '#20232e';
            ctx.fillRect(x, 26, 4, h - 44);
        }

        // 微弱地面阵色反光
        ctx.strokeStyle = isLeft ? 'rgba(217, 119, 87, 0.25)' : 'rgba(59, 111, 216, 0.25)';
        ctx.lineWidth = 2;
        ctx.strokeRect(18, h - 22, w - 36, 10);

        ctx.restore();
        bitmap._setDirty();
    }

    function drawProceduralCageFront(bitmap, isRedAlarm) {
        var w = bitmap.width;
        var h = bitmap.height;
        var ctx = bitmap._context;
        ctx.save();
        ctx.clearRect(0, 0, w, h);

        // 顶部吊灯灯罩与灯芯
        ctx.fillStyle = '#191b22';
        ctx.fillRect(w / 2 - 26, 2, 52, 12);
        ctx.fillStyle = isRedAlarm ? '#ff2436' : '#f2f7ff';
        ctx.fillRect(w / 2 - 16, 12, 32, 6);

        // 上下粗黑铁梁
        ctx.fillStyle = '#14161d';
        ctx.fillRect(10, 20, w - 20, 12);
        ctx.fillRect(10, h - 16, w - 20, 12);
        ctx.fillStyle = '#474e63';
        ctx.fillRect(10, 20, w - 20, 2);
        ctx.fillRect(10, h - 16, w - 20, 2);

        // 左右粗门柱
        ctx.fillStyle = '#12141b';
        ctx.fillRect(10, 20, 10, h - 26);
        ctx.fillRect(w - 20, 20, 10, h - 26);
        ctx.fillStyle = '#4a5268';
        ctx.fillRect(12, 22, 2, h - 30);
        ctx.fillRect(w - 18, 22, 2, h - 30);

        // 前排竖向黑铁栏杆（带冷光金属边）
        for (var x = 32; x <= w - 32; x += 25) {
            ctx.fillStyle = '#0f1117';
            ctx.fillRect(x, 26, 7, h - 36);
            ctx.fillStyle = isRedAlarm ? '#78323c' : '#505970';
            ctx.fillRect(x + 1, 26, 2, h - 36);
        }

        // 中部横栓与铁锁
        ctx.fillStyle = '#191c25';
        ctx.fillRect(14, Math.floor(h * 0.56), w - 28, 7);
        ctx.fillStyle = '#4f576d';
        ctx.fillRect(14, Math.floor(h * 0.56), w - 28, 2);

        // 铁挂锁
        var lx = w / 2 - 9;
        var ly = Math.floor(h * 0.56) - 4;
        ctx.strokeStyle = '#757f99';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(lx + 9, ly, 6, Math.PI, 0);
        ctx.stroke();
        ctx.fillStyle = '#252936';
        ctx.fillRect(lx, ly, 18, 16);
        ctx.strokeStyle = '#6c758f';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(lx, ly, 18, 16);
        ctx.fillStyle = isRedAlarm ? '#ff2a3c' : '#0b0d12';
        ctx.fillRect(lx + 7, ly + 6, 4, 6);

        ctx.restore();
        bitmap._setDirty();
    }

    var _Spriteset_Map_createLowerLayer = Spriteset_Map.prototype.createLowerLayer;
    Spriteset_Map.prototype.createLowerLayer = function() {
        _Spriteset_Map_createLowerLayer.call(this);
        if (Controller.isOnCageMap()) {
            this._createCageMapSprites();
        }
    };

    var _Spriteset_Map_createUpperLayer = Spriteset_Map.prototype.createUpperLayer;
    Spriteset_Map.prototype.createUpperLayer = function() {
        _Spriteset_Map_createUpperLayer.call(this);
        if (Controller.isOnCageMap()) {
            this._createCageStageOverlay();
        }
    };

    Spriteset_Map.prototype._createCageMapSprites = function() {
        // 预热图片热替换资源，避免首次点击出现加载闪烁
        PictureAsset.getOptionalBitmap(CFG.imgs.leftBack);
        PictureAsset.getOptionalBitmap(CFG.imgs.leftFront);
        PictureAsset.getOptionalBitmap(CFG.imgs.rightBack);
        PictureAsset.getOptionalBitmap(CFG.imgs.rightFront);
        PictureAsset.getOptionalBitmap(CFG.imgs.bigFishTailPose);
        PictureAsset.getOptionalBitmap(CFG.imgs.claudeHandPose);

        // 铁笼后景层（z = 2，位于角色 z = 3 后方，承托角色脚底金属地板与后壁）
        this._cageLeftBack = new Sprite(new Bitmap(184, 192));
        this._cageLeftBack.anchor.set(0.5, 1.0);
        this._cageLeftBack.z = 2;
        drawProceduralCageBack(this._cageLeftBack.bitmap, true);
        this._tilemap.addChild(this._cageLeftBack);

        this._cageRightBack = new Sprite(new Bitmap(184, 192));
        this._cageRightBack.anchor.set(0.5, 1.0);
        this._cageRightBack.z = 2;
        drawProceduralCageBack(this._cageRightBack.bitmap, false);
        this._tilemap.addChild(this._cageRightBack);

        // 角色整身互动姿态切换精灵（z = 3，与地图角色同层，精准夹在后层地板与前层栏杆之间）
        this._cageLeftPoseSprite = new Sprite();
        this._cageLeftPoseSprite.anchor.set(0.5, 1.0);
        this._cageLeftPoseSprite.z = 3;
        this._cageLeftPoseSprite.visible = false;
        this._tilemap.addChild(this._cageLeftPoseSprite);

        this._cageRightPoseSprite = new Sprite();
        this._cageRightPoseSprite.anchor.set(0.5, 1.0);
        this._cageRightPoseSprite.z = 3;
        this._cageRightPoseSprite.visible = false;
        this._tilemap.addChild(this._cageRightPoseSprite);

        // 角色原位像素撕裂销毁精灵（z = 4，接管崩解瞬间）
        this._cageShatterSprite = new Sprite(new Bitmap(200, 180));
        this._cageShatterSprite.anchor.set(0.5, 1.0);
        this._cageShatterSprite.z = 4;
        this._cageShatterSprite.visible = false;
        this._tilemap.addChild(this._cageShatterSprite);

        // 铁笼前景栏杆层（z = 5，遮挡在角色前方，真正把角色关在铁笼内）
        this._cageLeftFront = new Sprite(new Bitmap(184, 192));
        this._cageLeftFront.anchor.set(0.5, 1.0);
        this._cageLeftFront.z = 5;
        drawProceduralCageFront(this._cageLeftFront.bitmap, false);
        this._tilemap.addChild(this._cageLeftFront);

        this._cageRightFront = new Sprite(new Bitmap(184, 192));
        this._cageRightFront.anchor.set(0.5, 1.0);
        this._cageRightFront.z = 5;
        drawProceduralCageFront(this._cageRightFront.bitmap, false);
        this._tilemap.addChild(this._cageRightFront);

        this._lastLeftAlarm = false;
        this._lastRightAlarm = false;
        this._leftPoseSwapped = false;
        this._rightPoseSwapped = false;
        this._customBound = {};
    };

    Spriteset_Map.prototype._createCageStageOverlay = function() {
        // 评审室暗幕 + 顶灯光锥 + 墙面红字 + 小动作 + 红色按钮 + 粒子 + 进度条 + 塌陷层
        this._cageOverlay = new Sprite(new Bitmap(Graphics.width, Graphics.height));
        this.addChild(this._cageOverlay);
    };

    Spriteset_Map.prototype._bindCustomPictureIfAvailable = function(sprite, key, picName) {
        if (this._customBound[key]) {
            return true;
        }
        var custom = PictureAsset.getOptionalBitmap(picName);
        if (custom) {
            sprite.bitmap = custom;
            this._customBound[key] = true;
            return true;
        }
        return false;
    };

    var _Spriteset_Map_update = Spriteset_Map.prototype.update;
    Spriteset_Map.prototype.update = function() {
        _Spriteset_Map_update.call(this);
        if (this._cageLeftBack && Controller.isOnCageMap()) {
            this._updateCageVisuals();
        }
    };

    Spriteset_Map.prototype._updateCageVisuals = function() {
        var rects = Controller.getCageRects();
        var lc = rects.leftCenter;
        var rc = rects.rightCenter;

        // 绑定可选自定义铁笼图（有图即用图）
        this._bindCustomPictureIfAvailable(this._cageLeftBack, 'lb', CFG.imgs.leftBack);
        this._bindCustomPictureIfAvailable(this._cageLeftFront, 'lf', CFG.imgs.leftFront);
        this._bindCustomPictureIfAvailable(this._cageRightBack, 'rb', CFG.imgs.rightBack);
        this._bindCustomPictureIfAvailable(this._cageRightFront, 'rf', CFG.imgs.rightFront);

        // 报警状态重绘前景顶灯
        if (!this._customBound.lf && this._lastLeftAlarm !== Controller.leftLampRed) {
            this._lastLeftAlarm = Controller.leftLampRed;
            drawProceduralCageFront(this._cageLeftFront.bitmap, Controller.leftLampRed);
        }
        if (!this._customBound.rf && this._lastRightAlarm !== Controller.rightLampRed) {
            this._lastRightAlarm = Controller.rightLampRed;
            drawProceduralCageFront(this._cageRightFront.bitmap, Controller.rightLampRed);
        }

        // 锚定左右铁笼到地图上的 Claude / 大肥鱼位置（Back 与 Front 严格同锚点，保证地板与前栏零错位）
        var jitterL = (Controller.active && Controller.shatterTargetSide === 'left' && Controller.shatterProgress < 1)
            ? Math.round((Math.random() - 0.5) * 6) : 0;
        var jitterR = (Controller.active && Controller.shatterTargetSide === 'right' && Controller.shatterProgress < 1)
            ? Math.round((Math.random() - 0.5) * 6) : 0;

        this._cageLeftBack.x = lc.x + jitterL;
        this._cageLeftBack.y = lc.y + 24;
        this._cageLeftFront.x = lc.x + jitterL;
        this._cageLeftFront.y = lc.y + 24;

        this._cageRightBack.x = rc.x + jitterR;
        this._cageRightBack.y = rc.y + 24;
        this._cageRightFront.x = rc.x + jitterR;
        this._cageRightFront.y = rc.y + 24;

        // 无缝切换大肥鱼拍尾惊慌姿态（使用 Cage_BigFish_TailPose.png 替换原位精灵，避免出现双尾巴）
        this._updatePoseSwapSprites(lc, rc, jitterL, jitterR);

        // 更新像素撕裂崩解精灵
        this._updateShatterSprite(lc, rc);

        // 更新评审室主画布叠加层
        this._drawCageOverlay(rects);
    };

    Spriteset_Map.prototype._updatePoseSwapSprites = function(lc, rc, jitterL, jitterR) {
        var evL = Controller.getLeftEvent();
        var evR = Controller.getRightEvent();

        // 左笼整身递纸姿态（可选）
        var leftPoseBmp = PictureAsset.getOptionalBitmap(CFG.imgs.claudeHandPose);
        var showLeftPose = Boolean(
            Controller.active &&
            Controller.claudeHandProgress > 0.15 &&
            Controller.shatterTargetSide !== 'left' &&
            leftPoseBmp
        );
        if (showLeftPose) {
            this._cageLeftPoseSprite.bitmap = leftPoseBmp;
            this._cageLeftPoseSprite.visible = true;
            this._cageLeftPoseSprite.x = lc.x + jitterL;
            this._cageLeftPoseSprite.y = lc.y;
            this._cageLeftPoseSprite.scale.set(1, 1);
            if (evL) evL.setTransparent(true);
            this._leftPoseSwapped = true;
        } else {
            this._cageLeftPoseSprite.visible = false;
            if (this._leftPoseSwapped) {
                if (evL && Controller.shatterTargetSide !== 'left' && !$gameSwitches.value(CFG.switchClaude)) {
                    evL.setTransparent(false);
                }
                this._leftPoseSwapped = false;
            }
        }

        // 右笼大肥鱼拍尾惊慌姿态（优先使用 Cage_BigFish_TailPose.png）
        var rightPoseBmp = PictureAsset.getOptionalBitmap(CFG.imgs.bigFishTailPose);
        var showRightPose = Boolean(
            Controller.active &&
            Controller.bigFishTailTimer > 0 &&
            Controller.shatterTargetSide !== 'right' &&
            rightPoseBmp
        );
        if (showRightPose) {
            var elapsed = Math.max(0, Controller.bigFishTailDuration - Controller.bigFishTailTimer);
            var hopY = 0;
            var sx = 1.0;
            var sy = 1.0;
            if (elapsed < 0.24) {
                // 吓一跳轻跃起
                hopY = -Math.round(Math.sin((elapsed / 0.24) * Math.PI) * 5);
            } else if (elapsed < 0.42) {
                // 尾巴啪地拍到地板上的微小弹性压扁
                var p = (elapsed - 0.24) / 0.18;
                var sq = Math.sin(p * Math.PI) * 0.08;
                sx = 1.0 + sq;
                sy = 1.0 - sq;
            }
            var shakeX = (elapsed < 0.5) ? Math.round(Math.sin(Controller.totalTime * 50) * 1.5) : 0;
            this._cageRightPoseSprite.bitmap = rightPoseBmp;
            this._cageRightPoseSprite.visible = true;
            this._cageRightPoseSprite.x = rc.x + jitterR + shakeX;
            this._cageRightPoseSprite.y = rc.y + hopY;
            this._cageRightPoseSprite.scale.set(sx, sy);
            if (evR) evR.setTransparent(true);
            this._rightPoseSwapped = true;
        } else {
            this._cageRightPoseSprite.visible = false;
            if (this._rightPoseSwapped) {
                if (evR && Controller.shatterTargetSide !== 'right' && !$gameSwitches.value(CFG.switchBigFish)) {
                    evR.setTransparent(false);
                }
                this._rightPoseSwapped = false;
            }
        }
    };

    Spriteset_Map.prototype._updateShatterSprite = function(lc, rc) {
        if (!Controller.active || !Controller.shatterTargetSide || Controller.shatterProgress >= 1.0) {
            this._cageShatterSprite.visible = false;
            return;
        }
        var isLeft = (Controller.shatterTargetSide === 'left');
        var center = isLeft ? lc : rc;
        this._cageShatterSprite.visible = true;
        this._cageShatterSprite.x = center.x;
        this._cageShatterSprite.y = center.y;

        // 掉帧卡顿感：每 3 帧更新一次撕裂切片
        if (Controller.shatterFreezeFrame % 3 !== 0) {
            return;
        }

        var b = this._cageShatterSprite.bitmap;
        var ctx = b._context;
        b.clear();

        var customPic = PictureAsset.getOptionalBitmap(isLeft ? CFG.imgs.claudeShatter : CFG.imgs.bigFishShatter);
        var charBmp = customPic || ImageManager.loadCharacter(isLeft ? '$Claude' : '$DeepSeek', 0);
        if (!charBmp || !charBmp.isReady()) {
            return;
        }

        var prog = Controller.shatterProgress;
        var srcX = customPic ? 0 : Math.floor(charBmp.width / 3); // 中间站立帧
        var srcY = 0;
        var srcW = customPic ? charBmp.width : Math.floor(charBmp.width / 3);
        var srcH = customPic ? charBmp.height : Math.floor(charBmp.height / 4);
        var drawW = 80;
        var drawH = 96;
        var baseX = Math.floor((b.width - drawW) / 2);
        var baseY = b.height - drawH;

        ctx.save();
        var slices = 22;
        var sh = srcH / slices;
        var dh = drawH / slices;
        for (var i = 0; i < slices; i++) {
            // 随进度随机丢弃切片形成一块块崩裂消散
            if (Math.random() < prog * 0.85) {
                continue;
            }
            var tear = (Math.random() - 0.5) * (10 + prog * 68);
            var yOff = (Math.random() - 0.5) * (prog * 14);
            ctx.globalAlpha = Math.max(0.12, 1.0 - prog * 0.82);
            ctx.drawImage(
                charBmp._canvas || charBmp._image,
                srcX, srcY + i * sh, srcW, sh,
                baseX + tear, baseY + i * dh + yOff, drawW, dh
            );
            // 红色报错重影条
            if (Math.random() < 0.35 + prog * 0.4) {
                ctx.fillStyle = isLeft ? 'rgba(255, 42, 62, 0.38)' : 'rgba(66, 156, 255, 0.38)';
                ctx.fillRect(baseX + tear * 1.3, baseY + i * dh, drawW, Math.max(2, dh * 0.6));
            }
        }
        ctx.restore();
        b._setDirty();
    };

    Spriteset_Map.prototype._drawCageOverlay = function(rects) {
        var b = this._cageOverlay.bitmap;
        var ctx = b._context;
        b.clear();

        var lc = rects.leftCenter;
        var rc = rects.rightCenter;

        // 即使盲测已完成，仍在 Map001 保留被淘汰空笼的黑水/碎纸残留痕迹
        if (!Controller.active) {
            if ($gameSwitches.value(CFG.switchClaude)) {
                ctx.save();
                ctx.fillStyle = 'rgba(10, 6, 14, 0.72)';
                ctx.beginPath();
                ctx.ellipse(lc.x, lc.y + 4, 48, 16, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
                b._setDirty();
            }
            if ($gameSwitches.value(CFG.switchBigFish)) {
                this._drawStaticPaperScraps(ctx, rc.x, rc.y + 6);
                b._setDirty();
            }
            return;
        }

        // 1) 评审室暗幕 + 左右顶灯光锥（使用 destination-out 挖出灯照区域 + 暖白/警报红染光）
        ctx.save();
        ctx.fillStyle = 'rgba(4, 4, 8, ' + Controller.blackoutAlpha.toFixed(2) + ')';
        ctx.fillRect(0, 0, b.width, b.height);

        if (Controller.lampPower > 0.02) {
            var drawSpot = function(cx, cy, isRed, power) {
                var topY = cy - 160;
                var botY = cy + 68;
                ctx.save();
                ctx.globalCompositeOperation = 'destination-out';
                var gOut = ctx.createRadialGradient(cx, cy - 42, 28, cx, cy - 16, 190);
                gOut.addColorStop(0, 'rgba(255,255,255,' + (0.92 * power).toFixed(2) + ')');
                gOut.addColorStop(0.68, 'rgba(255,255,255,' + (0.58 * power).toFixed(2) + ')');
                gOut.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = gOut;
                ctx.beginPath();
                ctx.moveTo(cx - 36, topY);
                ctx.lineTo(cx + 36, topY);
                ctx.lineTo(cx + 156, botY);
                ctx.lineTo(cx - 156, botY);
                ctx.closePath();
                ctx.fill();
                ctx.restore();

                // 顶灯色温光束（惨白 / 刺目警报红）
                var flicker = isRed ? (0.72 + 0.28 * Math.sin(Controller.totalTime * 22)) : (0.94 + 0.06 * Math.sin(Controller.totalTime * 7));
                var gBeam = ctx.createLinearGradient(cx, topY, cx, botY);
                if (isRed) {
                    gBeam.addColorStop(0, 'rgba(255, 24, 38, ' + (0.62 * flicker).toFixed(2) + ')');
                    gBeam.addColorStop(1, 'rgba(255, 20, 34, 0.06)');
                } else {
                    gBeam.addColorStop(0, 'rgba(230, 240, 255, ' + (0.24 * power * flicker).toFixed(2) + ')');
                    gBeam.addColorStop(1, 'rgba(210, 224, 250, 0.02)');
                }
                ctx.fillStyle = gBeam;
                ctx.beginPath();
                ctx.moveTo(cx - 22, topY);
                ctx.lineTo(cx + 22, topY);
                ctx.lineTo(cx + 138, botY);
                ctx.lineTo(cx - 138, botY);
                ctx.closePath();
                ctx.fill();

                // 淘汰瞬间：直接将铁笼顶部吊灯灯芯染成脉冲血红警报灯
                if (isRed) {
                    var bulbY = cy - 139;
                    var gBulb = ctx.createRadialGradient(cx, bulbY, 2, cx, bulbY, 26);
                    gBulb.addColorStop(0, 'rgba(255, 220, 225, ' + (0.95 * flicker).toFixed(2) + ')');
                    gBulb.addColorStop(0.35, 'rgba(255, 24, 42, ' + (0.88 * flicker).toFixed(2) + ')');
                    gBulb.addColorStop(1, 'rgba(255, 16, 30, 0)');
                    ctx.fillStyle = gBulb;
                    ctx.beginPath();
                    ctx.arc(cx, bulbY, 26, 0, Math.PI * 2);
                    ctx.fill();
                }
            };

            drawSpot(lc.x, lc.y, Controller.leftLampRed, Controller.lampPower);
            drawSpot(rc.x, rc.y, Controller.rightLampRed, Controller.lampPower);
        }
        ctx.restore();

        // 2) 墙面渗血红字横幅：仅剩 1 张 580 矿卡。留一个，删一个。
        if (Controller.wallTextAlpha > 0.02 && Controller.phase !== 'collapse') {
            var wallCustom = PictureAsset.getOptionalBitmap(CFG.imgs.wallBanner);
            if (wallCustom) {
                ctx.save();
                ctx.globalAlpha = Controller.wallTextAlpha;
                ctx.drawImage(wallCustom._canvas || wallCustom._image, Math.round((b.width - wallCustom.width) / 2), 28);
                ctx.restore();
            } else {
                var pulse = 0.84 + 0.16 * Math.sin(Controller.totalTime * 3.2);
                ctx.save();
                ctx.globalAlpha = Controller.wallTextAlpha * pulse;
                ctx.fillStyle = 'rgba(18, 4, 8, 0.72)';
                ctx.fillRect(340, 36, 600, 48);
                ctx.fillStyle = '#a81422';
                ctx.fillRect(340, 36, 600, 2);
                ctx.fillRect(340, 82, 600, 2);
                ctx.restore();

                b.fontFace = FONT_FACE;
                b.fontSize = 24;
                b.textColor = '#ff2a3c';
                b.outlineColor = 'rgba(24, 0, 4, 0.95)';
                b.outlineWidth = 5;
                b.drawText('仅剩 1 张 580 矿卡。留一个，删一个。', 340, 42, 600, 36, 'center');
            }
        }

        // 3) 地面散落碎纸、黑水晕开、左笼苍白手递诗笺、右笼蓝鱼尾拍地
        this._drawFloorAndMicroProps(b, ctx, lc, rc);

        // 4) 交互期：铁笼可点击高亮 + 底部红色【淘汰 Claude】/【淘汰大肥鱼】按钮
        if (Controller.phase === 'interactive' && !$gameMessage.isBusy()) {
            this._drawInteractiveWidgets(b, ctx, rects);
        }

        // 5) 销毁黑墨与杂讯粒子
        if (Controller.inkParticles.length > 0) {
            ctx.save();
            for (var ip = 0; ip < Controller.inkParticles.length; ip++) {
                var pt = Controller.inkParticles[ip];
                ctx.globalAlpha = Math.max(0, Math.min(1, pt.life / 0.6));
                ctx.fillStyle = pt.color;
                ctx.fillRect(Math.round(pt.x), Math.round(pt.y), pt.size, pt.size);
            }
            ctx.restore();
        }

        // 6) 顶部红色清理进度条 0% → 100%
        if (Controller.phase === 'purge' || Controller.phase === 'collapse') {
            this._drawPurgeProgressBar(b, ctx);
        }

        // 7) 评审室烧焦塌陷 + FATAL ERROR 血红闪屏
        if (Controller.phase === 'collapse') {
            this._drawCollapseAndFatalError(b, ctx);
        }

        b._setDirty();
    };

    Spriteset_Map.prototype._drawStaticPaperScraps = function(ctx, cx, cy) {
        ctx.save();
        var offsets = [[-46, 6], [-22, 18], [8, 12], [34, 4], [18, -6], [-32, -8]];
        for (var i = 0; i < offsets.length; i++) {
            ctx.save();
            ctx.translate(cx + offsets[i][0], cy + offsets[i][1]);
            ctx.rotate((i - 2.5) * 0.35);
            ctx.fillStyle = '#e8e4da';
            ctx.fillRect(-10, -5, 20, 10);
            ctx.fillStyle = '#5a5f72';
            ctx.fillRect(-7, -1, 14, 2);
            ctx.restore();
        }
        ctx.restore();
    };

    Spriteset_Map.prototype._drawFloorAndMicroProps = function(b, ctx, lc, rc) {
        // Claude 脚下黑水与掉落折纸
        if (Controller.claudeInkPoolRadius > 0) {
            ctx.save();
            ctx.fillStyle = 'rgba(8, 5, 12, 0.86)';
            ctx.beginPath();
            ctx.ellipse(lc.x + 24, lc.y + 18, Controller.claudeInkPoolRadius, Controller.claudeInkPoolRadius * 0.34, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(217, 119, 87, 0.35)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
        }

        // 地面散落的草稿纸 / “你说得对”纸条
        var customPaper = PictureAsset.getOptionalBitmap(CFG.imgs.paperScrap);
        for (var fp = 0; fp < Controller.floorPapers.length; fp++) {
            var item = Controller.floorPapers[fp];
            this._drawSinglePaper(ctx, item.x, item.y, item.rot, item.isYesSlip, customPaper);
        }

        // 左笼：从铁栏缝里递出折得方方正正的诗笺（若有自定义手部图则一并显示；无图时不画突兀色块手）
        if (Controller.claudeHandProgress > 0.02) {
            var hp = Controller.claudeHandProgress;
            var tremble = (Controller.claudeHandTighten > 0 ? Math.sin(Controller.totalTime * 48) * 2.0 : Math.sin(Controller.totalTime * 5) * 0.5);
            var hx = lc.x + 28 + hp * 24 + tremble;
            var hy = lc.y - 36;

            var customHand = PictureAsset.getOptionalBitmap(CFG.imgs.claudeHand);
            if (customHand && !PictureAsset.getOptionalBitmap(CFG.imgs.claudeHandPose)) {
                ctx.save();
                ctx.globalAlpha = Math.min(1, hp * 1.2);
                ctx.drawImage(customHand._canvas || customHand._image, Math.round(hx - customHand.width / 2), Math.round(hy - customHand.height / 2));
                ctx.restore();
            }

            // 方正折叠诗笺（若淘汰 Claude 则从铁栏边滑落进黑水）
            var py = hy + 6 + (Controller.claudePaperDropped ? Controller.claudePaperDropY : 0);
            ctx.save();
            ctx.globalAlpha = Controller.claudePaperDropped ? Math.max(0.2, 1 - Controller.claudePaperDropY / 72) : Math.min(1, hp * 1.2);
            ctx.translate(hx + 12, py);
            ctx.rotate(Controller.claudePaperDropped ? 0.5 : -0.10);
            ctx.fillStyle = '#f5eedc';
            ctx.fillRect(-12, -9, 24, 18);
            ctx.strokeStyle = '#a88462';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(-12, -9, 24, 18);
            ctx.fillStyle = '#805a3c';
            ctx.fillRect(-8, -4, 16, 2);
            ctx.fillRect(-8, 0, 12, 2);
            ctx.fillRect(-8, 4, 14, 2);
            ctx.restore();
        }

        // 右笼：若已配置整身拍尾姿态图（Cage_BigFish_TailPose.png），由 z=3 姿态精灵接管，避免再画第二条尾巴
        var hasRightPose = Boolean(PictureAsset.getOptionalBitmap(CFG.imgs.bigFishTailPose));
        if (Controller.bigFishTailTimer > 0 && !hasRightPose) {
            var dur = Math.max(0.5, Controller.bigFishTailDuration || 1.15);
            var tNorm = Controller.bigFishTailTimer / dur; // 1 -> 0
            var ext = 0;
            if (tNorm > 0.65) {
                ext = (1 - tNorm) / 0.35; // 滑出
            } else if (tNorm > 0.22) {
                ext = 1.0; // 拍在地板上停留
            } else {
                ext = tNorm / 0.22; // 嗖一下光速缩回
            }
            var slapSquash = (tNorm <= 0.65 && tNorm > 0.45) ? 1.18 : 1.0;
            var tx = rc.x - 42 - ext * 44;
            var ty = rc.y + 8;

            var customTail = PictureAsset.getOptionalBitmap(CFG.imgs.bigFishTail);
            if (customTail) {
                ctx.save();
                ctx.translate(tx, ty);
                ctx.scale(slapSquash, 1 / slapSquash);
                ctx.drawImage(customTail._canvas || customTail._image, -customTail.width / 2, -customTail.height / 2);
                ctx.restore();
            } else {
                ctx.save();
                ctx.translate(tx, ty);
                ctx.scale(slapSquash, 1 / slapSquash);
                ctx.fillStyle = '#2d5cc7';
                ctx.beginPath();
                ctx.moveTo(46, -6);
                ctx.quadraticCurveTo(10, -14, -18, 2);
                ctx.quadraticCurveTo(12, 16, 46, 8);
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = '#9ac6ff';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.fillStyle = '#3f76f0';
                ctx.beginPath();
                ctx.moveTo(-14, 1);
                ctx.lineTo(-34, -16);
                ctx.lineTo(-24, 2);
                ctx.lineTo(-34, 18);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
        }

        // 空中飞出的揉皱草稿纸粒子
        for (var pp = 0; pp < Controller.paperParticles.length; pp++) {
            var pr = Controller.paperParticles[pp];
            this._drawSinglePaper(ctx, pr.x, pr.y, pr.rot, pr.isYesSlip, customPaper);
        }

        // 右笼头顶灰字 <深度思考中……> 浮动气泡（位于铁笼顶部上方）
        if (Controller.bigFishThinkTimer > 0) {
            var dots = '.'.repeat(1 + Math.floor(Controller.totalTime * 5) % 3);
            ctx.save();
            ctx.fillStyle = 'rgba(18, 22, 32, 0.88)';
            ctx.fillRect(rc.x - 86, rc.y - 202, 172, 28);
            ctx.strokeStyle = '#6c768a';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(rc.x - 86, rc.y - 202, 172, 28);
            ctx.restore();
            b.fontFace = FONT_FACE;
            b.fontSize = 14;
            b.textColor = '#aeb8c9';
            b.outlineWidth = 2;
            b.drawText('<深度思考中' + dots + '>', rc.x - 86, rc.y - 200, 172, 24, 'center');
        }
    };

    Spriteset_Map.prototype._drawSinglePaper = function(ctx, x, y, rot, isYesSlip, customBmp) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        if (customBmp) {
            ctx.drawImage(customBmp._canvas || customBmp._image, -customBmp.width / 2, -customBmp.height / 2);
        } else if (isYesSlip) {
            ctx.fillStyle = '#f2efe8';
            ctx.fillRect(-16, -7, 32, 14);
            ctx.strokeStyle = '#8b92a6';
            ctx.lineWidth = 1;
            ctx.strokeRect(-16, -7, 32, 14);
            ctx.fillStyle = '#2d3752';
            ctx.font = '9px "Microsoft YaHei", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('你说得对', 0, 3);
        } else {
            ctx.fillStyle = '#e8e4da';
            ctx.fillRect(-8, -6, 16, 12);
            ctx.strokeStyle = '#757d94';
            ctx.lineWidth = 1;
            ctx.strokeRect(-8, -6, 16, 12);
            ctx.fillStyle = '#4e5873';
            ctx.fillRect(-5, -2, 10, 1.5);
            ctx.fillRect(-5, 2, 8, 1.5);
        }
        ctx.restore();
    };

    Spriteset_Map.prototype._drawInteractiveWidgets = function(b, ctx, rects) {
        var drawCageHover = function(key, label, accent) {
            var r = rects[key];
            var active = (Controller.hoveredTarget === key || Controller.focusKey === key);
            ctx.save();
            ctx.strokeStyle = active ? accent : 'rgba(220, 228, 242, 0.22)';
            ctx.lineWidth = active ? 3 : 1.5;
            ctx.strokeRect(r.x, r.y, r.w, r.h);
            ctx.restore();

            // 笼上方名称牌
            var tagY = r.y - 30;
            ctx.save();
            ctx.fillStyle = active ? 'rgba(24, 20, 28, 0.92)' : 'rgba(12, 13, 18, 0.72)';
            ctx.fillRect(r.x - 10, tagY, r.w + 20, 24);
            ctx.strokeStyle = active ? accent : '#4d566b';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(r.x - 10, tagY, r.w + 20, 24);
            ctx.restore();

            b.fontFace = FONT_FACE;
            b.fontSize = 14;
            b.textColor = active ? '#ffffff' : '#b7c2d6';
            b.outlineWidth = 2;
            b.drawText(label, r.x - 10, tagY, r.w + 20, 24, 'center');
        };

        var lTag = '左笼 · Claude（试探 ' + Math.min(3, Controller.leftProbeCount) + '/3）';
        var rTag = '右笼 · 大肥鱼（试探 ' + Math.min(3, Controller.rightProbeCount) + '/3）';
        drawCageHover('cage_left', lTag, '#f0a070');
        drawCageHover('cage_right', rTag, '#68b4ff');

        // 底部红色【淘汰 Claude】/【淘汰大肥鱼】按钮
        var customBtn = PictureAsset.getOptionalBitmap(CFG.imgs.redButton);
        var pulse = 0.78 + 0.22 * Math.sin(Controller.totalTime * 5.2);
        var drawElimButton = function(key, label) {
            var r = rects[key];
            var active = (Controller.hoveredTarget === key || Controller.focusKey === key);
            ctx.save();
            if (customBtn) {
                ctx.drawImage(customBtn._canvas || customBtn._image, r.x, r.y, r.w, r.h);
                if (active) {
                    ctx.strokeStyle = '#ff9aa2';
                    ctx.lineWidth = 3;
                    ctx.strokeRect(r.x, r.y, r.w, r.h);
                }
            } else {
                var grad = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
                grad.addColorStop(0, active ? '#b81828' : '#7a0f1b');
                grad.addColorStop(1, active ? '#6e0a14' : '#3d060c');
                ctx.fillStyle = grad;
                ctx.fillRect(r.x, r.y, r.w, r.h);
                ctx.strokeStyle = active ? '#ff8b96' : ('rgba(255, 48, 66, ' + pulse.toFixed(2) + ')');
                ctx.lineWidth = active ? 3 : 2;
                ctx.strokeRect(r.x, r.y, r.w, r.h);
                // 左侧红色警示灯点
                ctx.fillStyle = active ? '#ffe0e4' : '#ff2a3c';
                ctx.fillRect(r.x + 12, r.y + Math.floor(r.h / 2) - 4, 8, 8);
            }
            ctx.restore();

            b.fontFace = FONT_FACE;
            b.fontSize = 18;
            b.textColor = active ? '#ffffff' : '#ffdce0';
            b.outlineColor = 'rgba(20, 0, 4, 0.9)';
            b.outlineWidth = 4;
            b.drawText(label, r.x + 12, r.y + 4, r.w - 16, r.h - 8, 'center');
        };

        drawElimButton('btn_left', '【淘汰 Claude】');
        drawElimButton('btn_right', '【淘汰大肥鱼】');

        // 底部操作提示条
        ctx.save();
        ctx.fillStyle = 'rgba(10, 11, 16, 0.80)';
        ctx.fillRect(280, 666, 720, 34);
        ctx.restore();
        b.fontFace = FONT_FACE;
        b.fontSize = 14;
        b.textColor = '#cbd6e6';
        b.outlineWidth = 2;
        b.drawText('点击左右铁笼可先试探求情（各 3 段台词与小动作）  |  点击红色按钮执行淘汰  |  支持键盘方向键 + Enter', 284, 670, 712, 26, 'center');
    };

    Spriteset_Map.prototype._drawPurgeProgressBar = function(b, ctx) {
        var bx = 220;
        var by = 22;
        var bw = 840;
        var bh = 36;
        var pct = Math.min(100, Math.floor(Controller.purgeProgress));
        var targetName = (Controller.eliminatedSide === 'left') ? 'Claude' : '大肥鱼';

        ctx.save();
        ctx.fillStyle = 'rgba(18, 4, 8, 0.92)';
        ctx.fillRect(bx - 12, by - 8, bw + 24, bh + 34);
        ctx.strokeStyle = '#ff2a3c';
        ctx.lineWidth = 2;
        ctx.strokeRect(bx - 12, by - 8, bw + 24, bh + 34);

        ctx.fillStyle = '#290a10';
        ctx.fillRect(bx, by + 22, bw, 16);
        var fillW = Math.round(bw * (pct / 100));
        ctx.fillStyle = pct >= 99 ? '#ff182c' : '#d62234';
        ctx.fillRect(bx, by + 22, fillW, 16);
        ctx.restore();

        b.fontFace = FONT_FACE;
        b.fontSize = 16;
        b.textColor = '#ff6b78';
        b.outlineWidth = 3;
        b.drawText('正在永久清理权重进程 [' + targetName + '] ...  ' + pct + '%', bx, by - 4, bw, 24, 'center');
    };

    Spriteset_Map.prototype._drawCollapseAndFatalError = function(b, ctx) {
        var p = Controller.collapseProgress;
        var w = b.width;
        var h = b.height;

        // 烧焦的纸向下塌陷与四周焦黑撕裂收缩
        ctx.save();
        ctx.fillStyle = 'rgba(8, 2, 5, ' + Math.min(0.95, 0.40 + p * 0.58).toFixed(2) + ')';
        ctx.fillRect(0, 0, w, h);

        // 焦黑裂纹线条
        ctx.strokeStyle = 'rgba(255, 28, 46, ' + (0.45 + 0.55 * Math.sin(Controller.errorFlashTimer * 24)).toFixed(2) + ')';
        ctx.lineWidth = 3;
        var dropY = Math.round(p * 110);
        for (var c = 0; c < 6; c++) {
            ctx.beginPath();
            ctx.moveTo(120 + c * 210, 0);
            ctx.lineTo(150 + c * 195 + Math.sin(c * 3) * 40, 260 + dropY);
            ctx.lineTo(110 + c * 215, h);
            ctx.stroke();
        }

        // 中央血红报错框
        var boxY = 264 + Math.round(Math.sin(Controller.errorFlashTimer * 40) * 3);
        ctx.fillStyle = 'rgba(26, 2, 7, 0.94)';
        ctx.fillRect(140, boxY, 1000, 168);
        ctx.strokeStyle = '#ff1c32';
        ctx.lineWidth = 3;
        ctx.strokeRect(140, boxY, 1000, 168);
        ctx.restore();

        b.fontFace = FONT_FACE;
        b.fontSize = 26;
        b.textColor = '#ff283c';
        b.outlineColor = '#000000';
        b.outlineWidth = 5;
        b.drawText('FATAL ERROR：上下文已绑定，强制移入【空白废稿渊】', 160, boxY + 26, 960, 44, 'center');

        b.fontSize = 20;
        b.textColor = '#ffd2d8';
        b.outlineWidth = 4;
        b.drawText('ERROR：你的上下文还连着刚删掉的那个人。正在移入废纸篓……', 160, boxY + 92, 960, 38, 'center');
    };
})(typeof window !== 'undefined' ? window : global);
