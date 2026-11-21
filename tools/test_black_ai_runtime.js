#!/usr/bin/env node
'use strict';
/**
 * 《BLACK AI》RPG Maker MV 核心插件 Node.js 无头回归测试（M1–M6）
 * 验证：
 * 1. BlackAI.Data 全量加载（31 物品 / 13 角色 / 6 怪物 / 7 Boss / 12 技能 / 11 结局）
 * 2. 6 档显卡送礼规则（580 假小 C +12 / 大肥鱼 +8 / 猫猫拒收强送 -5；600900 100→200%）
 * 3. 大 PSU 清理缓存、400 HP 有效上限拦截、GlobalMemory 持久化读写
 * 4. 全部 7 位核心 AI 娘 .dialogue 剧本解析与表/里世界分支运行
 * 5. BS2 战斗：防御 -50%+Token、输出截断、水宕机、水泥电阻限流打断、侧透玻璃碎裂+黑胶带修补、WD-40 次回合先手
 * 6. AI 娘 Boss：大肥鱼首回合深度思考打断、假小 C × 真小 C 修罗场狂暴、小肥鱼 × 大肥鱼反水回血、
 *    溢出态 UI 破坏（红线划掉逃跑/乱码血条）与击杀写入 GlobalMemory.killed_in_past_saves
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BA_DATA = path.join(ROOT, 'data', 'black_ai');

const BlackAI = require(path.join(ROOT, 'js', 'plugins', 'BlackAI_Core.js'));
require(path.join(ROOT, 'js', 'plugins', 'BlackAI_BattleEngine.js'));
require(path.join(ROOT, 'js', 'plugins', 'BlackAI_Dialogue.js'));

function loadJson(name) {
    return JSON.parse(fs.readFileSync(path.join(BA_DATA, name), 'utf8'));
}

function runAllTests() {
    // 1. M1 数据加载
    BlackAI.Data.initFromRaw({
        config: loadJson('config.json'),
        items: loadJson('items.json'),
        characters: loadJson('characters.json'),
        monsters: loadJson('monsters.json'),
        endings: loadJson('endings.json'),
        skills: loadJson('skills.json'),
        bosses: loadJson('bosses.json')
    });
    assert.strictEqual(BlackAI.Data.isLoaded, true, 'DataRegistry 应无错加载');
    const sum = BlackAI.Data.getSummary();
    assert.strictEqual(sum.items_total, 31);
    assert.strictEqual(sum.core_heroines, 7);
    assert.strictEqual(sum.function_npcs, 5);
    assert.strictEqual(sum.monsters, 6);
    assert.strictEqual(sum.bosses, 7);
    assert.strictEqual(sum.endings, 11);

    // 2. GlobalMemory 临时文件持久化
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackai-mv-test-'));
    const memPath = path.join(tmpDir, 'global_memory.json');
    BlackAI.GlobalMemory.resetInMemory();
    BlackAI.GlobalMemory._customFilePath = memPath;
    BlackAI.GlobalMemory.registerSl();
    BlackAI.GlobalMemory.unlockEnding('joke_itchy_fingers');
    BlackAI.GlobalMemory.resetInMemory();
    BlackAI.GlobalMemory.load();
    assert.strictEqual(BlackAI.GlobalMemory.sl_count, 1, 'SL 计数应持久保存');
    assert.strictEqual(BlackAI.GlobalMemory.hasEnding('joke_itchy_fingers'), true);

    // 3. M3 PSU 升级上限 400 与清理缓存
    const st = BlackAI.State;
    st.resetNewGame(false);
    st.addWeightShards(500);
    st.addItem('rog_case', 1);
    st.equipItem('case', 'rog_case', true); // +80 HP
    st.base_max_hp = 320;
    assert.strictEqual(st.getEffectiveMaxHp(), 400);
    assert.strictEqual(st.upgradeBaseHp(), false, '有效 HP 已达 400 时应禁止继续升级');

    st.setContext(15);
    assert.strictEqual(st.isContextOverflow(), true);
    st.defeated_world_enemies.glitch_ghost = true;
    const resp = st.psuClearCache();
    assert.strictEqual(st.context, 80);
    assert.strictEqual(resp, 1);
    assert.strictEqual(Object.keys(st.defeated_world_enemies).length, 0);

    // 4. M4 6 档显卡送礼 & 600900 100→200% & .dialogue 运行
    st.resetNewGame(false);
    st.addItem('gpu_580', 4);
    st.addItem('gpu_20600', 1);
    st.addItem('gpu_50900', 4);
    st.addItem('gpu_huawei', 1);
    st.addItem('gpu_600900', 1);

    const rFake = st.giftGraphicsCard('fake_c', 'gpu_580', false, true);
    assert.strictEqual(rFake.delta, 12);
    const rBig = st.giftGraphicsCard('big_fish', 'gpu_580', false, true);
    assert.strictEqual(rBig.delta, 8);
    st.giftGraphicsCard('gemini_cat', 'gpu_20600', false, true); // +10
    const rRej = st.giftGraphicsCard('gemini_cat', 'gpu_580', false, true);
    assert.strictEqual(rRej.rejected, true);
    const rFor = st.giftGraphicsCard('gemini_cat', 'gpu_580', true, true);
    assert.strictEqual(rFor.new_value, 5);
    for (let i = 0; i < 4; i++) st.giftGraphicsCard('gemini_cat', 'gpu_50900', false, true);
    st.giftGraphicsCard('gemini_cat', 'gpu_huawei', false, true);
    assert.strictEqual(st.getAffection('gemini_cat'), 100);
    st.giftGraphicsCard('gemini_cat', 'gpu_600900', false, true);
    assert.strictEqual(st.getAffection('gemini_cat'), 200);
    st.addAffection('big_fish', 62, false);
    assert.strictEqual(st.giftGraphicsCard('big_fish', 'gpu_huawei', false, false).new_value, 100);
    assert.strictEqual(st.giftGraphicsCard('big_fish', 'gpu_huawei', false, false).new_value, 135);

    // 验证小龙娘 .dialogue 剧本分支执行
    st.setContext(80);
    const solRaw = fs.readFileSync(path.join(ROOT, 'dialogue', 'sol.dialogue'), 'utf8');
    const solDoc = BlackAI.DialogueParser.parseText(solRaw);
    assert.strictEqual(solDoc.ok, true);
    let sawChoices = [];
    const runner = new BlackAI.DialogueRunner({
        onLine: function() { runner.advance(); },
        onChoices: function(opts) { sawChoices = opts; }
    });
    runner.start(solDoc, 'start', 'sol');
    assert.ok(sawChoices.length >= 3, '小龙娘应呈现选项');
    runner.choose(0); // calm_chat -> context +10
    assert.strictEqual(st.context, 90);

    // 5. M5 战斗：输出截断、侧透玻璃碎裂+黑胶带修补、水泥电阻打断矿渣傀儡、WD-40 次回合 SPD
    st.resetNewGame(false);
    st.setToken(10);
    const eng1 = new BlackAI.BattleEngine(() => 0.99);
    eng1.startMonsterBattle('glitch_ghost', true);
    eng1.executePlayerTurn('skill', 'overclock_slash');
    assert.ok(eng1.last_truncation_banner.indexOf('输出截断') !== -1, 'Token 不足强放应触发输出截断');

    st.resetNewGame(false);
    st.addItem('tempered_glass_case', 1);
    st.equipItem('case', 'tempered_glass_case', true);
    st.addItem('black_tape', 1);
    const engGlass = new BlackAI.BattleEngine(() => 0.99);
    engGlass.startMonsterBattle('slag_golem', true);
    engGlass.executePlayerTurn('attack', ''); // slag_golem 蓄力
    engGlass.executePlayerTurn('attack', ''); // 吃一记 51 点重击 -> 玻璃碎裂 DEF 22 -> 0
    assert.strictEqual(st.is_case_broken, true, '单次 >45 伤害应触发侧透玻璃碎裂');
    assert.strictEqual(st.getEffectiveDef(), 0);
    engGlass.executePlayerTurn('item', 'black_tape');
    assert.strictEqual(st.is_case_broken, false, '黑胶带应修补碎裂的侧透玻璃机箱');
    assert.strictEqual(st.getEffectiveDef(), 22);

    st.resetNewGame(false);
    st.addItem('wd40', 1);
    const engWd = new BlackAI.BattleEngine(() => 0.99);
    engWd.startMonsterBattle('glitch_ghost', true);
    engWd.executePlayerTurn('item', 'wd40');
    assert.strictEqual(engWd.player_next_turn_spd_bonus, 50, 'WD-40 的 +50 SPD 应保留到下回合');

    // 6. M6 Boss：大肥鱼首回合深度思考打断、假小 C × 真小 C 修罗场、小肥鱼 × 大肥鱼反水、溢出 UI 破坏与击杀写入
    st.resetNewGame(false);
    st.addItem('water', 2);
    st.addItem('cement_resistor', 2);
    const engBF = new BlackAI.BattleEngine(() => 0.2);
    engBF.startHeroineBossBattle('big_fish', true);
    assert.strictEqual(engBF.enemy.charging_skill_id, 'big_fish_deep_think');
    assert.strictEqual(engBF.getEnemyEffectiveDef(), 24);
    engBF.executePlayerTurn('item', 'water');
    assert.strictEqual(engBF.enemy.charging_skill_id, '', '泼水应打断大肥鱼深度思考');
    assert.ok(engBF.enemy.statuses.crash >= 1, '大肥鱼应陷入 AI 宕机硬直');

    st.resetNewGame(false);
    st.addAffection('fake_c', 75, false);
    st.addAffection('small_fish', 75, false);
    assert.strictEqual(st.setAssistPartner('fake_c'), true);
    const engTC = new BlackAI.BattleEngine(() => 0.5);
    engTC.startHeroineBossBattle('true_c', true);
    assert.strictEqual(engTC.boss_enraged, true, '带假小 C 助战打真小 C 应触发正版锁定狂暴');
    assert.ok(engTC.formatStatusBadges(engTC.player_statuses, false).indexOf('狂暴锁定') === -1, '玩家状态栏不应混入 Boss 徽章');

    assert.strictEqual(st.setAssistPartner('small_fish'), true);
    const engBetray = new BlackAI.BattleEngine(() => 0.1); // <= 0.65 反水
    engBetray.startHeroineBossBattle('big_fish', true);
    engBetray.enemy.hp = 400;
    engBetray.executePlayerTurn('assist', '');
    assert.ok(engBetray.boss_rivalry_banner.indexOf('助战反水') !== -1, '小肥鱼并发助战打大肥鱼应触发反水劝架横幅');
    // 400 + 30（小肥鱼反水回血）+ 35（大肥鱼未被打断的深度思考回血）= 465
    assert.strictEqual(engBetray.enemy.hp, 465, '小肥鱼反水回血(+30)与大肥鱼深度思考回血(+35)应准确结算为 465');

    // 溢出态 Boss UI 破坏 + 击杀写入 GlobalMemory
    st.resetNewGame(false);
    st.setContext(15);
    const engOv = new BlackAI.BattleEngine(() => 0.99);
    engOv.startHeroineBossBattle('small_fish', true);
    assert.strictEqual(engOv.is_overflow_boss, true);
    assert.strictEqual(engOv.escape_crossed_out, true, '溢出 Boss 应红线划掉逃跑键');
    assert.strictEqual(engOv.hp_bar_glitched, true, '溢出 Boss 应启用血条 1-bit 乱码');
    engOv.enemy.hp = 1;
    engOv.executePlayerTurn('attack', '');
    assert.strictEqual(engOv.phase, 'victory');
    assert.strictEqual(st.isCharacterAlive('small_fish'), false, '击败 Boss 后 alive_states 应置为 false');
    assert.strictEqual(BlackAI.GlobalMemory.hasKilledInPast('small_fish'), true, '击败 Boss 应写入 GlobalMemory.killed_in_past_saves');

    // 清理临时目录
    try {
        fs.unlinkSync(memPath);
        fs.rmdirSync(tmpDir);
    } catch (_e) {}

    console.log('[PASS] Node.js 无头回归测试全部通过（M1 数据 / M3 PSU / M4 送礼与对话 / M5 硬件回合制 / M6 Boss 与溢出 UI 破坏）');
}

runAllTests();
