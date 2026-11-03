// scripts/schoolExplorer.js
/**
 * Модуль «Школьный обзор» (School Explorer) для раздела «Мои классы» (/teacher/study-process/journal/my).
 * Объединяет 4 инструмента в верхней панели:
 *  1. 👥 Поиск и экспорт своих учеников (локальный кэш, отчет изменений контингента, выгрузка в Excel)
 *  2. 🏫 Данные всех учеников школы (дозированная подгрузка классов по запросу через split_chat)
 *  3. 📅 Расписание учителей школы (просмотр и печать сетки расписания любого учителя)
 *  4. 📅 Расписание классов школы (просмотр и печать сетки расписания любого класса)
 */

window.initSchoolExplorer = function () {
    const TARGET_PATH = '/teacher/study-process/journal/my';
    const NDO_KEYS = ['ндо', 'на дому', 'индив'];
    const DAYS_RU = ["", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
    const DEFAULT_BELLS = window.MESH_DEFAULT_BELLS || `1 урок 08:30-09:10\n2 урок 09:20-10:00\n3 урок 10:10-10:50\n4 урок 11:05-11:45\n5 урок 12:00-12:40\n6 урок 13:00-13:40\n7 урок 14:00-14:40\n8 урок 14:55-15:35\n9 урок 15:50-16:30\n10 урок 16:40-17:20\n11 урок 17:30-18:10\n12 урок 18:20-19:00`;
    const PE_GROUPS = { 1: 'Основная (1)', 2: 'Подгот. (2)', 3: 'Спец. А (3)', 4: 'Спец. Б (4)' };
    const BADGE_STYLE = 'background:rgba(255,255,255,0.22);color:#fff;border:none;padding:4px 10px;font-size:12px;';

    const BTN_IDS = {
        ownPupils: 'mesh-export-pupils-btn',
        allPupils: 'mesh-all-pupils-btn',
        teachersSch: 'mesh-check-schedule-teachers-btn',
        classesSch: 'mesh-check-schedule-classes-btn'
    };

    // =========================================================================
    // 1. ОБЩИЕ УТИЛИТЫ, ШАБЛОНЫ И СОСТОЯНИЕ (RAM-КЭШ)
    // =========================================================================
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const pad = n => String(n).padStart(2, '0');
    const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const fmtRu = d => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
    const timeToM = s => { if (!s) return null; const [h, m] = s.replace('.', ':').split(':').map(Number); return isNaN(h) || isNaN(m) ? null : h * 60 + m; };

    const toggleVis = (el, show) => {
        if (!el) return;
        el.classList.toggle('mshhlpr-hidden', !show);
        el.style.setProperty('display', show ? 'inline-flex' : 'none', 'important');
    };

    const parseDateObj = raw => {
        if (!raw) return new Date();
        if (Array.isArray(raw) && raw.length >= 3) return new Date(raw[0], raw[1] - 1, raw[2]);
        if (typeof raw === 'string') {
            const p = raw.split(/[-,\/]/).map(Number);
            if (p.length === 3 && p[0] > 1900) return new Date(p[0], p[1] - 1, p[2]);
        }
        return new Date(raw);
    };

    const getWeekRange = (baseDate = new Date(), offsetWeeks = 0) => {
        const d = new Date(baseDate);
        if (offsetWeeks) d.setDate(d.getDate() + offsetWeeks * 7);
        const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() || 7) - 1));
        const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
        return { from: fmtDate(mon), to: fmtDate(sun), label: `${fmtRu(mon)} — ${fmtRu(sun)}` };
    };

    function resolveCurrentAid(fallbackAid) {
        if (fallbackAid) return String(fallbackAid);
        const paramAid = new URLSearchParams(location.search).get('academic_year_id');
        if (paramAid) return String(paramAid);
        try {
            const res = performance.getEntriesByType('resource');
            for (let i = res.length - 1; i >= 0; i--) {
                const m = res[i].name.match(/[?&]academic_year_id=(\d+)/);
                if (m) return String(m[1]);
            }
        } catch {}
        return "14";
    }

    const state = {
        token: null, profileId: "", schoolId: null, aid: "14",
        teachers: [], classes: [], rooms: [], buildings: [], parsedBells: [],
        bldMap: new Map(), teacherMap: new Map(), roomMap: new Map(), roomBldMap: new Map(),
        groupCache: new Map(), myGroupIds: new Set(),
        selectedWeek: null, calMonth: new Date(),
        isCatalogLoaded: false, isCatalogLoading: false
    };

    let activeAbort = null;

    /** Создает каркас модального окна с автоотменой активных запросов при закрытии */
    function openBaseModal(title, width, height, headerBg = '') {
        activeAbort?.abort();
        document.querySelectorAll('.mshhlpr-modal-overlay').forEach(el => el.remove());

        const ov = document.createElement('div');
        ov.className = 'mshhlpr-modal-overlay';
        ov.innerHTML = `
            <div class="mshhlpr-modal-content" style="width:${width};max-width:98vw;height:${height};max-height:92vh;display:flex;flex-direction:column;overflow:hidden;">
                <div class="mshhlpr-modal-header" style="flex-shrink:0;padding:12px 20px;${headerBg ? `background:${headerBg}!important;` : ''}">
                    <span style="font-size:15px;">${title}</span>
                    <button class="mshhlpr-modal-close">×</button>
                </div>
                <div class="msh-modal-body-slot" style="flex:1;display:flex;flex-direction:column;overflow:hidden;background:#fff;"></div>
            </div>`;
        document.body.appendChild(ov);

        const close = () => { activeAbort?.abort(); ov.remove(); };
        ov.querySelector('.mshhlpr-modal-close').onclick = close;
        ov.onclick = e => e.target === ov && close();
        return { ov, bodySlot: ov.querySelector('.msh-modal-body-slot'), close };
    }

    /** Универсальный генератор HTML полной карточки ученика */
    function buildFullCardHtml(info, opts = {}) {
        const parentsHtml = (info.parents || []).map(p => `
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:10px;margin-bottom:6px;">
                <div style="font-weight:700;color:#2e7d32;font-size:13px;">👤 ${p.type || 'Представитель'}: ${p.name || 'Имя не указано'}</div>
                <div style="font-size:12px;color:#475569;display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:4px;">
                    <div>📞 ${p.phone_number || '—'}</div><div>📧 ${p.email ? `<a href="mailto:${p.email}" style="color:#2e7d32">${p.email}</a>` : '—'}</div>
                    <div style="grid-column:span 2;color:#64748b;">СНИЛС: ${p.snils || '—'}</div>
                </div>
            </div>`).join('') || '<div style="color:#94a3b8;font-size:12px;">Информация о представителях отсутствует.</div>';

        return `
            <div class="mshhlpr-modal-header" style="padding:16px 20px;flex-direction:column;align-items:flex-start;border-radius:8px;">
                <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
                    <span style="font-size:11px;opacity:.85;text-transform:uppercase;">Карточка ученика</span>
                    ${opts.backBtn ? `<button id="msh-ap-back" style="background:rgba(255,255,255,0.2);border:none;color:#fff;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px;font-weight:600;">⬅ К списку ФИО класса</button>` : ''}
                </div>
                <h2 style="margin:4px 0 0 0;font-size:22px;color:#fff;">${info.fio}</h2>
                <div style="display:flex;gap:8px;margin-top:10px;width:100%;align-items:center;flex-wrap:wrap;">
                    <span class="mshhlpr-badge mshhlpr-badge-green" style="${BADGE_STYLE}">🎓 Класс: ${info.cls}</span>
                    <span class="mshhlpr-badge mshhlpr-badge-green" style="${BADGE_STYLE}">👩‍🏫 Кл. рук: <span id="msh-c-mentor">${info.mentor}</span></span>
                    ${opts.profileLink ? `<a href="${location.origin}/teacher/group-management/student-card/${info.id}" target="_blank" style="margin-left:auto;text-decoration:none;"><button class="mshhlpr-universal-toggle-btn" style="background:#fff!important;color:#2e7d32!important;border:none!important;padding:4px 10px!important;cursor:pointer;font-size:12px!important;">🔗 Профиль в МЭШ</button></a>` : ''}
                </div>
            </div>
            <div style="display:flex;flex-direction:column;padding:14px 0;gap:12px;">
                <div class="mshhlpr-grid-2">
                    <div class="mshhlpr-info-card" style="padding:14px;">
                        <h4 class="mshhlpr-info-title" style="margin-bottom:10px;">Личные данные</h4>
                        <div class="mshhlpr-info-row" style="font-size:13px;">
                            <div class="mshhlpr-info-label">Возраст:</div><div><b>${info.age || '—'}</b></div>
                            <div class="mshhlpr-info-label">Пол:</div><div><b>${info.sex || '—'}</b></div>
                            <div class="mshhlpr-info-label">Дата рожд:</div><div><b>${info.birthDate || '—'}</b></div>
                            <div class="mshhlpr-info-label">СНИЛС:</div><div style="font-family:monospace;">${info.snils || '—'}</div>
                            <div class="mshhlpr-info-label">Телефон:</div><div><b>${info.phone || '—'}</b></div>
                            <div class="mshhlpr-info-label">Email:</div><div><b>${info.email || '—'}</b></div>
                        </div>
                    </div>
                    <div class="mshhlpr-info-card" style="padding:14px;">
                        <h4 class="mshhlpr-info-title" style="margin-bottom:10px;">Школьная информация</h4>
                        <div class="mshhlpr-info-row" style="font-size:13px;">
                            ${info.building ? `<div class="mshhlpr-info-label">Корпус:</div><div><b>${info.building}</b></div>` : ''}
                            <div class="mshhlpr-info-label">Логин МЭШ:</div><div style="font-family:monospace;font-weight:700;color:#2e7d32;">${info.login || '—'}</div>
                            <div class="mshhlpr-info-label">Пропуски:</div><div><b id="msh-c-att">${info.absences ?? '—'}</b></div>
                            <div class="mshhlpr-info-label">Физкультура:</div><div><b>${info.peGroup || '—'}</b></div>
                            <div class="mshhlpr-info-label">ID в МЭШ:</div><div style="font-size:11px;color:#94a3b8;font-family:monospace;">${info.id}</div>
                        </div>
                    </div>
                </div>
                <div><h4 class="mshhlpr-info-title" style="margin-bottom:8px;">Семья / Представители</h4><div>${parentsHtml}</div></div>
                ${opts.statusFooter ? `<div id="msh-c-status" style="font-size:10.5px;color:#94a3b8;text-align:right;">⚡ Данные из кэша. Запрос актуализации...</div>` : ''}
            </div>`;
    }

    // =========================================================================
    // 2. ЕДИНАЯ АВТОРИЗАЦИЯ И ЗАГРУЗКА СПРАВОЧНИКОВ ШКОЛЫ
    // =========================================================================
    async function ensureAuth() {
        const s = await chrome.storage.session.get(['currentBearerToken', 'currentProfileId', 'currentAid']);
        if (!s.currentBearerToken) throw new Error('Сессионный токен не найден. Обновите страницу.');

        if (state.profileId && s.currentProfileId && String(s.currentProfileId) !== String(state.profileId)) {
            state.schoolId = null; state.isCatalogLoaded = false;
            state.classes = []; state.teachers = []; state.rooms = []; state.buildings = [];
            state.bldMap.clear(); state.teacherMap.clear(); state.roomMap.clear(); state.roomBldMap.clear();
            state.groupCache.clear(); state.myGroupIds.clear();
        }

        state.token = s.currentBearerToken;
        state.profileId = s.currentProfileId || state.profileId || "";
        state.aid = resolveCurrentAid(s.currentAid);

        if (state.schoolId && state.profileId) return { token: state.token, pid: state.profileId, aid: state.aid };

        const ctrl = new AbortController(), tid = setTimeout(() => ctrl.abort(), 6000);
        try {
            const r = await fetch("https://authedu.mosreg.ru/api/ej/acl/v1/sessions", {
                method: "POST", signal: ctrl.signal,
                headers: { "accept": "application/json", "content-type": "application/json", "authorization": `Bearer ${state.token}`, "x-mes-subsystem": "teacherweb", "x-mes-hostid": "9", "x-mes-roleid": "9" },
                body: JSON.stringify({ auth_token: state.token })
            });
            if (r.ok) {
                const d = await r.json();
                const t = d.profiles?.find(p => p.type === 'teacher' || p.profile_type === 'teacher') || d.profiles?.[0];
                state.schoolId = t?.school_id || t?.organization_id || d.school_id || null;
                if (!state.profileId) state.profileId = t?.id || "";
            }
        } catch {} finally { clearTimeout(tid); }

        return { token: state.token, pid: state.profileId, aid: state.aid };
    }

    async function apiGet(url, sub = 'teacherweb', extSignal = null, timeoutMs = 7000) {
        await ensureAuth();
        const ctrl = new AbortController(), tid = setTimeout(() => ctrl.abort(), timeoutMs);
        if (extSignal) {
            if (extSignal.aborted) { clearTimeout(tid); throw new DOMException('Aborted', 'AbortError'); }
            extSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
        }
        try {
            const r = await fetch(url, {
                headers: { "authorization": `Bearer ${state.token}`, "profile-id": String(state.profileId), "x-mes-subsystem": sub, "x-mes-hostid": "9", "x-mes-roleid": "9", "aid": state.aid, "accept": "application/json" },
                signal: ctrl.signal
            });
            return r.ok ? await r.json() : null;
        } catch (e) {
            if (extSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
            return null;
        } finally { clearTimeout(tid); }
    }

    /** Загружает и кэширует в RAM справочники школы: звонки, кабинеты, корпуса, классы и учителей */
    async function preloadSchoolCatalogs() {
        await ensureAuth();
        if (state.isCatalogLoaded) return true;
        if (state.isCatalogLoading) {
            while (state.isCatalogLoading) await sleep(80);
            return state.isCatalogLoaded;
        }
        state.isCatalogLoading = true;

        try {
            const bStore = await new Promise(r => chrome.storage.local.get(['activeTeacher', 'profiles', 'globalBellSchedule'], r));
            const act = bStore?.activeTeacher;
            const bText = (act && bStore?.profiles?.[act]?.bellSchedule) || bStore?.globalBellSchedule || DEFAULT_BELLS;
            state.parsedBells = bText.split('\n').map((l, i) => {
                const m = l.match(/(?:(\d+)\s*урок\s*)?(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})/i);
                return m ? { num: m[1] ? +m[1] : (i + 1), start: timeToM(m[2]), end: timeToM(m[3]), timeStr: `${m[2].replace('.', ':')}-${m[3].replace('.', ':')}` } : null;
            }).filter(b => b && b.start !== null).sort((a, b) => a.start - b.start);

            const sq = state.schoolId ? `&school_id=${state.schoolId}` : '';
            const [rList, bList, cList, tPage1, myProf] = await Promise.all([
                apiGet(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/rooms?per_page=300${sq}`, 'teacherweb'),
                apiGet(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/buildings?per_page=100${sq}`, 'teacherweb'),
                apiGet(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/class_units?per_page=300${sq}`, 'teacherweb'),
                apiGet(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/teacher_profiles?per_page=100&page=1${sq}`, 'teacherweb'),
                state.profileId ? apiGet(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/teacher_profiles/${state.profileId}?with_assigned_groups=true&with_replacement_groups=true`, 'teacherweb') : null
            ]);

            state.myGroupIds = new Set([...(myProf?.assigned_group_ids || []), ...(myProf?.replacement_group_ids || [])].map(Number));
            state.rooms = Array.isArray(rList) ? rList : (rList?.rooms || []);
            state.buildings = Array.isArray(bList) ? bList : (bList?.buildings || []);
            state.bldMap.clear(); state.buildings.forEach(b => state.bldMap.set(b.id, b.name));
            state.roomMap.clear(); state.roomBldMap.clear();
            state.rooms.forEach(r => {
                state.roomMap.set(r.id, r.name);
                if (r.building_id && state.bldMap.has(r.building_id)) state.roomBldMap.set(r.id, state.bldMap.get(r.building_id));
            });

            const rawTeachers = [];
            const pushPage = res => {
                const list = Array.isArray(res) ? res : (res?.teacher_profiles || res?.data || []);
                rawTeachers.push(...list);
                return list.length;
            };
            if (pushPage(tPage1) === 100) {
                for (let page = 2; page <= 10; page++) {
                    const res = await apiGet(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/teacher_profiles?per_page=100&page=${page}${sq}`, 'teacherweb');
                    if (pushPage(res) < 100) break;
                }
            }

            state.teacherMap.clear();
            state.teachers = rawTeachers.map(t => {
                const u = t.user || t.person || t;
                const fio = `${u.last_name || ''} ${u.first_name || ''} ${u.middle_name || ''}`.trim() || `Учитель #${t.id}`;
                const bld = (t.buildings?.[0]?.name) || state.bldMap.get(t.building_ids?.[0] || t.building_id) || state.roomBldMap.get(t.room_id) || null;
                state.teacherMap.set(t.id, fio);
                return { id: t.id, fio, buildingName: bld };
            }).filter(t => t.fio.length > 2).sort((a, b) => a.fio.localeCompare(b.fio, 'ru'));

            const rawClasses = Array.isArray(cList) ? cList : (cList?.class_units || cList?.data || []);
            state.classes = rawClasses.map(c => ({
                id: c.id,
                name: (c.name || c.unit_name || `Класс #${c.id}`).trim(),
                buildingName: state.bldMap.get(c.building_id) || null,
                studentCount: c.student_count ?? null,
                mentorName: state.teacherMap.get(c.mentor_ids?.[0] || c.mentor_id) || 'Не назначен'
            })).sort((a, b) => (parseInt(a.name, 10) || 0) - (parseInt(b.name, 10) || 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));

            state.isCatalogLoaded = true;
        } finally { state.isCatalogLoading = false; }
        return true;
    }

    // =========================================================================
    // 3. МОДУЛЬ 1: ПОИСК И ЭКСПОРТ СВОИХ УЧЕНИКОВ
    // =========================================================================
    function openOwnPupilsModal() {
        const { bodySlot } = openBaseModal('👥 Поиск и экспорт своих учеников', '1050px', '90vh');

        bodySlot.innerHTML = `
            <div style="padding:10px 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;flex-direction:column;gap:8px;flex-shrink:0;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                    <div id="msh-cache-text" style="font-size:12.5px;color:#475569;line-height:1.35;">⏳ Загрузка...</div>
                    <div style="display:flex;gap:6px;">
                        <button id="msh-btn-excel" class="mshhlpr-universal-toggle-btn mshhlpr-hidden" style="height:32px;"><span class="mshhlpr-universal-toggle-text">📂 Скачать Excel</span></button>
                        <button id="msh-btn-sync" class="mshhlpr-universal-toggle-btn" style="height:32px;"><span class="mshhlpr-universal-toggle-text">🔄 Собрать / Обновить</span></button>
                        <button id="msh-btn-stop" class="mshhlpr-btn mshhlpr-btn-danger mshhlpr-hidden" style="height:32px;">⏹️ Остановить</button>
                        <button id="msh-btn-del" class="mshhlpr-btn mshhlpr-btn-danger mshhlpr-hidden" style="height:32px;background:#fff!important;color:#dc2626!important;border-color:#fca5a5!important;">🗑️ Удалить базу</button>
                    </div>
                </div>
                <div id="msh-diff-box" class="mshhlpr-hidden" style="background:#fff;border:1px solid #bbf7d0;border-radius:6px;padding:8px 12px;"></div>
                <div id="msh-prog-wrap" class="mshhlpr-hidden" style="flex-direction:column;gap:3px;">
                    <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:600;color:#16a34a;">
                        <span id="msh-prog-txt">Сбор данных...</span><span id="msh-prog-pct">0%</span>
                    </div>
                    <div style="width:100%;height:5px;background:#e2e8f0;border-radius:3px;overflow:hidden;">
                        <div id="msh-prog-bar" style="width:0%;height:100%;background:var(--mshhlpr-primary-gradient);transition:width .2s;"></div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <input type="text" id="msh-srch-inp" placeholder="🔎 Умный поиск (ФИО, класс, телефон, СНИЛС)..." style="flex:1;padding:6px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;outline:none;">
                    <span id="msh-srch-cnt" style="font-size:11.5px;font-weight:700;color:#64748b;white-space:nowrap;">Найдено: 0</span>
                </div>
            </div>
            <div style="flex:1;display:flex;overflow:hidden;background:#f1f5f9;">
                <div id="msh-details-pane" style="flex:1;padding:18px;overflow-y:auto;background:#f8fafc;">
                    <div id="msh-empty-state" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#94a3b8;text-align:center;gap:8px;">
                        <div style="font-size:40px;">🔍</div>
                        <div style="font-size:15px;font-weight:600;color:#64748b;">Выберите ученика</div>
                        <div style="font-size:12px;max-width:320px;">Введите запрос и выберите ученика справа.</div>
                    </div>
                    <div id="msh-card-state" style="display:none;"></div>
                </div>
                <div style="width:320px;border-left:1px solid #e2e8f0;display:flex;flex-direction:column;background:#fff;flex-shrink:0;">
                    <ul id="msh-results-list" style="list-style:none;padding:0;margin:0;overflow-y:auto;flex:1;"></ul>
                </div>
            </div>`;

        const $ = s => bodySlot.querySelector(s);
        const [cacheTxt, diffBox, btnExcel, btnSync, btnStop, btnDel, progWrap, progBar, progTxt, progPct, srchInp, srchCnt, detailsEmpty, detailsCard, resList] = [
            $('#msh-cache-text'), $('#msh-diff-box'), $('#msh-btn-excel'), $('#msh-btn-sync'), $('#msh-btn-stop'), $('#msh-btn-del'),
            $('#msh-prog-wrap'), $('#msh-prog-bar'), $('#msh-prog-txt'), $('#msh-prog-pct'), $('#msh-srch-inp'), $('#msh-srch-cnt'),
            $('#msh-empty-state'), $('#msh-card-state'), $('#msh-results-list')
        ];

        let crawlerAbort = { aborted: false }, flatList = [], selectedId = null, currentPid = null;

        function indexFlatList(groupedData) {
            flatList = [];
            const seen = new Set();
            if (!groupedData) return;
            for (const [cls, list] of Object.entries(groupedData)) {
                list.forEach(s => {
                    const id = s["ID System"] || s.id;
                    if (id && !seen.has(id)) {
                        seen.add(id);
                        flatList.push({
                            ...s, cleanCls: cls,
                            _idx: `${s["ФИО"]} ${cls} ${s["Email"]} ${s["Логин МЭШ"]}`.toLowerCase(),
                            _num: `${s["Телефон"]} ${s["СНИЛС"]}`.replace(/\D/g, '')
                        });
                    }
                });
            }
            flatList.sort((a, b) => (a["ФИО"] || '').localeCompare(b["ФИО"] || '', 'ru'));
        }

        function updateState(mode, data = null) {
            const isSync = mode === 'syncing', hasDb = mode === 'has_db';
            toggleVis(btnSync, !isSync); toggleVis(btnStop, isSync);
            toggleVis(btnExcel, hasDb && !isSync); toggleVis(btnDel, hasDb && !isSync);
            toggleVis(progWrap, isSync);
            srchInp.disabled = !hasDb || isSync;

            if (hasDb && data) {
                indexFlatList(data.data);
                cacheTxt.innerHTML = `<b>База сохранена</b> | Обновлено: <b>${data.date}</b><br>Классов: <b>${Object.keys(data.data).length}</b>, учеников: <b>${flatList.length}</b>`;
                renderResults(srchInp.value);
            } else if (mode === 'no_db') {
                flatList = [];
                cacheTxt.innerHTML = `⚠️ База не сформирована. Нажмите <b>«Собрать / Обновить»</b> для поиска и экспорта.`;
                resList.innerHTML = `<li style="padding:25px;text-align:center;color:#94a3b8;font-size:12px;">База пуста.</li>`;
                detailsEmpty.style.display = 'flex'; detailsCard.style.display = 'none'; srchCnt.textContent = 'Найдено: 0';
            }
        }

        async function checkCache() {
            try {
                currentPid = (await ensureAuth()).pid;
                const kD = `mesh_students_data_${currentPid}`, kT = `mesh_students_date_${currentPid}`;
                chrome.storage.local.get([kD, kT], r => r[kD] ? updateState('has_db', { data: r[kD], date: r[kT] }) : updateState('no_db'));
            } catch { updateState('no_db'); }
        }
        checkCache();

        function renderResults(q = '') {
            const clean = q.trim().toLowerCase(), tokens = clean.split(/\s+/), digits = clean.replace(/\D/g, '');
            const res = !clean ? flatList : flatList.filter(s => tokens.every(t => s._idx.includes(t) || (digits.length >= 3 && s._num.includes(digits))));
            srchCnt.textContent = `Найдено: ${res.length}`;
            resList.innerHTML = '';
            if (!res.length) { resList.innerHTML = '<li style="padding:20px;text-align:center;color:#94a3b8;font-size:12px;">Ничего не найдено</li>'; return; }

            res.slice(0, 70).forEach(st => {
                const id = st["ID System"] || st.id, li = document.createElement('li');
                li.style.cssText = `padding:8px 12px;border-bottom:1px solid #f1f5f9;cursor:pointer;background:${selectedId === id ? '#e0f2fe' : '#fff'};`;
                li.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;"><b style="font-size:13px;color:#1e293b;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;">${st["ФИО"]}</b><span style="font-size:11px;color:#2e7d32;font-weight:700;border:1px solid #dcfce7;padding:1px 5px;border-radius:3px;">${st.cleanCls}</span></div>
                                <div style="font-size:11px;color:#64748b;margin-top:2px;">ДР: ${st["Дата рождения"] || '—'} ${st["Телефон"] !== '—' ? '• 📞 ' + st["Телефон"] : ''}</div>`;
                li.onclick = () => { selectedId = id; renderResults(srchInp.value); renderOwnStudentCard(st); };
                resList.appendChild(li);
            });
        }
        srchInp.oninput = () => renderResults(srchInp.value);

        async function renderOwnStudentCard(st) {
            detailsEmpty.style.display = 'none'; detailsCard.style.display = 'block';
            const id = st["ID System"] || st.id;

            detailsCard.innerHTML = buildFullCardHtml({
                id, fio: st["ФИО"], cls: st.cleanCls || st["Класс"] || '—', mentor: 'загрузка...',
                age: st["Возраст"], sex: st["Пол"] === 'М' ? '👦 Муж' : (st["Пол"] === 'Ж' ? '👧 Жен' : '—'),
                birthDate: st["Дата рождения"], snils: st["СНИЛС"], phone: st["Телефон"], email: st["Email"],
                login: st["Логин МЭШ"], absences: '⏳ ...', peGroup: st["Группа здоровья"], parents: st.rawParents
            }, { profileLink: true, statusFooter: true });

            activeAbort?.abort();
            activeAbort = new AbortController();
            const signal = activeAbort.signal;

            const live = await apiGet(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/student_profiles/${id}?with_user_info=true&with_attendances_count=true`, 'teacherweb', signal).catch(() => null);
            if (signal.aborted) return;

            const mEl = detailsCard.querySelector('#msh-c-mentor'), aEl = detailsCard.querySelector('#msh-c-att'), sEl = detailsCard.querySelector('#msh-c-status');
            if (live) {
                mEl.textContent = live.mentors?.[0]?.name || 'Не назначен';
                const att = live.non_attendance || 0;
                aEl.textContent = att; aEl.style.color = att > 30 ? '#dc2626' : '#1e293b';
                sEl.innerHTML = '✅ Данные сверены с сервером';
            } else {
                mEl.textContent = '—'; aEl.textContent = '—';
                sEl.textContent = '⚡ Показаны локальные данные';
            }
        }

        btnExcel.onclick = () => {
            if (!currentPid) return alert('Ошибка идентификации профиля');
            chrome.storage.local.get(`mesh_students_data_${currentPid}`, d => d[`mesh_students_data_${currentPid}`] ? exportToExcel(d[`mesh_students_data_${currentPid}`]) : alert('База пуста'));
        };

        btnDel.onclick = () => {
            if (!currentPid || !confirm('Удалить сохранённую базу с этого компьютера?')) return;
            chrome.storage.local.remove([`mesh_students_data_${currentPid}`, `mesh_students_date_${currentPid}`], () => { toggleVis(diffBox, false); updateState('no_db'); });
        };

        btnSync.onclick = async () => {
            if (typeof XLSX === 'undefined') return alert('Ошибка: библиотека XLSX не найдена.');
            if (!currentPid) {
                try { currentPid = (await ensureAuth()).pid; } catch { return alert('Не удалось получить токен. Обновите страницу.'); }
            }
            const kD = `mesh_students_data_${currentPid}`, kT = `mesh_students_date_${currentPid}`;
            const oldData = await new Promise(r => chrome.storage.local.get(kD, d => r(d[kD] || null)));

            crawlerAbort.aborted = false;
            updateState('syncing');
            btnStop.onclick = () => { crawlerAbort.aborted = true; progTxt.textContent = 'Остановка...'; };

            try {
                const finalData = await runOwnPupilsCrawler(crawlerAbort, (done, tot, txt) => {
                    const pct = Math.round((done / Math.max(1, tot)) * 100);
                    progBar.style.width = `${pct}%`; progPct.textContent = `${pct}%`; progTxt.textContent = txt;
                });
                if (crawlerAbort.aborted) { alert('Сбор остановлен. Данные сохранены без изменений.'); return checkCache(); }
                if (finalData) {
                    const date = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                    chrome.storage.local.set({ [kD]: finalData, [kT]: date }, () => {
                        updateState('has_db', { data: finalData, date });
                        renderDiff(diffBox, oldData, finalData);
                    });
                }
            } catch (e) { alert('Ошибка: ' + e.message); checkCache(); }
        };
    }

    async function runOwnPupilsCrawler(abortCtrl, onProgress) {
        const { pid, aid } = await ensureAuth();
        onProgress(0, 100, 'Запрос классов...');

        const prof = await apiGet(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/teacher_profiles/${pid}?with_assigned_groups=true&with_replacement_groups=true`, 'teacherweb');
        const groupIds = prof?.assigned_group_ids || [];
        if (!groupIds.length) throw new Error('Классы не найдены.');

        onProgress(5, 100, 'Консолидация групп...');
        let groupsData = await apiGet(`https://authedu.mosreg.ru/api/ej/plan/teacher/v1/groups?page=1&academic_year_id=${aid}&group_ids=${groupIds.join(',')}&with_periods_schedule_id=true&per_page=300`, 'journalw');
        if (!Array.isArray(groupsData)) groupsData = groupsData?.groups || [];

        const classMap = new Map();
        groupsData.forEach(g => {
            const raw = (g.short_name || g.name || '').trim();
            const m = raw.match(/\b\d{1,2}[-_ ]?[А-Яа-яA-Za-z]?\d*\b/);
            const cls = g.class_unit_name?.trim() || (m ? m[0].replace('_', '-').replace(/\s+/g, '') : (raw || `Группа_${g.id}`));
            if (!classMap.has(cls)) classMap.set(cls, new Set());
            (g.student_ids || []).forEach(id => classMap.get(cls).add(id));
        });

        const uniqueClasses = Array.from(classMap.entries()).map(([cls, ids]) => ({ cls, ids: Array.from(ids) }))
            .sort((a, b) => a.cls.localeCompare(b.cls, undefined, { numeric: true }));

        const finalData = {};
        let consecErrors = 0;

        for (let i = 0; i < uniqueClasses.length; i++) {
            if (abortCtrl.aborted) break;
            const { cls, ids } = uniqueClasses[i];
            if (!ids.length) { finalData[cls] = []; continue; }

            const resArr = new Array(ids.length), exec = [];
            for (let sIdx = 0; sIdx < ids.length; sIdx++) {
                const sid = ids[sIdx];
                const p = (async () => {
                    if (abortCtrl.aborted) return null;
                    if (consecErrors >= 4) throw new Error('МЭШ вернул много ошибок подряд (лимит или сбой). Сбор прерван.');
                    onProgress(i + (sIdx / ids.length), uniqueClasses.length, `${cls}: ученик ${sIdx + 1}/${ids.length}`);

                    for (let attempt = 0; attempt < 2; attempt++) {
                        const raw = await apiGet(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/student_profiles/${sid}?with_user_info=true&with_attendances_count=true`, 'teacherweb');
                        if (raw) { consecErrors = 0; return parseStudent(raw, cls); }
                        consecErrors++;
                        await sleep(800);
                    }
                    return { "ID System": sid, "Класс": cls, "ФИО": `Ошибка загрузки (ID: ${sid})`, "Пол": "—", "Дата рождения": "—", "Возраст": "—", "Телефон": "—", "Email": "—", "СНИЛС": "—", "Логин МЭШ": "—", "Группа здоровья": "—", "Родитель 1": "Ошибка", "Родитель 2": "", rawParents: [] };
                })().then(r => resArr[sIdx] = r);

                exec.push(p);
                if (exec.length >= 4) await Promise.race(exec);
            }
            await Promise.all(exec);

            finalData[cls] = resArr.filter(Boolean).sort((a, b) => a["ФИО"].localeCompare(b["ФИО"], 'ru'));
            await sleep(250);
        }
        return finalData;
    }

    function parseStudent(raw, cls) {
        const u = raw.user || raw.person || raw;
        const fio = u.full_name || raw.user_name || `${u.last_name || ''} ${u.first_name || ''} ${u.middle_name || ''}`.trim() || 'Без имени';
        const parents = raw.parents || [];
        const fmtP = p => p ? `[${p.type || 'Представитель'}] ${p.name || ''}\nТел: ${p.phone_number || '—'}\nEmail: ${p.email || '—'}\nСНИЛС: ${p.snils || '—'}` : '';

        return {
            "ID System": raw.id, "Класс": cls, "ФИО": fio,
            "Пол": (u.sex || raw.sex) === 'male' ? 'М' : ((u.sex || raw.sex) === 'female' ? 'Ж' : '—'),
            "Дата рождения": u.birth_date || raw.birth_date || '—', "Возраст": raw.age ? `${raw.age} лет` : '—',
            "Телефон": u.phone_number || raw.phone_number || '—', "Email": u.email || raw.email || '—',
            "СНИЛС": raw.snils || '—', "Логин МЭШ": raw.gusoev_login || '—',
            "Группа здоровья": PE_GROUPS[raw.physical_training_group_id] || '—',
            "Родитель 1": fmtP(parents[0]), "Родитель 2": fmtP(parents[1]),
            rawParents: parents
        };
    }

    function renderDiff(box, oldD, newD) {
        if (!oldD) {
            toggleVis(box, true); box.style.borderColor = '#bbf7d0';
            box.innerHTML = `<div style="font-size:12px;font-weight:700;color:#16a34a;">✨ База сохранена впервые</div><div style="font-size:11px;color:#64748b;">При следующих обновлениях здесь появится статистика движения контингента.</div>`;
            return;
        }
        const mapOld = new Map(), mapNew = new Map();
        Object.entries(oldD).forEach(([cls, l]) => l.forEach(s => s["ID System"] && mapOld.set(String(s["ID System"]), { name: s["ФИО"], cls })));
        Object.entries(newD).forEach(([cls, l]) => l.forEach(s => s["ID System"] && mapNew.set(String(s["ID System"]), { name: s["ФИО"], cls })));

        const added = [], trans = [], rem = [];
        mapNew.forEach((v, id) => {
            if (!mapOld.has(id)) added.push(v);
            else if (mapOld.get(id).cls !== v.cls) trans.push({ name: v.name, from: mapOld.get(id).cls, to: v.cls });
        });
        mapOld.forEach((v, id) => { if (!mapNew.has(id)) rem.push(v); });

        toggleVis(box, true);
        if (!added.length && !trans.length && !rem.length) {
            box.style.borderColor = '#e2e8f0';
            box.innerHTML = `<div style="font-size:12px;font-weight:600;color:#16a34a;">✨ Состав классов не изменился</div>`;
            return;
        }
        box.style.borderColor = '#f59e0b';
        box.innerHTML = `
            <div style="font-size:11.5px;font-weight:700;color:#b45309;margin-bottom:4px;">📊 Изменения в составе классов:</div>
            <div style="display:flex;gap:10px;font-size:11.5px;font-weight:700;margin-bottom:6px;">
                <span style="color:#16a34a;">🟢 +${added.length}</span><span style="color:#2563eb;">🔄 ${trans.length}</span><span style="color:#dc2626;">🔴 -${rem.length}</span>
            </div>
            <div style="max-height:110px;overflow-y:auto;font-size:11.5px;display:flex;flex-direction:column;gap:3px;">
                ${added.map(s => `<div style="color:#16a34a;">🟢 <b>${s.name}</b> ➔ ${s.cls}</div>`).join('')}
                ${trans.map(s => `<div style="color:#2563eb;">🔄 <b>${s.name}</b>: ${s.from} ➔ ${s.to}</div>`).join('')}
                ${rem.map(s => `<div style="color:#dc2626;">🔴 <b>${s.name}</b> (выбыл из ${s.cls})</div>`).join('')}
            </div>`;
    }

    function exportToExcel(data) {
        const wb = XLSX.utils.book_new();
        const extractParent = (pObj, pStr) => {
            if (pObj) return { fio: (pObj.name || "—").replace(/^\[.*?\]\s*/, '').trim() || "—", type: pObj.type || "—", phone: pObj.phone_number || "—", email: pObj.email || "—", snils: pObj.snils || "—" };
            if (pStr && typeof pStr === 'string' && pStr.trim()) {
                const lines = pStr.split('\n'), firstLine = lines[0] || '';
                const getVal = pref => { const l = lines.find(x => x.toLowerCase().startsWith(pref.toLowerCase())); return l ? l.split(':').slice(1).join(':').trim() || "—" : "—"; };
                return { fio: firstLine.replace(/^\[.*?\]\s*/, '').trim() || "—", type: firstLine.match(/^\[(.*?)\]/)?.[1] || "—", phone: getVal('Тел'), email: getVal('Email'), snils: getVal('СНИЛС') };
            }
            return { fio: "—", type: "—", phone: "—", email: "—", snils: "—" };
        };

        const formatRow = (s, num) => {
            const p1 = extractParent(s.rawParents?.[0], s["Родитель 1"]), p2 = extractParent(s.rawParents?.[1], s["Родитель 2"]);
            return {
                "№": num, "ID System": s["ID System"] || s.id || "—", "ФИО": s["ФИО"] || "Без имени", "Класс": s["Класс"] || s.cleanCls || "—",
                "Пол": s["Пол"] || "—", "Дата рождения": s["Дата рождения"] || "—", "Возраст": s["Возраст"] || "—", "Телефон": s["Телефон"] || "—",
                "Email": s["Email"] || "—", "СНИЛС": s["СНИЛС"] || "—", "Логин МЭШ": s["Логин МЭШ"] || "—", "Группа здоровья": s["Группа здоровья"] || "—",
                "Родитель 1: ФИО": p1.fio, "Родитель 1: Кем приходится": p1.type, "Родитель 1: Телефон": p1.phone, "Родитель 1: Email": p1.email, "Родитель 1: СНИЛС": p1.snils,
                "Родитель 2: ФИО": p2.fio, "Родитель 2: Кем приходится": p2.type, "Родитель 2: Телефон": p2.phone, "Родитель 2: Email": p2.email, "Родитель 2: СНИЛС": p2.snils
            };
        };

        const getColsWidth = rows => rows.length ? Object.keys(rows[0]).map(k => ({ wch: Math.min(Math.max(rows.reduce((m, r) => Math.max(m, String(r[k] ?? '').length), k.length) + 3, 6), 45) })) : [];

        const allList = [], seen = new Set();
        let gIdx = 1;
        Object.values(data).forEach(list => list.forEach(s => {
            const id = s["ID System"] || s.id;
            if (id && !seen.has(id)) { seen.add(id); allList.push(formatRow(s, gIdx++)); }
        }));

        if (allList.length) {
            const wsAll = XLSX.utils.json_to_sheet(allList);
            wsAll['!cols'] = getColsWidth(allList);
            XLSX.utils.book_append_sheet(wb, wsAll, "Все ученики");
        }
        Object.entries(data).forEach(([cls, list]) => {
            if (!list.length) return;
            const rows = list.map((s, i) => formatRow(s, i + 1)), ws = XLSX.utils.json_to_sheet(rows);
            ws['!cols'] = getColsWidth(rows);
            XLSX.utils.book_append_sheet(wb, ws, cls.replace(/[\\/?*[\]]/g, '').substring(0, 31) || "Класс");
        });
        XLSX.writeFile(wb, `База_учеников_${new Date().toISOString().slice(0, 10)}.xlsx`);
    }

    // =========================================================================
    // 4. МОДУЛЬ 2: ДАННЫЕ ВСЕХ УЧЕНИКОВ ШКОЛЫ (ДОЗИРОВАННО ПО КЛАССАМ)
    // =========================================================================
    async function fetchClassStudentsOnDemand(clsObj, signal) {
        let items = [];
        for (const offset of [0, -1, -2, 1]) {
            const w = getWeekRange(new Date(), offset);
            const raw = await apiGet(`https://authedu.mosreg.ru/api/ej/plan/teacher/v1/schedule_items?academic_year_id=${state.aid}&class_unit_id=${clsObj.id}&from=${w.from}&to=${w.to}&original=true&per_page=400`, 'journalw', signal);
            items = Array.isArray(raw) ? raw : (raw?.schedule_items || []);
            if (items.length) break;
        }
        const gIds = [...new Set(items.map(l => l.group_id).filter(Boolean))];
        if (!gIds.length) return [];

        const sIds = new Set(), ownIds = new Set();
        for (let i = 0; i < gIds.length; i += 50) {
            const raw = await apiGet(`https://authedu.mosreg.ru/api/ej/plan/teacher/v1/groups?group_ids=${gIds.slice(i, i + 50).join(',')}&academic_year_id=${state.aid}&per_page=100`, 'journalw', signal);
            (Array.isArray(raw) ? raw : (raw?.groups || [])).forEach(g => {
                const isMine = state.myGroupIds.has(Number(g.id));
                (g.student_ids || []).forEach(id => {
                    const numId = Number(id);
                    sIds.add(numId);
                    if (isMine) ownIds.add(numId);
                });
            });
        }
        const idsArr = [...sIds];
        if (!idsArr.length) return [];

        const namesMap = new Map();
        for (let i = 0; i < idsArr.length; i += 60) {
            const raw = await apiGet(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/split_chat/get_profile_full_name?profile_ids=${idsArr.slice(i, i + 60).join(',')}`, 'teacherweb', signal);
            if (Array.isArray(raw)) raw.forEach(it => it?.id && namesMap.set(Number(it.id), (it.full_name || it.name || '').trim()));
        }

        const bldName = clsObj.buildingName || 'Корпус не указан';
        return idsArr.map(id => ({
            id, fio: namesMap.get(id) || `Ученик (ID: ${id})`,
            className: clsObj.name, buildingName: bldName,
            mentorName: clsObj.mentorName, isOwn: ownIds.has(id)
        })).sort((a, b) => a.fio.localeCompare(b.fio, 'ru'));
    }

    function openAllPupilsModal() {
        const { ov, bodySlot } = openBaseModal('🏫 Данные всех учеников школы', '1100px', '88vh');
        bodySlot.style.background = '#f1f5f9';
        bodySlot.innerHTML = `<div style="display:flex;justify-content:center;align-items:center;height:100%;color:#2e7d32;font-weight:600;gap:10px;"><div class="mshhlpr-loader-icon">⏳</div><span>Загрузка списка классов школы...</span></div>`;

        preloadSchoolCatalogs()
            .then(() => document.body.contains(ov) && renderAllPupilsView(bodySlot))
            .catch(e => { bodySlot.innerHTML = `<div style="padding:30px;text-align:center;color:#dc2626;font-weight:600;">❌ ${e.message}</div>`; });
    }

    function renderAllPupilsView(container) {
        const counts = {};
        state.classes.forEach(c => {
            const b = c.buildingName || 'Корпус не указан';
            counts[b] = (counts[b] || 0) + 1;
        });

        const bldOpts = `<option value="all">Все корпуса (${state.classes.length} кл.)</option>` +
            Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
                .map(([n, cnt]) => `<option value="${n}">${n} (${cnt} кл.)</option>`).join('');

        container.innerHTML = `
            <div style="padding:10px 18px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0;">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <select id="msh-ap-bld" class="mshhlpr-select" style="width:220px;height:32px;font-weight:600;">${bldOpts}</select>
                    <input type="text" id="msh-ap-cls-srch" class="mshhlpr-input" placeholder="🔎 Фильтр класса (напр. 9-1)..." style="width:190px;height:32px;">
                    <input type="text" id="msh-ap-stu-srch" class="mshhlpr-input" placeholder="🔎 Поиск ученика в классе..." style="width:230px;height:32px;" disabled>
                </div>
                <button id="msh-ap-copy-btn" class="mshhlpr-universal-toggle-btn mshhlpr-hidden" style="height:32px;cursor:pointer;">
                    <span class="mshhlpr-universal-toggle-text">📋 Скопировать ФИО учеников</span>
                </button>
            </div>
            <div style="flex:1;display:flex;overflow:hidden;">
                <div style="width:230px;background:#fff;border-right:1px solid #e2e8f0;display:flex;flex-direction:column;flex-shrink:0;">
                    <div style="padding:8px 12px;font-size:11.5px;font-weight:700;color:#64748b;background:#f8fafc;border-bottom:1px solid #e2e8f0;text-transform:uppercase;">Классы школы (<span id="msh-ap-cls-cnt">0</span>)</div>
                    <ul id="msh-ap-cls-list" style="list-style:none;margin:0;padding:0;overflow-y:auto;flex:1;"></ul>
                </div>
                <div style="width:340px;background:#fff;border-right:1px solid #e2e8f0;display:flex;flex-direction:column;flex-shrink:0;">
                    <div id="msh-ap-stu-hdr" style="padding:8px 12px;font-size:11.5px;font-weight:700;color:#64748b;background:#f8fafc;border-bottom:1px solid #e2e8f0;text-transform:uppercase;">Ученики класса</div>
                    <ul id="msh-ap-stu-list" style="list-style:none;margin:0;padding:0;overflow-y:auto;flex:1;">
                        <li style="padding:30px 15px;text-align:center;color:#94a3b8;font-size:12.5px;">👈 Нажмите на класс слева, чтобы загрузить его учеников</li>
                    </ul>
                </div>
                <div id="msh-ap-details" style="flex:1;padding:18px;overflow-y:auto;background:#f8fafc;">
                    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#94a3b8;text-align:center;gap:8px;">
                        <div style="font-size:40px;">🏫</div>
                        <div style="font-size:15px;font-weight:600;color:#64748b;">Выберите класс в списке слева</div>
                        <div style="font-size:12px;max-width:340px;">Данные собираются по запросу только для выбранного класса.</div>
                    </div>
                </div>
            </div>`;

        const $ = s => container.querySelector(s);
        const [bldSel, clsSrch, stuSrch, copyBtn, clsCnt, clsListEl, stuHdr, stuListEl, detailsEl] = [
            $('#msh-ap-bld'), $('#msh-ap-cls-srch'), $('#msh-ap-stu-srch'), $('#msh-ap-copy-btn'),
            $('#msh-ap-cls-cnt'), $('#msh-ap-cls-list'), $('#msh-ap-stu-hdr'), $('#msh-ap-stu-list'), $('#msh-ap-details')
        ];

        let selectedClass = null, currentStudents = [], selectedStudentId = null;

        function renderClassList() {
            const bVal = bldSel.value, q = clsSrch.value.trim().toLowerCase();
            const list = state.classes.filter(c => {
                const bName = c.buildingName || 'Корпус не указан';
                return (bVal === 'all' || bName === bVal) && (!q || c.name.toLowerCase().includes(q) || c.mentorName.toLowerCase().includes(q));
            });

            clsCnt.textContent = list.length;
            if (!list.length) { clsListEl.innerHTML = `<li style="padding:20px;text-align:center;color:#94a3b8;font-size:12px;">Классы не найдены</li>`; return; }

            clsListEl.innerHTML = '';
            list.forEach(c => {
                const isSel = selectedClass?.id === c.id, li = document.createElement('li');
                li.style.cssText = `padding:9px 12px;border-bottom:1px solid #f1f5f9;cursor:pointer;background:${isSel ? '#dcfce7' : '#fff'};`;
                li.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <b style="font-size:13.5px;color:${isSel ? '#15803d' : '#1e293b'};">${c.name}</b>
                        ${c.studentCount !== null ? `<span style="font-size:11px;color:#2e7d32;background:#f0fdf4;border:1px solid #bbf7d0;padding:1px 6px;border-radius:10px;font-weight:700;">${c.studentCount} уч.</span>` : ''}
                    </div>
                    <div style="font-size:11px;color:#64748b;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="Кл. рук: ${c.mentorName}">👩‍🏫 ${c.mentorName}</div>`;
                li.onclick = () => selectClass(c);
                clsListEl.appendChild(li);
            });
        }

        async function selectClass(clsObj) {
            selectedClass = clsObj; selectedStudentId = null; currentStudents = [];
            stuSrch.value = ''; stuSrch.disabled = true;
            toggleVis(copyBtn, false);
            renderClassList();

            activeAbort?.abort();
            activeAbort = new AbortController();
            const signal = activeAbort.signal;

            stuHdr.textContent = `Класс ${clsObj.name} — загрузка...`;
            stuListEl.innerHTML = `<li style="padding:40px 15px;text-align:center;color:#2e7d32;font-weight:600;"><div class="mshhlpr-loader-icon">⏳</div><div style="font-size:12.5px;margin-top:8px;">Собираем список ${clsObj.name}...</div></li>`;
            detailsEl.innerHTML = '';

            try {
                const list = await fetchClassStudentsOnDemand(clsObj, signal);
                if (signal.aborted) return;
                currentStudents = list;
                stuSrch.disabled = !list.length;
                toggleVis(copyBtn, list.length > 0);
                renderStudentList();
                renderClassSummary(clsObj, list);
            } catch (e) {
                if (e.name !== 'AbortError') {
                    stuHdr.textContent = `Класс ${clsObj.name} — ошибка`;
                    stuListEl.innerHTML = `<li style="padding:20px;text-align:center;color:#dc2626;font-size:12px;">Не удалось загрузить список класса.</li>`;
                }
            }
        }

        function renderStudentList() {
            const q = stuSrch.value.trim().toLowerCase();
            const list = !q ? currentStudents : currentStudents.filter(s => s.fio.toLowerCase().includes(q) || String(s.id).includes(q));
            stuHdr.textContent = `Класс ${selectedClass?.name || ''}: ${list.length} из ${currentStudents.length} уч.`;
            if (!list.length) { stuListEl.innerHTML = `<li style="padding:25px;text-align:center;color:#94a3b8;font-size:12px;">Ученики не найдены</li>`; return; }

            stuListEl.innerHTML = '';
            list.forEach((st, idx) => {
                const li = document.createElement('li');
                li.style.cssText = `padding:8px 12px;border-bottom:1px solid #f1f5f9;cursor:pointer;background:${selectedStudentId === st.id ? '#e0f2fe' : '#fff'};display:flex;justify-content:space-between;align-items:center;gap:8px;`;
                li.innerHTML = `
                    <span style="font-size:12.5px;font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        <span style="color:#94a3b8;font-weight:400;margin-right:4px;">${idx + 1}.</span>${st.fio}
                    </span>
                    <span style="font-size:10.5px;color:#94a3b8;font-family:monospace;flex-shrink:0;">#${st.id}</span>`;
                li.onclick = () => { selectedStudentId = st.id; renderStudentList(); renderStudentDetails(st); };
                stuListEl.appendChild(li);
            });
        }

        function renderClassSummary(clsObj, list) {
            detailsEl.innerHTML = `
                <div class="mshhlpr-modal-header" style="padding:16px 20px;flex-direction:column;align-items:flex-start;border-radius:8px;">
                    <div style="font-size:11px;opacity:.85;text-transform:uppercase;">Сводка по классу</div>
                    <h2 style="margin:2px 0 0 0;font-size:22px;color:#fff;">Класс ${clsObj.name}</h2>
                    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
                        <span class="mshhlpr-badge mshhlpr-badge-green" style="${BADGE_STYLE}">👥 Учеников: ${list.length}</span>
                        <span class="mshhlpr-badge mshhlpr-badge-green" style="${BADGE_STYLE}">👩‍🏫 Кл. рук: ${clsObj.mentorName}</span>
                        <span class="mshhlpr-badge mshhlpr-badge-green" style="${BADGE_STYLE}">🏢 ${clsObj.buildingName || 'Корпус не указан'}</span>
                    </div>
                </div>
                <div class="mshhlpr-info-card" style="margin-top:14px;padding:14px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <h4 class="mshhlpr-info-title" style="margin:0;border:none;padding:0;">Полный список ФИО класса (${list.length} чел.)</h4>
                        <span style="font-size:11px;color:#64748b;">Кликните на ученика слева для просмотра карточки</span>
                    </div>
                    <textarea readonly style="width:100%;height:340px;font-family:monospace;font-size:12.5px;line-height:1.45;border:1px solid #cbd5e1;border-radius:8px;padding:10px;resize:vertical;background:#f8fafc;box-sizing:border-box;outline:none;">${list.map(s => s.fio).join('\n')}</textarea>
                </div>`;
        }

        async function renderStudentDetails(st) {
            const bindBack = () => {
                detailsEl.querySelector('#msh-ap-back').onclick = () => {
                    selectedStudentId = null;
                    renderStudentList();
                    renderClassSummary(selectedClass, currentStudents);
                };
            };

            const renderShortCard = () => {
                detailsEl.innerHTML = `
                    <div class="mshhlpr-modal-header" style="padding:16px 20px;flex-direction:column;align-items:flex-start;border-radius:8px;">
                        <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
                            <span style="font-size:11px;opacity:.85;text-transform:uppercase;">Карточка ученика</span>
                            <button id="msh-ap-back" style="background:rgba(255,255,255,0.2);border:none;color:#fff;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px;font-weight:600;">⬅ К списку ФИО класса</button>
                        </div>
                        <h2 style="margin:4px 0 0 0;font-size:22px;color:#fff;">${st.fio}</h2>
                        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
                            <span class="mshhlpr-badge mshhlpr-badge-green" style="${BADGE_STYLE}">🎓 Класс: ${st.className}</span>
                            <span class="mshhlpr-badge mshhlpr-badge-green" style="${BADGE_STYLE}">👩‍🏫 Кл. рук: ${st.mentorName}</span>
                        </div>
                    </div>
                    <div class="mshhlpr-info-card" style="margin-top:14px;padding:14px;">
                        <h4 class="mshhlpr-info-title" style="margin-bottom:10px;">Школьная информация</h4>
                        <div class="mshhlpr-info-row" style="font-size:13px;">
                            <div class="mshhlpr-info-label">Корпус:</div><div><b>${st.buildingName}</b></div>
                            <div class="mshhlpr-info-label">ID в МЭШ:</div><div style="font-size:12px;color:#64748b;font-family:monospace;">${st.id}</div>
                        </div>
                    </div>`;
                bindBack();
            };

            if (!st.isOwn) return renderShortCard();

            activeAbort?.abort();
            activeAbort = new AbortController();
            const signal = activeAbort.signal;

            detailsEl.innerHTML = `<div style="padding:40px;text-align:center;color:#2e7d32;font-weight:600;"><div class="mshhlpr-loader-icon">⏳</div><div>Загрузка карточки: ${st.fio}...</div></div>`;

            const live = await apiGet(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/student_profiles/${st.id}?with_user_info=true&with_attendances_count=true`, 'teacherweb', signal).catch(() => null);
            if (signal.aborted) return;

            const u = live?.user || live?.person || live || {};
            if (!live || (!u.last_name && !u.full_name && !live.snils)) return renderShortCard();

            detailsEl.innerHTML = buildFullCardHtml({
                id: st.id, fio: st.fio, cls: st.className, mentor: live.mentors?.[0]?.name || st.mentorName,
                age: live.age ? `${live.age} лет` : '—',
                sex: (u.sex || live.sex) === 'male' ? '👦 Муж' : ((u.sex || live.sex) === 'female' ? '👧 Жен' : '—'),
                birthDate: u.birth_date || live.birth_date, snils: live.snils,
                phone: u.phone_number || live.phone_number, email: u.email || live.email,
                building: st.buildingName, login: live.gusoev_login,
                absences: live.non_attendance, peGroup: PE_GROUPS[live.physical_training_group_id],
                parents: live.parents
            }, { backBtn: true });
            bindBack();
        }

        copyBtn.onclick = () => {
            if (!currentStudents.length) return;
            navigator.clipboard.writeText(currentStudents.map(s => s.fio).join('\n')).then(() => {
                const span = copyBtn.querySelector('.mshhlpr-universal-toggle-text'), orig = span.textContent;
                span.textContent = `✅ Скопировано (${currentStudents.length} чел.)!`;
                setTimeout(() => { span.textContent = orig; }, 1800);
            });
        };

        bldSel.onchange = renderClassList;
        clsSrch.oninput = renderClassList;
        stuSrch.oninput = renderStudentList;
        renderClassList();
    }

    // =========================================================================
    // 5. МОДУЛЬ 3 И 4: РАСПИСАНИЕ УЧИТЕЛЕЙ И КЛАССОВ ШКОЛЫ
    // =========================================================================
    const viewOpts = { shortClasses: false, hideNdo: false, showBuilding: false };

    const cleanRoom = s => !s ? '—' : (String(s).replace(/^(каб\.?|кабинет)\s*/i, '').trim().match(/^(\d+[\wа-яА-ЯёЁ-]*)\b/)?.[1] || String(s).trim());
    const formatFioShort = fio => {
        if (!fio || fio === '—') return '—';
        const p = fio.trim().split(/\s+/);
        return p.length === 1 ? p[0] : `${p[0]} ${p[1] ? p[1][0] + '.' : ''}${p[2] ? p[2][0] + '.' : ''}`.trim();
    };
    const extractClass = (raw, teacher, ndo) => {
        if (!raw || ndo) return raw || '—';
        const tParts = (teacher || '').toLowerCase().split(/\s+/).filter(p => p.length > 2);
        const clean = String(raw).split(/\s+/).filter(w => !/^[а-яёa-z]\.([а-яёa-z]\.?)?$/i.test(w) && !tParts.some(p => w.toLowerCase().replace(/[^a-zа-яё0-9-]/g, '').includes(p)));
        const idx = clean.findIndex(w => /^\d/.test(w));
        return idx !== -1 ? clean[idx].replace(/[.,;:)]+$/, '') : raw;
    };
    const isNdo = it => NDO_KEYS.some(k => `${state.groupCache.get(it.group_id)?.fullName || it.group_name || ''} ${state.roomMap.get(it.room_id) || ''}`.toLowerCase().includes(k));

    async function resolveGroups(gIds) {
        const miss = gIds.filter(id => id && !state.groupCache.has(id));
        for (let i = 0; i < miss.length; i += 50) {
            const data = await apiGet(`https://authedu.mosreg.ru/api/ej/plan/teacher/v1/groups?group_ids=${miss.slice(i, i + 50).join(',')}&academic_year_id=${state.aid}&per_page=100`, 'journalw');
            (Array.isArray(data) ? data : (data?.groups || [])).forEach(g => {
                state.groupCache.set(g.id, { fullName: (g.name || g.class_unit_name || `Группа ${g.id}`).trim(), subjectName: g.subject_name || '—' });
            });
        }
    }

    function assignSlots(lessons) {
        const getMins = it => (Array.isArray(it.time) && it.time.length >= 2) ? it.time[0] * 60 + it.time[1] : null;
        const findBell = (m, tol) => (m === null || !state.parsedBells.length) ? null : state.parsedBells.reduce((acc, b) => {
            const diff = Math.abs(b.start - m);
            return (diff <= tol && (!acc || diff < acc.diff)) ? { b, diff } : acc;
        }, null)?.b;

        const reg = [], ndo = [], map = new Map(), regTimes = [];
        lessons.forEach(l => (isNdo(l) ? ndo : reg).push(l));

        reg.forEach(l => {
            const m = getMins(l), bell = findBell(m, 25);
            const slot = { slotNum: bell ? bell.num : (l.lesson_number || 1), timeStr: bell?.timeStr || (m ? `${pad(Math.floor(m / 60))}:${pad(m % 60)}` : '—') };
            map.set(l, slot);
            if (m !== null) regTimes.push({ mins: m, ...slot });
        });

        ndo.forEach(l => {
            const m = getMins(l);
            let slot = null;
            if (m !== null && regTimes.length) {
                const near = regTimes.reduce((acc, r) => {
                    const diff = Math.abs(r.mins - m);
                    return (diff <= 20 && (!acc || diff < acc.diff)) ? { r, diff } : acc;
                }, null)?.r;
                if (near) slot = { slotNum: near.slotNum, timeStr: near.timeStr };
            }
            if (!slot && m !== null) {
                const bell = findBell(m, 30);
                if (bell) slot = { slotNum: bell.num, timeStr: bell.timeStr };
            }
            map.set(l, slot || { slotNum: l.lesson_number || 1, timeStr: m ? `${pad(Math.floor(m / 60))}:${pad(m % 60)}` : '—' });
        });
        return map;
    }

    function getCardData(l, mode, curEntityName) {
        const meta = state.groupCache.get(l.group_id) || {};
        const fullGroup = meta.fullName || l.group?.name || l.group_name || `Группа ${l.group_id}`;
        const ndoFlag = isNdo(l);
        const rName = cleanRoom(state.roomMap.get(l.room_id) || l.room_id || l.room_name);
        const bld = state.roomBldMap.get(l.room_id) || l.building_name;
        const subName = meta.subjectName || l.subject_name || '—';

        if (mode === 'classes') {
            const tShort = formatFioShort(l.teacher_name);
            return { title: subName, subtitle: tShort !== '—' ? `👤 ${tShort}` : '', rName, bld, ndoFlag };
        }
        return { title: viewOpts.shortClasses ? extractClass(fullGroup, curEntityName, ndoFlag) : fullGroup, subtitle: subName, rName, bld, ndoFlag };
    }

    function toggleCalendar(wrapper, onSelect) {
        const old = wrapper.querySelector('#msh-np-cal-pop');
        if (old) return old.remove();

        const pop = document.createElement('div');
        pop.id = 'msh-np-cal-pop';
        pop.style.cssText = 'position:absolute;top:calc(100% + 6px);left:0;z-index:100000;background:#fff;border-radius:8px;box-shadow:0 10px 25px rgba(0,0,0,0.2);border:1px solid #cbd5e1;padding:12px;width:280px;box-sizing:border-box;font-family:inherit;';

        const render = () => {
            const y = state.calMonth.getFullYear(), m = state.calMonth.getMonth();
            const mNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
            const start = new Date(y, m, 1);
            start.setDate(1 - ((start.getDay() || 7) - 1));

            let rows = '', cur = new Date(start);
            for (let w = 0; w < 6; w++) {
                const wStart = new Date(cur), wEnd = new Date(cur);
                wEnd.setDate(cur.getDate() + 6);
                const isSel = fmtDate(wStart) === state.selectedWeek.from;
                let days = '';
                for (let d = 0; d < 7; d++) {
                    days += `<td style="text-align:center;padding:6px 0;font-size:11.5px;color:${cur.getMonth() === m ? '#1e293b' : '#94a3b8'};user-select:none;">${cur.getDate()}</td>`;
                    cur.setDate(cur.getDate() + 1);
                }
                rows += `<tr class="msh-np-cal-r ${isSel ? 'sel' : ''}" data-f="${fmtDate(wStart)}" data-t="${fmtDate(wEnd)}">${days}</tr>`;
                if (cur.getMonth() !== m && w >= 3) break;
            }

            pop.innerHTML = `
                <style>.msh-cal-t{table-layout:fixed;width:100%;border-collapse:collapse;}.msh-np-cal-r{cursor:pointer;border-radius:4px;}.msh-np-cal-r:hover td{background:#e0f2fe!important;color:#0284c7!important;}.msh-np-cal-r.sel td{background:#dcfce7!important;color:#15803d!important;font-weight:bold;}</style>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <button id="msh-c-prev" style="background:none;border:none;cursor:pointer;font-weight:bold;color:#475569;padding:2px 6px;">◀</button>
                    <span style="font-weight:700;font-size:13px;color:#1e293b;">${mNames[m]} ${y}</span>
                    <button id="msh-c-next" style="background:none;border:none;cursor:pointer;font-weight:bold;color:#475569;padding:2px 6px;">▶</button>
                </div>
                <table class="msh-cal-t"><thead><tr style="color:#64748b;font-size:10px;font-weight:700;"><th>Пн</th><th>Вт</th><th>Ср</th><th>Чт</th><th>Пт</th><th>Сб</th><th>Вс</th></tr></thead><tbody>${rows}</tbody></table>
                <button id="msh-c-today" style="width:100%;margin-top:8px;padding:6px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;font-size:11px;font-weight:700;color:#334155;cursor:pointer;">📅 Выбрать текущую неделю</button>`;

            pop.querySelector('#msh-c-prev').onclick = e => { e.stopPropagation(); state.calMonth.setMonth(m - 1); render(); };
            pop.querySelector('#msh-c-next').onclick = e => { e.stopPropagation(); state.calMonth.setMonth(m + 1); render(); };
            pop.querySelector('#msh-c-today').onclick = e => { e.stopPropagation(); state.selectedWeek = getWeekRange(); pop.remove(); onSelect(state.selectedWeek); };
            pop.querySelectorAll('.msh-np-cal-r').forEach(r => r.onclick = e => {
                e.stopPropagation();
                state.selectedWeek = { from: r.dataset.f, to: r.dataset.t, label: `${fmtRu(parseDateObj(r.dataset.f))} — ${fmtRu(parseDateObj(r.dataset.t))}` };
                pop.remove(); onSelect(state.selectedWeek);
            });
        };
        render();
        wrapper.appendChild(pop);
        const onDoc = e => { if (!wrapper.contains(e.target)) { pop.remove(); document.removeEventListener('click', onDoc); } };
        setTimeout(() => document.addEventListener('click', onDoc), 50);
    }

    function openScheduleModal(mode = 'teachers') {
        state.selectedWeek = getWeekRange();
        state.calMonth = new Date(parseDateObj(state.selectedWeek.from));
        const isClasses = (mode === 'classes');
        const { ov, bodySlot } = openBaseModal(
            isClasses ? '📅 Расписание классов школы' : '📅 Расписание учителей школы',
            '1300px', '92vh',
            isClasses ? 'var(--mshhlpr-primary-gradient)' : 'linear-gradient(135deg,#0284c7,#0369a1)'
        );
        bodySlot.style.cssText = 'flex:1;overflow-y:auto;padding:16px 20px;background:#fff;';
        bodySlot.innerHTML = `<div style="display:flex;justify-content:center;align-items:center;height:200px;color:#2e7d32;font-weight:600;gap:10px;"><div class="mshhlpr-loader-icon">⏳</div><span>Загрузка каталогов школы...</span></div>`;

        preloadSchoolCatalogs().then(() => document.body.contains(ov) && renderScheduleView(bodySlot, mode));
    }

    function renderScheduleView(container, mode = 'teachers') {
        const isClasses = (mode === 'classes');
        const toggleHtml = (id, txt, chk) => `
            <div class="mshhlpr-universal-toggle-btn mshhlpr-compact-toggle msh-np-tgl" data-t="${id}" style="cursor:pointer!important;user-select:none!important;transform:none!important;">
                <span class="mshhlpr-universal-toggle-text" style="font-size:11px!important;pointer-events:none;">${txt}</span>
                <div class="mshhlpr-ios-switch mshhlpr-compact-switch" style="pointer-events:none;"><input type="checkbox" id="${id}" ${chk ? 'checked' : ''} style="pointer-events:none;"><span class="mshhlpr-ios-slider" style="pointer-events:none;"></span></div>
            </div>`;

        const counts = {};
        (isClasses ? state.classes : state.teachers).forEach(e => { if (e.buildingName) counts[e.buildingName] = (counts[e.buildingName] || 0) + 1; });
        const validB = [], emptyB = [];
        state.buildings.forEach(b => ((counts[b.name] || 0) > 0 ? validB : emptyB).push({ name: b.name, cnt: counts[b.name] || 0 }));
        const sortB = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
        validB.sort(sortB); emptyB.sort(sortB);

        const bldOpts = `<option value="all">Все корпуса</option>` +
            validB.map(b => `<option value="${b.name}">${b.name} (${b.cnt})</option>`).join('') +
            emptyB.map(b => `<option value="${b.name}" disabled style="color:#94a3b8;background:#f8fafc;">${b.name} (0)</option>`).join('');

        container.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:12px;">
                <div style="display:flex;gap:8px;align-items:center;background:#f8fafc;padding:10px 14px;border-radius:8px;border:1px solid #e2e8f0;flex-wrap:wrap;">
                    <div style="display:flex;gap:6px;flex:1;min-width:420px;flex-wrap:wrap;">
                        <input type="text" id="msh-s-inp" placeholder="${isClasses ? '🔎 Класс (напр. 7-4)...' : '🔎 Поиск учителя...'}" class="mshhlpr-input" style="width:150px;height:32px;">
                        <select id="msh-b-sel" class="mshhlpr-select" style="width:160px;height:32px;font-weight:600;">${bldOpts}</select>
                        <select id="msh-target-sel" class="mshhlpr-select" style="flex:1;min-width:200px;height:32px;font-weight:600;"></select>
                    </div>
                    <div style="position:relative;display:inline-block;" id="msh-w-box">
                        <button id="msh-w-btn" class="mshhlpr-universal-toggle-btn mshhlpr-compact-toggle" style="background:#fff!important;border:1px solid #cbd5e1!important;color:#1e293b!important;height:32px;padding:0 10px;cursor:pointer;transform:none!important;">
                            <span class="mshhlpr-universal-toggle-text" id="msh-w-txt" style="color:#1e293b!important;">📅 ${state.selectedWeek.label}</span>
                        </button>
                    </div>
                    <button id="msh-run-btn" class="mshhlpr-universal-toggle-btn" style="height:32px;padding:0 16px;transform:none!important;background:${isClasses ? 'var(--mshhlpr-primary-gradient)' : 'linear-gradient(135deg,#0284c7,#0369a1)'}!important;"><span class="mshhlpr-universal-toggle-text">Показать</span></button>
                </div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:0 2px;">
                    ${!isClasses ? toggleHtml('tgl-short', 'Сократить классы', viewOpts.shortClasses) : ''}
                    ${!isClasses ? toggleHtml('tgl-ndo', 'Скрыть НДО', viewOpts.hideNdo) : ''}
                    ${toggleHtml('tgl-bld', 'Показывать корпус', viewOpts.showBuilding)}
                </div>
                <div id="msh-res-div"><div style="text-align:center;color:#94a3b8;padding:40px;font-size:13px;">Выберите ${isClasses ? 'класс' : 'преподавателя'} в списке выше.</div></div>
            </div>`;

        const $ = s => container.querySelector(s);
        const [sInp, bSel, tSel, wBox, wBtn, wTxt, runBtn, resDiv] = [$('#msh-s-inp'), $('#msh-b-sel'), $('#msh-target-sel'), $('#msh-w-box'), $('#msh-w-btn'), $('#msh-w-txt'), $('#msh-run-btn'), $('#msh-res-div')];

        const updateOptions = () => {
            const q = sInp.value.trim().toLowerCase(), b = bSel.value;
            const list = (isClasses ? state.classes : state.teachers).filter(x => (isClasses ? x.name : x.fio).toLowerCase().includes(q) && (b === 'all' || x.buildingName === b));
            tSel.innerHTML = `<option value="">-- Выберите ${isClasses ? 'класс' : 'учителя'} (${list.length}) --</option>` +
                list.map(x => `<option value="${x.id}">${isClasses ? x.name : x.fio}${x.buildingName ? ` — [${x.buildingName}]` : ''}</option>`).join('');
            if (list.length === 1) { tSel.selectedIndex = 1; runBtn.click(); }
        };

        sInp.oninput = updateOptions;
        bSel.onchange = updateOptions;
        tSel.onchange = () => { if (tSel.value) runBtn.click(); };
        wBtn.onclick = e => {
            e.stopPropagation();
            toggleCalendar(wBox, sel => {
                wTxt.textContent = `📅 ${sel.label}`;
                if (tSel.value) runBtn.click();
            });
        };

        let currLessons = [], currEntityName = "";

        const openPrintView = (sortedSlots, grid, showDays, slotTimes) => {
            const maxNum = sortedSlots.length ? Math.max(...sortedSlots) : 0;
            const density = (maxNum <= 6) ? "density-spacious" : (maxNum >= 9 ? "density-compact" : "density-comfortable");
            const printRows = sortedSlots.map(sNum => {
                const tStr = slotTimes.get(sNum) || state.parsedBells.find(b => b.num === sNum)?.timeStr || '—';
                const cells = showDays.map(dNum => {
                    const lList = grid[sNum]?.[dNum] || [];
                    if (!lList.length) return `<td class="cell-empty"></td>`;
                    return `<td class="cell-lesson">${lList.map(l => {
                        const card = getCardData(l, mode, currEntityName);
                        return `<div class="lesson-wrapper"><div class="class-box"><span class="cabinet-name">каб. ${card.rName}</span><span class="class-name">${card.title}</span></div><div class="subject-name">${card.subtitle}</div>${viewOpts.showBuilding && card.bld ? `<div class="building-name">🏢 ${card.bld}</div>` : ''}</div>`;
                    }).join('<div class="lesson-separator"></div>')}</td>`;
                }).join('');
                return `<tr><td class="col-num">${sNum}</td><td class="col-time">${tStr}</td>${cells}</tr>`;
            }).join('');

            const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="color-scheme" content="light"><title>Расписание - ${currEntityName}</title>
            <style>
                @page{size:landscape;margin:6mm 8mm}body{font-family:Arial,sans-serif;color:#000;background:#fff;margin:0;box-sizing:border-box}
                .header{text-align:center;margin-bottom:12px;padding-top:8px;}h1{margin:0 0 6px;color:#2e7d32;font-size:22px;font-weight:700}
                .btn-print{background:#2e7d32;color:#fff;border:none;padding:8px 24px;cursor:pointer;border-radius:6px;font-size:14px;font-weight:700;}
                table{width:100%;border-collapse:collapse;text-align:center;table-layout:fixed;background:#fff;margin:0 auto}
                th,td{border:1px solid #000;vertical-align:middle;word-wrap:break-word;box-sizing:border-box;}th{background:#f0f0f0;font-weight:700;-webkit-print-color-adjust:exact;padding:6px 2px;}
                body.density-spacious{padding:12px}body.density-spacious td{padding:10px 4px}body.density-spacious .class-name{font-size:14px}
                body.density-comfortable{padding:8px}body.density-comfortable td{padding:6px 3px}body.density-comfortable .class-name{font-size:12.5px}
                body.density-compact{padding:4px}body.density-compact td{padding:4px 2px}body.density-compact .class-name{font-size:11px}
                .lesson-wrapper{display:block;width:100%;box-sizing:border-box;overflow:hidden;text-align:left;}
                .cabinet-name{float:right;margin-left:5px;margin-bottom:2px;font-size:9.5px;font-weight:700;color:#111;border:1px solid #777;padding:1px 3px;border-radius:3px;background:#f0f0f0;white-space:nowrap;-webkit-print-color-adjust:exact;}
                .class-name{font-weight:700;color:#000;line-height:1.2;word-break:break-word;display:inline;}
                .subject-name{clear:both;font-size:10px;color:#444;line-height:1.15;text-align:left;margin-top:2px;}
                .building-name{font-size:9px;color:#555;text-align:left;clear:both;}.lesson-separator{border-top:1px dashed #bbb;margin:3px 0;width:100%;clear:both;}
                .col-num{width:38px;font-weight:bold;}.col-time{width:90px;font-family:monospace;font-size:11px;font-weight:bold;}.cell-empty{background:#fafafa;}
                @media print{.btn-print,h1{display:none!important;}.header{margin-bottom:6px!important;}.header::after{content:"📅 Расписание: " attr(data-entity);font-size:18px;font-weight:700;display:block;text-align:center;color:#000;}}
            </style></head><body class="${density}">
                <div class="header" data-entity="${currEntityName}"><h1>📅 Расписание: ${currEntityName}</h1><button class="btn-print" onclick="window.print()">🖨️ Напечатать</button></div>
                <table><thead><tr><th class="col-num">№</th><th class="col-time">Время</th>${showDays.map(d => `<th>${DAYS_RU[d]}</th>`).join('')}</tr></thead><tbody>${printRows}</tbody></table>
            </body></html>`;

            const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
            const win = window.open(blobUrl, '_blank');
            if (win) setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
            else alert('Разрешите всплывающие окна для печати.');
        };

        const renderGrid = () => {
            if (!currLessons.length) return;
            const visible = currLessons.filter(l => !(!isClasses && viewOpts.hideNdo && isNdo(l)));
            if (!visible.length) {
                resDiv.innerHTML = `<div style="text-align:center;background:#fffbeb;border:1px solid #fef3c7;border-radius:8px;padding:25px;color:#b45309;font-weight:700;">Все занятия скрыты тумблером «Скрыть НДО».</div>`;
                return;
            }
            const slotMap = assignSlots(visible), grid = {}, activeDays = new Set([1, 2, 3, 4, 5]), slotTimes = new Map();
            visible.forEach(l => {
                const dNum = parseDateObj(l.date || l.iso_date || l.lesson?.date).getDay() || 7;
                if (dNum >= 6) activeDays.add(dNum);
                const info = slotMap.get(l) || { slotNum: 1, timeStr: '—' };
                ((grid[info.slotNum] = grid[info.slotNum] || {})[dNum] = grid[info.slotNum][dNum] || []).push(l);
                if (!slotTimes.has(info.slotNum) && info.timeStr !== '—') slotTimes.set(info.slotNum, info.timeStr);
            });

            const sortedSlots = Object.keys(grid).map(Number).sort((a, b) => a - b);
            const showDays = [1, 2, 3, 4, 5, 6, 7].filter(d => activeDays.has(d));

            const rows = sortedSlots.map(sNum => {
                const tStr = slotTimes.get(sNum) || state.parsedBells.find(b => b.num === sNum)?.timeStr || '—';
                const cells = showDays.map(dNum => {
                    const lList = grid[sNum]?.[dNum] || [];
                    if (!lList.length) return `<td style="border:1px solid #cbd5e1;background:#fafafa;"></td>`;
                    return `<td style="border:1px solid #cbd5e1;padding:4px;vertical-align:top;background:#fff;">${lList.map(l => {
                        const card = getCardData(l, mode, currEntityName);
                        return `<div style="background:#fff;border:1px solid ${card.ndoFlag ? '#fed7aa' : '#cbd5e1'};border-left:4px solid ${card.ndoFlag ? '#f97316' : (isClasses ? '#0284c7' : '#22c55e')};border-radius:6px;padding:6px 8px;display:block;margin-bottom:4px;box-shadow:0 1px 3px rgba(0,0,0,0.05);text-align:left;">
                            <div style="display:block;width:100%;">
                                <span style="float:right;margin-left:6px;margin-bottom:2px;font-size:10px;font-weight:700;color:${card.ndoFlag ? '#c2410c' : '#15803d'};background:${card.ndoFlag ? '#ffedd5' : '#dcfce7'};padding:1px 5px;border-radius:3px;white-space:nowrap;">каб. ${card.rName}</span>
                                <span style="font-weight:800;font-size:13px;color:#1e293b;line-height:1.25;display:inline;word-break:break-word;">${card.title}</span>
                            </div>
                            <div style="clear:both;font-size:11px;color:#64748b;line-height:1.2;margin-top:2px;">${card.subtitle}</div>
                            ${viewOpts.showBuilding ? `<div style="clear:both;font-size:9.5px;color:#475569;background:#f1f5f9;padding:1px 4px;border-radius:3px;width:fit-content;margin-top:2px;">🏢 ${card.bld || 'Корпус не указан'}</div>` : ''}
                        </div>`;
                    }).join('')}</td>`;
                }).join('');
                return `<tr><td style="border:1px solid #cbd5e1;text-align:center;font-weight:800;font-size:14px;background:#f8fafc;color:#1e293b;">${sNum}</td><td style="border:1px solid #cbd5e1;text-align:center;font-size:11px;font-family:monospace;font-weight:700;background:#f8fafc;color:#475569;white-space:nowrap;">${tStr}</td>${cells}</tr>`;
            }).join('');

            resDiv.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
                    <div><span style="font-weight:800;font-size:15px;color:#1e293b;">📅 Расписание: <span style="color:#2e7d32;">${currEntityName}</span></span><span style="font-size:12px;color:#64748b;margin-left:8px;">(Уроков: <b>${visible.length}</b>)</span></div>
                    <button id="msh-print-btn" class="mshhlpr-universal-toggle-btn" style="height:30px;padding:0 12px;cursor:pointer;transform:none!important;"><span class="mshhlpr-universal-toggle-text">🖨️ Распечатать</span></button>
                </div>
                <div style="overflow-x:auto;background:#fff;border-radius:6px;">
                    <table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px;">
                        <thead><tr style="background:#f1f5f9;color:#334155;font-size:12.5px;"><th style="border:1px solid #cbd5e1;width:40px;padding:8px 4px;text-align:center;">№</th><th style="border:1px solid #cbd5e1;width:95px;padding:8px 4px;text-align:center;">Время</th>${showDays.map(d => `<th style="border:1px solid #cbd5e1;padding:8px;text-align:center;font-weight:700;">${DAYS_RU[d]}</th>`).join('')}</tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>`;
            resDiv.querySelector('#msh-print-btn').onclick = () => openPrintView(sortedSlots, grid, showDays, slotTimes);
        };

        [['tgl-short', 'shortClasses'], ['tgl-ndo', 'hideNdo'], ['tgl-bld', 'showBuilding']].forEach(([id, key]) => {
            const wrap = container.querySelector(`.msh-np-tgl[data-t="${id}"]`), inp = container.querySelector(`#${id}`);
            if (wrap && inp) wrap.onclick = e => { e.stopPropagation(); inp.checked = !inp.checked; viewOpts[key] = inp.checked; renderGrid(); };
        });

        runBtn.onclick = async () => {
            const selId = tSel.value;
            if (!selId) return alert(isClasses ? 'Выберите класс.' : 'Выберите учителя.');
            currEntityName = isClasses
                ? (state.classes.find(c => String(c.id) === String(selId))?.name || `Класс #${selId}`)
                : (state.teachers.find(t => String(t.id) === String(selId))?.fio || `Учитель #${selId}`);

            activeAbort?.abort();
            activeAbort = new AbortController();
            const signal = activeAbort.signal;

            resDiv.innerHTML = `<div style="text-align:center;padding:30px;"><div class="mshhlpr-loader-icon">⏳</div><div>Запрос расписания: ${currEntityName}...</div></div>`;

            try {
                const qParam = isClasses ? `class_unit_id=${selId}` : `teacher_id=${selId}`;
                const raw = await apiGet(`https://authedu.mosreg.ru/api/ej/plan/teacher/v1/schedule_items?academic_year_id=${state.aid}&${qParam}&from=${state.selectedWeek.from}&to=${state.selectedWeek.to}&with_lesson_info=true&with_rooms_info=true&page=1&per_page=400&original=true`, 'journalw', signal, 5000);
                if (signal.aborted) return;
                currLessons = Array.isArray(raw) ? raw : (raw?.schedule_items || []);

                if (!currLessons.length) {
                    resDiv.innerHTML = `<div style="text-align:center;background:#fffbeb;border:1px solid #fef3c7;border-radius:8px;padding:25px;color:#b45309;"><div style="font-size:15px;font-weight:700;">Уроков не найдено</div><div style="font-size:12.5px;margin-top:4px;">В базе нет уроков для <b>${currEntityName}</b> на выбранную неделю.</div></div>`;
                    return;
                }
                await resolveGroups([...new Set(currLessons.map(l => l.group_id).filter(Boolean))]);
                if (!signal.aborted) renderGrid();
            } catch (e) {
                if (e.name !== 'AbortError') resDiv.innerHTML = `<div style="padding:25px;text-align:center;color:#dc2626;">Ошибка загрузки расписания.</div>`;
            }
        };

        updateOptions();
    }

    // =========================================================================
    // 6. ЕДИНОЕ ВНЕДРЕНИЕ ВСЕХ 4 КНОПОК И НАБЛЮДАТЕЛЬ
    // =========================================================================
    function injectExplorerButtons() {
        if (location.pathname.replace(/\/$/, '') !== TARGET_PATH) {
            Object.values(BTN_IDS).forEach(id => document.getElementById(id)?.remove());
            return;
        }

        const aside = document.querySelector('aside.rUlQ9EWlNWIMbbZh.Et14spNe2tEZiyY3')
                   || document.querySelector('aside:has(button[data-test-component="schoolButtonChoice"])');
        if (!aside) return;

        const configs = [
            { id: BTN_IDS.ownPupils, text: '👥 Поиск и экспорт своих учеников', bg: '', action: openOwnPupilsModal },
            { id: BTN_IDS.allPupils, text: '🏫 Данные всех учеников школы', bg: '', action: openAllPupilsModal },
            { id: BTN_IDS.teachersSch, text: '📅 Расписание учителей', bg: 'background:linear-gradient(135deg,#0284c7,#0369a1)!important;', action: () => openScheduleModal('teachers') },
            { id: BTN_IDS.classesSch, text: '📅 Расписание классов', bg: 'background:var(--mshhlpr-primary-gradient)!important;', action: () => openScheduleModal('classes') }
        ];

        let prevBtn = null;
        configs.forEach(cfg => {
            let btn = document.getElementById(cfg.id);
            if (!btn) {
                btn = document.createElement('button');
                btn.id = cfg.id;
                btn.type = 'button';
                btn.className = 'mshhlpr-universal-toggle-btn mshhlpr-compact-toggle';
                btn.style.cssText = `${cfg.bg}margin-right:6px!important;flex-shrink:0!important;cursor:pointer!important;`;
                btn.innerHTML = `<span class="mshhlpr-universal-toggle-text" style="color:#fff!important;">${cfg.text}</span>`;
                btn.onclick = e => { e.preventDefault(); e.stopPropagation(); cfg.action(); };
                prevBtn ? prevBtn.after(btn) : aside.prepend(btn);
            }
            prevBtn = btn;
        });
    }

    let scheduled = false;
    new MutationObserver(() => {
        if (!scheduled) {
            scheduled = true;
            requestAnimationFrame(() => { injectExplorerButtons(); scheduled = false; });
        }
    }).observe(document.body, { childList: true, subtree: true });

    injectExplorerButtons();
};