// scripts/exportPupils.js

window.initExportPupils = function () {
    const LOG = '[МЭШ Помогатор][ExportPupils]:';
    const TARGET_PATH = '/teacher/study-process/journal/my';

    // === 1. СЕЛЕКТОРЫ И КОНФИГУРАЦИЯ ===
    const SEL = {
        btnId: 'mesh-export-pupils-btn',
        aside: 'aside.rUlQ9EWlNWIMbbZh.Et14spNe2tEZiyY3',
        asideFallback: 'aside:has(button[data-test-component="schoolButtonChoice"])',
        modalOverlay: '.mshhlpr-modal-overlay'
    };

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const toggleVis = (el, show) => {
        if (!el) return;
        el.classList.toggle('mshhlpr-hidden', !show);
        el.style.setProperty('display', show ? 'inline-flex' : 'none', 'important');
    };

    let activeAbortCtrl = null; 

    // === 2. ВНЕДРЕНИЕ КНОПКИ В ASIDE ===
    function injectExportButton() {
        if (location.pathname.replace(/\/$/, '') !== TARGET_PATH) {
            document.getElementById(SEL.btnId)?.remove();
            return;
        }

        const aside = document.querySelector(SEL.aside) || document.querySelector(SEL.asideFallback);
        if (!aside || aside.querySelector(`#${SEL.btnId}`)) return;

        const btn = document.createElement('button');
        btn.id = SEL.btnId;
        btn.className = 'mshhlpr-universal-toggle-btn mshhlpr-compact-toggle';
        btn.style.cssText = 'margin-right: 6px !important; flex-shrink: 0 !important; cursor: pointer !important;';
        btn.innerHTML = `<span class="mshhlpr-universal-toggle-text">👥 Поиск и экспорт своих учеников</span>`;
        btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openModal(); };

        aside.prepend(btn);
    }

    // === 3. АВТОРИЗАЦИЯ ===
    async function getAuth() {
        const { currentBearerToken: token, currentProfileId: pid, currentAid: aidStore } = await chrome.storage.session.get(['currentBearerToken', 'currentProfileId', 'currentAid']);
        if (!token) throw new Error('Сессионный токен не найден. Обновите страницу.');

        let aid = aidStore || new URLSearchParams(location.search).get('academic_year_id') || '13';
        return {
            headers: { "authorization": `Bearer ${token}`, "profile-id": pid || "", "x-mes-hostid": "9", "x-mes-roleid": "9", "content-type": "application/json", "aid": aid },
            pid, aid
        };
    }

    // === 4. МОДАЛЬНОЕ ОКНО ===
    function openModal() {
        document.querySelectorAll(SEL.modalOverlay).forEach(el => el.remove());

        const ov = document.createElement('div');
        ov.className = 'mshhlpr-modal-overlay';
        ov.innerHTML = `
            <div class="mshhlpr-modal-content" style="width: 1050px; max-width: 96vw; height: 90vh; max-height: 92vh; display: flex; flex-direction: column; overflow: hidden;">
                <div class="mshhlpr-modal-header" style="flex-shrink: 0; padding: 12px 20px;">
                    <span style="font-size: 15px;">👥 Поиск и экспорт своих учеников</span>
                    <button class="mshhlpr-modal-close">×</button>
                </div>
                <div style="padding: 10px 20px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <div id="msh-cache-text" style="font-size: 12.5px; color: #475569; line-height: 1.35;">⏳ Загрузка...</div>
                        <div style="display: flex; gap: 6px;">
                            <button id="msh-btn-excel" class="mshhlpr-universal-toggle-btn mshhlpr-hidden" style="height: 32px;"><span class="mshhlpr-universal-toggle-text">📂 Скачать Excel</span></button>
                            <button id="msh-btn-sync" class="mshhlpr-universal-toggle-btn" style="height: 32px;"><span class="mshhlpr-universal-toggle-text">🔄 Собрать / Обновить</span></button>
                            <button id="msh-btn-stop" class="mshhlpr-btn mshhlpr-btn-danger mshhlpr-hidden" style="height: 32px;">⏹️ Остановить</button>
                            <button id="msh-btn-del" class="mshhlpr-btn mshhlpr-btn-danger mshhlpr-hidden" style="height: 32px; background: #fff!important; color: #dc2626!important; border-color: #fca5a5!important;">🗑️ Удалить базу</button>
                        </div>
                    </div>
                    <div id="msh-diff-box" class="mshhlpr-hidden" style="background:#fff; border:1px solid #bbf7d0; border-radius:6px; padding:8px 12px;"></div>
                    <div id="msh-prog-wrap" class="mshhlpr-hidden" style="flex-direction: column; gap: 3px;">
                        <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; color: #16a34a;">
                            <span id="msh-prog-txt">Сбор данных...</span><span id="msh-prog-pct">0%</span>
                        </div>
                        <div style="width: 100%; height: 5px; background: #e2e8f0; border-radius: 3px; overflow: hidden;">
                            <div id="msh-prog-bar" style="width: 0%; height: 100%; background: var(--mshhlpr-primary-gradient); transition: width .2s;"></div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <input type="text" id="msh-srch-inp" placeholder="🔎 Умный поиск (ФИО, класс, телефон, СНИЛС)..." style="flex: 1; padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; outline: none;">
                        <span id="msh-srch-cnt" style="font-size: 11.5px; font-weight: 700; color: #64748b; white-space: nowrap;">Найдено: 0</span>
                    </div>
                </div>
                <div style="flex: 1; display: flex; overflow: hidden; background: #f1f5f9;">
                    <div id="msh-details-pane" style="flex: 1; padding: 18px; overflow-y: auto; background: #f8fafc;">
                        <div id="msh-empty-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #94a3b8; text-align: center; gap: 8px;">
                            <div style="font-size: 40px;">🔍</div>
                            <div style="font-size: 15px; font-weight: 600; color: #64748b;">Выберите ученика</div>
                            <div style="font-size: 12px; max-width: 320px;">Введите запрос и выберите ученика справа.</div>
                        </div>
                        <div id="msh-card-state" style="display: none;"></div>
                    </div>
                    <div style="width: 320px; border-left: 1px solid #e2e8f0; display: flex; flex-direction: column; background: #fff; flex-shrink: 0;">
                        <ul id="msh-results-list" style="list-style: none; padding: 0; margin: 0; overflow-y: auto; flex: 1;"></ul>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(ov);

        const $ = s => ov.querySelector(s);
        const [cacheTxt, diffBox, btnExcel, btnSync, btnStop, btnDel, progWrap, progBar, progTxt, progPct, srchInp, srchCnt, detailsEmpty, detailsCard, resList] = [
            $('#msh-cache-text'), $('#msh-diff-box'), $('#msh-btn-excel'), $('#msh-btn-sync'), $('#msh-btn-stop'), $('#msh-btn-del'),
            $('#msh-prog-wrap'), $('#msh-prog-bar'), $('#msh-prog-txt'), $('#msh-prog-pct'), $('#msh-srch-inp'), $('#msh-srch-cnt'),
            $('#msh-empty-state'), $('#msh-card-state'), $('#msh-results-list')
        ];

        const close = () => { if (activeAbortCtrl) activeAbortCtrl.abort(); ov.remove(); };
        ov.querySelector('.mshhlpr-modal-close').onclick = close;
        ov.onclick = e => e.target === ov && close();

        let crawlerAbort = { aborted: false }, flatList = [], selectedId = null, currentPid = null;

        // Предварительная индексация для мгновенного поиска
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
            flatList.sort((a, b) => (a["ФИО"] || '').localeCompare(b["ФИО"] || ''));
        }

        function updateState(mode, data = null) {
            const isSync = mode === 'syncing', hasDb = mode === 'has_db';
            toggleVis(btnSync, !isSync);
            toggleVis(btnStop, isSync);
            toggleVis(btnExcel, hasDb && !isSync);
            toggleVis(btnDel, hasDb && !isSync);
            toggleVis(progWrap, isSync);
            srchInp.disabled = !hasDb || isSync;

            if (hasDb && data) {
                indexFlatList(data.data);
                cacheTxt.innerHTML = `<b>База сохранена</b> | Обновлено: <b>${data.date}</b><br>Классов: <b>${Object.keys(data.data).length}</b>, учеников: <b>${flatList.length}</b>`;
                renderResults(srchInp.value);
            } else if (mode === 'no_db') {
                flatList = [];
                cacheTxt.innerHTML = `⚠️ База не сформирована. Нажмите <b>«Собрать / Обновить»</b> для поиска и экспорта.`;
                resList.innerHTML = `<li style="padding:25px; text-align:center; color:#94a3b8; font-size:12px;">База пуста.</li>`;
                detailsEmpty.style.display = 'flex'; detailsCard.style.display = 'none'; srchCnt.textContent = 'Найдено: 0';
            }
        }

        // ИЗОЛИРОВАННАЯ ПРОВЕРКА КЭША
        async function checkCache() {
            try {
                const auth = await getAuth();
                currentPid = auth.pid; // Запоминаем текущего учителя
                
                const keyData = `mesh_students_data_${currentPid}`;
                const keyDate = `mesh_students_date_${currentPid}`;
                
                chrome.storage.local.get([keyData, keyDate], r => {
                    if (r[keyData]) updateState('has_db', { data: r[keyData], date: r[keyDate] });
                    else updateState('no_db');
                });
            } catch (e) {
                updateState('no_db');
            }
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
                li.style.cssText = `padding:8px 12px; border-bottom:1px solid #f1f5f9; cursor:pointer; background:${selectedId === id ? '#e0f2fe' : '#fff'};`;
                li.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;"><b style="font-size:13px;color:#1e293b;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;">${st["ФИО"]}</b><span style="font-size:11px;color:#2e7d32;font-weight:700;border:1px solid #dcfce7;padding:1px 5px;border-radius:3px;">${st.cleanCls}</span></div>
                                <div style="font-size:11px;color:#64748b;margin-top:2px;">ДР: ${st["Дата рождения"] || '—'} ${st["Телефон"] !== '—' ? '• 📞 '+st["Телефон"] : ''}</div>`;
                li.onclick = () => { selectedId = id; renderResults(srchInp.value); renderStudentCard(st); };
                resList.appendChild(li);
            });
        }
        srchInp.oninput = () => renderResults(srchInp.value);

        async function renderStudentCard(st) {
            detailsEmpty.style.display = 'none'; detailsCard.style.display = 'block';
            const id = st["ID System"] || st.id, cls = st.cleanCls || st["Класс"] || '—';

            const parentsHtml = (st.rawParents || []).map(p => `
                <div style="background:#fff; border:1px solid #e2e8f0; border-radius:6px; padding:10px; margin-bottom:6px;">
                    <div style="font-weight:700; color:#2e7d32; font-size:13px;">👤 ${p.type || 'Представитель'}: ${p.name || 'Имя не указано'}</div>
                    <div style="font-size:12px; color:#475569; display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-top:4px;">
                        <div>📞 ${p.phone_number || '—'}</div><div>📧 ${p.email ? `<a href="mailto:${p.email}" style="color:#2e7d32">${p.email}</a>` : '—'}</div>
                        <div style="grid-column:span 2; color:#64748b;">СНИЛС: ${p.snils || '—'}</div>
                    </div>
                </div>`).join('') || '<div style="color:#94a3b8;font-size:12px;">Информация отсутствует.</div>';

            detailsCard.innerHTML = `
                <div class="mshhlpr-modal-header" style="padding:16px 20px; flex-direction:column; align-items:flex-start; border-radius:8px;">
                    <div style="font-size:11px; opacity:.85; text-transform:uppercase;">Карточка ученика</div>
                    <h2 style="margin:0; font-size:22px; color:#fff;">${st["ФИО"]}</h2>
                    <div style="display:flex; gap:8px; margin-top:10px; width:100%; align-items:center; flex-wrap:wrap;">
                        <span class="mshhlpr-badge mshhlpr-badge-green" style="background:rgba(255,255,255,0.22); color:#fff; border:none; padding:4px 10px; font-size:12px;">🎓 Класс: ${cls}</span>
                        <span class="mshhlpr-badge mshhlpr-badge-green" style="background:rgba(255,255,255,0.22); color:#fff; border:none; padding:4px 10px; font-size:12px;">👨‍🏫 Кл. рук: <span id="msh-c-mentor">загрузка...</span></span>
                        <a href="${location.origin}/teacher/group-management/student-card/${id}" target="_blank" style="margin-left:auto; text-decoration:none;">
                            <button class="mshhlpr-universal-toggle-btn" style="background:#fff!important; color:#2e7d32!important; border:none!important; padding:4px 10px!important; cursor:pointer; font-size:12px!important;">🔗 Профиль в МЭШ</button>
                        </a>
                    </div>
                </div>
                <div style="display:flex; flex-direction:column; padding:14px 0; gap:12px;">
                    <div class="mshhlpr-grid-2">
                        <div class="mshhlpr-info-card" style="padding:14px;">
                            <h4 class="mshhlpr-info-title" style="margin-bottom:10px;">Личные данные</h4>
                            <div class="mshhlpr-info-row" style="font-size:13px;">
                                <div class="mshhlpr-info-label">Возраст:</div><div><b>${st["Возраст"] || '—'}</b></div>
                                <div class="mshhlpr-info-label">Пол:</div><div><b>${st["Пол"] === 'М' ? '👦 Муж' : (st["Пол"] === 'Ж' ? '👧 Жен' : '—')}</b></div>
                                <div class="mshhlpr-info-label">Дата рожд:</div><div><b>${st["Дата рождения"] || '—'}</b></div>
                                <div class="mshhlpr-info-label">СНИЛС:</div><div style="font-family:monospace;">${st["СНИЛС"] || '—'}</div>
                                <div class="mshhlpr-info-label">Телефон:</div><div><b>${st["Телефон"] || '—'}</b></div>
                                <div class="mshhlpr-info-label">Email:</div><div><b>${st["Email"] || '—'}</b></div>
                            </div>
                        </div>
                        <div class="mshhlpr-info-card" style="padding:14px;">
                            <h4 class="mshhlpr-info-title" style="margin-bottom:10px;">Школьная информация</h4>
                            <div class="mshhlpr-info-row" style="font-size:13px;">
                                <div class="mshhlpr-info-label">Логин МЭШ:</div><div style="font-family:monospace; font-weight:700; color:#2e7d32;">${st["Логин МЭШ"] || '—'}</div>
                                <div class="mshhlpr-info-label">Пропуски:</div><div><b id="msh-c-att">⏳ ...</b></div>
                                <div class="mshhlpr-info-label">Физкультура:</div><div><b>${st["Группа здоровья"] || '—'}</b></div>
                                <div class="mshhlpr-info-label">ID:</div><div style="font-size:11px; color:#94a3b8;">${id}</div>
                            </div>
                        </div>
                    </div>
                    <div><h4 class="mshhlpr-info-title" style="margin-bottom:8px;">Семья / Представители</h4><div id="msh-c-parents">${parentsHtml}</div></div>
                    <div id="msh-c-status" style="font-size:10.5px; color:#94a3b8; text-align:right;">⚡ Данные из кэша. Запрос актуализации...</div>
                </div>`;

            if (activeAbortCtrl) activeAbortCtrl.abort();
            activeAbortCtrl = new AbortController();
            const signal = activeAbortCtrl.signal;

            try {
                const { headers } = await getAuth();
                const res = await fetch(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/student_profiles/${id}?with_user_info=true&with_attendances_count=true`, { headers: { ...headers, "x-mes-subsystem": "teacherweb" }, signal });
                if (!res.ok) throw new Error(res.status);
                const live = await res.json();
                if (signal.aborted) return;

                detailsCard.querySelector('#msh-c-mentor').textContent = live.mentors?.[0]?.name || 'Не назначен';
                const att = live.non_attendance || 0;
                const attEl = detailsCard.querySelector('#msh-c-att');
                attEl.textContent = att; attEl.style.color = att > 30 ? '#dc2626' : '#1e293b';
                detailsCard.querySelector('#msh-c-status').innerHTML = '✅ Данные сверены с сервером';
            } catch (err) {
                if (signal.aborted) return;
                detailsCard.querySelector('#msh-c-mentor').textContent = '—';
                detailsCard.querySelector('#msh-c-att').textContent = '—';
                detailsCard.querySelector('#msh-c-status').textContent = '⚡ Показаны локальные данные';
            }
        }

        // Действия: Скачивание
        btnExcel.onclick = () => {
            if (!currentPid) return alert('Ошибка идентификации профиля');
            chrome.storage.local.get(`mesh_students_data_${currentPid}`, d => {
                d[`mesh_students_data_${currentPid}`] ? exportToExcel(d[`mesh_students_data_${currentPid}`]) : alert('База пуста');
            });
        };

        // Действия: Удаление ИЗОЛИРОВАННОЙ БАЗЫ
        btnDel.onclick = () => {
            if (!currentPid) return;
            if (!confirm('Удалить сохранённую базу с этого компьютера?')) return;
            chrome.storage.local.remove([`mesh_students_data_${currentPid}`, `mesh_students_date_${currentPid}`], () => {
                toggleVis(diffBox, false); updateState('no_db');
            });
        };

        // Действия: Сбор / Обновление (с сохранением в изолированный ключ)
        btnSync.onclick = async () => {
            if (typeof XLSX === 'undefined') return alert('Ошибка: XLSX библиотека не найдена.');
            
            if (!currentPid) {
                try {
                    const auth = await getAuth();
                    currentPid = auth.pid;
                } catch(e) {
                    return alert('Не удалось получить токен. Обновите страницу.');
                }
            }

            const keyData = `mesh_students_data_${currentPid}`;
            const keyDate = `mesh_students_date_${currentPid}`;

            const oldData = await new Promise(r => chrome.storage.local.get(keyData, d => r(d[keyData] || null)));

            crawlerAbort.aborted = false;
            updateState('syncing');

            btnStop.onclick = () => { crawlerAbort.aborted = true; progTxt.textContent = 'Остановка...'; };

            try {
                const finalData = await runCrawler(crawlerAbort, (done, tot, txt) => {
                    const pct = Math.round((done / Math.max(1, tot)) * 100);
                    progBar.style.width = `${pct}%`; progPct.textContent = `${pct}%`; progTxt.textContent = txt;
                });

                if (crawlerAbort.aborted) {
                    alert('Сбор остановлен. Данные сохранены без изменений.');
                    checkCache(); return;
                }

                if (finalData) {
                    const date = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                    const toSave = {};
                    toSave[keyData] = finalData;
                    toSave[keyDate] = date;

                    chrome.storage.local.set(toSave, () => {
                        updateState('has_db', { data: finalData, date });
                        renderDiff(diffBox, oldData, finalData);
                    });
                }
            } catch (e) {
                console.error(LOG, e);
                alert('Ошибка: ' + e.message);
                checkCache();
            }
        };
    }

    // === 5. КРАУЛЕР С ЗАЩИТОЙ ОТ ДУБЛЕЙ И СПАМ-ОШИБОК ===
    function cleanClassName(g) {
        if (g.class_unit_name?.trim()) return g.class_unit_name.trim();
        const raw = (g.short_name || g.name || '').trim();
        const m = raw.match(/\b\d{1,2}[-_ ]?[А-Яа-яA-Za-z]?\d*\b/);
        return m ? m[0].replace('_', '-').replace(/\s+/g, '') : (raw || `Группа_${g.id}`);
    }

    async function runCrawler(abortCtrl, onProgress) {
        const { headers, pid, aid } = await getAuth();
        onProgress(0, 100, 'Запрос классов...');

        let teacherId = pid;
        let profRes = await fetch(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/teacher_profiles/${teacherId}?with_assigned_groups=true&with_replacement_groups=true`, { headers: { ...headers, "x-mes-subsystem": "teacherweb" } });

        if (!profRes.ok) {
            const sess = await (await fetch("https://authedu.mosreg.ru/api/ej/acl/v1/sessions", { method: "POST", headers: { ...headers, "x-mes-subsystem": "teacherweb" }, body: JSON.stringify({ auth_token: headers.authorization.replace('Bearer ', '') }) })).json();
            teacherId = sess.profiles?.find(p => p.type === 'teacher')?.id || teacherId;
            profRes = await fetch(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/teacher_profiles/${teacherId}?with_assigned_groups=true&with_replacement_groups=true`, { headers: { ...headers, "profile-id": String(teacherId), "x-mes-subsystem": "teacherweb" } });
        }

        const groupIds = (await profRes.json()).assigned_group_ids || [];
        if (!groupIds.length) throw new Error('Классы не найдены.');

        onProgress(5, 100, 'Консолидация групп...');
        const groupsUrl = `https://authedu.mosreg.ru/api/ej/plan/teacher/v1/groups?page=1&academic_year_id=${aid}&group_ids=${groupIds.join(',')}&with_periods_schedule_id=true&per_page=300`;
        let groupsData = await (await fetch(groupsUrl, { headers: { ...headers, "x-mes-subsystem": "journalw" } })).json();
        if (!Array.isArray(groupsData)) groupsData = groupsData.groups || [];

        const classMap = new Map();
        groupsData.forEach(g => {
            const cls = cleanClassName(g);
            if (!classMap.has(cls)) classMap.set(cls, new Set());
            (g.student_ids || []).forEach(id => classMap.get(cls).add(id));
        });

        const uniqueClasses = Array.from(classMap.entries()).map(([cls, ids]) => ({ cls, ids: Array.from(ids) }));
        uniqueClasses.sort((a, b) => a.cls.localeCompare(b.cls, undefined, { numeric: true }));

        const finalData = {};
        let consecErrors = 0;

        for (let i = 0; i < uniqueClasses.length; i++) {
            if (abortCtrl.aborted) break;
            const { cls, ids } = uniqueClasses[i];
            if (!ids.length) { finalData[cls] = []; continue; }

            const students = await mapConcurrent(ids, 4, async (sid, sIdx) => {
                if (abortCtrl.aborted) return null;
                if (consecErrors >= 4) throw new Error('МЭШ вернул много ошибок подряд (лимит или сбой). Сбор прерван.');

                onProgress(i + (sIdx / ids.length), uniqueClasses.length, `${cls}: ученик ${sIdx + 1}/${ids.length}`);

                try {
                    const res = await fetch(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/student_profiles/${sid}?with_user_info=true&with_attendances_count=true`, { headers: { ...headers, "x-mes-subsystem": "teacherweb" } });
                    if (res.status === 429 || res.status === 401) throw new Error(`HTTP ${res.status}`);
                    if (!res.ok) throw new Error();
                    const raw = await res.json();
                    consecErrors = 0;
                    return parseStudent(raw, cls);
                } catch (e) {
                    consecErrors++;
                    if (e.message.includes('429') || e.message.includes('401')) throw e;
                    await sleep(1000);
                    try {
                        const r2 = await fetch(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/student_profiles/${sid}?with_user_info=true&with_attendances_count=true`, { headers: { ...headers, "x-mes-subsystem": "teacherweb" } });
                        if (r2.ok) { consecErrors = 0; return parseStudent(await r2.json(), cls); }
                    } catch {}
                    return { "ID System": sid, "Класс": cls, "ФИО": `Ошибка загрузки (ID: ${sid})`, "Пол": "—", "Дата рождения": "—", "Возраст": "—", "Телефон": "—", "Email": "—", "СНИЛС": "—", "Логин МЭШ": "—", "Группа здоровья": "—", "Родитель 1": "Ошибка", "Родитель 2": "", rawParents: [] };
                }
            });

            const valid = students.filter(Boolean);
            valid.sort((a, b) => a["ФИО"].localeCompare(b["ФИО"]));
            finalData[cls] = valid;
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
            "Группа здоровья": { 1: 'Основная (1)', 2: 'Подгот. (2)', 3: 'Спец. А (3)', 4: 'Спец. Б (4)' }[raw.physical_training_group_id] || '—',
            "Родитель 1": fmtP(parents[0]), "Родитель 2": fmtP(parents[1]),
            rawParents: parents
        };
    }

    // === 6. ОТЧЕТ ОБ ИЗМЕНЕНИЯХ (DIFF) ===
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

    // === 7. ГЕНЕРАЦИЯ EXCEL ===
    function exportToExcel(data) {
        const wb = XLSX.utils.book_new();

        const extractParent = (pObj, pStr) => {
            if (pObj) {
                return {
                    fio: (pObj.name || "—").replace(/^\[.*?\]\s*/, '').trim() || "—",
                    type: pObj.type || "—",
                    phone: pObj.phone_number || "—",
                    email: pObj.email || "—",
                    snils: pObj.snils || "—"
                };
            }
            if (pStr && typeof pStr === 'string' && pStr.trim()) {
                const lines = pStr.split('\n');
                const firstLine = lines[0] || '';
                const typeMatch = firstLine.match(/^\[(.*?)\]/);
                const getVal = prefix => {
                    const l = lines.find(x => x.toLowerCase().startsWith(prefix.toLowerCase()));
                    return l ? l.split(':').slice(1).join(':').trim() || "—" : "—";
                };
                return {
                    fio: firstLine.replace(/^\[.*?\]\s*/, '').trim() || "—",
                    type: typeMatch ? typeMatch[1] : "—",
                    phone: getVal('Тел'),
                    email: getVal('Email'),
                    snils: getVal('СНИЛС')
                };
            }
            return { fio: "—", type: "—", phone: "—", email: "—", snils: "—" };
        };

        const formatRow = (s, num) => {
            const p1 = extractParent(s.rawParents?.[0], s["Родитель 1"]);
            const p2 = extractParent(s.rawParents?.[1], s["Родитель 2"]);

            return {
                "№": num,
                "ID System": s["ID System"] || s.id || "—",
                "ФИО": s["ФИО"] || "Без имени",
                "Класс": s["Класс"] || s.cleanCls || "—",
                "Пол": s["Пол"] || "—",
                "Дата рождения": s["Дата рождения"] || "—",
                "Возраст": s["Возраст"] || "—",
                "Телефон": s["Телефон"] || "—",
                "Email": s["Email"] || "—",
                "СНИЛС": s["СНИЛС"] || "—",
                "Логин МЭШ": s["Логин МЭШ"] || "—",
                "Группа здоровья": s["Группа здоровья"] || "—",
                "Родитель 1: ФИО": p1.fio,
                "Родитель 1: Кем приходится": p1.type,
                "Родитель 1: Телефон": p1.phone,
                "Родитель 1: Email": p1.email,
                "Родитель 1: СНИЛС": p1.snils,
                "Родитель 2: ФИО": p2.fio,
                "Родитель 2: Кем приходится": p2.type,
                "Родитель 2: Телефон": p2.phone,
                "Родитель 2: Email": p2.email,
                "Родитель 2: СНИЛС": p2.snils
            };
        };

        const getColsAutoWidth = (rows) => {
            if (!rows.length) return [];
            return Object.keys(rows[0]).map(key => {
                let maxLen = key.length;
                rows.forEach(r => {
                    const val = r[key];
                    if (val !== null && val !== undefined) {
                        const len = String(val).length;
                        if (len > maxLen) maxLen = len;
                    }
                });
                return { wch: Math.min(Math.max(maxLen + 3, 6), 45) };
            });
        };

        const allList = [];
        const seen = new Set();
        let gIdx = 1;

        Object.values(data).forEach(list => list.forEach(s => {
            const id = s["ID System"] || s.id;
            if (id && !seen.has(id)) {
                seen.add(id);
                allList.push(formatRow(s, gIdx++));
            }
        }));

        if (allList.length) {
            const wsAll = XLSX.utils.json_to_sheet(allList);
            wsAll['!cols'] = getColsAutoWidth(allList);
            XLSX.utils.book_append_sheet(wb, wsAll, "Все ученики");
        }

        Object.entries(data).forEach(([cls, list]) => {
            if (!list.length) return;
            const classRows = list.map((s, i) => formatRow(s, i + 1));
            const wsClass = XLSX.utils.json_to_sheet(classRows);
            wsClass['!cols'] = getColsAutoWidth(classRows);

            const safeSheetName = cls.replace(/[\\/?*[\]]/g, '').substring(0, 31) || "Класс";
            XLSX.utils.book_append_sheet(wb, wsClass, safeSheetName);
        });

        const dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `База_учеников_${dateStr}.xlsx`);
    }

    async function mapConcurrent(arr, limit, fn) {
        const res = new Array(arr.length), exec = [];
        for (let i = 0; i < arr.length; i++) {
            const p = Promise.resolve().then(() => fn(arr[i], i)).then(r => res[i] = r);
            exec.push(p);
            if (exec.length >= limit) await Promise.race(exec);
        }
        await Promise.all(exec);
        return res;
    }

    // === 8. НАБЛЮДАТЕЛЬ ===
    let isScheduled = false;
    new MutationObserver(() => {
        if (!isScheduled) {
            isScheduled = true;
            requestAnimationFrame(() => { injectExportButton(); isScheduled = false; });
        }
    }).observe(document.body, { childList: true, subtree: true });

    injectExportButton();
};