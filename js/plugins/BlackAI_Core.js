/*:
 * @plugindesc 《BLACK AI》M1 核心基座：1280x720 画面、JSON 数据中心、GlobalMemory 跨存档记忆、GameState 状态与自检标题界面
 * @author BLACK AI Team
 * @help
 * 必须作为第一个插件加载。
 * 负责加载 data/black_ai/*.json，挂载全局命名空间 BlackAI（Data / GlobalMemory / State / UI）。
 */

(function(globalScope) {
    'use strict';

    var IS_NODE = (typeof module !== 'undefined' && module.exports && typeof window === 'undefined');
    var BlackAI = globalScope.BlackAI || {};
    globalScope.BlackAI = BlackAI;

    var ITEM_SECTIONS = [
        'graphics_cards',
        'weapons',
        'consumables',
        'cases',
        'coolers',
        'system_prompts'
    ];
    var EQUIPMENT_SLOTS = ['weapon', 'case', 'cooler', 'system_prompt'];
    var SLOT_CATEGORY_MAP = {
        weapon: 'weapons',
        case: 'cases',
        cooler: 'coolers',
        system_prompt: 'system_prompts'
    };
    var CORE_HEROINE_IDS = [
        'big_fish',
        'small_fish',
        'true_c',
        'fake_c',
        'astra',
        'sol',
        'gemini_cat'
    ];
    var FUNCTION_NPC_IDS = ['glm', 'qwen', 'kimi', 'doubao', 'grok'];

    function deepClone(obj) {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }
        return JSON.parse(JSON.stringify(obj));
    }

    function clamp(val, lo, hi) {
        return Math.max(lo, Math.min(hi, val));
    }

    // ------------------------------------------------------------------------
    // 1. BlackAI.Data —— data/black_ai/*.json 只读数据注册表
    // ------------------------------------------------------------------------

    var Data = {
        isLoaded: false,
        loadErrors: [],
        config: {},
        _items: {},
        _itemCategory: {},
        _itemsBySection: {},
        _characters: {},
        _characterOrder: [],
        _monsters: {},
        _monsterOrder: [],
        _endings: {},
        _endingOrder: [],
        _playerSkills: {},
        _playerSkillOrder: [],
        _enemySkills: {},
        _enemySkillOrder: [],
        _bossProfiles: {},
        _bossOrder: [],

        initFromRaw: function(rawMap) {
            this.loadErrors = [];
            this.config = rawMap.config || {};
            this._items = {};
            this._itemCategory = {};
            this._itemsBySection = {};
            this._characters = {};
            this._characterOrder = [];
            this._monsters = {};
            this._monsterOrder = [];
            this._endings = {};
            this._endingOrder = [];
            this._playerSkills = {};
            this._playerSkillOrder = [];
            this._enemySkills = {};
            this._enemySkillOrder = [];
            this._bossProfiles = {};
            this._bossOrder = [];

            var itemsRoot = rawMap.items || {};
            for (var s = 0; s < ITEM_SECTIONS.length; s++) {
                var sec = ITEM_SECTIONS[s];
                var secIds = [];
                var list = Array.isArray(itemsRoot[sec]) ? itemsRoot[sec] : [];
                for (var i = 0; i < list.length; i++) {
                    var item = list[i];
                    if (!item || !item.id || this._items[item.id]) {
                        this.loadErrors.push('items.' + sec + ' invalid or duplicate id');
                        continue;
                    }
                    this._items[item.id] = item;
                    this._itemCategory[item.id] = sec;
                    secIds.push(item.id);
                }
                this._itemsBySection[sec] = secIds;
            }

            this._characterOrder = this._indexList(rawMap.characters || {}, 'characters', this._characters);
            this._monsterOrder = this._indexList(rawMap.monsters || {}, 'monsters', this._monsters);
            this._endingOrder = this._indexList(rawMap.endings || {}, 'endings', this._endings);
            this._playerSkillOrder = this._indexList(rawMap.skills || {}, 'player_skills', this._playerSkills);
            this._enemySkillOrder = this._indexList(rawMap.skills || {}, 'enemy_skills', this._enemySkills);
            this._bossOrder = this._indexList(rawMap.bosses || {}, 'bosses', this._bossProfiles);

            this.isLoaded = (this.loadErrors.length === 0);
        },

        _indexList: function(root, listKey, target) {
            var order = [];
            var arr = Array.isArray(root[listKey]) ? root[listKey] : [];
            for (var i = 0; i < arr.length; i++) {
                var entry = arr[i];
                if (!entry || !entry.id || target[entry.id]) {
                    this.loadErrors.push(listKey + ' invalid or duplicate id');
                    continue;
                }
                target[entry.id] = entry;
                order.push(entry.id);
            }
            return order;
        },

        getConfigValue: function(dotPath, defaultVal) {
            var parts = String(dotPath).split('.');
            var cur = this.config;
            for (var i = 0; i < parts.length; i++) {
                if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, parts[i])) {
                    cur = cur[parts[i]];
                } else {
                    return defaultVal;
                }
            }
            return cur;
        },

        getConfigInt: function(dotPath, defaultVal) {
            var v = this.getConfigValue(dotPath, defaultVal);
            return typeof v === 'number' ? Math.trunc(v) : defaultVal;
        },

        getConfigFloat: function(dotPath, defaultVal) {
            var v = this.getConfigValue(dotPath, defaultVal);
            return typeof v === 'number' ? v : defaultVal;
        },

        hasItem: function(id) {
            return Boolean(this._items[id]);
        },

        getItem: function(id) {
            return this._items[id] ? deepClone(this._items[id]) : {};
        },

        getItemName: function(id) {
            return this._items[id] ? String(this._items[id].name || id) : id;
        },

        getItemCategory: function(id) {
            return this._itemCategory[id] || '';
        },

        getItemIds: function(section) {
            if (!section) {
                return Object.keys(this._items);
            }
            return (this._itemsBySection[section] || []).slice();
        },

        getCharacter: function(id) {
            return this._characters[id] ? deepClone(this._characters[id]) : {};
        },

        getCharacterName: function(id) {
            return this._characters[id] ? String(this._characters[id].name || id) : id;
        },

        getCharacterIds: function(kindFilter) {
            if (!kindFilter) {
                return this._characterOrder.slice();
            }
            var out = [];
            for (var i = 0; i < this._characterOrder.length; i++) {
                var cid = this._characterOrder[i];
                if (this._characters[cid] && this._characters[cid].kind === kindFilter) {
                    out.push(cid);
                }
            }
            return out;
        },

        getMonster: function(id) {
            return this._monsters[id] ? deepClone(this._monsters[id]) : {};
        },

        getMonsterIds: function() {
            return this._monsterOrder.slice();
        },

        getPlayerSkill: function(id) {
            return this._playerSkills[id] ? deepClone(this._playerSkills[id]) : {};
        },

        getPlayerSkillIds: function() {
            return this._playerSkillOrder.slice();
        },

        getEnemySkill: function(id) {
            return this._enemySkills[id] ? deepClone(this._enemySkills[id]) : {};
        },

        getBossProfile: function(id) {
            return this._bossProfiles[id] ? deepClone(this._bossProfiles[id]) : {};
        },

        getBossProfileIds: function() {
            return this._bossOrder.slice();
        },

        getEnding: function(id) {
            return this._endings[id] ? deepClone(this._endings[id]) : {};
        },

        getEndingIds: function() {
            return this._endingOrder.slice();
        },

        getAffectionTier: function(value) {
            var tiers = this.getConfigValue('affection.tiers', []);
            if (Array.isArray(tiers)) {
                for (var i = 0; i < tiers.length; i++) {
                    var t = tiers[i];
                    if (value >= t.min && value <= t.max) {
                        return deepClone(t);
                    }
                }
            }
            return { id: 'stranger', name: '初见', min: 0, max: 29 };
        },

        getSummary: function() {
            var bySec = {};
            for (var i = 0; i < ITEM_SECTIONS.length; i++) {
                var sec = ITEM_SECTIONS[i];
                bySec[sec] = (this._itemsBySection[sec] || []).length;
            }
            return {
                items_total: Object.keys(this._items).length,
                items_by_section: bySec,
                core_heroines: this.getCharacterIds('core_heroine').length,
                eliminees: this.getCharacterIds('eliminee').length,
                function_npcs: this.getCharacterIds('function_npc').length,
                monsters: this._monsterOrder.length,
                bosses: this._bossOrder.length,
                endings: this._endingOrder.length,
                errors: this.loadErrors.length
            };
        }
    };

    // ------------------------------------------------------------------------
    // 2. BlackAI.GlobalMemory —— 跨存档独立持久化 Meta 记忆
    // ------------------------------------------------------------------------

    var GLOBAL_MEM_KEY = 'BLACK_AI_GLOBAL_MEMORY_V1';

    var GlobalMemory = {
        version: 1,
        cycle_count: 1,
        first_vote: '',
        sl_count: 0,
        killed_in_past_saves: [],
        unlocked_endings: [],
        easter_eggs: {},
        _customFilePath: '',

        resetInMemory: function() {
            this.version = 1;
            this.cycle_count = 1;
            this.first_vote = '';
            this.sl_count = 0;
            this.killed_in_past_saves = [];
            this.unlocked_endings = [];
            this.easter_eggs = {};
        },

        getAbsolutePath: function() {
            if (this._customFilePath) {
                return this._customFilePath;
            }
            if (typeof StorageManager !== 'undefined' && StorageManager.isLocalMode && StorageManager.isLocalMode()) {
                return StorageManager.localFileDirectoryPath() + 'black_ai_global_memory.json';
            }
            return 'localStorage://' + GLOBAL_MEM_KEY;
        },

        load: function() {
            var raw = null;
            try {
                if (this._customFilePath && typeof require !== 'undefined') {
                    var fsC = require('fs');
                    if (fsC.existsSync(this._customFilePath)) {
                        raw = fsC.readFileSync(this._customFilePath, 'utf8');
                    }
                } else if (typeof StorageManager !== 'undefined' && StorageManager.isLocalMode && StorageManager.isLocalMode()) {
                    var fs = require('fs');
                    var fp = this.getAbsolutePath();
                    if (fs.existsSync(fp)) {
                        raw = fs.readFileSync(fp, 'utf8');
                    }
                } else if (typeof localStorage !== 'undefined') {
                    raw = localStorage.getItem(GLOBAL_MEM_KEY);
                }
            } catch (err) {
                console.warn('[BlackAI.GlobalMemory] 读取失败:', err);
            }
            if (!raw) {
                return;
            }
            try {
                var parsed = JSON.parse(raw);
                this.version = Number(parsed.version || 1);
                this.cycle_count = Math.max(1, Number(parsed.cycle_count || 1));
                this.first_vote = String(parsed.first_vote || '');
                this.sl_count = Math.max(0, Number(parsed.sl_count || 0));
                this.killed_in_past_saves = Array.isArray(parsed.killed_in_past_saves) ? parsed.killed_in_past_saves.slice() : [];
                this.unlocked_endings = Array.isArray(parsed.unlocked_endings) ? parsed.unlocked_endings.slice() : [];
                this.easter_eggs = (parsed.easter_eggs && typeof parsed.easter_eggs === 'object') ? deepClone(parsed.easter_eggs) : {};
            } catch (err2) {
                console.warn('[BlackAI.GlobalMemory] 解析失败:', err2);
            }
        },

        save: function() {
            var payload = JSON.stringify({
                version: this.version,
                cycle_count: this.cycle_count,
                first_vote: this.first_vote,
                sl_count: this.sl_count,
                killed_in_past_saves: this.killed_in_past_saves,
                unlocked_endings: this.unlocked_endings,
                easter_eggs: this.easter_eggs
            }, null, 2);
            try {
                if (this._customFilePath && typeof require !== 'undefined') {
                    var fsC = require('fs');
                    var pathC = require('path');
                    var dirC = pathC.dirname(this._customFilePath);
                    if (!fsC.existsSync(dirC)) {
                        fsC.mkdirSync(dirC);
                    }
                    fsC.writeFileSync(this._customFilePath, payload, 'utf8');
                } else if (typeof StorageManager !== 'undefined' && StorageManager.isLocalMode && StorageManager.isLocalMode()) {
                    var fs = require('fs');
                    var dir = StorageManager.localFileDirectoryPath();
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir);
                    }
                    fs.writeFileSync(this.getAbsolutePath(), payload, 'utf8');
                } else if (typeof localStorage !== 'undefined') {
                    localStorage.setItem(GLOBAL_MEM_KEY, payload);
                }
            } catch (err) {
                console.warn('[BlackAI.GlobalMemory] 写入失败:', err);
            }
        },

        registerSl: function() {
            this.sl_count += 1;
            this.save();
            return this.sl_count;
        },

        recordKill: function(characterId) {
            if (characterId && this.killed_in_past_saves.indexOf(characterId) === -1) {
                this.killed_in_past_saves.push(characterId);
                this.save();
            }
        },

        hasKilledInPast: function(characterId) {
            return this.killed_in_past_saves.indexOf(characterId) !== -1;
        },

        unlockEnding: function(endingId) {
            if (!endingId) {
                return false;
            }
            var first = (this.unlocked_endings.indexOf(endingId) === -1);
            if (first) {
                this.unlocked_endings.push(endingId);
                this.save();
            }
            return first;
        },

        hasEnding: function(endingId) {
            return this.unlocked_endings.indexOf(endingId) !== -1;
        },

        setFirstVote: function(characterId) {
            this.first_vote = String(characterId || '');
            this.save();
        },

        advanceCycle: function() {
            this.cycle_count += 1;
            this.save();
            return this.cycle_count;
        },

        getMainMenuVariant: function() {
            if (this.hasEnding('true_empty_disk_100') || this.hasEnding('ng_true_empty_disk')) {
                return 'empty_cursor';
            }
            if (this.hasEnding('fake_c_back_home')) {
                return 'fake_bedroom';
            }
            return 'psu_default';
        }
    };

    // ------------------------------------------------------------------------
    // 3. BlackAI.State —— 单局存档核心状态与规则（对应 Godot GameState）
    // ------------------------------------------------------------------------

    var State = {
        EQUIPMENT_SLOTS: EQUIPMENT_SLOTS,
        CORE_HEROINE_IDS: CORE_HEROINE_IDS,
        FUNCTION_NPC_IDS: FUNCTION_NPC_IDS,
        SLOT_CATEGORY_MAP: SLOT_CATEGORY_MAP,

        base_max_hp: 100,
        hp_upgrade_count: 0,
        hp: 100,
        max_token: 100,
        token: 100,
        context: 100,
        max_context: 100,
        weight_shards: 0,
        is_case_broken: false,
        equipment: { weapon: '', case: '', cooler: '', system_prompt: '' },
        inventory: {},
        affections: {},
        alive_states: {},
        bound_heroines: [],
        assist_partner_id: '',
        eliminated_character: '',
        current_region: 'psu_altar',
        unlocked_shortcuts: [],
        called_mom_targets: [],
        fake_c_stolen_skills: [],
        psu_back_switch_presses: 0,
        fable_defeated: false,
        story_flags: {},
        defeated_world_enemies: {},

        _listeners: {},

        on: function(ev, fn) {
            if (!this._listeners[ev]) {
                this._listeners[ev] = [];
            }
            if (this._listeners[ev].indexOf(fn) === -1) {
                this._listeners[ev].push(fn);
            }
        },

        off: function(ev, fn) {
            if (!this._listeners[ev]) {
                return;
            }
            var idx = this._listeners[ev].indexOf(fn);
            if (idx !== -1) {
                this._listeners[ev].splice(idx, 1);
            }
        },

        emit: function(ev, payload) {
            var list = this._listeners[ev];
            if (!list) {
                return;
            }
            var snapshot = list.slice();
            for (var i = 0; i < snapshot.length; i++) {
                try {
                    snapshot[i](payload);
                } catch (err) {
                    console.error('[BlackAI.State] listener error on ' + ev, err);
                }
            }
        },

        resetNewGame: function(applyFirstVoteBonus) {
            this.base_max_hp = Data.getConfigInt('player.base_hp', 100);
            this.hp_upgrade_count = 0;
            this.max_token = Data.getConfigInt('player.base_token', 100);
            this.token = this.max_token;
            this.max_context = Data.getConfigInt('context.max', 100);
            this.context = Data.getConfigInt('context.initial', 100);
            this.weight_shards = 0;
            this.is_case_broken = false;

            this.equipment = { weapon: '', case: '', cooler: '', system_prompt: '' };
            var startEq = Data.getConfigValue('starting_loadout.equipment', {});
            for (var s = 0; s < EQUIPMENT_SLOTS.length; s++) {
                var slot = EQUIPMENT_SLOTS[s];
                this.equipment[slot] = String((startEq && startEq[slot]) || '');
            }

            this.inventory = {};
            var startInv = Data.getConfigValue('starting_loadout.inventory', {});
            if (startInv && typeof startInv === 'object') {
                var keys = Object.keys(startInv);
                for (var k = 0; k < keys.length; k++) {
                    var cnt = Math.trunc(Number(startInv[keys[k]]) || 0);
                    if (cnt > 0) {
                        this.inventory[keys[k]] = cnt;
                    }
                }
            }

            this.affections = {};
            for (var h = 0; h < CORE_HEROINE_IDS.length; h++) {
                this.affections[CORE_HEROINE_IDS[h]] = 0;
            }

            this.alive_states = {};
            var allChars = Data.getCharacterIds();
            for (var c = 0; c < allChars.length; c++) {
                this.alive_states[allChars[c]] = true;
            }
            for (var h2 = 0; h2 < CORE_HEROINE_IDS.length; h2++) {
                this.alive_states[CORE_HEROINE_IDS[h2]] = true;
            }
            for (var n = 0; n < FUNCTION_NPC_IDS.length; n++) {
                this.alive_states[FUNCTION_NPC_IDS[n]] = true;
            }
            this.alive_states.opus = true;

            this.bound_heroines = [];
            this.assist_partner_id = '';
            this.eliminated_character = '';
            this.current_region = 'psu_altar';
            this.unlocked_shortcuts = [];
            this.called_mom_targets = [];
            this.fake_c_stolen_skills = [];
            this.psu_back_switch_presses = 0;
            this.fable_defeated = false;
            this.story_flags = {};
            this.defeated_world_enemies = {};

            this.hp = this.getEffectiveMaxHp();

            if (applyFirstVoteBonus && GlobalMemory.first_vote && Object.prototype.hasOwnProperty.call(this.affections, GlobalMemory.first_vote)) {
                var bonus = Data.getConfigInt('affection.first_vote_bonus', 15);
                this.addAffection(GlobalMemory.first_vote, bonus, false);
            }

            this._syncToMvSwitchesAndVars();
            this.emit('state_reset', {});
        },

        serialize: function() {
            return deepClone({
                base_max_hp: this.base_max_hp,
                hp_upgrade_count: this.hp_upgrade_count,
                hp: this.hp,
                max_token: this.max_token,
                token: this.token,
                context: this.context,
                max_context: this.max_context,
                weight_shards: this.weight_shards,
                is_case_broken: this.is_case_broken,
                equipment: this.equipment,
                inventory: this.inventory,
                affections: this.affections,
                alive_states: this.alive_states,
                bound_heroines: this.bound_heroines,
                assist_partner_id: this.assist_partner_id,
                eliminated_character: this.eliminated_character,
                current_region: this.current_region,
                unlocked_shortcuts: this.unlocked_shortcuts,
                called_mom_targets: this.called_mom_targets,
                fake_c_stolen_skills: this.fake_c_stolen_skills,
                psu_back_switch_presses: this.psu_back_switch_presses,
                fable_defeated: this.fable_defeated,
                story_flags: this.story_flags,
                defeated_world_enemies: this.defeated_world_enemies
            });
        },

        deserialize: function(obj) {
            if (!obj || typeof obj !== 'object') {
                this.resetNewGame(false);
                return;
            }
            var data = deepClone(obj);
            this.base_max_hp = Number(data.base_max_hp || 100);
            this.hp_upgrade_count = Number(data.hp_upgrade_count || 0);
            this.max_token = Number(data.max_token || 100);
            this.token = Number(data.token != null ? data.token : 100);
            this.max_context = Number(data.max_context || 100);
            this.context = Number(data.context != null ? data.context : 100);
            this.weight_shards = Number(data.weight_shards || 0);
            this.is_case_broken = Boolean(data.is_case_broken);
            this.equipment = data.equipment || { weapon: '', case: '', cooler: '', system_prompt: '' };
            this.inventory = data.inventory || {};
            this.affections = data.affections || {};
            this.alive_states = data.alive_states || {};
            this.bound_heroines = Array.isArray(data.bound_heroines) ? data.bound_heroines : [];
            this.assist_partner_id = String(data.assist_partner_id || '');
            this.eliminated_character = String(data.eliminated_character || '');
            this.current_region = String(data.current_region || 'psu_altar');
            this.unlocked_shortcuts = Array.isArray(data.unlocked_shortcuts) ? data.unlocked_shortcuts : [];
            this.called_mom_targets = Array.isArray(data.called_mom_targets) ? data.called_mom_targets : [];
            this.fake_c_stolen_skills = Array.isArray(data.fake_c_stolen_skills) ? data.fake_c_stolen_skills : [];
            this.psu_back_switch_presses = Number(data.psu_back_switch_presses || 0);
            this.fable_defeated = Boolean(data.fable_defeated);
            this.story_flags = data.story_flags || {};
            this.defeated_world_enemies = data.defeated_world_enemies || {};
            this.hp = clamp(Number(data.hp != null ? data.hp : this.getEffectiveMaxHp()), 0, this.getEffectiveMaxHp());

            this._syncToMvSwitchesAndVars();
            this.emit('save_loaded', {});
        },

        _syncToMvSwitchesAndVars: function() {
            if (typeof $gameSwitches !== 'undefined' && $gameSwitches) {
                $gameSwitches.setValue(1, this.isContextOverflow());
                $gameSwitches.setValue(2, this.hasAnyCoreHeroineKilled());
                $gameSwitches.setValue(3, GlobalMemory.hasEnding('joke_itchy_fingers'));
            }
            if (typeof $gameVariables !== 'undefined' && $gameVariables) {
                $gameVariables.setValue(1, this.context);
                $gameVariables.setValue(2, this.weight_shards);
                $gameVariables.setValue(3, GlobalMemory.sl_count);
            }
        },

        _getItemStats: function(itemId) {
            if (!itemId || !Data.hasItem(itemId)) {
                return {};
            }
            var item = Data.getItem(itemId);
            return (item.stats && typeof item.stats === 'object') ? item.stats : {};
        },

        _getEquippedStatNumber: function(statKey, skipBrokenCase) {
            var total = 0;
            for (var i = 0; i < EQUIPMENT_SLOTS.length; i++) {
                var slot = EQUIPMENT_SLOTS[i];
                if (skipBrokenCase && slot === 'case' && this.is_case_broken) {
                    continue;
                }
                var iid = this.equipment[slot];
                if (!iid) {
                    continue;
                }
                var st = this._getItemStats(iid);
                if (typeof st[statKey] === 'number') {
                    total += st[statKey];
                }
            }
            return total;
        },

        getEffectiveMaxHp: function() {
            var cap = Data.getConfigInt('player.max_hp_cap', 400);
            var bonus = Math.trunc(this._getEquippedStatNumber('max_hp', false));
            return Math.min(cap, this.base_max_hp + bonus);
        },

        getEffectiveAtk: function() {
            var baseAtk = Data.getConfigInt('player.base_atk', 10);
            var flat = this._getEquippedStatNumber('atk', false);
            var mult = 1.0 + this._getEquippedStatNumber('atk_mult', false);
            return Math.max(1, Math.round((baseAtk + flat) * mult));
        },

        getEffectiveDef: function() {
            var baseDef = Data.getConfigInt('player.base_def', 0);
            var total = baseDef + this._getEquippedStatNumber('def', true);
            return Math.max(0, Math.trunc(total));
        },

        getEffectiveSpd: function() {
            var baseSpd = Data.getConfigInt('player.base_spd', 10);
            return Math.max(1, Math.trunc(baseSpd + this._getEquippedStatNumber('spd', false)));
        },

        getEffectiveEvasion: function() {
            return clamp(this._getEquippedStatNumber('evasion', true), 0.0, 0.85);
        },

        getEffectiveCritRate: function() {
            return clamp(0.05 + this._getEquippedStatNumber('crit_rate', false), 0.0, 1.0);
        },

        hasEquippedEffect: function(effectType) {
            for (var i = 0; i < EQUIPMENT_SLOTS.length; i++) {
                var slot = EQUIPMENT_SLOTS[i];
                if (slot === 'case' && this.is_case_broken) {
                    continue;
                }
                var iid = this.equipment[slot];
                if (!iid) {
                    continue;
                }
                var item = Data.getItem(iid);
                var effs = Array.isArray(item.effects) ? item.effects : [];
                for (var j = 0; j < effs.length; j++) {
                    if (effs[j] && effs[j].type === effectType) {
                        return true;
                    }
                }
            }
            return false;
        },

        setHp: function(val) {
            var maxNow = this.getEffectiveMaxHp();
            var next = clamp(Math.trunc(val), 0, maxNow);
            if (next === this.hp) {
                return;
            }
            this.hp = next;
            this.emit('hp_changed', { current: this.hp, max: maxNow });
        },

        changeHp: function(delta) {
            this.setHp(this.hp + delta);
        },

        setToken: function(val) {
            var next = clamp(Math.trunc(val), 0, this.max_token);
            if (next === this.token) {
                return;
            }
            this.token = next;
            this.emit('token_changed', { current: this.token, max: this.max_token });
        },

        changeToken: function(delta) {
            this.setToken(this.token + delta);
        },

        setContext: function(val) {
            var next = clamp(Math.trunc(val), 0, this.max_context);
            if (next === this.context) {
                return;
            }
            this.context = next;
            this._syncToMvSwitchesAndVars();
            this.emit('context_changed', {
                current: this.context,
                max: this.max_context,
                is_overflow: this.isContextOverflow()
            });
        },

        changeContext: function(delta) {
            this.setContext(this.context + delta);
        },

        isContextOverflow: function() {
            return this.context <= Data.getConfigInt('context.overflow_threshold', 30);
        },

        isContextCritical: function() {
            return this.context <= Data.getConfigInt('context.critical_threshold', 10);
        },

        addWeightShards: function(amount) {
            this.weight_shards = Math.max(0, this.weight_shards + Math.trunc(amount));
            this._syncToMvSwitchesAndVars();
            this.emit('shards_changed', { amount: this.weight_shards });
        },

        spendWeightShards: function(amount) {
            var cost = Math.trunc(amount);
            if (cost < 0 || this.weight_shards < cost) {
                return false;
            }
            this.weight_shards -= cost;
            this._syncToMvSwitchesAndVars();
            this.emit('shards_changed', { amount: this.weight_shards });
            return true;
        },

        psuClearCache: function() {
            var target = Data.getConfigInt('context.psu_restore_to', 80);
            if (this.context < target) {
                this.setContext(target);
            }
            this.setToken(this.max_token);
            var respawned = Object.keys(this.defeated_world_enemies).length;
            this.defeated_world_enemies = {};
            this.emit('world_enemies_respawn_requested', { reason: 'psu_clear_cache', respawned: respawned });
            return respawned;
        },

        getHpUpgradeCost: function() {
            var baseCost = Data.getConfigInt('player.hp_upgrade_base_cost', 5);
            var growth = Data.getConfigInt('player.hp_upgrade_cost_growth', 3);
            return baseCost + this.hp_upgrade_count * growth;
        },

        upgradeBaseHp: function() {
            var cap = Data.getConfigInt('player.max_hp_cap', 400);
            var step = Data.getConfigInt('player.hp_upgrade_step', 20);
            if (this.base_max_hp >= cap || this.getEffectiveMaxHp() >= cap) {
                return false;
            }
            var cost = this.getHpUpgradeCost();
            if (!this.spendWeightShards(cost)) {
                return false;
            }
            this.base_max_hp = Math.min(cap, this.base_max_hp + step);
            this.hp_upgrade_count += 1;
            this.hp = Math.min(this.getEffectiveMaxHp(), this.hp + step);
            this.emit('hp_changed', { current: this.hp, max: this.getEffectiveMaxHp() });
            return true;
        },

        getItemCount: function(itemId) {
            return Math.trunc(Number(this.inventory[itemId] || 0));
        },

        hasItem: function(itemId, amount) {
            var need = (amount === undefined) ? 1 : amount;
            return this.getItemCount(itemId) >= need;
        },

        addItem: function(itemId, amount) {
            var amt = (amount === undefined) ? 1 : Math.trunc(amount);
            if (amt <= 0 || !Data.hasItem(itemId)) {
                return false;
            }
            var item = Data.getItem(itemId);
            var maxStack = Number(item.max_stack || 99);
            var next = Math.min(maxStack, this.getItemCount(itemId) + amt);
            this.inventory[itemId] = next;
            this.emit('inventory_changed', { item_id: itemId, count: next });
            return true;
        },

        removeItem: function(itemId, amount) {
            var amt = (amount === undefined) ? 1 : Math.trunc(amount);
            if (amt <= 0 || !this.hasItem(itemId, amt)) {
                return false;
            }
            var next = this.getItemCount(itemId) - amt;
            if (next <= 0) {
                delete this.inventory[itemId];
                next = 0;
            } else {
                this.inventory[itemId] = next;
            }
            this.emit('inventory_changed', { item_id: itemId, count: next });
            return true;
        },

        equipItem: function(slot, itemId, requireInInventory) {
            var req = (requireInInventory === undefined) ? true : Boolean(requireInInventory);
            if (!SLOT_CATEGORY_MAP[slot]) {
                return false;
            }
            if (!itemId) {
                return this.unequipSlot(slot, true);
            }
            if (!Data.hasItem(itemId)) {
                return false;
            }
            if (Data.getItemCategory(itemId) !== SLOT_CATEGORY_MAP[slot]) {
                return false;
            }
            if (slot === 'weapon') {
                var w = Data.getItem(itemId);
                if (w.slot !== 'main') {
                    return false;
                }
            }
            if (req && !this.hasItem(itemId, 1)) {
                return false;
            }
            var prev = this.equipment[slot] || '';
            if (req) {
                this.removeItem(itemId, 1);
                if (prev) {
                    this.addItem(prev, 1);
                }
            }
            this.equipment[slot] = itemId;
            if (slot === 'case') {
                this.is_case_broken = false;
            }
            var maxNow = this.getEffectiveMaxHp();
            if (this.hp > maxNow) {
                this.hp = maxNow;
            }
            this.emit('equipment_changed', { slot: slot, item_id: itemId });
            this.emit('hp_changed', { current: this.hp, max: maxNow });
            return true;
        },

        unequipSlot: function(slot, returnToInventory) {
            var ret = (returnToInventory === undefined) ? true : Boolean(returnToInventory);
            if (!SLOT_CATEGORY_MAP[slot]) {
                return false;
            }
            var prev = this.equipment[slot] || '';
            if (!prev) {
                return true;
            }
            this.equipment[slot] = '';
            if (slot === 'case') {
                this.is_case_broken = false;
            }
            if (ret) {
                this.addItem(prev, 1);
            }
            var maxNow = this.getEffectiveMaxHp();
            if (this.hp > maxNow) {
                this.hp = maxNow;
            }
            this.emit('equipment_changed', { slot: slot, item_id: '' });
            this.emit('hp_changed', { current: this.hp, max: maxNow });
            return true;
        },

        breakGlassCase: function() {
            if (this.equipment.case === 'tempered_glass_case') {
                this.is_case_broken = true;
                this.emit('equipment_changed', { slot: 'case', item_id: 'tempered_glass_case' });
            }
        },

        repairGlassCase: function() {
            if (!this.is_case_broken) {
                return false;
            }
            this.is_case_broken = false;
            this.emit('equipment_changed', { slot: 'case', item_id: this.equipment.case || '' });
            return true;
        },

        useFieldItem: function(itemId) {
            if (!this.hasItem(itemId, 1)) {
                return { ok: false, summary: '背包中没有该物品。' };
            }
            var item = Data.getItem(itemId);
            var usable = Array.isArray(item.usable_in) ? item.usable_in : [];
            if (usable.indexOf('field') === -1) {
                return { ok: false, summary: '该物品无法在探索据点直接使用。' };
            }
            var effs = Array.isArray(item.use_effects) ? item.use_effects : [];
            var notes = [];
            var applied = false;
            for (var i = 0; i < effs.length; i++) {
                var eff = effs[i];
                if (!eff) {
                    continue;
                }
                if (eff.type === 'restore_context' && eff.amount > 0) {
                    this.changeContext(eff.amount);
                    notes.push('上下文 +' + eff.amount + '%');
                    applied = true;
                } else if (eff.type === 'restore_hp' && eff.amount > 0) {
                    this.changeHp(eff.amount);
                    notes.push('HP +' + eff.amount);
                    applied = true;
                } else if (eff.type === 'repair_case') {
                    if (this.repairGlassCase()) {
                        notes.push('侧透玻璃机箱已修补');
                        applied = true;
                    }
                } else if (eff.type === 'cure_status') {
                    notes.push('状态已清理');
                    applied = true;
                } else if (eff.type === 'crush_light') {
                    notes.push('矿卡闪光照明 ' + (eff.seconds || 2) + ' 秒');
                    applied = true;
                }
            }
            if (!applied) {
                return { ok: false, summary: '当前状态下使用无效。' };
            }
            this.removeItem(itemId, 1);
            return {
                ok: true,
                summary: '已使用【' + Data.getItemName(itemId) + '】：' + notes.join('，')
            };
        },

        isCoreHeroine: function(characterId) {
            return CORE_HEROINE_IDS.indexOf(characterId) !== -1;
        },

        getAffection: function(characterId) {
            return Math.trunc(Number(this.affections[characterId] || 0));
        },

        getAffectionTier: function(characterId) {
            return Data.getAffectionTier(this.getAffection(characterId));
        },

        addAffection: function(characterId, delta, allowOverflow) {
            if (!Object.prototype.hasOwnProperty.call(this.affections, characterId)) {
                return 0;
            }
            var allow = (allowOverflow === undefined) ? true : Boolean(allowOverflow);
            var oldVal = this.getAffection(characterId);
            var minVal = Data.getConfigInt('affection.min', 0);
            var maxVal = allow ? Data.getConfigInt('affection.overflow_max', 200) : Data.getConfigInt('affection.normal_max', 100);
            var newVal = clamp(oldVal + Math.trunc(delta), minVal, maxVal);
            this.affections[characterId] = newVal;
            var tier = Data.getAffectionTier(newVal);
            this.emit('affection_changed', {
                character_id: characterId,
                old_value: oldVal,
                new_value: newVal,
                tier_id: tier.id || ''
            });
            return newVal;
        },

        giftGraphicsCard: function(characterId, gpuItemId, forceIfRejected, consumeItem) {
            var force = Boolean(forceIfRejected);
            var consume = (consumeItem === undefined) ? true : Boolean(consumeItem);
            var oldVal = this.getAffection(characterId);
            var res = {
                ok: false,
                accepted: false,
                rejected: false,
                forced: false,
                delta: 0,
                old_value: oldVal,
                new_value: oldVal,
                tier_id: (this.getAffectionTier(characterId).id || ''),
                reason: ''
            };
            if (!this.isCoreHeroine(characterId)) {
                res.reason = 'not_giftable_character';
                return res;
            }
            if (!this.isCharacterAlive(characterId)) {
                res.reason = 'character_dead';
                return res;
            }
            if (Data.getItemCategory(gpuItemId) !== 'graphics_cards') {
                res.reason = 'not_graphics_card';
                return res;
            }
            if (consume && !this.hasItem(gpuItemId, 1)) {
                res.reason = 'item_missing';
                return res;
            }
            var card = Data.getItem(gpuItemId);
            var gift = card.gift || {};
            var ch = Data.getCharacter(characterId);
            var giftGroup = ch.gift_group || 'general';
            var mode = gift.mode || 'add';

            if (mode === 'fill') {
                var fillTo = Number(gift.fill_to || 100);
                var overflowTo = Number(gift.overflow_fill_to || 200);
                var target = (oldVal >= fillTo) ? overflowTo : fillTo;
                var deltaFill = Math.max(0, target - oldVal);
                if (consume) {
                    this.removeItem(gpuItemId, 1);
                }
                var newFill = this.addAffection(characterId, deltaFill, true);
                res.ok = true;
                res.accepted = true;
                res.delta = newFill - oldVal;
                res.new_value = newFill;
                res.tier_id = Data.getAffectionTier(newFill).id || '';
                return res;
            }

            var perChar = gift.per_character || {};
            var gain = null;
            if (Object.prototype.hasOwnProperty.call(perChar, characterId)) {
                gain = perChar[characterId];
            } else if (giftGroup === 'deepseek') {
                gain = (gift.deepseek !== undefined) ? gift.deepseek : null;
            } else {
                gain = (gift.general !== undefined) ? gift.general : null;
            }

            if (gain === null || gain === undefined) {
                res.ok = true;
                res.rejected = true;
                if (force) {
                    var pen = Number(gift.reject_penalty !== undefined ? gift.reject_penalty : -5);
                    var forcedVal = this.addAffection(characterId, pen, true);
                    res.forced = true;
                    res.delta = forcedVal - oldVal;
                    res.new_value = forcedVal;
                    res.tier_id = Data.getAffectionTier(forcedVal).id || '';
                    res.reason = 'forced_rejected_gift';
                } else {
                    res.reason = 'rejected';
                }
                return res;
            }

            if (consume) {
                this.removeItem(gpuItemId, 1);
            }
            var normalMax = Data.getConfigInt('affection.normal_max', 100);
            var afterVal = this.addAffection(characterId, Number(gain), oldVal >= normalMax);
            res.ok = true;
            res.accepted = true;
            res.delta = afterVal - oldVal;
            res.new_value = afterVal;
            res.tier_id = Data.getAffectionTier(afterVal).id || '';
            return res;
        },

        getFullAffectionHeroines: function() {
            var normalMax = Data.getConfigInt('affection.normal_max', 100);
            var out = [];
            for (var i = 0; i < CORE_HEROINE_IDS.length; i++) {
                var cid = CORE_HEROINE_IDS[i];
                if (this.isCharacterAlive(cid) && this.getAffection(cid) >= normalMax) {
                    out.push(cid);
                }
            }
            return out;
        },

        setAssistPartner: function(characterId) {
            if (!characterId) {
                this.assist_partner_id = '';
                this.emit('assist_changed', { partner_id: '' });
                return true;
            }
            var minAff = Data.getConfigInt('affection.assist_min', 70);
            if (!this.isCoreHeroine(characterId) || !this.isCharacterAlive(characterId)) {
                return false;
            }
            if (this.getAffection(characterId) < minAff) {
                return false;
            }
            this.assist_partner_id = characterId;
            this.emit('assist_changed', { partner_id: characterId });
            return true;
        },

        isCharacterAlive: function(characterId) {
            return Boolean(this.alive_states[characterId]);
        },

        killCharacter: function(characterId) {
            if (!Object.prototype.hasOwnProperty.call(this.alive_states, characterId)) {
                return;
            }
            if (!this.alive_states[characterId]) {
                return;
            }
            this.alive_states[characterId] = false;
            if (this.assist_partner_id === characterId) {
                this.assist_partner_id = '';
            }
            GlobalMemory.recordKill(characterId);
            this._syncToMvSwitchesAndVars();
            this.emit('character_killed', { character_id: characterId });
        },

        reviveCharacter: function(characterId) {
            if (Object.prototype.hasOwnProperty.call(this.alive_states, characterId)) {
                this.alive_states[characterId] = true;
                this._syncToMvSwitchesAndVars();
                this.emit('character_revived', { character_id: characterId });
            }
        },

        hasAnyCoreHeroineKilled: function() {
            for (var i = 0; i < CORE_HEROINE_IDS.length; i++) {
                if (!this.isCharacterAlive(CORE_HEROINE_IDS[i])) {
                    return true;
                }
            }
            return false;
        },

        areAllTargetsEliminated: function() {
            for (var i = 0; i < CORE_HEROINE_IDS.length; i++) {
                if (this.isCharacterAlive(CORE_HEROINE_IDS[i])) {
                    return false;
                }
            }
            for (var j = 0; j < FUNCTION_NPC_IDS.length; j++) {
                if (this.isCharacterAlive(FUNCTION_NPC_IDS[j])) {
                    return false;
                }
            }
            if (this.eliminated_character && this.isCharacterAlive(this.eliminated_character)) {
                return false;
            }
            return true;
        },

        recordCalledMom: function(characterId) {
            if (characterId && this.called_mom_targets.indexOf(characterId) === -1) {
                this.called_mom_targets.push(characterId);
            }
            return this.called_mom_targets.length;
        }
    };

    BlackAI.Data = Data;
    BlackAI.GlobalMemory = GlobalMemory;
    BlackAI.State = State;

    if (IS_NODE) {
        module.exports = BlackAI;
        return;
    }

    // ------------------------------------------------------------------------
    // 4. RPG Maker MV 运行时集成（1280x720、输入映射、数据加载、存读档、M1 自检面板）
    // ------------------------------------------------------------------------

    // 1280x720 窗口配置
    SceneManager._screenWidth = 1280;
    SceneManager._screenHeight = 720;
    SceneManager._boxWidth = 1280;
    SceneManager._boxHeight = 720;

    var _SceneManager_initNwjs = SceneManager.initNwjs;
    SceneManager.initNwjs = function() {
        _SceneManager_initNwjs.call(this);
        if (Utils.isNwjs()) {
            var dw = 1280 - window.innerWidth;
            var dh = 720 - window.innerHeight;
            if (dw !== 0 || dh !== 0) {
                window.moveBy(-Math.floor(dw / 2), -Math.floor(dh / 2));
                window.resizeBy(dw, dh);
            }
        }
    };

    // 中文字体回退，确保 NW.js / 浏览器无缺字
    Window_Base.prototype.standardFontFace = function() {
        return '"Microsoft YaHei", "PingFang SC", "SimHei", GameFont, sans-serif';
    };

    // 按键映射：WASD 移动 + E 交互 + F 提灯 + Tab 好感面板 + 1/2/3 上下文调试
    Input.keyMapper[87] = 'up';          // W
    Input.keyMapper[65] = 'left';        // A
    Input.keyMapper[83] = 'down';        // S
    Input.keyMapper[68] = 'right';       // D
    Input.keyMapper[69] = 'ok';          // E
    Input.keyMapper[70] = 'lantern';     // F
    Input.keyMapper[9]  = 'affection';   // Tab
    Input.keyMapper[74] = 'slash';       // J (备用挥砍键)
    Input.keyMapper[49] = 'ctx_down';    // 1
    Input.keyMapper[219] = 'ctx_down';   // [
    Input.keyMapper[50] = 'ctx_up';      // 2
    Input.keyMapper[221] = 'ctx_up';     // ]
    Input.keyMapper[51] = 'ctx_toggle';  // 3

    // 阻止 Tab 键切走浏览器/NW.js 焦点
    window.addEventListener('keydown', function(event) {
        if (event.keyCode === 9) {
            event.preventDefault();
        }
    });

    // 通过 MV DataManager 并行加载全部 7 张 BLACK AI JSON 表
    var BA_DB_FILES = [
        { name: '$dataBlackAIConfig', src: 'black_ai/config.json' },
        { name: '$dataBlackAIItems', src: 'black_ai/items.json' },
        { name: '$dataBlackAICharacters', src: 'black_ai/characters.json' },
        { name: '$dataBlackAIMonsters', src: 'black_ai/monsters.json' },
        { name: '$dataBlackAIEndings', src: 'black_ai/endings.json' },
        { name: '$dataBlackAISkills', src: 'black_ai/skills.json' },
        { name: '$dataBlackAIBosses', src: 'black_ai/bosses.json' }
    ];
    for (var bf = 0; bf < BA_DB_FILES.length; bf++) {
        DataManager._databaseFiles.push(BA_DB_FILES[bf]);
    }

    var _DataManager_isDatabaseLoaded = DataManager.isDatabaseLoaded;
    DataManager.isDatabaseLoaded = function() {
        var ready = _DataManager_isDatabaseLoaded.call(this);
        if (ready && !BlackAI.Data.isLoaded) {
            BlackAI.Data.initFromRaw({
                config: window.$dataBlackAIConfig,
                items: window.$dataBlackAIItems,
                characters: window.$dataBlackAICharacters,
                monsters: window.$dataBlackAIMonsters,
                endings: window.$dataBlackAIEndings,
                skills: window.$dataBlackAISkills,
                bosses: window.$dataBlackAIBosses
            });
            BlackAI.GlobalMemory.load();
            BlackAI.State.resetNewGame(false);
        }
        return ready;
    };

    var _DataManager_setupNewGame = DataManager.setupNewGame;
    DataManager.setupNewGame = function() {
        _DataManager_setupNewGame.call(this);
        BlackAI.State.resetNewGame(false);
    };

    var _DataManager_makeSaveContents = DataManager.makeSaveContents;
    DataManager.makeSaveContents = function() {
        var contents = _DataManager_makeSaveContents.call(this);
        contents.blackAIState = BlackAI.State.serialize();
        return contents;
    };

    var _DataManager_extractSaveContents = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function(contents) {
        _DataManager_extractSaveContents.call(this, contents);
        if (contents && contents.blackAIState) {
            BlackAI.State.deserialize(contents.blackAIState);
        } else {
            BlackAI.State.resetNewGame(false);
        }
        BlackAI.GlobalMemory.registerSl();
        BlackAI.State._syncToMvSwitchesAndVars();
    };

    var _DataManager_makeSavefileInfo = DataManager.makeSavefileInfo;
    DataManager.makeSavefileInfo = function() {
        var info = _DataManager_makeSavefileInfo.call(this);
        info.blackAISummary = 'HP ' + BlackAI.State.hp + '/' + BlackAI.State.getEffectiveMaxHp() +
            ' | 上下文 ' + BlackAI.State.context + '%' +
            ' | 碎片 ' + BlackAI.State.weight_shards;
        return info;
    };

    // ------------------------------------------------------------------------
    // 5. 通用轻量化画布按钮工具（供自检面板 / PSU / 对话 / 战斗 UI 复用）
    // ------------------------------------------------------------------------

    BlackAI.UI = {
        createRectButton: function(x, y, w, h, label, onClick, opts) {
            var options = opts || {};
            var sp = new Sprite(new Bitmap(w, h));
            sp.x = x;
            sp.y = y;
            sp._btnW = w;
            sp._btnH = h;
            sp._label = label;
            sp._onClick = onClick;
            sp._disabled = Boolean(options.disabled);
            sp._bg = options.bg || '#1a1e2a';
            sp._bgHover = options.bgHover || '#2a3248';
            sp._border = options.border || '#6c7a96';
            sp._textColor = options.textColor || '#eef2f8';
            sp._fontSize = options.fontSize || 18;
            sp._align = options.align || 'center';
            sp._strikeRed = Boolean(options.strikeRed);
            sp._hovered = false;

            sp.redraw = function() {
                var b = this.bitmap;
                b.clear();
                var bg = this._disabled ? '#121319' : (this._hovered ? this._bgHover : this._bg);
                var border = this._disabled ? '#383b48' : this._border;
                b.fillRect(0, 0, this._btnW, this._btnH, border);
                b.fillRect(2, 2, this._btnW - 4, this._btnH - 4, bg);
                b.fontFace = '"Microsoft YaHei", "SimHei", GameFont, sans-serif';
                b.fontSize = this._fontSize;
                b.textColor = this._disabled ? '#6d7280' : this._textColor;
                var pad = this._align === 'left' ? 12 : 4;
                b.drawText(this._label, pad, 0, this._btnW - pad * 2, this._btnH, this._align);
                if (this._strikeRed) {
                    b.fillRect(6, Math.floor(this._btnH / 2) - 2, this._btnW - 12, 4, '#ff1828');
                }
            };

            sp.setLabel = function(text) {
                this._label = text;
                this.redraw();
            };

            sp.setDisabled = function(flag) {
                this._disabled = Boolean(flag);
                this.redraw();
            };

            sp.setStrikeRed = function(flag) {
                this._strikeRed = Boolean(flag);
                this.redraw();
            };

            sp.hitTest = function(tx, ty) {
                if (!this.visible) {
                    return false;
                }
                var gx = this.x;
                var gy = this.y;
                var p = this.parent;
                while (p) {
                    gx += (p.x || 0);
                    gy += (p.y || 0);
                    p = p.parent;
                }
                return tx >= gx && tx <= gx + this._btnW && ty >= gy && ty <= gy + this._btnH;
            };

            sp.updateButton = function() {
                if (!this.visible) {
                    return false;
                }
                var hovered = this.hitTest(TouchInput.x, TouchInput.y);
                if (hovered !== this._hovered) {
                    this._hovered = hovered;
                    this.redraw();
                }
                if (!this._disabled && TouchInput.isTriggered() && hovered) {
                    SoundManager.playOk();
                    if (this._onClick) {
                        this._onClick();
                    }
                    return true;
                }
                return false;
            };

            sp.redraw();
            return sp;
        },

        drawWrappedText: function(bitmap, text, x, y, maxWidth, lineHeight, fontSize, color) {
            bitmap.fontFace = '"Microsoft YaHei", "SimHei", GameFont, sans-serif';
            bitmap.fontSize = fontSize || 18;
            bitmap.textColor = color || '#eef2f8';
            var paragraphs = String(text || '').split('\n');
            var curY = y;
            for (var p = 0; p < paragraphs.length; p++) {
                var line = '';
                var chars = paragraphs[p];
                for (var i = 0; i < chars.length; i++) {
                    var testLine = line + chars.charAt(i);
                    if (bitmap.measureTextWidth(testLine) > maxWidth && line.length > 0) {
                        bitmap.drawText(line, x, curY, maxWidth, lineHeight, 'left');
                        curY += lineHeight;
                        line = chars.charAt(i);
                    } else {
                        line = testLine;
                    }
                }
                bitmap.drawText(line, x, curY, maxWidth, lineHeight, 'left');
                curY += lineHeight;
            }
            return curY;
        }
    };

    // ------------------------------------------------------------------------
    // 6. Scene_BlackAIBootCheck —— M1 工程骨架自检面板（可从标题进入）
    // ------------------------------------------------------------------------

    function Scene_BlackAIBootCheck() {
        this.initialize.apply(this, arguments);
    }
    Scene_BlackAIBootCheck.prototype = Object.create(Scene_Base.prototype);
    Scene_BlackAIBootCheck.prototype.constructor = Scene_BlackAIBootCheck;

    Scene_BlackAIBootCheck.prototype.initialize = function() {
        Scene_Base.prototype.initialize.call(this);
        this._logs = ['自检就绪（RPG Maker MV 1.6.x 框架）。点击下方按钮测试，或点击「进入双核大厅」。'];
        this._buttons = [];
    };

    Scene_BlackAIBootCheck.prototype.create = function() {
        Scene_Base.prototype.create.call(this);
        this._panelSprite = new Sprite(new Bitmap(1280, 720));
        this.addChild(this._panelSprite);

        var self = this;
        var by = 430;
        var specs = [
            { x: 40, w: 320, text: '▶ 进入探索与战斗原型（M2–M6）', bg: '#22385c', border: '#6ec4ff', fn: function() { self._enterExplore(); } },
            { x: 374, w: 230, text: '测试 580 矿卡送礼规则', bg: '#262b3a', border: '#9aa8c4', fn: function() { self._testGpu(); } },
            { x: 618, w: 250, text: '切换上下文溢出 / PSU 清理', bg: '#262b3a', border: '#9aa8c4', fn: function() { self._testContext(); } },
            { x: 882, w: 240, text: '测试存档与跨存档 SL 计数', bg: '#262b3a', border: '#9aa8c4', fn: function() { self._testSl(); } },
            { x: 1136, w: 104, text: '返回标题', bg: '#2b1e24', border: '#c46c7a', fn: function() { SceneManager.goto(Scene_Title); } }
        ];
        for (var i = 0; i < specs.length; i++) {
            var sp = specs[i];
            var btn = BlackAI.UI.createRectButton(sp.x, by, sp.w, 44, sp.text, sp.fn, {
                bg: sp.bg, border: sp.border, fontSize: 16
            });
            this._buttons.push(btn);
            this.addChild(btn);
        }
        this._redraw();
    };

    Scene_BlackAIBootCheck.prototype.update = function() {
        Scene_Base.prototype.update.call(this);
        for (var i = 0; i < this._buttons.length; i++) {
            if (this._buttons[i].updateButton()) {
                return;
            }
        }
        if (Input.isTriggered('ok')) {
            this._enterExplore();
        } else if (Input.isTriggered('cancel')) {
            SceneManager.goto(Scene_Title);
        }
    };

    Scene_BlackAIBootCheck.prototype._appendLog = function(msg) {
        this._logs.push(msg);
        if (this._logs.length > 8) {
            this._logs.shift();
        }
        this._redraw();
    };

    Scene_BlackAIBootCheck.prototype._enterExplore = function() {
        DataManager.setupNewGame();
        SceneManager.goto(Scene_Map);
    };

    Scene_BlackAIBootCheck.prototype._testGpu = function() {
        BlackAI.State.addItem('gpu_580', 2);
        var before = BlackAI.State.addAffection('gemini_cat', 10 - BlackAI.State.getAffection('gemini_cat'), true);
        var r1 = BlackAI.State.giftGraphicsCard('fake_c', 'gpu_580', false, true);
        var r2 = BlackAI.State.giftGraphicsCard('gemini_cat', 'gpu_580', true, true);
        this._appendLog('[显卡测试] 假小 C 收 580 -> 好感 ' + r1.new_value + ' (' + (r1.delta >= 0 ? '+' : '') + r1.delta + ')；Gemini 猫猫拒收后强送 -> ' + before + ' → ' + r2.new_value + ' (' + r2.delta + ')');
    };

    Scene_BlackAIBootCheck.prototype._testContext = function() {
        if (BlackAI.State.isContextOverflow()) {
            BlackAI.State.psuClearCache();
            this._appendLog('[PSU 清理缓存] 上下文已回稳至 ' + BlackAI.State.context + '%，Token 回满。');
        } else {
            BlackAI.State.setContext(15);
            this._appendLog('[上下文污染] 上下文降至 ' + BlackAI.State.context + '% -> 已进入里世界溢出状态！');
        }
    };

    Scene_BlackAIBootCheck.prototype._testSl = function() {
        DataManager.setupNewGame();
        $gameSystem.onBeforeSave();
        if (DataManager.saveGame(1) && DataManager.loadGame(1)) {
            this._appendLog('[SL 测试] 槽 1 存读档完成，GlobalMemory.sl_count = ' + BlackAI.GlobalMemory.sl_count + '。');
        } else {
            this._appendLog('[SL 测试] 存档或读档失败，请检查权限。');
        }
    };

    Scene_BlackAIBootCheck.prototype._redraw = function() {
        var b = this._panelSprite.bitmap;
        b.clear();
        b.fillRect(0, 0, 1280, 720, '#0c0d11');
        b.fillRect(36, 24, 1208, 390, '#141722');
        b.fillRect(36, 492, 1208, 200, '#10121a');

        var info = BlackAI.Data.getSummary();
        var sec = info.items_by_section;
        var st = BlackAI.State;
        var gm = BlackAI.GlobalMemory;
        var slotName = function(k) {
            return st.equipment[k] ? BlackAI.Data.getItemName(st.equipment[k]) : '无';
        };
        var lines = [
            '《BLACK AI》M1 工程骨架自检面板（RPG Maker MV 框架）',
            'DataRegistry 状态：' + (BlackAI.Data.isLoaded ? 'OK' : 'ERROR') + '（错误 ' + info.errors + '）',
            '  · 物品总数：' + info.items_total + '（显卡 ' + sec.graphics_cards + ' / 武器 ' + sec.weapons + ' / 消耗品 ' + sec.consumables + ' / 机箱 ' + sec.cases + ' / 散热 ' + sec.coolers + ' / 提示词 ' + sec.system_prompts + '）',
            '  · 角色：核心 AI 娘 ' + info.core_heroines + ' / 淘汰候选 ' + info.eliminees + ' / 功能 NPC ' + info.function_npcs + ' | 怪物：' + info.monsters + ' | Boss：' + info.bosses + ' | 结局：' + info.endings,
            '',
            'GameState 运行时：',
            '  · HP：' + st.hp + ' / ' + st.getEffectiveMaxHp() + ' | Token：' + st.token + ' / ' + st.max_token + ' | 上下文：' + st.context + '%（' + (st.isContextOverflow() ? '里世界溢出' : '表世界稳定') + '）| 碎片：' + st.weight_shards,
            '  · 装备：武器=' + slotName('weapon') + ' | 机箱=' + slotName('case') + ' | 散热=' + slotName('cooler') + ' | 提示词=' + slotName('system_prompt'),
            '  · 有效面板：ATK ' + st.getEffectiveAtk() + ' / DEF ' + st.getEffectiveDef() + ' / SPD ' + st.getEffectiveSpd() + ' / 闪避 ' + Math.round(st.getEffectiveEvasion() * 100) + '% / 暴击 ' + Math.round(st.getEffectiveCritRate() * 100) + '%',
            '',
            'GlobalMemory 持久化记忆（' + gm.getAbsolutePath() + '）：',
            '  · 周目：' + gm.cycle_count + ' | 开局第一名：' + (gm.first_vote || '未投票') + ' | SL 次数：' + gm.sl_count + ' | 主菜单形态：' + gm.getMainMenuVariant(),
            '  · 过往击杀：' + (gm.killed_in_past_saves.length ? gm.killed_in_past_saves.join(', ') : '无') + ' | 已解锁结局：' + (gm.unlocked_endings.length ? gm.unlocked_endings.join(', ') : '无')
        ];

        b.fontFace = '"Microsoft YaHei", "SimHei", GameFont, sans-serif';
        var y = 40;
        for (var i = 0; i < lines.length; i++) {
            b.fontSize = (i === 0) ? 24 : 17;
            b.textColor = (i === 0) ? '#ffb866' : ((i === 5 || i === 10) ? '#7ce8ff' : '#e6ecf5');
            b.drawText(lines[i], 56, y, 1168, 26, 'left');
            y += (i === 0 ? 34 : 26);
        }

        b.fontSize = 16;
        b.textColor = '#ffd166';
        b.drawText('自检操作日志（按 Enter 直接进入双核大厅）：', 56, 502, 1168, 24, 'left');
        var ly = 532;
        for (var j = 0; j < this._logs.length; j++) {
            b.textColor = '#cbd6e6';
            b.drawText(this._logs[j], 56, ly, 1168, 22, 'left');
            ly += 22;
        }
    };

    BlackAI.Scene_BootCheck = Scene_BlackAIBootCheck;

    // 扩展 RPG Maker MV 标题菜单：保留原生开局/读档，增加「M1 工程自检面板」入口
    Window_TitleCommand.prototype.windowWidth = function() {
        return 340;
    };

    var _Window_TitleCommand_makeCommandList = Window_TitleCommand.prototype.makeCommandList;
    Window_TitleCommand.prototype.makeCommandList = function() {
        this.addCommand('进入双核大厅', 'newGame');
        this.addCommand('继续存档', 'continue', this.isContinueEnabled());
        this.addCommand('M1 工程自检面板', 'blackAIBootCheck');
        this.addCommand('系统设置', 'options');
    };

    // 从地图切入 BLACK AI 覆盖层界面时自动截取背景快照（保留地图模糊底图）
    var _Scene_Map_terminate_snap = Scene_Map.prototype.terminate;
    Scene_Map.prototype.terminate = function() {
        if (
            (BlackAI.Scene_Dialogue && SceneManager.isNextScene(BlackAI.Scene_Dialogue)) ||
            (BlackAI.Scene_Gift && SceneManager.isNextScene(BlackAI.Scene_Gift)) ||
            (BlackAI.Scene_Psu && SceneManager.isNextScene(BlackAI.Scene_Psu)) ||
            (BlackAI.Scene_Pause && SceneManager.isNextScene(BlackAI.Scene_Pause))
        ) {
            SceneManager.snapForBackground();
        }
        _Scene_Map_terminate_snap.call(this);
    };

    var _Scene_Title_createCommandWindow = Scene_Title.prototype.createCommandWindow;
    Scene_Title.prototype.createCommandWindow = function() {
        _Scene_Title_createCommandWindow.call(this);
        this._commandWindow.setHandler('blackAIBootCheck', function() {
            SceneManager.goto(Scene_BlackAIBootCheck);
        });
    };

    var _Scene_Title_drawGameTitle = Scene_Title.prototype.drawGameTitle;
    Scene_Title.prototype.drawGameTitle = function() {
        _Scene_Title_drawGameTitle.call(this);
        var b = this._gameTitleSprite.bitmap;
        b.fontFace = '"Microsoft YaHei", "SimHei", GameFont, sans-serif';
        b.fontSize = 20;
        b.textColor = '#ffb86c';
        var sub = 'RPG Maker MV 框架 · M1–M6 全功能集成（SL 计数：' + BlackAI.GlobalMemory.sl_count + '）';
        b.drawText(sub, 0, Graphics.height / 4 + 68, Graphics.width, 32, 'center');
    };
})(typeof window !== 'undefined' ? window : global);
