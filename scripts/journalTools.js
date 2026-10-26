// scripts/journalTools.js

window.initJournalTools = function () {
    console.log('[МЭШ][journalTools] 🚀 Глобальная инициализация расширения.');

    // --- УТИЛИТЫ И КЭШ ---
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const logMW = (...a) => console.log('[МЭШ][journalTools][modalWindows]', ...a);
    const logCL = (...a) => console.log('[МЭШ][journalTools][classLists]', ...a);
    const logMV = (...a) => console.log('[МЭШ][journalTools][marksValidator]', ...a);
    const logSC = (...a) => console.log('[МЭШ][journalTools][studentCard]', ...a);

    const TEST_BIRTHDAY_DATE = null;
    let lastGroupId = null;
    let classCache = { groupId: null, classUnitId: null, className: "", profiles: [], absentIds: [], isLoaded: false, isLoading: false, classLevelId: null };
    let rouletteState = { participants: [], excluded: [], currentRotation: 0, isSpinning: false };
    
    let valCfg = null, valCfgLoading = false; 
    let valState = { mode: null, running: false, abort: false, sig: "" };
    let valCache = { grp: null }; 
    let cellMarksCache = {}, isMuted = false;
    let silentMarkTimeout = null;

    const getSuperscript = w => {
        const map = { '1': '', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
        return String(w) in map ? map[String(w)] : `^${w}`;
    };

    const chunkArray = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size).join(', ')).join(',\n  ');

    // ЕДИНЫЙ ГЕНЕРАТОР МОДАЛЬНЫХ ОКОН
    const createModal = (width, html, overflowY = 'auto') => {
        document.querySelectorAll('.mshhlpr-modal-overlay').forEach(el => el.remove());
        const ov = document.createElement('div'); 
        ov.className = 'mshhlpr-modal-overlay';
        ov.innerHTML = `<div class="mshhlpr-modal-content" style="width:${width}; max-width:95vw; max-height:90vh; display:flex; flex-direction:column; padding:0; overflow-y:${overflowY};">${html}</div>`;
        document.body.appendChild(ov);
        const close = () => ov.remove();
        ov.addEventListener('click', e => { if (e.target === ov) close(); });
        const closeBtn = ov.querySelector('.mshhlpr-modal-close');
        if (closeBtn) closeBtn.onclick = close;
        return { ov, close };
    };

    const getWeightedMarks = (row) => {
        return Array.from(row.querySelectorAll('.R4p7ZXgwQ59R96TEeVm3')).filter(e => {
            const isFinal = e.closest('div[data-test-component*="final"]') || e.closest('td[class*="final"]');
            return !isFinal && !isNaN(parseInt(e.textContent));
        }).flatMap(e => {
            const val = parseInt(e.textContent.trim());
            let weight = 1;
            const markCellDiv = e.closest('div[data-test-component*="markCell"]');
            
            if (markCellDiv) {
                const cellId = markCellDiv.getAttribute('data-test-component') || '';
                const weightSpan = Array.from(markCellDiv.querySelectorAll('span')).find(s => s !== e && /^\d+$/.test(s.textContent.trim()));
                if (weightSpan) weight = parseInt(weightSpan.textContent.trim()) || 1;

                if (cellId && (markCellDiv.querySelector('svg[viewBox*="stacked"]') || markCellDiv.querySelector('.reW5yKeh505HpxGYfGSw'))) {
                    if (cellMarksCache[cellId]) return cellMarksCache[cellId];
                    
                    const activePopper = document.body.querySelector('div[data-test-component^="markCellMarkHoverPopup"]');
                    if (markCellDiv.matches(':hover') || activePopper) {
                        if (activePopper && activePopper.getAttribute('data-test-component')?.includes(cellId.split('-')[1])) {
                            const marks = Array.from(activePopper.querySelectorAll('.R4p7ZXgwQ59R96TEeVm3')).map(el => ({ val: parseInt(el.textContent.trim()), weight })).filter(m => !isNaN(m.val));
                            if (marks.length > 0) { cellMarksCache[cellId] = marks; return marks; }
                        }
                        return [{ val, weight }];
                    }

                    let silentStyle = document.getElementById('msh-silent-mark-pop');
                    if (!silentStyle) {
                        silentStyle = document.createElement('style');
                        silentStyle.id = 'msh-silent-mark-pop';
                        silentStyle.textContent = 'div[data-test-component^="markCellMarkHoverPopup"] { opacity: 0 !important; pointer-events: none !important; }';
                        (document.head || document.documentElement).appendChild(silentStyle);
                    }

                    isMuted = true;
                    markCellDiv.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
                    
                    const popper = document.body.querySelector('div[data-test-component^="markCellMarkHoverPopup"]');
                    const stackedMarks = popper ? Array.from(popper.querySelectorAll('.R4p7ZXgwQ59R96TEeVm3')).map(el => ({ val: parseInt(el.textContent.trim()), weight })).filter(m => !isNaN(m.val)) : [];
                    
                    markCellDiv.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true, cancelable: true }));
                    
                    clearTimeout(silentMarkTimeout);
                    silentMarkTimeout = setTimeout(() => { 
                        document.getElementById('msh-silent-mark-pop')?.remove(); 
                        isMuted = false; 
                    }, 50);

                    if (stackedMarks.length > 0) { 
                        cellMarksCache[cellId] = stackedMarks; 
                        return stackedMarks; 
                    }
                }
            }
            return [{ val, weight }];
        });
    };

    const getGroupId = () => location.href.match(/\/journal\/(?:[a-zA-Z-]+\/)?(\d+)/)?.[1];
    
    function getPageAcademicYearId() {
        try {
            const resources = performance.getEntriesByType('resource');
            for (let i = resources.length - 1; i >= 0; i--) {
                const match = resources[i].name.match(/[?&]academic_year_id=(\d+)/);
                if (match) return match[1];
            }
        } catch (e) {}
        return new URLSearchParams(location.search).get('academic_year_id') || "";
    }

    async function getHeaders() {
        const { currentBearerToken, currentProfileId, currentAid } = await chrome.storage.session.get(['currentBearerToken', 'currentProfileId', 'currentAid']);
        if (!currentBearerToken) throw new Error('Сессионные токены не найдены');
        
        const aid = currentAid || getPageAcademicYearId() || new URLSearchParams(location.search).get('academic_year_id') || "13";
        
        const h = { 
            "authorization": `Bearer ${currentBearerToken}`, 
            "profile-id": currentProfileId || "", 
            "x-mes-hostid": "9", 
            "x-mes-roleid": "9", 
            "content-type": "application/json" 
        };
        if (aid) h["aid"] = String(aid);
        return h;
    }

    // --- АКТУАЛИЗАЦИЯ ОТСУТСТВУЮЩИХ НА СЕГОДНЯ ---
    async function fetchTodayAttendances(groupId) {
        if (!groupId) return classCache.absentIds || [];
        try {
            const h = await getHeaders();
            const targetAid = h.aid || "13";
            const lvl = classCache.classLevelId || classCache.profiles.find(p => p.classLevelId)?.classLevelId;
            if (!lvl) return classCache.absentIds || [];

            const dt = new Date();
            const y = dt.getMonth() >= 8 ? dt.getFullYear() : dt.getFullYear() - 1;
            const todayRu = `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
            const todayIso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
            const isToday = dStr => (dStr === todayRu || dStr === todayIso);

            const attRes = await fetch(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/attendances?group_ids=${groupId}&class_level_id=${lvl}&academic_year_id=${targetAid}&start_at=01.09.${y}&stop_at=31.08.${y + 1}&page=1&per_page=1000`, {
                headers: { ...h, "aid": targetAid, "x-mes-subsystem": "journalw" }
            });

            if (attRes.ok) {
                const att = await attRes.json();
                if (Array.isArray(att)) {
                    classCache.absentIds = att
                        .filter(i => isToday(i.date))
                        .map(i => String(i.student_profile_id));
                }
            }
        } catch (e) {
            console.log('[МЭШ][journalTools] Ошибка фонового обновления посещаемости:', e?.message || e);
        }
        return classCache.absentIds;
    }

    // --- ФОНОВАЯ ЗАГРУЗКА КЛАССА ---
    async function ensureClassLoaded(groupId) {
        if (!groupId || (classCache.groupId === groupId && (classCache.isLoaded || classCache.isLoading))) return;
        
        classCache = { groupId, classUnitId: null, className: "", profiles: [], absentIds: [], isLoaded: false, isLoading: true, classLevelId: null };
        try {
            const h = await getHeaders();
            const d = await (await fetch(`https://authedu.mosreg.ru/api/ej/plan/teacher/v1/groups/${groupId}`, { headers: { ...h, "x-mes-subsystem": "journalw" } })).json();
            
            classCache.classUnitId = d.class_unit_id || d.class_unit?.id || null;
            classCache.className = d.class_unit_name || d.name || "";

            let profs = [];

            // 1. Обычный активный класс
            if (d.student_ids && d.student_ids.length > 0) {
                profs = (await Promise.all(d.student_ids.map(async id => {
                    try {
                        const pData = await (await fetch(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/student_profiles/${id}?with_user_info=true&with_archived_groups=true`, { headers: { ...h, "x-mes-subsystem": "teacherweb" } })).json();
                        const p = pData.user || pData.person || pData;
                        
                        if (!classCache.classUnitId && pData?.class_unit?.id) {
                            classCache.classUnitId = pData.class_unit.id;
                        }
                        if (!classCache.className && pData?.class_unit?.name) {
                            classCache.className = pData.class_unit.name;
                        }

                        return p?.last_name ? { 
                            id, 
                            name: `${p.last_name} ${p.first_name} ${p.middle_name || ''}`.trim(), 
                            shortName: `${p.last_name} ${p.first_name}`.trim(), 
                            classLevelId: pData.class_unit?.class_level_id || d.class_level_id,
                            birthDate: p.birth_date || null
                        } : null;
                    } catch { return null; }
                }))).filter(Boolean);
            } 
            // 2. Архивный класс
            else {
                try {
                    const archRes = await fetch(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/student_profiles?group_ids=${groupId}&with_archived_groups=true&with_user_info=true&per_page=150`, { headers: { ...h, "x-mes-subsystem": "teacherweb" } });
                    if (archRes.ok) {
                        const archList = await archRes.json();
                        const rawList = Array.isArray(archList) ? archList : (archList.student_profiles || []);
                        profs = rawList.map(pData => {
                            const p = pData.user || pData.person || pData;
                            if (!classCache.classUnitId && pData?.class_unit?.id) {
                                classCache.classUnitId = pData.class_unit.id;
                            }
                            return p?.last_name ? {
                                id: pData.id,
                                name: `${p.last_name} ${p.first_name} ${p.middle_name || ''}`.trim(),
                                shortName: `${p.last_name} ${p.first_name}`.trim(),
                                classLevelId: pData.class_unit?.class_level_id || d.class_level_id,
                                birthDate: p.birth_date || null
                            } : null;
                        }).filter(Boolean);
                    }
                } catch (errArch) {}
            }

            profs.sort((a, b) => a.name.localeCompare(b.name));
            classCache.profiles = profs;
            classCache.absentIds = [];

            const lvl = profs.find(p => p.classLevelId)?.classLevelId || d.class_level_id;
            classCache.classLevelId = lvl;
            if (lvl) {
                await fetchTodayAttendances(groupId);
            }
            classCache.isLoaded = true;
        } catch (e) { 
            logCL('Ошибка списков:', e?.message || e); 
            classCache.isLoaded = true;
        } finally { 
            classCache.isLoading = false; 
        }
    }

    // --- 1. ПАНЕЛЬ UI И АДАПТИВНЫЙ САЙДБАР ---
    function modalWindows() {
        const autoFitText = el => {
            if (!el?.parentElement) return;
            let maxW = el.parentElement.clientWidth - 24, size = 16; el.style.fontSize = size + 'px';
            while (el.scrollWidth > maxW && size > 10) el.style.fontSize = (size -= 0.5) + 'px';
        };

        const board = document.querySelector('.GMR0YmfCRS7L64NE4EFF');
        if (!board) return null;
        if (getComputedStyle(board).position === 'static') board.style.position = 'relative';

        // 🎯 ТОЧЕЧНЫЙ ФИКС СКРОЛЛА, СВОРАЧИВАНИЯ И ДИНАМИЧЕСКОЙ ШИРИНЫ
        if (!document.getElementById('mshhlpr-sidebar-scroll-fix')) {
            const fix = document.createElement('style');
            fix.id = 'mshhlpr-sidebar-scroll-fix';
            fix.textContent = `
                /* Динамический отступ журнала под актуальную ширину сайдбара */
                .GMR0YmfCRS7L64NE4EFF.mshhlpr-has-sidebar-expanded {
                    min-height: calc(100vh - 140px) !important;
                    padding-right: var(--msh-sb-pad, clamp(245px, 20vw, 340px)) !important;
                    transition: padding-right 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
                }
                .GMR0YmfCRS7L64NE4EFF.mshhlpr-has-sidebar-collapsed {
                    padding-right: 0px !important;
                }

                /* Развернутое состояние */
                #mshhlpr-journal-sidebar.mshhlpr-sidebar-expanded {
                    width: var(--msh-sb-w, clamp(230px, 19vw, 320px)) !important;
                    max-height: min(calc(100% - 20px), calc(100vh - 145px)) !important;
                    display: flex !important;
                    flex-direction: column !important;
                    border-radius: 14px !important;
                }
                #mshhlpr-journal-sidebar.mshhlpr-sidebar-expanded #mshhlpr-sidebar-expanded-content {
                    height: 100% !important;
                    max-height: 100% !important;
                    min-height: 0 !important;
                    display: flex !important;
                    flex-direction: column !important;
                    overflow: hidden !important;
                }
                #mshhlpr-journal-sidebar.mshhlpr-sidebar-expanded #mshhlpr-sidebar-collapsed-content {
                    display: none !important;
                }

                /* Свернутое состояние (круглая кнопка со значком 🛠️ на всю площадь) */
                #mshhlpr-journal-sidebar.mshhlpr-sidebar-collapsed {
                    width: 44px !important;
                    height: 44px !important;
                    min-height: 44px !important;
                    max-height: 44px !important;
                    border-radius: 50% !important;
                    cursor: pointer !important;
                    overflow: hidden !important;
                    padding: 0 !important;
                }
                #mshhlpr-journal-sidebar.mshhlpr-sidebar-collapsed #mshhlpr-sidebar-expanded-content {
                    display: none !important;
                    pointer-events: none !important;
                }
                #mshhlpr-journal-sidebar.mshhlpr-sidebar-collapsed #mshhlpr-sidebar-collapsed-content {
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    width: 44px !important;
                    height: 44px !important;
                    font-size: 20px !important;
                    background: var(--mshhlpr-primary-gradient) !important;
                    cursor: pointer !important;
                    user-select: none !important;
                    pointer-events: auto !important;
                }

                /* Внутренний скролл тела панели */
                #mshhlpr-journal-sidebar #mshhlpr-sidebar-body {
                    flex: 1 1 auto !important;
                    min-height: 0 !important;
                    max-height: none !important;
                    overflow-y: auto !important;
                    overflow-x: hidden !important;
                    scrollbar-width: thin !important;
                }
                #mshhlpr-journal-sidebar #mshhlpr-sidebar-body::-webkit-scrollbar {
                    width: 5px;
                }
                #mshhlpr-journal-sidebar #mshhlpr-sidebar-body::-webkit-scrollbar-thumb {
                    background-color: #cbd5e1;
                    border-radius: 4px;
                }

                /* Уплотнение вертикальных отступов на небольших экранах */
                @media (max-height: 860px) {
                    #mshhlpr-journal-sidebar #mshhlpr-sidebar-header {
                        padding: 6px 12px !important;
                        min-height: 28px !important;
                        height: 28px !important;
                    }
                    #mshhlpr-journal-sidebar #mshhlpr-sidebar-body {
                        padding: 8px 10px !important;
                        gap: 6px !important;
                    }
                    #mshhlpr-journal-sidebar #mshhlpr-mentor-widget {
                        padding: 6px 10px !important;
                    }
                    #mshhlpr-journal-sidebar .msh-widget-title {
                        margin-bottom: 2px !important;
                    }
                    #mshhlpr-journal-sidebar #mshhlpr-tools-widget button {
                        padding: 4px 8px !important;
                    }
                    #mshhlpr-journal-sidebar #mesh-validator-ui,
                    #mshhlpr-journal-sidebar #msh-cs-w {
                        margin-top: 4px !important;
                        padding-top: 6px !important;
                    }
                }

                /* Фиксированная таблица расписания без пустых пробелов */
                .msh-cs-table {
                    width: 100% !important;
                    table-layout: fixed !important;
                    border-collapse: collapse !important;
                    font-size: 11px !important;
                    line-height: 1.15 !important;
                }
                .msh-cs-table td {
                    vertical-align: top !important;
                    box-sizing: border-box !important;
                }
                .msh-cs-col-num {
                    width: 16px !important;
                    padding: 2px 2px 2px 2px !important;
                    text-align: left !important;
                    font-weight: 800 !important;
                    color: #475569 !important;
                    white-space: nowrap !important;
                }
                .msh-cs-col-time {
                    width: 34px !important;
                    padding: 2px 3px 2px 0 !important;
                    text-align: left !important;
                    font-size: 9.5px !important;
                    color: #64748b !important;
                    font-family: monospace !important;
                    white-space: nowrap !important;
                    letter-spacing: -0.3px !important;
                }
                .msh-cs-col-info {
                    width: auto !important;
                    padding: 2px 2px 2px 0 !important;
                    overflow: hidden !important;
                }

                /* Контейнер предмета и кабинета + бегущая строка по наведению */
                .msh-cs-row-top {
                    display: flex !important;
                    align-items: center !important;
                    justify-content: space-between !important;
                    gap: 4px !important;
                    width: 100% !important;
                    min-width: 0 !important;
                }
                .msh-cs-sub-wrap {
                    flex: 1 1 0% !important;
                    min-width: 0 !important;
                    overflow: hidden !important;
                    white-space: nowrap !important;
                    text-overflow: ellipsis !important;
                    font-weight: 700 !important;
                    color: #1e293b !important;
                }
                .msh-cs-sub-text {
                    display: inline !important;
                }
                @keyframes mshCsMarquee {
                    0%, 10% { transform: translateX(0); }
                    90%, 100% { transform: translateX(var(--msh-marquee-dist, 0px)); }
                }
                .msh-cs-sub-wrap.msh-is-scrolling {
                    text-overflow: clip !important;
                }
                .msh-cs-sub-wrap.msh-is-scrolling .msh-cs-sub-text {
                    display: inline-block !important;
                    animation: mshCsMarquee var(--msh-marquee-dur, 2.5s) ease-in-out infinite alternate !important;
                }
                .msh-cs-room {
                    flex: 0 0 auto !important;
                    font-size: 9px !important;
                    font-weight: 700 !important;
                    background: #f1f5f9 !important;
                    border: 1px solid #cbd5e1 !important;
                    padding: 0 3px !important;
                    border-radius: 3px !important;
                    white-space: nowrap !important;
                    color: #334155 !important;
                }
            `;
            document.head.appendChild(fix);
        }

        const toggleSidebar = (collapse) => {
            const el = document.getElementById('mshhlpr-journal-sidebar');
            const curBoard = document.querySelector('.GMR0YmfCRS7L64NE4EFF');
            if (!el || !curBoard) return;

            el.classList.toggle('mshhlpr-sidebar-collapsed', collapse); 
            el.classList.toggle('mshhlpr-sidebar-expanded', !collapse);
            
            curBoard.classList.toggle('mshhlpr-has-sidebar-expanded', !collapse);
            curBoard.classList.toggle('mshhlpr-has-sidebar-collapsed', collapse);

            el.classList.add('mshhlpr-sidebar-transition'); 
            sessionStorage.setItem('mshhlpr_sidebar_collapsed', collapse);
        };

        let sidebar = document.getElementById('mshhlpr-journal-sidebar');
        if (!sidebar) {
            const isC = sessionStorage.getItem('mshhlpr_sidebar_collapsed') === 'true';
            sidebar = document.createElement('div');
            sidebar.id = 'mshhlpr-journal-sidebar';
            sidebar.className = `mshhlpr-sidebar-container ${isC ? 'mshhlpr-sidebar-collapsed' : 'mshhlpr-sidebar-expanded'}`;

            sidebar.innerHTML = `
                <div id="mshhlpr-sidebar-expanded-content">
                    <div id="mshhlpr-sidebar-header" class="mshhlpr-universal-toggle-btn" title="Свернуть панель">
                        <span class="mshhlpr-universal-toggle-text">🛠️ Помогатор</span>
                        <span style="color:#fff;font-weight:700;font-size:11px">▼</span>
                    </div>
                    <div id="mshhlpr-sidebar-body"></div>
                </div>
                <div id="mshhlpr-sidebar-collapsed-content" title="Развернуть Помогатор">🛠️</div>`;
            
            board.appendChild(sidebar);
            requestAnimationFrame(() => requestAnimationFrame(() => sidebar.classList.add('mshhlpr-sidebar-transition')));
            sidebar.addEventListener('transitionend', e => e.propertyName === 'width' && sidebar.classList.contains('mshhlpr-sidebar-expanded') && autoFitText(document.getElementById('mshhlpr-mentor-name')));
            
            document.getElementById('mshhlpr-sidebar-header').onclick = e => {
                e.stopPropagation();
                toggleSidebar(true);
            };
            document.getElementById('mshhlpr-sidebar-collapsed-content').onclick = e => {
                e.stopPropagation();
                toggleSidebar(false);
            };
            sidebar.onclick = e => {
                if (sidebar.classList.contains('mshhlpr-sidebar-collapsed')) {
                    e.stopPropagation();
                    toggleSidebar(false);
                }
            };
        }

        // Всегда синхронизируем родительский контейнер журнала (при смене класса React сбрасывает его классы)
        if (sidebar.parentElement !== board) board.appendChild(sidebar);
        const isCollapsedNow = sidebar.classList.contains('mshhlpr-sidebar-collapsed');
        board.classList.toggle('mshhlpr-has-sidebar-expanded', !isCollapsedNow);
        board.classList.toggle('mshhlpr-has-sidebar-collapsed', isCollapsedNow);

        return { body: document.getElementById('mshhlpr-sidebar-body'), autoFitText };
    }

    // --- 2. КЛАССНЫЙ РУКОВОДИТЕЛЬ ---
    async function getMentor(container, groupId, autoFit) {
        let el = document.getElementById('mshhlpr-mentor-content');
        if (!document.getElementById('mshhlpr-mentor-widget')) {
            container.insertAdjacentHTML('beforeend', `<div id="mshhlpr-mentor-widget"><div class="msh-widget-title">Классный руководитель</div><div id="mshhlpr-mentor-content"><span style="color:#666;font-style:italic">Загрузка...</span></div></div>`);
            el = document.getElementById('mshhlpr-mentor-content');
        } else if (el && lastGroupId !== groupId) {
            el.innerHTML = '<span style="color:#666;font-style:italic">Загрузка...</span>';
        }

        if (lastGroupId === groupId || !groupId || !el) return;

        try {
            const h = await getHeaders();
            const groupData = await (await fetch(`https://authedu.mosreg.ru/api/ej/plan/teacher/v1/groups/${groupId}`, { headers: { ...h, "x-mes-subsystem": "journalw" } })).json();
            
            let firstStudentId = groupData.student_ids?.[0];
            let mentorName = "Не назначен";
            let className = groupData.class_unit_name || "?";

            if (firstStudentId) {
                const prof = await (await fetch(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/student_profiles/${firstStudentId}?with_user_info=true`, { headers: { ...h, "x-mes-subsystem": "teacherweb" } })).json();
                mentorName = prof.mentors?.[0]?.name || "Не назначен";
                className = prof.class_unit?.name || className;
            }

            el.innerHTML = `<div style="font-size:10px;color:#2e7d32;font-weight:700;margin-bottom:4px">Класс ${className}</div><span id="mshhlpr-mentor-name" style="font-size:13px;font-weight:700;color:#333" title="${mentorName}">${mentorName}</span>`;
            if (document.getElementById('mshhlpr-journal-sidebar')?.classList.contains('mshhlpr-sidebar-expanded')) {
                requestAnimationFrame(() => autoFit(document.getElementById('mshhlpr-mentor-name')));
            }
        } catch { 
            el.innerHTML = '<span style="color:#777">Ошибка загрузки</span>'; 
        }
    }

    // --- 3. СПИСКИ И РУЛЕТКА ---
    function classLists(container) {
        if (!document.getElementById('mshhlpr-tools-widget')) {
            container.insertAdjacentHTML('beforeend', `<div id="mshhlpr-tools-widget" style="display:flex;gap:8px;width:100%;box-sizing:border-box"><button id="mshhlpr-btn-lists" class="mshhlpr-universal-toggle-btn" style="flex:1;cursor:pointer;justify-content:center;padding:8px 10px!important"><span class="mshhlpr-universal-toggle-text" style="font-size:12px!important">👥 Списки</span></button><button id="mshhlpr-btn-wheel" class="mshhlpr-universal-toggle-btn" style="flex:1;cursor:pointer;justify-content:center;padding:8px 10px!important"><span class="mshhlpr-universal-toggle-text" style="font-size:12px!important">🎡 Рулетка</span></button></div>`);
            document.getElementById('mshhlpr-btn-lists').onclick = openListsModal;
            document.getElementById('mshhlpr-btn-wheel').onclick = russianRoulette;
        }

        async function openListsModal() {
            if (!classCache.isLoaded) return alert('Списки загружаются, подождите пару секунд...');

            const { ov } = createModal('420px', `
                <div class="mshhlpr-modal-header"><span>👥 Списки класса</span><button class="mshhlpr-modal-close">×</button></div>
                <div id="msh-lists-dynamic-body" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;min-height:260px;">
                    <div class="mshhlpr-loader-icon">⏳</div>
                    <div style="font-weight:600;color:#2e7d32;font-size:14px;margin-top:10px;">Сверка отсутствующих с журналом...</div>
                </div>
            `);

            await fetchTodayAttendances(classCache.groupId);
            if (!document.body.contains(ov)) return;

            const all = classCache.profiles.map(p => p.name), absIds = classCache.absentIds || [];
            const pres = classCache.profiles.filter(p => !absIds.includes(String(p.id))).map(p => p.name);
            const abs = classCache.profiles.filter(p => absIds.includes(String(p.id))).map(p => p.name), hasAbs = abs.length > 0;

            const contentBox = ov.querySelector('.mshhlpr-modal-content');
            if (contentBox) contentBox.style.width = hasAbs ? '920px' : '360px';

            const cCol = (t, l, c, id) => `<div style="flex:1;display:flex;flex-direction:column;gap:8px"><div style="color:${c};font-weight:700;font-size:13px">${t}</div><textarea readonly style="width:100%;height:260px;font-family:monospace;font-size:12px;border:1px solid #ccc;border-radius:8px;padding:8px;resize:none;background:#fafafa;box-sizing:border-box">${l.join('\n')}</textarea><button id="${id}" style="width:100%;background:#eaeaea;color:#333;border:1px solid #ccc;border-radius:6px;padding:6px;font-weight:700;cursor:pointer;font-size:12px;transition:.2s">📋 Скопировать</button></div>`;
            
            const dynamicBody = ov.querySelector('#msh-lists-dynamic-body');
            if (dynamicBody) {
                dynamicBody.style.cssText = 'display:flex;gap:15px;padding:20px;min-height:auto;';
                dynamicBody.innerHTML = `${cCol(`Все ученики (${all.length})`,all,'#2196f3','msh-c-all')}${hasAbs ? cCol(`Присутствуют (${pres.length})`,pres,'#4caf50','msh-c-pres') + cCol(`Отсутствуют (${abs.length})`,abs,'#f44336','msh-c-abs') : ''}`;
            }

            const bind = (s, txt) => { 
                const b = ov.querySelector(s); 
                if (b) b.onclick = () => { 
                    navigator.clipboard.writeText(txt); 
                    b.textContent = '✅ Скопировано!'; b.style.background = '#4caf50'; b.style.color = '#fff'; 
                    setTimeout(() => { b.textContent = '📋 Скопировать'; b.style.background = '#eaeaea'; b.style.color = '#333'; }, 1200); 
                }; 
            };
            bind('#msh-c-all', all.join('\n')); 
            if (hasAbs) { bind('#msh-c-pres', pres.join('\n')); bind('#msh-c-abs', abs.join('\n')); }
        }

        async function russianRoulette() {
            if (!classCache.isLoaded) return alert('Списки загружаются...');
            const KEY = `mesh_roulette_${classCache.groupId}`;
            const past = JSON.parse(sessionStorage.getItem(KEY) || '[]');
            const recent = past.filter(w => Date.now() - w.time < 2400000).map(w => String(w.id));
            
            const previouslyExcludedIds = new Set([
                ...recent,
                ...rouletteState.excluded.map(p => String(p.id))
            ]);

            const customIn = rouletteState.participants.filter(p => String(p.id).startsWith('c_'));
            const customOut = rouletteState.excluded.filter(p => String(p.id).startsWith('c_'));

            rouletteState.currentRotation = 0;
            rouletteState.isSpinning = false;
            
            const { ov } = createModal('90vw', `
                <div style="display:flex;flex-direction:row;background:#2c3e50;color:#fff;overflow:hidden;height:85vh;max-height:85vh;">
                    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:space-between;position:relative;padding:15px;min-width:0;min-height:0;">
                        <button class="mshhlpr-modal-close" style="position:absolute;top:10px;left:15px;color:#fff;border:none;background:0 0;font-size:28px;cursor:pointer;z-index:100">×</button>
                        
                        <div style="flex:1;width:100%;display:flex;justify-content:center;align-items:center;position:relative;min-height:0;margin-bottom:10px;">
                            <div style="position:relative;height:100%;aspect-ratio:1;max-height:100%;max-width:100%;display:flex;align-items:center;justify-content:center;">
                                <canvas id="mesh-wheel-canvas" width="800" height="800" style="width:100%;height:100%;max-height:100%;object-fit:contain;border-radius:50%;border:6px solid #f39c12;transition:transform 7s cubic-bezier(.1,.9,.2,1);box-shadow:0 0 30px rgba(0,0,0,.6)"></canvas>
                                <div style="position:absolute;top:50%;right:-25px;transform:translateY(-50%);border-top:20px solid transparent;border-bottom:20px solid transparent;border-right:40px solid #e74c3c;z-index:10;filter:drop-shadow(-3px 0 3px rgba(0,0,0,.6))"></div>
                            </div>
                        </div>

                        <div style="display:flex;flex-direction:column;align-items:center;gap:10px;flex-shrink:0;">
                            <div id="mesh-roulette-winner" style="font-size:26px;font-weight:700;color:#ecf0f1;text-align:center;min-height:32px;">⏳ Сверка отсутствующих...</div>
                            <div><button id="mesh-roulette-spin" style="font-size:18px;padding:10px 40px;background-color:#27ae60;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:not-allowed;opacity:0.6;transition:.2s" disabled>Крутить!</button></div>
                        </div>
                    </div>
                    <div style="width:340px;background:#1a252f;border-left:2px solid #34495e;display:flex;flex-direction:column;padding:15px;flex-shrink:0;">
                        <h3 style="margin-top:0;margin-bottom:15px;border-bottom:1px solid #34495e;padding-bottom:10px">Управление</h3>
                        <div style="display:flex;margin-bottom:15px;gap:5px"><input type="text" id="mesh-r-custom" placeholder="Имя..." style="flex:1;padding:8px;border-radius:4px;border:none;outline:0;background:#34495e;color:#fff"><button id="mesh-r-add" style="background:#27ae60;border:none;border-radius:4px;color:#fff;cursor:pointer;padding:0 15px">➕</button></div>
                        <h4 style="color:#2ecc71;margin-bottom:10px">В колесе (<span id="c-in">0</span>)</h4><ul id="mesh-r-in" style="flex:1;overflow-y:auto;list-style:none;padding:0;margin:0 0 15px"></ul>
                        <h4 style="color:#e74c3c;margin-bottom:10px">Выбывшие (<span id="c-out">0</span>)</h4><ul id="mesh-r-out" style="flex:1;overflow-y:auto;list-style:none;padding:0;margin:0"></ul>
                    </div>
                </div>
            `, 'hidden');

            const canvas = ov.querySelector('#mesh-wheel-canvas'), spinBtn = ov.querySelector('#mesh-roulette-spin'), winnerTxt = ov.querySelector('#mesh-roulette-winner');
            let pending = false;
            const reset = () => { canvas.style.transition = 'none'; rouletteState.currentRotation = 0; canvas.style.transform = `rotate(0deg)`; void canvas.offsetHeight; canvas.style.transition = 'transform 7s cubic-bezier(.1,.9,.2,1)'; pending = false; };
            
            function upLists() {
                const cin = document.getElementById('c-in'), cout = document.getElementById('c-out');
                if (cin) cin.innerText = rouletteState.participants.length; 
                if (cout) cout.innerText = rouletteState.excluded.length;
                const li = (p,i,o) => `<li style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;background:rgba(255,255,255,${o?'.05':'.1'});padding:6px 12px;border-radius:6px;font-size:14px;${o?'color:#95a5a6':''}"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.shortName}</span> <button data-idx="${i}" class="msh-rb ${o?'o':'i'}" style="background:0 0;border:none;color:${o?'#2ecc71':'#e74c3c'};cursor:pointer;font-size:14px">${o?'🔄':'❌'}</button></li>`;
                const rin = document.getElementById('mesh-r-in'), rout = document.getElementById('mesh-r-out');
                if (rin) rin.innerHTML = rouletteState.participants.map((p,i) => li(p,i,0)).join(''); 
                if (rout) rout.innerHTML = rouletteState.excluded.map((p,i) => li(p,i,1)).join('');
                document.querySelectorAll('.msh-rb').forEach(b => b.onclick = e => { if (rouletteState.isSpinning) return; const o = e.target.classList.contains('o'), idx = e.target.dataset.idx; if(o) rouletteState.participants.push(rouletteState.excluded.splice(idx,1)[0]); else rouletteState.excluded.push(rouletteState.participants.splice(idx,1)[0]); if (!rouletteState.isSpinning) reset(); upAll(); });
                if (rouletteState.participants.length && !rouletteState.isSpinning) {
                    spinBtn.style.display = 'inline-block';
                    spinBtn.disabled = false;
                    spinBtn.style.opacity = '1';
                    spinBtn.style.cursor = 'pointer';
                }
            }
            function draw(cvs, p) {
                const ctx = cvs.getContext('2d'), cx = cvs.width/2, r = cx, n = p.length; ctx.clearRect(0,0,cvs.width,cvs.height); ctx.textBaseline = 'middle';
                if (!n) { ctx.beginPath(); ctx.arc(cx,cx,r,0,2*Math.PI); ctx.fillStyle='#34495e'; ctx.fill(); ctx.textAlign='center'; ctx.fillStyle='#fff'; ctx.font='bold 36px sans-serif'; ctx.fillText('Нет учеников',cx,cx); return; }
                const arc = 2*Math.PI/n, cols = ['#e74c3c','#f39c12','#2ecc71','#3498db','#9b59b6','#1abc9c','#d35400','#2980b9'];
                for (let i=0; i<n; i++) { 
                    const a = i*arc; 
                    ctx.beginPath(); 
                    ctx.moveTo(cx,cx); 
                    ctx.arc(cx,cx,r,a,a+arc); 
                    ctx.fillStyle = (n%cols.length!==0 && i===n-1 && cols[i%cols.length]===cols[0]) ? '#8e44ad' : cols[i%cols.length]; 
                    ctx.fill(); 
                    ctx.strokeStyle = '#2c3e50'; 
                    ctx.lineWidth = 3; 
                    ctx.stroke(); 
                    
                    ctx.save(); 
                    ctx.translate(cx,cx); 
                    ctx.rotate(a+arc/2); 
                    ctx.textAlign = 'right'; 
                    ctx.fillStyle = '#fff'; 
                    ctx.font = `bold ${n>25?16:n>15?20:26}px sans-serif`; 
                    ctx.shadowColor = 'rgba(0,0,0,.6)'; 
                    ctx.shadowBlur = 5; 
                    ctx.fillText(p[i].shortName, r-40, 0); 
                    ctx.restore(); 
                }
                ctx.beginPath(); ctx.arc(cx,cx,r*.1,0,2*Math.PI); ctx.fillStyle='#ecf0f1'; ctx.fill(); ctx.lineWidth=5; ctx.stroke();
            }
            const upAll = () => { upLists(); draw(canvas, rouletteState.participants); };

            ov.querySelector('#mesh-r-add').onclick = () => { const v = ov.querySelector('#mesh-r-custom').value.trim(); if (v) { rouletteState.participants.push({ id: 'c_'+Date.now(), name: v, shortName: v }); ov.querySelector('#mesh-r-custom').value = ''; if (!rouletteState.isSpinning) reset(); upAll(); } };
            
            spinBtn.onclick = () => {
                if (rouletteState.isSpinning || !rouletteState.participants.length) return;
                if (pending) { upAll(); reset(); }
                rouletteState.isSpinning = true; winnerTxt.innerText = 'Вращение...'; winnerTxt.style.color = '#fff'; spinBtn.style.opacity = '.5'; spinBtn.style.cursor = 'not-allowed';
                const wIdx = Math.floor(Math.random() * rouletteState.participants.length), win = rouletteState.participants[wIdx];
                const arc = 360/rouletteState.participants.length, targetA = (wIdx*arc) + arc/2;
                rouletteState.currentRotation += 3600;
                let diff = (360 - targetA)%360 - rouletteState.currentRotation%360;
                rouletteState.currentRotation += (diff < 0 ? diff+360 : diff) + (Math.random()-.5)*arc*.8;
                canvas.style.transform = `rotate(${rouletteState.currentRotation}deg)`;
                setTimeout(() => {
                    winnerTxt.innerHTML = `🎉 ${win.name} 🎉`; winnerTxt.style.color = '#f1c40f';
                    if (!String(win.id).startsWith('c_')) { const p = JSON.parse(sessionStorage.getItem(KEY)||'[]'); p.push({id: String(win.id), time:Date.now()}); sessionStorage.setItem(KEY, JSON.stringify(p)); }
                    rouletteState.excluded.push(rouletteState.participants.splice(wIdx,1)[0]);
                    rouletteState.isSpinning = false; pending = true; upLists();
                    spinBtn.style.opacity = '1'; spinBtn.style.cursor = 'pointer'; spinBtn.innerText = rouletteState.participants.length ? 'Крутить дальше' : ''; spinBtn.style.display = rouletteState.participants.length ? 'inline-block' : 'none';
                }, 7000);
            };

            await fetchTodayAttendances(classCache.groupId);
            if (!document.body.contains(ov)) return;

            const absIds = classCache.absentIds || [];
            const part = [], excl = [];

            classCache.profiles.forEach(p => {
                const strId = String(p.id);
                if (previouslyExcludedIds.has(strId) || absIds.includes(strId)) {
                    excl.push(p);
                } else {
                    part.push(p);
                }
            });

            rouletteState.participants = [...part, ...customIn];
            rouletteState.excluded = [...excl, ...customOut];

            winnerTxt.innerText = 'Крутите барабан!';
            spinBtn.style.cursor = 'pointer';
            spinBtn.style.opacity = '1';
            spinBtn.disabled = false;

            upAll();
        }
    }

    // --- 4. ОПРЕДЕЛЕНИЕ КОЛИЧЕСТВА УРОКОВ В НЕДЕЛЮ ---
    function detectWeeklyLessons() {
        const dates = [];
        document.querySelectorAll('th:has(div[data-test-component*="scheduleLessonCell"])').forEach(th => {
            const d = parseInt(th.querySelector('.BR21L6DXj8Qc_95TamW2, .E8taxZlPjqlq_tc1djmu:last-child')?.textContent, 10);
            if (!isNaN(d)) {
                const count = parseInt(th.getAttribute('colspan'), 10) || 1;
                for (let k = 0; k < count; k++) dates.push(d);
            }
        });
        if (!dates.length) return 1;
        let months = 1;
        for (let i = 1; i < dates.length; i++) if (dates[i] < dates[i - 1]) months++;
        return Math.max(1, Math.round((dates.length / months) / 4));
    }

    // --- 4.1. ВАЛИДАТОР ОЦЕНОК (ПРОСЧЕТ И ИНТЕРФЕЙС) ---
    async function marksValidator(container, groupId) {
        const weeklyLessons = detectWeeklyLessons(), recommendedMin = weeklyLessons === 1 ? 3 : 5;
        const isNewGroup = (valCache.grp !== groupId);
        if (isNewGroup) { valCache.grp = groupId; valState.mode = null; valState.sig = ""; cellMarksCache = {}; }

        valCache.classMinMarks = valCache.classMinMarks || {};
        if (valCache.classMinMarks[groupId] === undefined) {
            const s = await new Promise(r => chrome.storage.local.get(['activeTeacher', 'profiles', 'msh_val_cfg'], r));
            const t = s.activeTeacher || 'default';
            valCache.classMinMarks[groupId] = s.profiles?.[t]?.classMinMarks?.[groupId] ?? recommendedMin;
            if (!valCfg) valCfg = s.msh_val_cfg || { isActive: false };
        }

        const currentMin = valCfg.minMarks = valCache.classMinMarks[groupId];
        const rows = document.querySelectorAll('.f0eMcueVzidF1N9SAffu');
        const activeBtn = Array.from(document.querySelectorAll('button[data-test-component^="JournalControlPanelView-journal"]')).find(b => b.classList.contains('C0qHlb4C7fAcYrnlODD0'));
        const cMode = activeBtn ? activeBtn.getAttribute('data-test-component') : 'JournalControlPanelView-journal';
        const isFinals = cMode === 'JournalControlPanelView-journalResults';

        const getHint = v => v !== recommendedMin ? `С учётом количества уроков в неделю (${weeklyLessons}), минимальное количество оценок для аттестации ${recommendedMin}.` : '';
        const updateHint = v => {
            const box = document.getElementById('msh-val-hint');
            if (box) { box.textContent = getHint(v); box.style.display = box.textContent ? 'block' : 'none'; }
        };

        if (!document.getElementById('mesh-validator-ui')) {
            const valHtml = `
                <div id="mesh-validator-ui" class="mesh-unified-card" style="margin-top:10px;border-top:1px solid #ccc;padding-top:10px">
                    <div id="msh-val-head" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-weight:700;color:#333;font-size:13px">
                        <div>Проверка оценок</div>
                        <div id="msh-val-tog" style="width:34px;height:18px;background:${valCfg.isActive ? '#4caf50' : '#ccc'};border-radius:10px;position:relative;transition:.3s">
                            <div style="width:14px;height:14px;background:#fff;border-radius:50%;position:absolute;top:2px;left:${valCfg.isActive ? '18px' : '2px'};transition:.3s"></div>
                        </div>
                    </div>
                    <div id="msh-val-body" style="display:${valCfg.isActive ? 'block' : 'none'};margin-top:10px;font-size:12px;color:#444">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                            <span>Мин. для аттестации:</span>
                            <input type="number" id="msh-val-min" value="${currentMin}" min="0" max="20" style="width:56px;padding:2px 6px;text-align:center;box-sizing:border-box;border:1px solid #ccc;border-radius:6px;font-weight:600;outline:none">
                        </div>
                        <div id="msh-val-hint" style="display:${getHint(currentMin) ? 'block' : 'none'};background:#fff3cd;color:#856404;border:1px solid #ffeeba;border-radius:6px;padding:6px 8px;font-size:11px;line-height:1.35;margin-top:6px;">${getHint(currentMin)}</div>
                    </div>
                </div>
            `;

            // Если виджет расписания уже случайно вставлен, вставляем ПЕРЕД ним
            const csWidget = document.getElementById('msh-cs-w');
            if (csWidget) {
                csWidget.insertAdjacentHTML('beforebegin', valHtml);
            } else {
                container.insertAdjacentHTML('beforeend', valHtml);
            }

            const minInp = document.getElementById('msh-val-min');
            const saveAndApply = async (newVal) => {
                valCache.classMinMarks[groupId] = valCfg.minMarks = newVal;
                updateHint(newVal);
                const s = await new Promise(r => chrome.storage.local.get(['profiles', 'activeTeacher'], r));
                const t = s.activeTeacher || 'default', p = s.profiles || {};
                if (!p[t]) p[t] = {};
                (p[t].classMinMarks = p[t].classMinMarks || {})[groupId] = newVal;
                chrome.storage.local.set({ profiles: p, msh_val_cfg: valCfg });
                valState.sig = "";
                valCfg.isActive ? marksValidator(container, groupId) : clearValidation();
            };

            document.getElementById('msh-val-head').onclick = e => { 
                if (['INPUT','BUTTON','LABEL','SPAN'].includes(e.target.tagName)) return; 
                valCfg.isActive = !valCfg.isActive; 
                document.getElementById('msh-val-tog').style.background = valCfg.isActive ? '#4caf50' : '#ccc'; 
                document.getElementById('msh-val-tog').firstElementChild.style.left = valCfg.isActive ? '18px' : '2px'; 
                document.getElementById('msh-val-body').style.display = valCfg.isActive ? 'block' : 'none'; 
                chrome.storage.local.set({ msh_val_cfg: valCfg });
                valState.sig = "";
                valCfg.isActive ? marksValidator(container, groupId) : clearValidation();
            };

            const onInputVal = e => {
                const n = parseInt(e.target.value, 10), safe = isNaN(n) ? recommendedMin : Math.max(0, n);
                if (e.type === 'change' && isNaN(n)) minInp.value = safe;
                saveAndApply(safe);
            };
            minInp.oninput = minInp.onchange = onInputVal;
        } else {
            const minInp = document.getElementById('msh-val-min');
            if (minInp && document.activeElement !== minInp && (isNewGroup || parseInt(minInp.value, 10) !== currentMin)) {
                minInp.value = currentMin;
            }
            updateHint(currentMin);
        }

        if (cMode !== valState.mode) { clearValidation(); valState.sig = ""; valState.mode = cMode; }
        if (!valCfg.isActive || cMode === 'JournalControlPanelView-journalOneLesson') return;
        
        let sParts = [];
        rows.forEach(r => {
            const n = r.querySelector('td span[title]')?.textContent.trim(); if(!n) return;
            if (isFinals) {
                const gm = sel => { const d = r.querySelector(`div[data-test-component*="${sel}"]`); return d ? (d.querySelector('.R4p7ZXgwQ59R96TEeVm3') || d.querySelector('span'))?.textContent.trim() || 'N' : 'N'; };
                sParts.push(`${n}:${gm('_yearResult')}:${gm('_yearExam')}:${gm('_yearAttestation')}`);
            } else sParts.push(`${n}:${getWeightedMarks(r).map(m => `${m.val}${getSuperscript(m.weight)}`).join(',')}`);
        });
        
        const sig = (isFinals ? "FINALS:" : "") + sParts.join('|');
        if (sig === valState.sig) return; valState.sig = sig; 
        
        rows.forEach(r => {
            const n = r.querySelector('td span[title]')?.textContent.trim(); if(!n) return;
            
            if (isFinals) {
                let s=0, c=0, yrC=null, yrV=null, exC=null, exV=null, fnC=null, fnV=null, periodMarksLog = [];
                r.querySelectorAll('div[data-test-component*="markCell"]').forEach(cell => {
                    const id = cell.getAttribute('data-test-component')||'', v = parseInt((cell.querySelector('.R4p7ZXgwQ59R96TEeVm3') || cell.querySelector('span'))?.textContent.trim());
                    if(id.includes('_yearResult')) { yrC = cell.closest('td'); if(!isNaN(v)) yrV=v; }
                    else if(id.includes('_yearExam')) { exC = cell.closest('td'); if(!isNaN(v)) exV=v; }
                    else if(id.includes('_yearAttestation')) { fnC = cell.closest('td'); if(!isNaN(v)) fnV=v; }
                    else if(id.includes('_finalResult') && !isNaN(v)) { s+=v; c++; periodMarksLog.push(v); }
                });

                if(yrC) {
                    yrC.classList.remove('mshhlpr-final-correct','mshhlpr-final-wrong','mshhlpr-final-missing');
                    if(c>0) {
                        const a=s/c, e = a<=2.5?2:a<=3.5?3:a<=4.5?4:5;
                        yrC.title = `Расчет годовой оценки:\n• Оценки за периоды: [${periodMarksLog.join(', ')}]\n• Средний балл периодов: ${a.toFixed(2)}\n• Округление:\n  - до 2.50 => 2\n  - от 2.51 до 3.50 => 3\n  - от 3.51 до 4.50 => 4\n  - более 4.50 => 5\n• Ожидается: ${e}\n• Фактически стоит: ${yrV !== null ? yrV : 'не выставлено'}`;
                        yrC.classList.add(yrV===null ? 'mshhlpr-final-missing' : yrV===e ? 'mshhlpr-final-correct' : 'mshhlpr-final-wrong');
                    }
                }
                if(fnC && yrV!==null) {
                    fnC.classList.remove('mshhlpr-final-correct','mshhlpr-final-wrong','mshhlpr-final-missing');
                    const e = exV!==null ? Math.round((yrV+exV)/2) : yrV;
                    let tt = `Расчет итоговой оценки:\n• Годовая оценка (Г): ${yrV}\n`;
                    if (exV !== null) tt += `• Оценка за экзамен (Э): ${exV}\n• Среднее (Г + Э) / 2: ${((yrV+exV)/2).toFixed(2)}\n• Округление по математическим правилам => ${e}`;
                    else tt += `• Экзамен отсутствует => Итоговая равна Годовой\n• Ожидается: ${e}`;
                    fnC.title = tt + `\n• Фактически стоит: ${fnV !== null ? fnV : 'не выставлено'}`;
                    fnC.classList.add(fnV===null ? 'mshhlpr-final-missing' : fnV===e ? 'mshhlpr-final-correct' : 'mshhlpr-final-wrong');
                }
            } else {
                const ms = getWeightedMarks(r);
                const marksCount = ms.length;
                const weightSum = ms.reduce((acc, m) => acc + m.weight, 0); 
                const w = r.querySelector('td span[title]')?.closest('div'); 
                
                if(w) { 
                    const isError = valCfg.minMarks > 0 && marksCount < valCfg.minMarks;
                    w.classList.toggle('mshhlpr-bg-error', isError); 
                    w.title = isError ? `Оценок: ${marksCount}. Нужно: ${valCfg.minMarks}` : ''; 
                }
                
                const aS = Array.from(r.querySelectorAll('span')).find(s => /^\s*[2-5],\d{2}\s*$/.test(s.textContent));
                let aV = aS ? parseFloat(aS.textContent.replace(',', '.')) : NaN;
                if (isNaN(aV) && weightSum > 0) aV = Number((ms.reduce((acc, el) => acc + (el.val * el.weight), 0) / weightSum).toFixed(2));
                
                const msFormatted = ms.map(m => `${m.val}${getSuperscript(m.weight)}`);
                const fc = r.querySelector('div[data-test-component*="final"]')?.closest('td');
                
                if(fc) {
                    fc.classList.remove('mshhlpr-final-correct','mshhlpr-final-wrong','mshhlpr-final-missing');
                    const vStr = fc.querySelector('.R4p7ZXgwQ59R96TEeVm3')?.textContent.trim() || '';
                    const v = parseInt(vStr);
                    const e = aV<=2.5?2:aV<=3.5?3:aV<=4.5?4:5; 
                    
                    fc.title = `Расчет триместровой оценки:\n• Физически оценок: ${marksCount} (Сумма весов: ${weightSum})\n• Список оценок:\n  ${chunkArray(msFormatted, 10)}\n• Средний балл ученика: ${aV.toFixed(2)}\n• Округление:\n  - до 2,50 => 2\n  - от 2,51 до 3,50 => 3\n  - от 3,51 до 4,50 => 4\n  - более 4,50 => 5\n• Ожидается: ${e}\n• Фактически выставлено: ${vStr || 'не выставлено'}`;
                    
                    fc.classList.add(!vStr ? 'mshhlpr-final-missing' : v===e ? 'mshhlpr-final-correct' : 'mshhlpr-final-wrong');
                }
            }
        });
        
        injectAutoFillBtn(isFinals);
    }

    function clearValidation() {
        ['mshhlpr-bg-error','mshhlpr-final-correct','mshhlpr-final-wrong','mshhlpr-final-missing','mshhlpr-rainbow-bg'].forEach(c => document.querySelectorAll(`.${c}`).forEach(e => e.classList.remove(c)));
        document.querySelectorAll('.f0eMcueVzidF1N9SAffu').forEach(r => { 
            const w=r.querySelector('td span[title]')?.closest('div'); if(w && /Оценок:|V1/.test(w.title)) w.title=""; 
            r.querySelectorAll('td').forEach(td => { if (td.title?.includes('Ожидается:')) td.title = ""; });
        });
    }
    
    // --- 4.2 АВТОВЫСТАВЛЕНИЕ ОЦЕНОК ---
    function injectAutoFillBtn(isFinals) {
        const panelBody = document.querySelector('#mesh-validator-ui #msh-val-body');
        if(!panelBody) return;
        
        let btnContainer = document.getElementById('mesh-autofill-panel');
        if (!btnContainer) {
            btnContainer = document.createElement('div');
            btnContainer.id = 'mesh-autofill-panel';
            btnContainer.style.cssText = 'margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(0,0,0,0.1);';
            panelBody.appendChild(btnContainer);
        }
        
        let b = document.getElementById('msh-af-btn');
        if(!b) { 
            b = document.createElement('button'); 
            b.id = 'msh-af-btn'; 
            b.style.cssText = 'width:100%;justify-content:center;padding:6px;background:#f39c12;border:none;border-radius:6px;color:#fff;font-weight:700;cursor:pointer;font-size:12px;box-shadow:0 2px 5px rgba(0,0,0,0.2);transition:background-color 0.2s';
            btnContainer.appendChild(b); 
        }
        
        if(!valState.running) {
            b.className = 'mshhlpr-btn-animated'; 
            const targetText = isFinals ? '🤖 Выставить годовые' : '🤖 Выставить триместр';
            
            if (b.textContent !== targetText && b.textContent !== '⏹️ Остановить' && b.textContent !== '⏳ Остановка...') {
                b.textContent = targetText;
                b.classList.remove('mshhlpr-btn-animated'); void b.offsetWidth; b.classList.add('mshhlpr-btn-animated'); 
            }
            b.onclick = () => showAfConfirm(isFinals);
        }
    }
    
    function showAfConfirm(isFinals) {
        const { ov, close } = createModal('400px', `
            <div style="text-align:center; padding: 20px;">
                <div style="font-size:40px;margin-bottom:10px">🤖</div>
                <h3 style="margin:0 0 10px;color:#333">Автовыставление</h3>
                <p style="color:#666;font-size:13px;margin-bottom:20px">Вы точно хотите выставить <b>${isFinals?'годовые':'триместровые'}</b> оценки?</p>
                <div style="display:flex;gap:10px">
                    <button id="af-no" class="mshhlpr-universal-toggle-btn" style="flex:1;justify-content:center;background:#e74c3c !important;color:#fff;border:none">Отмена</button>
                    <button id="af-yes" class="mshhlpr-universal-toggle-btn" style="flex:1;justify-content:center;background:#27ae60 !important;color:#fff;border:none">Да, выставить</button>
                </div>
            </div>
        `, 'hidden');
        
        ov.querySelector('#af-no').onclick = close;
        ov.querySelector('#af-yes').onclick = () => { close(); executeAutoFill(isFinals); };
    }

    async function executeAutoFill(isFinals) {
        valState.running = true; valState.abort = false;
        const b = document.getElementById('msh-af-btn');
        if(b) { b.className = 'mshhlpr-btn-danger'; b.style.cssText = 'width:100%;justify-content:center;padding:6px;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-size:12px'; b.textContent = '⏹️ Остановить'; b.onclick = () => { valState.abort = true; b.textContent = '⏳ Остановка...'; b.disabled = true; }; }
        
        let sC=0, skC=0, eC=0;
        for(const r of document.querySelectorAll('.f0eMcueVzidF1N9SAffu')) {
            if(valState.abort) break;
            const nEl = r.querySelector('td span[title]'); if(!nEl) continue;
            let exp = null, cur = null, tCell = null, skip = false;
            
            if(isFinals) {
                let s=0, c=0, mis=false;
                r.querySelectorAll('div[data-test-component*="markCell"]').forEach(cl => {
                    const id = cl.getAttribute('data-test-component')||'', v = parseInt((cl.querySelector('.R4p7ZXgwQ59R96TEeVm3') || cl.querySelector('span'))?.textContent.trim());
                    if(id.includes('_yearResult')) { tCell = cl.closest('td'); if(!isNaN(v)) cur=v; }
                    else if(id.includes('_finalResult')) { if(!isNaN(v)) {s+=v;c++;} else mis=true; }
                });
                if(mis) skip = true; else if(c>0) { const a=s/c; exp = a<=2.5?2:a<=3.5?3:a<=4.5?4:5; }
            } else {
                if(valCfg.minMarks > 0 && nEl.closest('div')?.classList.contains('mshhlpr-bg-error')) skip = true;
                
                let aV = parseFloat(Array.from(r.querySelectorAll('span')).find(sp => /^\s*[2-5],\d{2}\s*$/.test(sp.textContent))?.textContent.replace(',','.'));
                const ms = getWeightedMarks(r);
                const weightSum = ms.reduce((acc, m) => acc + m.weight, 0);

                if (isNaN(aV) && weightSum > 0) aV = ms.reduce((acc, el) => acc + (el.val * el.weight), 0) / weightSum;
                if(!isNaN(aV)) exp = aV<=2.5?2:aV<=3.5?3:aV<=4.5?4:5;
                
                const finalDiv = r.querySelector('div[data-test-component*="final"]');
                if (finalDiv) {
                    tCell = finalDiv.closest('td');
                    const valStr = finalDiv.querySelector('.R4p7ZXgwQ59R96TEeVm3')?.textContent.trim();
                    if(valStr && !isNaN(parseInt(valStr))) cur = parseInt(valStr);
                }
            }
            
            if(skip || !exp || !tCell || cur === exp) { skC++; continue; }
            
            await sleep(50); if(valState.abort) break;
            try { await emulate(tCell, exp); sC++; } catch(e) { eC++; }
        }
        valState.running = false; injectAutoFillBtn(isFinals);
        if(valState.abort) alert(`Остановлено!\nУспешно: ${sC}\nПропуск: ${skC}\nОшибок: ${eC}`); else alert(`Готово!\nУспешно: ${sC}\nПропуск: ${skC}\nОшибок: ${eC}\n(рекомендуется обновить страницу)`);
    }
    
    async function emulate(cell, m) {
        cell.scrollIntoView({block:'center',behavior:'auto'}); await sleep(50);
        const a = cell.querySelector('div') || cell;
        ['mousedown','mouseup','click'].forEach(e => a.dispatchEvent(new MouseEvent(e, {bubbles:true})));
        await sleep(150);
        let t = document.activeElement !== document.body ? document.activeElement : a; const k = String(m), c = 48+m;
        ['keydown','keypress','keyup'].forEach(e => t.dispatchEvent(new KeyboardEvent(e, {bubbles:true,cancelable:true,key:k,code:`Digit${k}`,keyCode:c,which:c})));
        await sleep(100); t = document.activeElement !== document.body ? document.activeElement : t;
        ['keydown','keypress','keyup'].forEach(e => t.dispatchEvent(new KeyboardEvent(e, {bubbles:true,cancelable:true,key:'Enter',code:'Enter',keyCode:13,which:13})));
        await sleep(200);
    }

    // --- 4.3. ВИДЖЕТ РАСПИСАНИЯ КЛАССА НА СЕГОДНЯ ---
    const csCache = new Map(), grpCache = new Map();
    let csAbort = null;

    async function classScheduleWidget(container, groupId) {
        if (!container || !groupId) return;

        let root = document.getElementById('msh-cs-w');
        if (!root) {
            const isCol = localStorage.getItem('msh_cs_col') === 'true';
            const html = `
                <div id="msh-cs-w" class="mesh-unified-card" style="margin-top:8px;border-top:1px solid #ccc;padding-top:6px;display:none;">
                    <div id="msh-cs-h" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;user-select:none;font-size:12px;font-weight:700;color:#333;">
                        <span>📅 Уроки класса на сегодня</span>
                        <span id="msh-cs-ar" style="font-size:9px;color:#888;">${isCol ? '▶' : '▼'}</span>
                    </div>
                    <div id="msh-cs-b" style="display:${isCol ? 'none' : 'block'};margin-top:4px;"></div>
                </div>`;

            // Строгое позиционирование: ПОД валидатором оценок
            const valEl = document.getElementById('mesh-validator-ui');
            if (valEl && valEl.parentElement === container) {
                valEl.insertAdjacentHTML('afterend', html);
            } else {
                container.insertAdjacentHTML('beforeend', html);
            }

            root = document.getElementById('msh-cs-w');
            const h = document.getElementById('msh-cs-h'), b = document.getElementById('msh-cs-b'), ar = document.getElementById('msh-cs-ar');
            h.onclick = () => {
                const col = b.style.display !== 'none';
                b.style.display = col ? 'none' : 'block';
                ar.textContent = col ? '▶' : '▼';
                localStorage.setItem('msh_cs_col', col);
            };
        } else {
            const valEl = document.getElementById('mesh-validator-ui');
            if (valEl && root.previousElementSibling !== valEl && valEl.parentElement === container) {
                valEl.after(root);
            }
        }

        // Не прерываем загрузку, если этот же класс уже загружен или прямо сейчас загружается
        if (root.dataset.groupId === String(groupId) && (root.dataset.loaded === 'true' || root.dataset.loading === 'true')) return;
        root.dataset.groupId = String(groupId);
        root.dataset.loaded = 'false';
        root.dataset.loading = 'true';

        const b = document.getElementById('msh-cs-b');
        if (csAbort) csAbort.abort();
        csAbort = new AbortController();

        const pad = n => String(n).padStart(2, '0');
        const now = new Date();
        const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const cKey = `${groupId}_${iso}`;

        // Пересчет оптимальной ширины панели при смене класса
        const adjustSidebarWidth = (items) => {
            const sidebar = document.getElementById('mshhlpr-journal-sidebar');
            const board = document.querySelector('.GMR0YmfCRS7L64NE4EFF');
            if (!sidebar || !board) return;

            let maxSubLen = 14;
            if (items && items.length) {
                items.forEach(l => {
                    if (l.sub && l.sub.length > maxSubLen) maxSubLen = l.sub.length;
                });
            }

            const maxAllowed = Math.min(330, Math.max(240, Math.round(window.innerWidth * 0.21)));
            const calculatedW = Math.min(maxAllowed, Math.max(225, Math.round(maxSubLen * 6.2 + 115)));

            sidebar.style.setProperty('--msh-sb-w', `${calculatedW}px`);
            board.style.setProperty('--msh-sb-pad', `${calculatedW + 18}px`);
        };

        const draw = (items) => {
            root.dataset.loaded = 'true';
            root.dataset.loading = 'false';
            adjustSidebarWidth(items);

            if (!items?.length) {
                root.style.display = 'none';
                return;
            }
            root.style.display = 'block';

            const curM = now.getHours() * 60 + now.getMinutes();
            const myName = (document.getElementById('activeTeacherName')?.textContent || '').split(' ')[0].toLowerCase();
            const slots = {};
            items.forEach(l => (slots[l.num] = slots[l.num] || []).push(l));

            b.innerHTML = `<table class="msh-cs-table">
                <tbody>${Object.entries(slots).map(([num, list]) => {
                    const f = list[0], isCur = curM >= f.start && curM <= f.end;
                    
                    // Проверяем деление на группы с одинаковым предметом
                    const firstSub = list[0].sub.trim().toLowerCase();
                    const isSameSubGroup = list.length > 1 && list.every(l => l.sub.trim().toLowerCase() === firstSub);

                    let lessonCellHtml = '';

                    if (isSameSubGroup) {
                        lessonCellHtml = `
                            <div class="msh-cs-row-top" style="margin-bottom:1px;">
                                <div class="msh-cs-sub-wrap">
                                    <span class="msh-cs-sub-text">${list[0].sub}</span>
                                </div>
                            </div>
                            <div style="display:flex;flex-direction:column;gap:1px;">
                                ${list.map(l => {
                                    const isMe = myName && l.rawTeacher.toLowerCase().includes(myName);
                                    return `
                                        <div class="msh-cs-row-top">
                                            <span style="font-size:9.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;${isMe ? 'color:#2e7d32;font-weight:700;' : 'color:#555;'}">
                                                👤 ${l.teacher} ${isMe ? '<span style="font-size:8px;background:#2e7d32;color:#fff;padding:0 2px;border-radius:2px;">Вы</span>' : ''}
                                            </span>
                                            <span class="msh-cs-room">${l.room}</span>
                                        </div>`;
                                }).join('')}
                            </div>`;
                    } else {
                        lessonCellHtml = list.map((l, i) => {
                            const isMe = myName && l.rawTeacher.toLowerCase().includes(myName);
                            return `${i ? '<div style="border-top:1px dashed #cbd5e1;margin:2px 0;"></div>' : ''}
                                <div class="msh-cs-row-top">
                                    <div class="msh-cs-sub-wrap">
                                        <span class="msh-cs-sub-text">${l.sub}</span>
                                    </div>
                                    <span class="msh-cs-room">${l.room}</span>
                                </div>
                                <div style="font-size:9.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${isMe ? 'color:#2e7d32;font-weight:700;' : 'color:#555;'}">
                                    👤 ${l.teacher} ${isMe ? '<span style="font-size:8.5px;background:#2e7d32;color:#fff;padding:0 2px;border-radius:2px;">Вы</span>' : ''}
                                </div>`;
                        }).join('');
                    }

                    // Вывод времени друг под другом
                    const timeLines = (f.startStr && f.endStr) 
                        ? `<div style="line-height:1.05;">${f.startStr}</div><div style="line-height:1.05;opacity:0.85;">${f.endStr}</div>` 
                        : f.time;

                    return `<tr style="${isCur ? 'background:#e8f5e9;border-left:3px solid #2e7d32;' : 'border-bottom:1px solid #f1f5f9;'}">
                        <td class="msh-cs-col-num" title="${isCur ? 'Урок идёт сейчас' : ''}">${isCur ? '<span style="color:#2e7d32;">●</span>' : `${num}.`}</td>
                        <td class="msh-cs-col-time" style="${isCur ? 'color:#2e7d32;font-weight:700;' : ''}">${timeLines}</td>
                        <td class="msh-cs-col-info">${lessonCellHtml}</td>
                    </tr>`;
                }).join('')}</tbody>
            </table>`;

            // Активация бегущей строки только при наведении курсора и только если название не поместилось
            b.querySelectorAll('.msh-cs-sub-wrap').forEach(wrap => {
                wrap.addEventListener('mouseenter', () => {
                    const overflow = wrap.scrollWidth - wrap.clientWidth;
                    if (overflow > 2) {
                        const dur = Math.max(1.5, overflow / 35).toFixed(2);
                        wrap.style.setProperty('--msh-marquee-dist', `-${overflow + 6}px`);
                        wrap.style.setProperty('--msh-marquee-dur', `${dur}s`);
                        wrap.classList.add('msh-is-scrolling');
                    }
                });
                wrap.addEventListener('mouseleave', () => {
                    wrap.classList.remove('msh-is-scrolling');
                });
            });
        };

        if (csCache.has(cKey)) return draw(csCache.get(cKey));

        try {
            const h = await getHeaders();
            let unitId = (classCache.groupId === groupId && classCache.classUnitId) ? classCache.classUnitId : null;
            if (!unitId) {
                const gd = await (await fetch(`https://authedu.mosreg.ru/api/ej/plan/teacher/v1/groups/${groupId}`, { headers: { ...h, "x-mes-subsystem": "journalw" }, signal: csAbort.signal })).json();
                unitId = gd.class_unit_id || gd.class_unit?.id;
                if (classCache.groupId === groupId) classCache.classUnitId = unitId;
            }
            if (!unitId) {
                root.dataset.loading = 'false';
                root.style.display = 'none';
                return;
            }

            const tid = setTimeout(() => csAbort.abort(), 10000);
            const res = await fetch(`https://authedu.mosreg.ru/api/ej/plan/teacher/v1/schedule_items?academic_year_id=${h.aid}&class_unit_id=${unitId}&from=${iso}&to=${iso}&with_lesson_info=true&with_rooms_info=true&page=1&per_page=50&original=true`, { headers: { ...h, "x-mes-subsystem": "journalw" }, signal: csAbort.signal });
            clearTimeout(tid);

            const raw = await res.json();
            const list = Array.isArray(raw) ? raw : (raw.schedule_items || []);

            if (!list.length) {
                csCache.set(cKey, []);
                draw([]);
                return;
            }

            const missG = [...new Set(list.map(l => l.group_id).filter(id => id && !grpCache.has(id)))];
            if (missG.length) {
                const gData = await (await fetch(`https://authedu.mosreg.ru/api/ej/plan/teacher/v1/groups?group_ids=${missG.join(',')}&academic_year_id=${h.aid}&per_page=100`, { headers: { ...h, "x-mes-subsystem": "journalw" }, signal: csAbort.signal })).json();
                (Array.isArray(gData) ? gData : (gData.groups || [])).forEach(g => grpCache.set(g.id, g.subject_name || '—'));
            }

            const parsed = list.map(l => {
                const sM = Array.isArray(l.time) ? l.time[0] * 60 + l.time[1] : 0, eM = sM + (l.duration || 40);
                const sStr = sM ? `${pad(Math.floor(sM/60))}:${pad(sM%60)}` : '';
                const eStr = sM ? `${pad(Math.floor(eM/60))}:${pad(eM%60)}` : '';
                return {
                    num: l.study_ordinal || l.lesson_number || 1,
                    start: sM, end: eM,
                    startStr: sStr,
                    endStr: eStr,
                    time: sM ? `${sStr}–${eStr}` : '—',
                    sub: grpCache.get(l.group_id) || l.subject_name || '—',
                    room: String(l.room_name || l.room_number || '').replace(/^(каб\.?|кабинет)\s*/i, '').match(/^(\d+[\wа-яА-ЯёЁ-]*)\b/)?.[1] || l.room_name || '—',
                    rawTeacher: l.teacher_name || '',
                    teacher: l.teacher_name ? l.teacher_name.split(/\s+/).map((p, i) => i ? p[0] + '.' : p).slice(0, 3).join(' ') : '—'
                };
            }).sort((a, b) => a.start - b.start || a.num - b.num);

            csCache.set(cKey, parsed);
            draw(parsed);
        } catch (e) {
            root.dataset.loading = 'false';
            if (e.name !== 'AbortError') root.style.display = 'none';
        }
    }

    // --- 5. ВИЗУАЛЬНЫЕ УЛУЧШЕНИЯ И ПОДСВЕТКИ ---
    function highlights() {
        if (!window.__meshHLInited) window.__meshHLInited = true;
        
        let activeRow = null, activeBox = null;
        if (!window.__zenBind) {
            document.addEventListener('mouseover', e => {
                if (!getGroupId()) return; 
                const row = e.target.closest('tr.f0eMcueVzidF1N9SAffu');
                if (row === activeRow) return; 
                activeRow = row;
                activeBox?.classList.remove('mesh-zh'); 
                activeBox = row?.querySelector('td span[title]')?.parentElement || null; 
                activeBox?.classList.add('mesh-zh');
            });
            window.__zenBind = true;
        }

        const d = new Date();
        const today = TEST_BIRTHDAY_DATE || `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
        const birthdayKids = classCache.profiles.filter(p => p.birthDate && p.birthDate.startsWith(today));

        document.querySelectorAll('.f0eMcueVzidF1N9SAffu').forEach(r => {
            const nameEl = r.querySelector('td span[title]');
            if (nameEl && birthdayKids.length > 0) {
                const currentText = (nameEl.childNodes[0]?.nodeValue || nameEl.textContent).trim();
                const kid = birthdayKids.find(k => currentText === k.shortName || currentText.startsWith(k.shortName));
                
                if (kid) {
                    if (!nameEl.querySelector('.msh-bday-tag')) {
                        const bdayTag = document.createElement('span');
                        bdayTag.className = 'msh-bday-tag';
                        bdayTag.textContent = ' 🎂';
                        bdayTag.style.pointerEvents = 'none';
                        nameEl.appendChild(bdayTag);
                        nameEl.title = `🎉 Сегодня день рождения! (${kid.birthDate})`;
                        nameEl.style.fontWeight = '700';
                        nameEl.style.color = '#d35400';
                    }
                }
            }

            const aS = Array.from(r.querySelectorAll('span')).find(s => /^\s*[2-5],\d{2}\s*$/.test(s.textContent));
            if (aS) {
                const aV = parseFloat(aS.textContent.replace(',', '.'));
                const ws = getWeightedMarks(r).reduce((acc, m) => acc + m.weight, 0); 
                aS.classList.toggle('mshhlpr-rainbow-bg', !isNaN(aV) && aV <= 2.50);
                let tt = `Средний балл: ${aV}`;
                if (!isNaN(aV) && ws > 0) {
                    const t = aV < 2.6 ? 2.6 : aV < 3.6 ? 3.6 : aV < 4.6 ? 4.6 : 0;
                    if (t) { 
                        const n = Math.max(0, Math.ceil((t * ws - aV * ws) / (5 - t))); 
                        tt += `\n👉 До оценки ${t < 3 ? 3 : t < 4 ? 4 : 5} нужно пятёрок (с весом 1): ${n > 50 ? '>50' : n}`; 
                    }
                }
                aS.title = tt;
            }
        });
    }

    // --- 6. КАРТОЧКА УЧЕНИКА ---
    if (!window.__tooltipKillerInited) {
        new MutationObserver((muts) => {
            muts.forEach(m => m.addedNodes.forEach(n => {
                if (n.nodeType === 1 && n.classList.contains('MuiPopper-root') && n.getAttribute('role') === 'tooltip' && n.textContent.includes('Информация об учащемся')) {
                    n.style.setProperty('display', 'none', 'important');
                    n.style.setProperty('pointer-events', 'none', 'important');
                    n.style.setProperty('opacity', '0', 'important');
                }
            }));
        }).observe(document.body, { childList: true, subtree: true });
        window.__tooltipKillerInited = true;
    }

    if (!window.__studentCardBind) {
        document.addEventListener('click', async (e) => {
            const nameEl = e.target.closest('.f0eMcueVzidF1N9SAffu td:first-child span[title]');
            if (!nameEl) return;
            e.preventDefault(); 
            e.stopPropagation(); 
            
            const rawText = nameEl.childNodes[0]?.nodeValue || nameEl.textContent;
            openCustomStudentCard(rawText.trim());
        }, true);
        window.__studentCardBind = true;
    }

    async function openCustomStudentCard(studentName) {
        const groupId = getGroupId(); if (!groupId) return;

        const { ov, close } = createModal('400px', `
            <div style="padding: 40px; text-align: center;">
                <div class="mshhlpr-loader-icon">⏳</div>
                <h3 style="margin: 0; color: #2e7d32;">Сбор данных: ${studentName}...</h3>
            </div>
        `);

        try {
            const h = await getHeaders();
            let studentId = null;

            if (!classCache.isLoaded) await ensureClassLoaded(groupId);
            
            let cachedStudent = classCache.profiles.find(p => 
                p.name === studentName || 
                p.shortName === studentName || 
                studentName.startsWith(p.shortName) || 
                p.name.startsWith(studentName)
            );

            if (cachedStudent) {
                studentId = cachedStudent.id;
            } else {
                const archRes = await fetch(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/student_profiles?group_ids=${groupId}&with_archived_groups=true&with_user_info=true&per_page=150`, { headers: { ...h, "x-mes-subsystem": "teacherweb" } });
                if (archRes.ok) {
                    const rawList = await archRes.json();
                    const list = Array.isArray(rawList) ? rawList : (rawList.student_profiles || []);
                    const found = list.find(s => {
                        const p = s.user || s.person || s;
                        const fn = `${p.last_name} ${p.first_name} ${p.middle_name || ''}`.trim();
                        const sn = `${p.last_name} ${p.first_name}`.trim();
                        return fn === studentName || sn === studentName || studentName.startsWith(sn) || fn.startsWith(studentName);
                    });
                    if (found) studentId = found.id;
                }
            }

            if (!studentId) throw new Error('Не удалось найти ученика в списке класса.');

            const raw = await (await fetch(`https://authedu.mosreg.ru/api/ej/core/teacher/v1/student_profiles/${studentId}?with_user_info=true&with_attendances_count=true&with_archived_groups=true`, { headers: { ...h, "x-mes-subsystem": "teacherweb" } })).json();
            
            const source = raw.user || raw.person || raw;
            const fio = source.full_name || raw.user_name || `${source.last_name} ${source.first_name} ${source.middle_name || ''}`.trim();
            let peGroup = '—';
            if (raw.physical_training_group_id) peGroup = {1:'Основная (1)', 2:'Подгот-ая (2)', 3:'Спец. А (3)', 4:'Спец. Б (4)'}[raw.physical_training_group_id] || `Группа ${raw.physical_training_group_id}`;

            let parentsHtml = (raw.parents || []).map(p => `
                <div class="mshhlpr-parent-card">
                    <div style="font-weight: bold; color: #2e7d32; margin-bottom: 8px; font-size: 16px;">👥 ${p.type || 'Родитель'}: ${p.name || 'Имя не указано'}</div>
                    <div style="font-size: 15px; color: #444; display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                        <div>📞 ${p.phone_number || '—'}</div>
                        <div>📧 ${p.email ? `<a href="mailto:${p.email}" style="color: #2e7d32;">${p.email}</a>` : '—'}</div>
                        <div style="grid-column: span 2; font-size: 14px; color: #777;">СНИЛС: ${p.snils || '—'}</div>
                    </div>
                </div>
            `).join('') || '<div style="color: #999; font-style: italic; font-size: 15px;">Информация о представителях отсутствует.</div>';

            ov.innerHTML = `<div class="mshhlpr-modal-content" style="width: 900px; max-width: 95vw; max-height: 90vh; display: flex; flex-direction: column; padding: 0;">
                <div class="mshhlpr-modal-header" style="padding: 25px 30px; flex-direction: column; align-items: flex-start; position: relative; flex-shrink: 0;">
                    <button class="mshhlpr-modal-close" style="position: absolute; top: 15px; right: 20px;">×</button>
                    <div style="font-size: 14px; opacity: 0.8; margin-bottom: 8px;">Карточка ученика</div>
                    <h2 style="margin: 0; font-size: 28px; color: white;">${fio}</h2>
                    <div style="display: flex; gap: 12px; margin-top: 15px; width: 100%; align-items: center; flex-wrap: wrap;">
                        <span class="mshhlpr-badge mshhlpr-badge-green" style="background: rgba(255,255,255,0.2); color: white; border: none; padding: 8px 14px; font-size: 14px;">🎓 Класс: ${raw.class_unit?.name || '—'}</span>
                        <span class="mshhlpr-badge mshhlpr-badge-green" style="background: rgba(255,255,255,0.2); color: white; border: none; padding: 8px 14px; font-size: 14px;">👨‍🏫 Кл. рук: ${raw.mentors?.[0]?.name || 'Не назначен'}</span>
                        <a href="${window.location.origin}/teacher/group-management/student-card/${raw.id}" target="_blank" style="margin-left: auto; text-decoration: none;">
                            <button class="mshhlpr-universal-toggle-btn" style="background: white !important; color: #2e7d32 !important; border: none !important; padding: 8px 16px !important; cursor: pointer; font-size: 14px !important;">🔗 Открыть профиль</button>
                        </a>
                    </div>
                </div>
                <div class="mshhlpr-modal-body" style="flex-direction: column; padding: 30px; background: #f8f9fa; gap: 25px; overflow-y: auto;">
                    <div class="mshhlpr-grid-2">
                        <div class="mshhlpr-info-card">
                            <h4 class="mshhlpr-info-title">Личные данные</h4>
                            <div class="mshhlpr-info-row">
                                <div class="mshhlpr-info-label">Возраст:</div> <div><b>${raw.age ? raw.age+' лет' : '—'}</b></div>
                                <div class="mshhlpr-info-label">Пол:</div> <div><b>${(source.sex||raw.sex)==='male'?'👦 Муж':((source.sex||raw.sex)==='female'?'👧 Жен':'—')}</b></div>
                                <div class="mshhlpr-info-label">Дата рожд:</div> <div><b>${source.birth_date || raw.birth_date || '—'}</b></div>
                                <div class="mshhlpr-info-label">СНИЛС:</div> <div style="font-family: monospace;">${raw.snils || '—'}</div>
                                <div class="mshhlpr-info-label">Телефон:</div> <div><b>${source.phone_number || raw.phone_number || '<span style="color:#999;">Нет</span>'}</b></div>
                                <div class="mshhlpr-info-label">Email:</div> <div><b>${source.email || raw.email || '<span style="color:#999;">Нет</span>'}</b></div>
                            </div>
                        </div>
                        <div class="mshhlpr-info-card">
                            <h4 class="mshhlpr-info-title">Школьная информация</h4>
                            <div class="mshhlpr-info-row">
                                <div class="mshhlpr-info-label">Логин МЭШ:</div> <div style="font-family: monospace; font-weight: bold; color: #2e7d32;">${raw.gusoev_login || '<span style="color:#999;">—</span>'}</div>
                                <div class="mshhlpr-info-label">Пропуски:</div> <div><b style="color: ${(raw.non_attendance||0) > 30 ? '#e74c3c' : '#333'};">${raw.non_attendance || 0}</b></div>
                                <div class="mshhlpr-info-label">Группа здоровья:</div> <div><b>${peGroup}</b></div>
                                <div class="mshhlpr-info-label">ID в МЭШ:</div> <div style="font-size: 13px; color: #aaa;">${raw.id}</div>
                            </div>
                        </div>
                    </div>
                    <div>
                        <h4 class="mshhlpr-info-title">Семья / Представители</h4>
                        ${parentsHtml}
                    </div>
                </div>
            </div>`;
            ov.querySelector('.mshhlpr-modal-close').onclick = close;
        } catch (e) {
            ov.innerHTML = `<div class="mshhlpr-modal-content" style="width: 400px; padding: 30px; text-align: center;"><h3 style="color: #e74c3c; margin-top: 0;">❌ Ошибка загрузки</h3><p style="font-size: 14px; color: #555;">${e.message}</p><button class="mshhlpr-universal-toggle-btn" style="margin-top: 15px; justify-content: center; background: #e74c3c !important;" onclick="this.closest('.mshhlpr-modal-overlay').remove()">Закрыть</button></div>`;
        }
    }

    // --- 7. OBSERVER МАРШРУТИЗАТОР ---
    let isScheduled = false;
    const obs = new MutationObserver(() => {
        if (isScheduled || isMuted) return; 
        isScheduled = true;
        requestAnimationFrame(async () => {
            const gId = getGroupId();
            if (gId) {
                ensureClassLoaded(gId);
                const ui = modalWindows();
                if (ui?.body) {
                    getMentor(ui.body, gId, ui.autoFitText);
                    classLists(ui.body); 
                    await marksValidator(ui.body, gId); // Строго перед расписанием
                    classScheduleWidget(ui.body, gId);
                    lastGroupId = gId;
                }
                highlights();
            } else { 
                document.getElementById('mshhlpr-journal-sidebar')?.remove(); 
                document.querySelector('.GMR0YmfCRS7L64NE4EFF')?.classList.remove('mshhlpr-has-sidebar-expanded', 'mshhlpr-has-sidebar-collapsed');
                lastGroupId = null; 
            }
            isScheduled = false;
        });
    });

    const initGid = getGroupId();
    if (initGid) { 
        ensureClassLoaded(initGid); 
        const ui = modalWindows(); 
        if (ui?.body) { 
            (async () => {
                getMentor(ui.body, initGid, ui.autoFitText); 
                classLists(ui.body); 
                await marksValidator(ui.body, initGid); // Строго перед расписанием
                classScheduleWidget(ui.body, initGid);
                lastGroupId = initGid; 
            })();
        } 
        highlights(); 
    }
    obs.observe(document.body, { childList: true, subtree: true });
};