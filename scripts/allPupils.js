// scripts/allPupils.js

window.initAllPupils = function () {
    const TARGET_PATH = '/teacher/study-process/journal/my';
    const BTN_ID = 'mesh-all-pupils-btn';
    const MODAL_ID = 'mshhlpr-all-pupils-modal';
    const TIMEOUT_MS = 8000;

    const pad = n => String(n).padStart(2, '0');
    const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const catalog = {
        token: null, profileId: "", schoolId: null, aid: "14",
        classes: [], bldMap: new Map(), teacherMap: new Map(), myGroupIds: new Set(),
        isLoaded: false, isLoading: false
    };

    let classAbort = null, studentAbort = null;

    const getWeekRange = (offset = 0) => {
        const d = new Date();
        if (offset) d.setDate(d.getDate() + offset * 7);
        const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() || 7) - 1));
        const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
        return { from: fmtDate(mon), to: fmtDate(sun) };
    };

    async function ensureAuth() {
        const s = await chrome.storage.session.get(['currentBearerToken', 'currentProfileId', 'currentAid']);
        if (!s.currentBearerToken) throw new Error('Токен не найден. Обновите страницу.');

        // Если сменился аккаунт учителя без перезагрузки вкладки — сбрасываем кэш
        if (catalog.profileId && s.currentProfileId && String(s.currentProfileId) !== String(catalog.profileId)) {
            catalog.schoolId = null;
            catalog.isLoaded = false;
            catalog.classes = [];
            catalog.bldMap.clear();
            catalog.teacherMap.clear();
            catalog.myGroupIds.clear();
        }

        catalog.token = s.currentBearerToken;
        catalog.profileId = s.currentProfileId || catalog.profileId || "";
        catalog.aid = String(s.currentAid || new URLSearchParams(location.search).get('academic_year_id') || "14");
        if (catalog.schoolId && catalog.profileId) return;

        const ctrl = new AbortController(), tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
            const r = await fetch("https://authedu.mosreg.ru/api/ej/acl/v1/sessions", {
                method: "POST", signal: ctrl.signal,
                headers: { "accept": "application/json", "content-type": "application/json", "authorization": `Bearer ${catalog.token}`, "x-mes-subsystem": "teacherweb", "x-mes-hostid": "9", "x-mes-roleid": "9" },
                body: JSON.stringify({ auth_token: catalog.token })
            });
            if (r.ok) {
                const d = await r.json();
                const t = d.profiles?.find(p => p.type === 'teacher' || p.profile_type === 'teacher') || d.profiles?.[0];
                catalog.schoolId = t?.school_id || t?.organization_id || d.school_id || null;
                if (!catalog.profileId) catalog.profileId = t?.id || "";
            }
        } finally { clearTimeout(tid); }
    }

    async function apiGet(url, sub = 'teacherweb', extSignal = null) {
        await ensureAuth();
        const ctrl = new AbortController(), tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        if (extSignal) {
            if (extSignal.aborted) { clearTimeout(tid); throw new DOMException('Aborted', 'AbortError'); }
            extSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
        }
        try {
            const r = await fetch(url, {
                headers: { "authorization": `Bearer ${catalog.token}`, "profile-id": String(catalog.profileId), "x-mes-subsystem": sub, "x-mes-hostid": "9", "x-mes-roleid": "9", "aid": catalog.aid, "accept": "application/json" },
                signal: ctrl.signal
            });
            return r.ok ? await r.json() : null;
        } catch (e) {
            if (extSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
            return null;
        } finally { clearTimeout(tid); }
    }

    async function loadSchoolCatalog() {
        await ensureAuth();
        if (catalog.isLoaded) return;
        if (catalog.isLoading) {
            while (catalog.isLoading) await new Promise(r => setTimeout(r, 80));
            return;
        }
        catalog.isLoading = true;
        try {
            const sq = catalog.schoolId ? `&school_id=${catalog.schoolId}` : '';

            const [bList, cList, tPage1, myProf] = await Promise.all([
                apiGet(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/buildings?per_page=100${sq}`),
                apiGet(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/class_units?per_page=300${sq}`),
                apiGet(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/teacher_profiles?per_page=100&page=1${sq}`),
                catalog.profileId ? apiGet(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/teacher_profiles/${catalog.profileId}?with_assigned_groups=true&with_replacement_groups=true`) : null
            ]);

            catalog.myGroupIds = new Set([
                ...(myProf?.assigned_group_ids || []),
                ...(myProf?.replacement_group_ids || [])
            ].map(Number));

            catalog.bldMap.clear();
            (Array.isArray(bList) ? bList : (bList?.buildings || [])).forEach(b => catalog.bldMap.set(b.id, b.name));

            catalog.teacherMap.clear();
            const addTeachers = res => {
                const list = Array.isArray(res) ? res : (res?.teacher_profiles || res?.data || []);
                list.forEach(t => {
                    const u = t.user || t.person || t;
                    const fio = `${u.last_name || ''} ${u.first_name || ''} ${u.middle_name || ''}`.trim();
                    if (fio) catalog.teacherMap.set(t.id, fio);
                });
                return list.length;
            };

            if (addTeachers(tPage1) === 100) {
                for (let page = 2; page <= 10; page++) {
                    const res = await apiGet(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/teacher_profiles?per_page=100&page=${page}${sq}`);
                    if (addTeachers(res) < 100) break;
                }
            }

            const rawClasses = Array.isArray(cList) ? cList : (cList?.class_units || cList?.data || []);
            catalog.classes = rawClasses.map(c => ({
                id: c.id,
                name: (c.name || c.unit_name || `Класс #${c.id}`).trim(),
                buildingName: catalog.bldMap.get(c.building_id) || 'Корпус не указан',
                studentCount: c.student_count ?? null,
                mentorName: catalog.teacherMap.get(c.mentor_ids?.[0] || c.mentor_id) || 'Не назначен'
            })).sort((a, b) => (parseInt(a.name, 10) || 0) - (parseInt(b.name, 10) || 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));

            catalog.isLoaded = true;
        } finally { catalog.isLoading = false; }
    }

    async function fetchClassStudents(clsObj, signal) {
        let items = [];
        for (const offset of [0, -1, -2, 1]) {
            const w = getWeekRange(offset);
            const raw = await apiGet(`https://authedu.mosreg.ru/api/ej/plan/teacher/v1/schedule_items?academic_year_id=${catalog.aid}&class_unit_id=${clsObj.id}&from=${w.from}&to=${w.to}&original=true&per_page=400`, 'journalw', signal);
            items = Array.isArray(raw) ? raw : (raw?.schedule_items || []);
            if (items.length) break;
        }

        const gIds = [...new Set(items.map(l => l.group_id).filter(Boolean))];
        if (!gIds.length) return [];

        const sIds = new Set(), ownStudentIds = new Set();
        for (let i = 0; i < gIds.length; i += 50) {
            const raw = await apiGet(`https://authedu.mosreg.ru/api/ej/plan/teacher/v1/groups?group_ids=${gIds.slice(i, i + 50).join(',')}&academic_year_id=${catalog.aid}&per_page=100`, 'journalw', signal);
            (Array.isArray(raw) ? raw : (raw?.groups || [])).forEach(g => {
                const isMyGrp = catalog.myGroupIds.has(Number(g.id));
                (g.student_ids || []).forEach(id => {
                    const numId = Number(id);
                    sIds.add(numId);
                    if (isMyGrp) ownStudentIds.add(numId);
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

        return idsArr.map(id => ({
            id,
            fio: namesMap.get(id) || `Ученик (ID: ${id})`,
            className: clsObj.name,
            buildingName: clsObj.buildingName,
            mentorName: clsObj.mentorName,
            isOwn: ownStudentIds.has(id)
        })).sort((a, b) => a.fio.localeCompare(b.fio, 'ru'));
    }

    function openModal() {
        document.querySelectorAll('.mshhlpr-modal-overlay').forEach(el => el.remove());

        const ov = document.createElement('div');
        ov.id = MODAL_ID;
        ov.className = 'mshhlpr-modal-overlay';
        ov.innerHTML = `
            <div class="mshhlpr-modal-content" style="width:1100px;max-width:96vw;height:88vh;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;">
                <div class="mshhlpr-modal-header" style="flex-shrink:0;padding:12px 20px;">
                    <span style="font-size:15px;">🏫 Данные всех учеников школы</span>
                    <button class="mshhlpr-modal-close">×</button>
                </div>
                <div id="msh-ap-body" style="flex:1;display:flex;flex-direction:column;overflow:hidden;background:#f1f5f9;">
                    <div style="display:flex;justify-content:center;align-items:center;height:100%;color:#2e7d32;font-weight:600;gap:10px;">
                        <div class="mshhlpr-loader-icon">⏳</div><span>Загрузка списка классов школы...</span>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(ov);

        const close = () => { classAbort?.abort(); studentAbort?.abort(); ov.remove(); };
        ov.querySelector('.mshhlpr-modal-close').onclick = close;
        ov.onclick = e => e.target === ov && close();

        loadSchoolCatalog()
            .then(() => document.body.contains(ov) && renderMainLayout(ov.querySelector('#msh-ap-body')))
            .catch(e => {
                const b = ov.querySelector('#msh-ap-body');
                if (b) b.innerHTML = `<div style="padding:30px;text-align:center;color:#dc2626;font-weight:600;">❌ ${e.message}</div>`;
            });
    }

    function renderMainLayout(container) {
        const counts = {};
        catalog.classes.forEach(c => { counts[c.buildingName] = (counts[c.buildingName] || 0) + 1; });

        const bldOpts = `<option value="all">Все корпуса (${catalog.classes.length} кл.)</option>` +
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
                    <div style="padding:8px 12px;font-size:11.5px;font-weight:700;color:#64748b;background:#f8fafc;border-bottom:1px solid #e2e8f0;text-transform:uppercase;">
                        Классы школы (<span id="msh-ap-cls-cnt">0</span>)
                    </div>
                    <ul id="msh-ap-cls-list" style="list-style:none;margin:0;padding:0;overflow-y:auto;flex:1;"></ul>
                </div>
                <div style="width:340px;background:#fff;border-right:1px solid #e2e8f0;display:flex;flex-direction:column;flex-shrink:0;">
                    <div id="msh-ap-stu-hdr" style="padding:8px 12px;font-size:11.5px;font-weight:700;color:#64748b;background:#f8fafc;border-bottom:1px solid #e2e8f0;text-transform:uppercase;">
                        Ученики класса
                    </div>
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

        const toggleCopyBtn = show => {
            copyBtn.classList.toggle('mshhlpr-hidden', !show);
            copyBtn.style.setProperty('display', show ? 'inline-flex' : 'none', 'important');
        };

        function renderClassList() {
            const bVal = bldSel.value, q = clsSrch.value.trim().toLowerCase();
            const list = catalog.classes.filter(c => (bVal === 'all' || c.buildingName === bVal) && (!q || c.name.toLowerCase().includes(q) || c.mentorName.toLowerCase().includes(q)));

            clsCnt.textContent = list.length;
            if (!list.length) {
                clsListEl.innerHTML = `<li style="padding:20px;text-align:center;color:#94a3b8;font-size:12px;">Классы не найдены</li>`;
                return;
            }

            clsListEl.innerHTML = '';
            list.forEach(c => {
                const isSel = selectedClass?.id === c.id;
                const li = document.createElement('li');
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
            selectedClass = clsObj;
            selectedStudentId = null;
            currentStudents = [];
            stuSrch.value = '';
            stuSrch.disabled = true;
            toggleCopyBtn(false);
            renderClassList();

            classAbort?.abort();
            studentAbort?.abort();
            classAbort = new AbortController();
            const signal = classAbort.signal;

            stuHdr.textContent = `Класс ${clsObj.name} — загрузка...`;
            stuListEl.innerHTML = `<li style="padding:40px 15px;text-align:center;color:#2e7d32;font-weight:600;"><div class="mshhlpr-loader-icon">⏳</div><div style="font-size:12.5px;margin-top:8px;">Собираем список ${clsObj.name}...</div></li>`;
            detailsEl.innerHTML = '';

            try {
                const list = await fetchClassStudents(clsObj, signal);
                if (signal.aborted) return;
                currentStudents = list;
                stuSrch.disabled = !list.length;
                toggleCopyBtn(list.length > 0);
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
            if (!list.length) {
                stuListEl.innerHTML = `<li style="padding:25px;text-align:center;color:#94a3b8;font-size:12px;">Ученики не найдены</li>`;
                return;
            }

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
            const badgeStyle = 'background:rgba(255,255,255,0.22);color:#fff;border:none;padding:4px 10px;font-size:12px;';
            detailsEl.innerHTML = `
                <div class="mshhlpr-modal-header" style="padding:16px 20px;flex-direction:column;align-items:flex-start;border-radius:8px;">
                    <div style="font-size:11px;opacity:.85;text-transform:uppercase;">Сводка по классу</div>
                    <h2 style="margin:2px 0 0 0;font-size:22px;color:#fff;">Класс ${clsObj.name}</h2>
                    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
                        <span class="mshhlpr-badge mshhlpr-badge-green" style="${badgeStyle}">👥 Учеников: ${list.length}</span>
                        <span class="mshhlpr-badge mshhlpr-badge-green" style="${badgeStyle}">👩‍🏫 Кл. рук: ${clsObj.mentorName}</span>
                        <span class="mshhlpr-badge mshhlpr-badge-green" style="${badgeStyle}">🏢 ${clsObj.buildingName}</span>
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
            studentAbort?.abort();
            const badgeStyle = 'background:rgba(255,255,255,0.22);color:#fff;border:none;padding:4px 10px;font-size:12px;';

            const renderShortCard = () => {
                detailsEl.innerHTML = `
                    <div class="mshhlpr-modal-header" style="padding:16px 20px;flex-direction:column;align-items:flex-start;border-radius:8px;">
                        <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
                            <span style="font-size:11px;opacity:.85;text-transform:uppercase;">Карточка ученика</span>
                            <button id="msh-ap-back" style="background:rgba(255,255,255,0.2);border:none;color:#fff;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px;font-weight:600;">⬅ К списку ФИО класса</button>
                        </div>
                        <h2 style="margin:4px 0 0 0;font-size:22px;color:#fff;">${st.fio}</h2>
                        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
                            <span class="mshhlpr-badge mshhlpr-badge-green" style="${badgeStyle}">🎓 Класс: ${st.className}</span>
                            <span class="mshhlpr-badge mshhlpr-badge-green" style="${badgeStyle}">👩‍🏫 Кл. рук: ${st.mentorName}</span>
                        </div>
                    </div>
                    <div class="mshhlpr-info-card" style="margin-top:14px;padding:14px;">
                        <h4 class="mshhlpr-info-title" style="margin-bottom:10px;">Школьная информация</h4>
                        <div class="mshhlpr-info-row" style="font-size:13px;">
                            <div class="mshhlpr-info-label">Корпус:</div><div><b>${st.buildingName}</b></div>
                            <div class="mshhlpr-info-label">ID в МЭШ:</div><div style="font-size:12px;color:#64748b;font-family:monospace;">${st.id}</div>
                        </div>
                    </div>`;
                detailsEl.querySelector('#msh-ap-back').onclick = () => {
                    selectedStudentId = null;
                    renderStudentList();
                    renderClassSummary(selectedClass, currentStudents);
                };
            };

            // Для учеников из чужих классов/групп сразу показываем только Корпус и ID без лишних запросов к серверу
            if (!st.isOwn) return renderShortCard();

            studentAbort = new AbortController();
            const signal = studentAbort.signal;
            detailsEl.innerHTML = `<div style="padding:40px;text-align:center;color:#2e7d32;font-weight:600;"><div class="mshhlpr-loader-icon">⏳</div><div>Загрузка карточки: ${st.fio}...</div></div>`;

            const live = await apiGet(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/student_profiles/${st.id}?with_user_info=true&with_attendances_count=true`, 'teacherweb', signal).catch(() => null);
            if (signal.aborted) return;

            const u = live?.user || live?.person || live || {};
            if (!live || (!u.last_name && !u.full_name && !live.snils)) return renderShortCard();

            const sexStr = (u.sex || live.sex) === 'male' ? '👦 Муж' : ((u.sex || live.sex) === 'female' ? '👧 Жен' : '—');
            const peGroup = { 1: 'Основная (1)', 2: 'Подгот. (2)', 3: 'Спец. А (3)', 4: 'Спец. Б (4)' }[live.physical_training_group_id] || '—';

            const parentsHtml = (live.parents || []).map(p => `
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:10px;margin-bottom:6px;">
                    <div style="font-weight:700;color:#2e7d32;font-size:13px;">👤 ${p.type || 'Представитель'}: ${p.name || 'Имя не указано'}</div>
                    <div style="font-size:12px;color:#475569;display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:4px;">
                        <div>📞 ${p.phone_number || '—'}</div>
                        <div>📧 ${p.email ? `<a href="mailto:${p.email}" style="color:#2e7d32">${p.email}</a>` : '—'}</div>
                        <div style="grid-column:span 2;color:#64748b;">СНИЛС: ${p.snils || '—'}</div>
                    </div>
                </div>`).join('') || `<div style="color:#94a3b8;font-size:12px;">Информация о представителях отсутствует.</div>`;

            detailsEl.innerHTML = `
                <div class="mshhlpr-modal-header" style="padding:16px 20px;flex-direction:column;align-items:flex-start;border-radius:8px;">
                    <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
                        <span style="font-size:11px;opacity:.85;text-transform:uppercase;">Карточка ученика</span>
                        <button id="msh-ap-back" style="background:rgba(255,255,255,0.2);border:none;color:#fff;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px;font-weight:600;">⬅ К списку ФИО класса</button>
                    </div>
                    <h2 style="margin:4px 0 0 0;font-size:22px;color:#fff;">${st.fio}</h2>
                    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
                        <span class="mshhlpr-badge mshhlpr-badge-green" style="${badgeStyle}">🎓 Класс: ${st.className}</span>
                        <span class="mshhlpr-badge mshhlpr-badge-green" style="${badgeStyle}">👩‍🏫 Кл. рук: ${live.mentors?.[0]?.name || st.mentorName}</span>
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;padding:14px 0;gap:12px;">
                    <div class="mshhlpr-grid-2">
                        <div class="mshhlpr-info-card" style="padding:14px;">
                            <h4 class="mshhlpr-info-title" style="margin-bottom:10px;">Личные данные</h4>
                            <div class="mshhlpr-info-row" style="font-size:13px;">
                                <div class="mshhlpr-info-label">Возраст:</div><div><b>${live.age ? `${live.age} лет` : '—'}</b></div>
                                <div class="mshhlpr-info-label">Пол:</div><div><b>${sexStr}</b></div>
                                <div class="mshhlpr-info-label">Дата рожд:</div><div><b>${u.birth_date || live.birth_date || '—'}</b></div>
                                <div class="mshhlpr-info-label">СНИЛС:</div><div style="font-family:monospace;">${live.snils || '—'}</div>
                                <div class="mshhlpr-info-label">Телефон:</div><div><b>${u.phone_number || live.phone_number || '—'}</b></div>
                                <div class="mshhlpr-info-label">Email:</div><div><b>${u.email || live.email || '—'}</b></div>
                            </div>
                        </div>
                        <div class="mshhlpr-info-card" style="padding:14px;">
                            <h4 class="mshhlpr-info-title" style="margin-bottom:10px;">Школьная информация</h4>
                            <div class="mshhlpr-info-row" style="font-size:13px;">
                                <div class="mshhlpr-info-label">Корпус:</div><div><b>${st.buildingName}</b></div>
                                <div class="mshhlpr-info-label">Логин МЭШ:</div><div style="font-family:monospace;font-weight:700;color:#2e7d32;">${live.gusoev_login || '—'}</div>
                                <div class="mshhlpr-info-label">Пропуски:</div><div><b>${live.non_attendance ?? '—'}</b></div>
                                <div class="mshhlpr-info-label">Физкультура:</div><div><b>${peGroup}</b></div>
                                <div class="mshhlpr-info-label">ID в МЭШ:</div><div style="font-size:11px;color:#94a3b8;font-family:monospace;">${st.id}</div>
                            </div>
                        </div>
                    </div>
                    <div>
                        <h4 class="mshhlpr-info-title" style="margin-bottom:8px;">Семья / Представители</h4>
                        <div>${parentsHtml}</div>
                    </div>
                </div>`;

            detailsEl.querySelector('#msh-ap-back').onclick = () => {
                selectedStudentId = null;
                renderStudentList();
                renderClassSummary(selectedClass, currentStudents);
            };
        }

        copyBtn.onclick = () => {
            if (!currentStudents.length) return;
            navigator.clipboard.writeText(currentStudents.map(s => s.fio).join('\n')).then(() => {
                const span = copyBtn.querySelector('.mshhlpr-universal-toggle-text');
                const orig = span.textContent;
                span.textContent = `✅ Скопировано (${currentStudents.length} чел.)!`;
                setTimeout(() => { span.textContent = orig; }, 1800);
            });
        };

        bldSel.onchange = renderClassList;
        clsSrch.oninput = renderClassList;
        stuSrch.oninput = renderStudentList;
        renderClassList();
    }

    function injectAllPupilsButton() {
        if (location.pathname.replace(/\/$/, '') !== TARGET_PATH) {
            document.getElementById(BTN_ID)?.remove();
            return;
        }

        const aside = document.querySelector('aside.rUlQ9EWlNWIMbbZh.Et14spNe2tEZiyY3')
                   || document.querySelector('aside:has(button[data-test-component="schoolButtonChoice"])');
        if (!aside || aside.querySelector(`#${BTN_ID}`)) return;

        const btn = document.createElement('button');
        btn.id = BTN_ID;
        btn.type = 'button';
        btn.className = 'mshhlpr-universal-toggle-btn mshhlpr-compact-toggle';
        btn.style.cssText = 'margin-right:6px!important;flex-shrink:0!important;cursor:pointer!important;';
        btn.innerHTML = `<span class="mshhlpr-universal-toggle-text">🏫 Данные всех учеников школы</span>`;
        btn.onclick = e => { e.preventDefault(); e.stopPropagation(); openModal(); };

        const ownBtn = document.getElementById('mesh-export-pupils-btn');
        ownBtn?.parentElement === aside ? ownBtn.after(btn) : aside.prepend(btn);
    }

    let scheduled = false;
    new MutationObserver(() => {
        if (!scheduled) {
            scheduled = true;
            requestAnimationFrame(() => { injectAllPupilsButton(); scheduled = false; });
        }
    }).observe(document.body, { childList: true, subtree: true });

    injectAllPupilsButton();
};