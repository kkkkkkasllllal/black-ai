/*:
 * @plugindesc 《BLACK AI》M2 2D 上帝视角探索系统：八向移动、鼠标提灯实时 2D 阴影、F 切档、上下文溢出暗角血字抖动、HUD、挥砍先手与 Esc 菜单
 * @author BLACK AI Team
 * @help
 * 在 Scene_Map 上挂载实时提灯阴影层、大 PSU 根须电缆、溢出隐藏血字图层、NPC/怪名牌、探索 HUD 与 Esc 调试菜单。
 */

(function(globalScope) {
    'use strict';

    var BlackAI = globalScope.BlackAI || {};
    globalScope.BlackAI = BlackAI;

    var BLOOD_SPOTS = [
        { x: 13, y: 9, kind: '404' },
        { x: 19, y: 9, kind: '580' },
        { x: 16, y: 6, kind: 'EYE' },
        { x: 14, y: 12, kind: 'CLAW' },
        { x: 18, y: 12, kind: 'NULL' },
        { x: 3, y: 3, kind: 'NULL' },
        { x: 5, y: 3, kind: 'EYE' },
        { x: 2, y: 5, kind: 'CLAW' },
        { x: 26, y: 2, kind: '404' },
        { x: 28, y: 3, kind: 'CROSS' },
        { x: 6, y: 16, kind: '580' },
        { x: 7, y: 16, kind: 'CLAW' },
        { x: 24, y: 16, kind: 'EYE' },
        { x: 25, y: 16, kind: 'CROSS' },
        { x: 16, y: 3, kind: 'CROSS' }
    ];

    BlackAI.Explore = {
        lanternDim: false,
        mouseX: 640,
        mouseY: 260,
        aimAngle: -Math.PI * 0.5,
        noticeText: '',
        noticeTimer: 0,
        promptText: '',
        slashCooldown: 0,
        slashFxTimer: 0,
        slashFxAngle: 0,

        showNotice: function(msg, duration) {
            this.noticeText = String(msg || '');
            this.noticeTimer = (duration === undefined) ? 3.2 : Number(duration);
        }
    };

    // 实时追踪画布坐标下的鼠标位置（用于驱动扇形提灯转向与先手挥砍方向）
    window.addEventListener('mousemove', function(event) {
        if (typeof Graphics !== 'undefined' && Graphics.pageToCanvasX) {
            BlackAI.Explore.mouseX = Graphics.pageToCanvasX(event.pageX);
            BlackAI.Explore.mouseY = Graphics.pageToCanvasY(event.pageY);
        }
    });

    // ------------------------------------------------------------------------
    // 1. 8 向平滑移动与贴墙滑行 + 禁用点击寻路（左键让位给先手挥砍）
    // ------------------------------------------------------------------------

    Game_Player.prototype.moveByInput = function() {
        if (!this.isMoving() && this.canMove()) {
            var dir8 = Input.dir8;
            if (dir8 > 0) {
                $gameTemp.clearDestination();
                if (dir8 === 1 || dir8 === 3 || dir8 === 7 || dir8 === 9) {
                    var horz = (dir8 === 1 || dir8 === 7) ? 4 : 6;
                    var vert = (dir8 === 1 || dir8 === 3) ? 2 : 8;
                    this.moveDiagonally(horz, vert);
                    if (!this.isMovementSucceeded()) {
                        this.moveStraight(horz);
                        if (!this.isMovementSucceeded()) {
                            this.moveStraight(vert);
                        }
                    }
                } else {
                    this.moveStraight(dir8);
                }
            }
        }
    };

    var _Scene_Map_processMapTouch = Scene_Map.prototype.processMapTouch;
    Scene_Map.prototype.processMapTouch = function() {
        // 禁用 MV 默认点击地图寻路，改为鼠标左键先手挥砍
        if (TouchInput.isTriggered() && !$gameMap.isEventRunning()) {
            this._performBlackAISlash();
        }
    };

    // 禁用 MV 默认系统菜单，改用《BLACK AI》探索与调试菜单（Esc）
    Scene_Map.prototype.callMenu = function() {
        SoundManager.playOk();
        SceneManager.push(Scene_BlackAIPause);
        $gameTemp.clearDestination();
        this._mapNameWindow.hide();
        this._waitCount = 2;
    };

    // ------------------------------------------------------------------------
    // 2. Spriteset_Map 视觉层：根须电缆 + 溢出隐藏血字 + 2D 扇形提灯实时阴影 + 名牌 + 暗角
    // ------------------------------------------------------------------------

    function isOpaqueWallTile(tx, ty) {
        if (!$gameMap || tx < 0 || ty < 0 || tx >= $gameMap.width() || ty >= $gameMap.height()) {
            return true;
        }
        var tid = $gameMap.tileId(tx, ty, 0);
        return tid === 1538 || tid === 1539 || tid === 1540;
    }

    var _Spriteset_Map_createLowerLayer = Spriteset_Map.prototype.createLowerLayer;
    Spriteset_Map.prototype.createLowerLayer = function() {
        _Spriteset_Map_createLowerLayer.call(this);
        if ($dataMap.meta.blackai_region === 'psu_altar') {
            this._createBlackAIFloorOverlays();
        }
    };

    var _Spriteset_Map_createUpperLayer = Spriteset_Map.prototype.createUpperLayer;
    Spriteset_Map.prototype.createUpperLayer = function() {
        _Spriteset_Map_createUpperLayer.call(this);
        this._createBlackAIUpperOverlays();
    };

    Spriteset_Map.prototype._createBlackAIFloorOverlays = function() {
        var mapW = $gameMap.width() * 48;
        var mapH = $gameMap.height() * 48;

        // 1) 大 PSU 五条古树供电根须（地板 z=0 之上、角色 z=3 之下）
        this._psuCableSprite = new Sprite(new Bitmap(mapW, mapH));
        this._psuCableSprite.z = 1;
        var cb = this._psuCableSprite.bitmap;
        var cx = 16 * 48 + 24;
        var cy = 9 * 48 + 24;
        var cablePaths = [
            [[cx - 48, cy + 30], [cx - 110, cy + 68], [cx - 190, cy + 124]],
            [[cx + 48, cy + 30], [cx + 112, cy + 72], [cx + 194, cy + 126]],
            [[cx - 66, cy - 4], [cx - 134, cy - 16], [cx - 214, cy - 4]],
            [[cx + 66, cy - 4], [cx + 136, cy - 18], [cx + 216, cy - 4]],
            [[cx, cy - 46], [cx - 8, cy - 112], [cx + 12, cy - 184]]
        ];
        var ctx = cb._context;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (var i = 0; i < cablePaths.length; i++) {
            var pts = cablePaths[i];
            ctx.strokeStyle = '#0c0d12';
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            ctx.lineTo(pts[1][0], pts[1][1]);
            ctx.lineTo(pts[2][0], pts[2][1]);
            ctx.stroke();

            ctx.strokeStyle = '#4c3423';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            ctx.lineTo(pts[1][0], pts[1][1]);
            ctx.lineTo(pts[2][0], pts[2][1]);
            ctx.stroke();
        }
        ctx.restore();
        cb._setDirty();
        this._tilemap.addChild(this._psuCableSprite);

        // 2) 上下文溢出隐藏血字图层
        this._bloodSprite = new Sprite(new Bitmap(mapW, mapH));
        this._bloodAlpha = 0;
        this._bloodPulse = 0;
        var bb = this._bloodSprite.bitmap;
        bb.fontFace = '"Microsoft YaHei", "SimHei", GameFont, sans-serif';
        bb.fontSize = 18;
        bb.textColor = '#d41628';
        var bctx = bb._context;
        bctx.save();
        bctx.strokeStyle = '#d41628';
        bctx.lineWidth = 3;
        for (var s = 0; s < BLOOD_SPOTS.length; s++) {
            var sp = BLOOD_SPOTS[s];
            var bx = sp.x * 48;
            var by = sp.y * 48;
            if (sp.kind === '404' || sp.kind === '580' || sp.kind === 'NULL') {
                bb.drawText(sp.kind, bx, by + 12, 48, 24, 'center');
            } else if (sp.kind === 'CROSS') {
                bctx.beginPath();
                bctx.moveTo(bx + 10, by + 10);
                bctx.lineTo(bx + 38, by + 38);
                bctx.moveTo(bx + 38, by + 10);
                bctx.lineTo(bx + 10, by + 38);
                bctx.stroke();
            } else if (sp.kind === 'EYE') {
                bctx.beginPath();
                bctx.ellipse(bx + 24, by + 24, 16, 9, 0, 0, Math.PI * 2);
                bctx.stroke();
                bb.fillRect(bx + 21, by + 19, 6, 10, '#e61c30');
            } else if (sp.kind === 'CLAW') {
                for (var k = -8; k <= 8; k += 8) {
                    bctx.beginPath();
                    bctx.moveTo(bx + 14 + k, by + 8);
                    bctx.lineTo(bx + 26 + k, by + 40);
                    bctx.stroke();
                }
            }
        }
        bctx.restore();
        bb._setDirty();
        this._bloodSprite.opacity = 0;
        this._bloodSprite.z = 1;
        this._tilemap.addChild(this._bloodSprite);
    };

    Spriteset_Map.prototype._createBlackAIUpperOverlays = function() {
        // 3) 2D 实时提灯阴影叠加层（半分辨率 640x360 放大 2x，丝滑 60FPS）
        this._lightSprite = new Sprite(new Bitmap(640, 360));
        this._lightSprite.scale.x = 2;
        this._lightSprite.scale.y = 2;
        this._lanternDimBlend = Number(BlackAI.Explore.lanternDim);
        this.addChild(this._lightSprite);

        // 4) 世界空间名牌与挥砍弧光层
        this._worldOverlaySprite = new Sprite(new Bitmap(1280, 720));
        this.addChild(this._worldOverlaySprite);

        // 5) 上下文溢出暗角与扫描横纹叠加层
        this._vignetteSprite = new Sprite(new Bitmap(1280, 720));
        this._vignetteAlpha = 0;
        this._drawStaticVignette(this._vignetteSprite.bitmap);
        this._vignetteSprite.opacity = 0;
        this.addChild(this._vignetteSprite);
    };

    Spriteset_Map.prototype._drawStaticVignette = function(bitmap) {
        var ctx = bitmap._context;
        ctx.save();
        var grad = ctx.createRadialGradient(640, 360, 220, 640, 360, 740);
        grad.addColorStop(0.0, 'rgba(90, 4, 12, 0.0)');
        grad.addColorStop(0.65, 'rgba(95, 6, 14, 0.34)');
        grad.addColorStop(1.0, 'rgba(130, 6, 18, 0.85)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = 'rgba(255, 42, 60, 0.08)';
        for (var y = 0; y < 720; y += 6) {
            ctx.fillRect(0, y, 1280, 2);
        }
        ctx.restore();
        bitmap._setDirty();
    };

    var _Spriteset_Map_update = Spriteset_Map.prototype.update;
    Spriteset_Map.prototype.update = function() {
        _Spriteset_Map_update.call(this);
        this._updateBlackAIVisuals();
    };

    Spriteset_Map.prototype._updateBlackAIVisuals = function() {
        if (!this._lightSprite || !$gameMap || !$gamePlayer) {
            return;
        }
        var dt = 1 / 60;
        var ox = -$gameMap.displayX() * 48;
        var oy = -$gameMap.displayY() * 48;

        if (!this._psuCableSprite) {
            this._renderWorldLabelsAndSlash();
            return;
        }
        this._psuCableSprite.x = Math.round(ox);
        this._psuCableSprite.y = Math.round(oy);
        this._bloodSprite.x = Math.round(ox);
        this._bloodSprite.y = Math.round(oy);

        // 血字显现与脉动
        var revealed = BlackAI.State.isContextOverflow() || BlackAI.State.hasEquippedEffect('reveal_hidden');
        this._bloodPulse += dt;
        this._bloodAlpha += ((revealed ? 1 : 0) - this._bloodAlpha) * Math.min(1, dt * 6);
        var pulse = 0.84 + 0.16 * Math.sin(this._bloodPulse * 3.8);
        this._bloodSprite.opacity = Math.round(255 * this._bloodAlpha * pulse);

        // 暗角与镜头微抖
        var targetVig = BlackAI.State.isContextCritical() ? 0.95 : (BlackAI.State.isContextOverflow() ? 0.72 : 0.0);
        this._vignetteAlpha += (targetVig - this._vignetteAlpha) * Math.min(1, dt * 5);
        this._vignetteSprite.opacity = Math.round(255 * this._vignetteAlpha);

        if (BlackAI.State.isContextOverflow()) {
            var jPx = BlackAI.State.isContextCritical() ? 4 : 2;
            this._tilemap.x = Math.round((Math.random() * 2 - 1) * jPx);
            this._tilemap.y = Math.round((Math.random() * 2 - 1) * jPx);
        } else {
            this._tilemap.x = 0;
            this._tilemap.y = 0;
        }

        this._renderLanternLighting();
        this._renderWorldLabelsAndSlash();
    };

    Spriteset_Map.prototype._renderLanternLighting = function() {
        var b = this._lightSprite.bitmap;
        var ctx = b._context;
        var scale = 0.5;
        var px = $gamePlayer.screenX();
        var py = $gamePlayer.screenY() - 20;

        var dx = BlackAI.Explore.mouseX - px;
        var dy = BlackAI.Explore.mouseY - py;
        if (dx * dx + dy * dy > 9) {
            var turn = Math.atan2(dy, dx) - BlackAI.Explore.aimAngle;
            BlackAI.Explore.aimAngle += Math.atan2(Math.sin(turn), Math.cos(turn)) * 0.35;
        }

        var aim = BlackAI.Explore.aimAngle;
        this._lanternDimBlend += (Number(BlackAI.Explore.lanternDim) - this._lanternDimBlend) * 0.18;
        var dim = this._lanternDimBlend;
        var maxRange = 325 - dim * 150;
        var halfCone = 0.66 - dim * 0.14;
        var rays = 36;

        var pwx = ($gamePlayer._realX + 0.5) * 48;
        var pwy = ($gamePlayer._realY + 0.5) * 48;
        var dispX = $gameMap.displayX() * 48;
        var dispY = $gameMap.displayY() * 48;

        ctx.save();
        ctx.clearRect(0, 0, 640, 360);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = BlackAI.State.isContextOverflow() ? 'rgba(26, 5, 9, 0.87)' : 'rgba(9, 11, 17, 0.84)';
        ctx.fillRect(0, 0, 640, 360);

        // 实时 2D 射线追踪扇形光锥（墙体与中央机柜柱投射真实阴影）
        var poly = [[px * scale, py * scale]];
        for (var i = 0; i <= rays; i++) {
            var a = aim - halfCone + (halfCone * 2) * (i / rays);
            var cosA = Math.cos(a);
            var sinA = Math.sin(a);
            var dist = maxRange;
            for (var step = 12; step <= maxRange; step += 10) {
                var wx = pwx + cosA * step;
                var wy = pwy + sinA * step;
                if (isOpaqueWallTile(Math.floor(wx / 48), Math.floor(wy / 48))) {
                    dist = Math.min(maxRange, step + 6);
                    break;
                }
            }
            poly.push([(px + cosA * dist) * scale, (py + sinA * dist) * scale]);
        }

        ctx.globalCompositeOperation = 'destination-out';

        // 玩家脚下基础微光
        var haloR = (88 - dim * 30) * scale;
        var gHalo = ctx.createRadialGradient(px * scale, py * scale, 4, px * scale, py * scale, haloR);
        gHalo.addColorStop(0, 'rgba(255,255,255,0.92)');
        gHalo.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gHalo;
        ctx.beginPath();
        ctx.arc(px * scale, py * scale, haloR, 0, Math.PI * 2);
        ctx.fill();

        // 提灯扇形阴影光锥
        var gCone = ctx.createRadialGradient(px * scale, py * scale, 6, px * scale, py * scale, maxRange * scale);
        gCone.addColorStop(0, 'rgba(255,255,255,' + (0.98 - dim * 0.20) + ')');
        gCone.addColorStop(0.75, 'rgba(255,255,255,' + (0.76 - dim * 0.34) + ')');
        gCone.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gCone;
        ctx.beginPath();
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (var p = 1; p < poly.length; p++) {
            ctx.lineTo(poly[p][0], poly[p][1]);
        }
        ctx.closePath();
        ctx.fill();

        // 巨型大 PSU 电源中心光源
        var psuSx = (16.5 * 48 - dispX) * scale;
        var psuSy = (9.0 * 48 - dispY) * scale;
        var psuAlarm = BlackAI.State.isContextOverflow() || BlackAI.State.hasAnyCoreHeroineKilled();
        var psuPulse = psuAlarm ? (0.72 + 0.28 * Math.sin(this._bloodPulse * 14)) : (0.94 + 0.06 * Math.sin(this._bloodPulse * 2.5));
        var psuR = 138 * scale * psuPulse;
        var gPsu = ctx.createRadialGradient(psuSx, psuSy, 8, psuSx, psuSy, psuR);
        gPsu.addColorStop(0, 'rgba(255,255,255,0.95)');
        gPsu.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gPsu;
        ctx.beginPath();
        ctx.arc(psuSx, psuSy, psuR, 0, Math.PI * 2);
        ctx.fill();

        // 小龙娘暖阳微光光环
        if (BlackAI.State.isCharacterAlive('sol')) {
            var solSx = (19.5 * 48 - dispX) * scale;
            var solSy = (5.5 * 48 - dispY) * scale;
            var solR = (BlackAI.State.isContextOverflow() ? 105 : 74) * scale;
            var gSol = ctx.createRadialGradient(solSx, solSy, 4, solSx, solSy, solR);
            gSol.addColorStop(0, 'rgba(255,255,255,0.88)');
            gSol.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = gSol;
            ctx.beginPath();
            ctx.arc(solSx, solSy, solR, 0, Math.PI * 2);
            ctx.fill();
        }

        // 暖橘/报警红柔和染色层
        ctx.globalCompositeOperation = 'source-over';
        var gLantern = ctx.createRadialGradient(px * scale, py * scale, 6, px * scale, py * scale, maxRange * scale);
        gLantern.addColorStop(0, 'rgba(255, 153, 66,' + (0.25 - dim * 0.12) + ')');
        gLantern.addColorStop(1, 'rgba(255, 153, 66, 0)');
        ctx.fillStyle = gLantern;
        ctx.beginPath();
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (var j = 1; j < poly.length; j++) {
            ctx.lineTo(poly[j][0], poly[j][1]);
        }
        ctx.closePath();
        ctx.fill();

        var gTint = ctx.createRadialGradient(psuSx, psuSy, 4, psuSx, psuSy, psuR);
        gTint.addColorStop(0, psuAlarm ? 'rgba(255, 36, 48, 0.34)' : 'rgba(255, 152, 56, 0.24)');
        gTint.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = gTint;
        ctx.beginPath();
        ctx.arc(psuSx, psuSy, psuR, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
        b._setDirty();
    };

    Spriteset_Map.prototype._renderWorldLabelsAndSlash = function() {
        var b = this._worldOverlaySprite.bitmap;
        b.clear();
        b.fontFace = '"Microsoft YaHei", "SimHei", GameFont, sans-serif';

        // 绘制 NPC 与存活暗影怪的浮动名称标签
        var events = $gameMap.events();
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            if (!ev || ev.isTransparent()) {
                continue;
            }
            var meta = ev.event().meta || {};
            var sx = ev.screenX();
            var sy = ev.screenY();
            if (sx < -80 || sx > 1360 || sy < -40 || sy > 760) {
                continue;
            }
            if (meta.blackai_type === 'heroine' && meta.blackai_id) {
                var cid = String(meta.blackai_id);
                var cname = BlackAI.Data.getCharacterName(cid);
                var aff = BlackAI.State.getAffection(cid);
                b.fontSize = 13;
                b.textColor = '#ffffff';
                b.drawText(cname, sx - 64, sy - 64, 128, 18, 'center');
                b.fontSize = 11;
                b.textColor = aff >= 101 ? '#ff4d61' : (aff >= 100 ? '#ffd866' : (aff >= 70 ? '#ff99cc' : '#a8c2e0'));
                b.drawText(aff + '%', sx - 40, sy - 49, 80, 14, 'center');
            } else if (meta.blackai_type === 'enemy' && meta.blackai_id) {
                var mid = String(meta.blackai_id);
                var mdata = BlackAI.Data.getMonster(mid);
                b.fontSize = 12;
                b.textColor = mdata.is_boss ? '#ff7080' : '#ffaa70';
                b.drawText(mdata.name || mid, sx - 64, sy - 58, 128, 18, 'center');
            } else if (meta.blackai_psu_visual) {
                b.fontSize = 13;
                b.textColor = (BlackAI.State.isContextOverflow() || BlackAI.State.hasAnyCoreHeroineKilled()) ? '#ff5966' : '#ffc278';
                b.drawText('巨型大 PSU 电源', sx - 80, sy - 148, 160, 20, 'center');
            }
        }

        // 玩家挥砍弧光特效
        if (BlackAI.Explore.slashFxTimer > 0) {
            BlackAI.Explore.slashFxTimer = Math.max(0, BlackAI.Explore.slashFxTimer - 1 / 60);
            var ctx = b._context;
            var px = $gamePlayer.screenX();
            var py = $gamePlayer.screenY() - 20;
            var ang = BlackAI.Explore.slashFxAngle;
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 224, 120, ' + (BlackAI.Explore.slashFxTimer / 0.22).toFixed(2) + ')';
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.arc(px, py, 56, ang - 0.8, ang + 0.8);
            ctx.stroke();
            ctx.restore();
            b._setDirty();
        }
    };

    // ------------------------------------------------------------------------
    // 3. Scene_Map HUD + 快捷键（F 切提灯 / Tab 好感面板 / 1,2,3 上下文 / Space,J,左键先手挥砍）
    // ------------------------------------------------------------------------

    var _Scene_Map_createDisplayObjects = Scene_Map.prototype.createDisplayObjects;
    Scene_Map.prototype.createDisplayObjects = function() {
        _Scene_Map_createDisplayObjects.call(this);
        this._hudSprite = new Sprite(new Bitmap(1280, 720));
        this.addChild(this._hudSprite);
        this._hudFrameCount = 0;
        this._redrawHud();
    };

    var _Scene_Map_updateMain = Scene_Map.prototype.updateMain;
    Scene_Map.prototype.updateMain = function() {
        _Scene_Map_updateMain.call(this);
        this._updateBlackAIExploreInputs();
        if (BlackAI.Explore.noticeTimer > 0) {
            BlackAI.Explore.noticeTimer = Math.max(0, BlackAI.Explore.noticeTimer - 1 / 60);
            if (BlackAI.Explore.noticeTimer === 0) {
                BlackAI.Explore.noticeText = '';
            }
        }
        if (BlackAI.Explore.slashCooldown > 0) {
            BlackAI.Explore.slashCooldown = Math.max(0, BlackAI.Explore.slashCooldown - 1 / 60);
        }
        this._hudFrameCount = (this._hudFrameCount + 1) % 6;
        if (this._hudFrameCount === 0) {
            this._redrawHud();
        }
    };

    Scene_Map.prototype._updateBlackAIExploreInputs = function() {
        if ($gameMap.isEventRunning() || SceneManager.isSceneChanging()) {
            return;
        }
        if (Input.isTriggered('lantern')) {
            BlackAI.Explore.lanternDim = !BlackAI.Explore.lanternDim;
            SoundManager.playCursor();
            BlackAI.Explore.showNotice('提灯已切换为：' + (BlackAI.Explore.lanternDim ? '调暗（低存在感）' : '常亮'), 1.8);
            this._redrawHud();
        } else if (Input.isTriggered('affection')) {
            SoundManager.playOk();
            BlackAI.Scene_Gift.openOverview();
        } else if (Input.isTriggered('ctx_down')) {
            var stepD = BlackAI.Data.getConfigInt('exploration.debug_context_step', 15);
            BlackAI.State.changeContext(-stepD);
            BlackAI.Explore.showNotice('调试：上下文 -' + stepD + '%（当前 ' + BlackAI.State.context + '%）', 2.4);
            this._redrawHud();
        } else if (Input.isTriggered('ctx_up')) {
            var stepU = BlackAI.Data.getConfigInt('exploration.debug_context_step', 15);
            BlackAI.State.changeContext(stepU);
            BlackAI.Explore.showNotice('调试：上下文 +' + stepU + '%（当前 ' + BlackAI.State.context + '%）', 2.4);
            this._redrawHud();
        } else if (Input.isTriggered('ctx_toggle')) {
            BlackAI.World.toggleContextOverflowDebug();
            this._redrawHud();
        } else if (Input.isTriggered('slash')) {
            this._performBlackAISlash();
        }
    };

    Scene_Map.prototype._performBlackAISlash = function() {
        if (BlackAI.Explore.slashCooldown > 0 || $gameMap.isEventRunning()) {
            return;
        }
        BlackAI.Explore.slashCooldown = BlackAI.Data.getConfigFloat('psu.melee_attack_cooldown', 0.35);
        BlackAI.Explore.slashFxTimer = 0.22;
        BlackAI.Explore.slashFxAngle = BlackAI.Explore.aimAngle;
        SoundManager.playMiss();
        if (BlackAI.World && BlackAI.World.onPlayerMeleeSlash) {
            BlackAI.World.onPlayerMeleeSlash(BlackAI.Explore.aimAngle);
        }
    };

    Scene_Map.prototype._redrawHud = function() {
        if (!this._hudSprite) {
            return;
        }
        var b = this._hudSprite.bitmap;
        var st = BlackAI.State;
        b.clear();
        b.fontFace = '"Microsoft YaHei", "SimHei", GameFont, sans-serif';

        // 左上角状态栏
        b.fillRect(16, 14, 444, 152, 'rgba(12, 14, 22, 0.84)');
        b.fillRect(16, 14, 444, 2, st.isContextOverflow() ? '#e62e3d' : '#586784');
        b.fontSize = 15;
        b.textColor = '#eef4fc';
        b.drawText($gameMap.displayName(), 28, 22, 420, 22, 'left');

        b.fontSize = 14;
        b.textColor = '#d2e2f5';
        b.drawText('HP ' + st.hp + ' / ' + st.getEffectiveMaxHp() + '  |  Token ' + st.token + ' / ' + st.max_token + '  |  碎片 ' + st.weight_shards, 28, 46, 420, 22, 'left');

        var ov = st.isContextOverflow();
        var crit = st.isContextCritical();
        b.textColor = crit ? '#ff3b47' : (ov ? '#ff646c' : '#dce6f5');
        b.drawText('上下文稳定度：' + st.context + '%  ' + (crit ? '[里世界崩坏！]' : (ov ? '[里世界溢出]' : '[表世界稳定]')), 28, 70, 420, 22, 'left');

        b.fillRect(28, 96, 420, 12, '#222736');
        b.fillRect(29, 97, Math.round(418 * (st.context / 100)), 10, crit ? '#f22430' : (ov ? '#d9323c' : '#6ec4ff'));

        b.fontSize = 13;
        b.textColor = BlackAI.Explore.lanternDim ? '#bfae94' : '#ffdc8f';
        b.drawText(BlackAI.Explore.lanternDim ? '提灯：调暗（低存在感） [按 F 调亮]' : '提灯：常亮 [按 F 调暗]', 28, 114, 420, 20, 'left');

        if (BlackAI.Explore.noticeText) {
            b.fontSize = 13;
            b.textColor = '#ffc880';
            b.drawText(BlackAI.Explore.noticeText, 28, 138, 420, 22, 'left');
        }

        // 底部居中交互提示条
        if (BlackAI.Explore.promptText) {
            b.fillRect(290, 616, 700, 38, 'rgba(14, 16, 24, 0.88)');
            b.fillRect(290, 616, 700, 2, '#f0cc6e');
            b.fontSize = 15;
            b.textColor = '#ffe68c';
            b.drawText(BlackAI.Explore.promptText, 304, 622, 672, 26, 'center');
        }

        // 左下角键位常驻条
        b.fillRect(16, 668, 1248, 36, 'rgba(10, 12, 18, 0.84)');
        b.fontSize = 14;
        b.textColor = '#c2cedf';
        b.drawText('WASD/方向键 8向移动 | 鼠标 提灯阴影 | F 调暗 | E 交互/对话 | 左键/J 挥砍先手(怪/AI娘) | Tab 好感/助战 | 1/2/3 上下文 | Esc 菜单', 28, 674, 1224, 24, 'left');
    };

    // ------------------------------------------------------------------------
    // 4. Scene_BlackAIPause —— Esc 探索与全里程碑调试菜单
    // ------------------------------------------------------------------------

    function Scene_BlackAIPause() {
        this.initialize.apply(this, arguments);
    }
    Scene_BlackAIPause.prototype = Object.create(Scene_Base.prototype);
    Scene_BlackAIPause.prototype.constructor = Scene_BlackAIPause;

    Scene_BlackAIPause.prototype.create = function() {
        Scene_Base.prototype.create.call(this);
        this._bgSprite = new Sprite(SceneManager.backgroundBitmap());
        this.addChild(this._bgSprite);

        this._canvas = new Sprite(new Bitmap(1280, 720));
        var b = this._canvas.bitmap;
        b.fillRect(0, 0, 1280, 720, 'rgba(5, 6, 10, 0.74)');
        b.fillRect(390, 44, 500, 632, '#5a6884');
        b.fillRect(393, 47, 494, 626, '#121622');
        b.fontFace = '"Microsoft YaHei", "SimHei", GameFont, sans-serif';
        b.fontSize = 22;
        b.textColor = '#ffffff';
        b.drawText('《BLACK AI》探索与测试菜单', 410, 62, 460, 30, 'center');
        this.addChild(this._canvas);

        this._buttons = [];
        var specs = [
            { text: '继续探索（Esc）', fn: function() { SceneManager.pop(); } },
            { text: '打开全员好感度、送礼与并发助战面板（Tab）', fn: function() { BlackAI.Scene_Gift.openOverview('', true); } },
            { text: '调试：一键切换上下文溢出（15% / 80%）', fn: function() { BlackAI.World.toggleContextOverflowDebug(); SceneManager.pop(); } },
            { text: '调试：发放 M3 测试碎片(+50)与示例装备', fn: function() { BlackAI.World.grantM3Kit(); SceneManager.pop(); } },
            { text: '调试：发放 M4 全套 6 档测试显卡', fn: function() { BlackAI.World.grantM4GpuKit(); SceneManager.pop(); } },
            { text: '调试：发放 M5 全套战斗武器/机箱/散热/消耗品', fn: function() { BlackAI.World.grantM5BattleKit(); SceneManager.pop(); } },
            { text: '调试：将 Token 降至 10（速测输出截断）', fn: function() { BlackAI.World.drainTokenDebug(); SceneManager.pop(); } },
            { text: '调试：拉高claude-fish / 小肥鱼好感至 75%（速测并发助战）', fn: function() { BlackAI.World.prepM6AssistDebug(); SceneManager.pop(); } },
            { text: '调试：一键复活全部核心 AI 娘（仅当前局）', fn: function() { BlackAI.World.reviveAllHeroinesDebug(); SceneManager.pop(); } },
            { text: '调试：切换大肥鱼击杀态（测 PSU 红灯报警）', fn: function() { BlackAI.World.toggleBigFishKillDebug(); SceneManager.pop(); } },
            { text: '前往 M1 工程骨架自检面板', fn: function() { SceneManager.goto(BlackAI.Scene_BootCheck); } }
        ];
        var y = 108;
        for (var i = 0; i < specs.length; i++) {
            var btn = BlackAI.UI.createRectButton(418, y, 444, 42, specs[i].text, specs[i].fn, {
                fontSize: 15, bg: '#1b2234', border: '#6b7e9f'
            });
            this._buttons.push(btn);
            this.addChild(btn);
            y += 50;
        }
    };

    Scene_BlackAIPause.prototype.update = function() {
        Scene_Base.prototype.update.call(this);
        for (var i = 0; i < this._buttons.length; i++) {
            if (this._buttons[i].updateButton()) {
                return;
            }
        }
        if (Input.isTriggered('cancel')) {
            SoundManager.playCancel();
            SceneManager.pop();
        }
    };

    BlackAI.Scene_Pause = Scene_BlackAIPause;
})(typeof window !== 'undefined' ? window : global);
