// scripts/scheduleZipper.js

// Единый источник дефолтного расписания звонков для всего расширения
window.MESH_DEFAULT_BELLS = `1 урок 08:30-09:10\n2 урок 09:20-10:00\n3 урок 10:10-10:50\n4 урок 11:05-11:45\n5 урок 12:00-12:40\n6 урок 13:00-13:40\n7 урок 14:00-14:40\n8 урок 14:55-15:35\n9 урок 15:50-16:30\n10 урок 16:40-17:20\n11 урок 17:30-18:10\n12 урок 18:20-19:00`;

const SELECTORS = {
    scheduleAside: 'aside.rUlQ9EWlNWIMbbZh.Et14spNe2tEZiyY3',
    asideFallback: 'aside',
    day: '.nkAfYFPTIKgFNq2L',
    lesson: '.e6ESIWCvYHQH3lOg',
    group: '.cdISCvPwy4Q2oujR > span:first-child, .As5rq3Q894A706VT',
    header: '.QN6g3q4k70_f36be',
    topic: '.cdISCvPwy4Q2oujR > span:nth-child(2), .Yqc7KGCueoAVFI1x',
    time: '.f98PG7hpc0sIR_eP span',
    btnHw: '[data-test-component*="Home-badgeStatus"]',
    btnMark: '[data-test-component*="Book-badgeStatus"]',
    emptyBadge: 'QI9v7aY5vGDIwBRPd17S',
    ruler: '.kDceJpxARRwfSjiN',
    elasticWindow: '.mshhlpr-elastic-window',
    statTooltip: '#mshhlpr-global-stat-tooltip',
    scheduleControls: '#mshhlpr-schedule-controls',
    zipToggle: '#mesh-zip-tgl',
    ndoToggle: '#mesh-ndo-tgl',
    bellButton: '#mesh-b-btn',
    bellModal: '#mesh-bell-modal',
    bellText: '#mesh-b-text',
    bellReset: '#mesh-b-res',
    bellSave: '#mesh-b-sav',
    scheduleCss: '#mshhlpr-sch-css',
    printButton: '#mesh-print-schedule-btn',
    globalStatTooltip: '#mshhlpr-global-stat-tooltip',
    cardInner: '.m0Kra9tNIDzJFtd8',
    timeRow: '.wwzPs6NXE0deYHCZ',
    cabinetMarker: '.HEbRoGG3le4LuAeo, .uejslo_PZAjKN3xN',
    cabinetMouseTarget: '.jbafQ8TzmhUujJ8_',
    popperTooltip: 'div[role="tooltip"].base-Popper-root',
    popperFallback: 'div[role="tooltip"]',
    popperCabinet: '.HEbRoGG3le4LuAeo, .cLGgUQsXXgqibjIv',
    injectedCab: '.msh-injected-cab',
    dateLabel: 'span.BTBt1wRzNcfIB7cb',
    dayNameLabel: 'span.dILX7N_ZSccOqnJB',
    statPill: '.mshhlpr-stat-pill[data-msh-tip]',
    summaryHeader: '.BGhWmbpXf3A9L1IQ',
    customRuler: '#mshhlpr-custom-ruler-container',
    scheduleWindow: '.mshhlpr-elastic-window',
    modalClose: '.mshhlpr-modal-close',
    modalHeader: '.mshhlpr-modal-header',
    modalBody: '.mshhlpr-modal-body',
    modalFooter: '.mshhlpr-modal-footer',
    modalContent: '.mshhlpr-modal-content',
    actionBtnPrimary: '.mshhlpr-action-btn-primary',
    actionBtnSecondary: '.mshhlpr-action-btn-secondary',
    universalToggleBtn: '.mshhlpr-universal-toggle-btn',
    universalToggleText: '.mshhlpr-universal-toggle-text',
    iosSwitch: '.mshhlpr-ios-switch',
    iosSlider: '.mshhlpr-ios-slider',
    compactToggle: '.mshhlpr-compact-toggle',
    compactSwitch: '.mshhlpr-compact-switch',
    dayStatsInline: '.mshhlpr-day-stats-inline',
    totalMini: '.mshhlpr-total-mini',
    statStack: '.mshhlpr-stat-stack',
    statPillClass: 'mshhlpr-stat-pill',
    settingsBtn: 'button[data-test-component="scheduleHeaderSettingsView"]',
    infoBtn: 'button[data-test-component="scheduleHeaderExportExcel"]',
    toggleContainer: 'div[data-test-component="undefined-toggleContainer"]'
};

// Переменная отслеживания состояния показа кабинета (по умолчанию true, если еще не считывалось)
let isCabinetEnabled = sessionStorage.getItem('msh_cabinet_enabled') !== 'false';

window.initScheduleZipper = function () {
    console.log('[МЭШ][scheduleZipper.js] Модуль расписания запущен.');

    const CONFIG = {
        NDO_KEYWORDS: ['ндо', 'на дому', 'индив'],
        DEFAULT_BELLS: window.MESH_DEFAULT_BELLS,
        CARD_HEIGHT: 104, // Оптимальная высота под 1 строку темы
        CARD_GAP: 5,      // Компактный отступ между слотами
        SEL: SELECTORS
    };

    let STATE = { zip: true, ndo: false };
    let BELLS_TEXT = "", PARSED_BELLS = [], ACTIVE_TEACHER = null;
    let mainObserver = null, isTogglingWeekend = false;
    let debounceTimer = null, isProcessingDom = false;
    const BELL_BY_NUM = new Map();
    const cabCache = {};

    const timeToMins = str => {
        try {
            const [h, m] = str.replace('.', ':').split(':').map(Number);
            return (isNaN(h) || isNaN(m)) ? null : h * 60 + m;
        } catch { return null; }
    };

    function updateParsedBells() {
        PARSED_BELLS = [];
        BELL_BY_NUM.clear();
        const raw = BELLS_TEXT || CONFIG.DEFAULT_BELLS;

        raw.split('\n').forEach(line => {
            const m = line.match(/(?:(\d+)\s*урок\s*)?(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})/i);
            if (m) {
                const s = timeToMins(m[2]), e = timeToMins(m[3]);
                if (s !== null && e !== null) {
                    const bell = {
                        num: m[1] ? parseInt(m[1], 10) : (PARSED_BELLS.length + 1),
                        start: s,
                        end: e,
                        orig: `${m[2].replace('.', ':')}-${m[3].replace('.', ':')}`
                    };
                    PARSED_BELLS.push(bell);
                    BELL_BY_NUM.set(bell.num, bell);
                }
            }
        });

        PARSED_BELLS.sort((a, b) => a.start - b.start);
    }

    const syncState = (res) => {
        ACTIVE_TEACHER = res.activeTeacher || 'default';
        const profile = res.profiles?.[ACTIVE_TEACHER] || res.profiles?.['undefined'] || {};
        STATE.zip = profile.zipScheduleEnabled !== false;
        STATE.ndo = profile.ndoHidden === true;
        BELLS_TEXT = profile.bellSchedule || res.globalBellSchedule || CONFIG.DEFAULT_BELLS;
        updateParsedBells();
    };

    chrome.storage.local.get(['activeTeacher', 'profiles', 'globalBellSchedule'], (res) => {
        syncState(res);
        const isSchedule = location.pathname.includes('/schedule') && !location.pathname.includes('/lesson');
        if (isSchedule) {
            injectStyles();
            injectToggleUI();
            runPipeline();
        } else {
            cleanupSchedule();
        }
        startObserver();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && location.href.includes('schedule') && (changes.profiles || changes.globalBellSchedule)) {
            chrome.storage.local.get(['activeTeacher', 'profiles', 'globalBellSchedule'], (res) => {
                syncState(res);
                updateTogglesUI();
                runPipeline();
            });
        }
    });

    function cleanupSchedule() {
        document.body.classList.remove('mshhlpr-zipping-active');
        document.getElementById('mshhlpr-sch-css')?.remove();
        document.getElementById('mshhlpr-schedule-controls')?.remove();
        document.getElementById('mshhlpr-global-stat-tooltip')?.remove();
        document.getElementById('mesh-bell-modal')?.remove();
    }

    function startObserver() {
        if (mainObserver) mainObserver.disconnect();

        const isScheduleView = () => location.pathname.includes('/schedule') && !location.pathname.includes('/lesson');

        const executeModifications = () => {
            if (isTogglingWeekend) return;
            isProcessingDom = true;

            if (isScheduleView()) {
                injectStyles();
                injectToggleUI();
                runPipeline();
            } else {
                cleanupSchedule();
            }

            requestAnimationFrame(() => {
                requestAnimationFrame(() => { isProcessingDom = false; });
            });
        };

        const observerHandler = () => {
            if (isProcessingDom || isTogglingWeekend) return;

            const isSch = isScheduleView();
            const controlsMissing = isSch && !document.getElementById('mshhlpr-schedule-controls');
            const cleanupNeeded = !isSch && (document.body.classList.contains('mshhlpr-zipping-active') || document.getElementById('mshhlpr-sch-css'));

            // Мгновенная реакция без задержек таймера при смене роута
            if (controlsMissing || cleanupNeeded) {
                executeModifications();
                return;
            }

            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(executeModifications, 120);
        };

        mainObserver = new MutationObserver(observerHandler);
        mainObserver.observe(document.body, { childList: true, subtree: true });
        executeModifications();
    }

    const getBellByNumber = num => BELL_BY_NUM.get(num) || PARSED_BELLS.find(b => b.num === num);

    function getLessonSlotIndex(timeText, fallbackIndex) {
        if (!timeText) return fallbackIndex || 1;
        const match = timeText.match(/(\d{1,2}[:.]\d{2})/);
        if (!match) return fallbackIndex || 1;

        const startMins = timeToMins(match[1]);
        if (startMins === null) return fallbackIndex || 1;

        for (let i = 0; i < PARSED_BELLS.length; i++) {
            const bell = PARSED_BELLS[i];
            const diff = Math.abs(bell.start - startMins);
            if (diff <= 15) return bell.num;
            if (bell.start > startMins) {
                const prev = PARSED_BELLS[i - 1];
                if (!prev) return bell.num;
                return Math.abs(prev.start - startMins) <= Math.abs(bell.start - startMins) ? prev.num : bell.num;
            }
        }
        return PARSED_BELLS[PARSED_BELLS.length - 1]?.num || (fallbackIndex || 1);
    }



    let cabQueue = [];
    let isFetchingCabs = false;

    function getCardCacheKey(cardElement) {
        const weekKey = document.querySelector(`${SELECTORS.summaryHeader} ${SELECTORS.dateLabel}`)?.textContent.trim() || '';
        const dayEl = cardElement.closest(SELECTORS.day);
        const dayIdx = dayEl ? Array.from(document.querySelectorAll(SELECTORS.day)).indexOf(dayEl) : 0;
        const time = cardElement.querySelector(SELECTORS.time)?.textContent.trim() || '';
        const grp = cardElement.querySelector(SELECTORS.group)?.textContent.trim() || '';
        return `${weekKey}|${dayIdx}|${time}|${grp}`;
    }

    function renderCabBadge(timeRow, cabText) {
        if (!timeRow || timeRow.querySelector(SELECTORS.cabinetMarker)) return;
        const nativeSpanCls = document.querySelector(`${SELECTORS.lesson} .HEbRoGG3le4LuAeo:not(.msh-injected-cab *)`)?.className
            || 'cTksrwhuCsYCcVfd kU0O9jo34U9_wBuB PvBZ8CQOMlocEX_A vD8EUWGQh0crxIHu RUVWygkjW7Yo9Xlj HEbRoGG3le4LuAeo';

        const cabDiv = document.createElement('div');
        cabDiv.className = 'uejslo_PZAjKN3xN msh-injected-cab';
        cabDiv.innerHTML = `
            <div class="cLGgUQsXXgqibjIv">
                <span class="${nativeSpanCls}">${cabText}</span>
            </div>
        `;
        timeRow.appendChild(cabDiv);
    }

    function ensureCabinetRendered(cardElement) {
        if (!isCabinetEnabled) return;

        const cardInner = cardElement.querySelector(SELECTORS.cardInner);
        const timeRow = cardInner?.querySelector(SELECTORS.timeRow);
        if (!cardInner || !timeRow || timeRow.querySelector(SELECTORS.cabinetMarker)) return;

        const key = getCardCacheKey(cardElement);
        if (cabCache[key]) {
            renderCabBadge(timeRow, cabCache[key]);
            return;
        }

        if (!cabQueue.some(item => item.key === key)) {
            cabQueue.push({ key, cardInner, timeRow });
            processCabQueue();
        }
    }

    async function processCabQueue() {
        if (isFetchingCabs || !cabQueue.length) return;
        isFetchingCabs = true;

        // Ждем, если сейчас автоматически переключается суббота или учитель сам открыл настройки
        while (isTogglingWeekend || document.querySelector(SELECTORS.toggleContainer)) {
            await new Promise(r => setTimeout(r, 50));
        }

        let silentStyle = document.getElementById('msh-silent-popper-hide');
        if (!silentStyle) {
            silentStyle = document.createElement('style');
            silentStyle.id = 'msh-silent-popper-hide';
            silentStyle.textContent = '.MAvpC5h97oUOHMjn, div[role="tooltip"]:not(:has(input)) { opacity: 0 !important; pointer-events: none !important; }';
            document.head.appendChild(silentStyle);
        }

        while (cabQueue.length > 0) {
            // Если учитель в этот момент открыл меню настроек — прерываем автоклики
            if (isTogglingWeekend || document.querySelector(SELECTORS.toggleContainer)) break;

            const { key, cardInner, timeRow } = cabQueue.shift();
            if (!cardInner.isConnected || !isCabinetEnabled) continue;

            if (cabCache[key]) {
                renderCabBadge(timeRow, cabCache[key]);
                continue;
            }

            isProcessingDom = true;
            isActionClicking = true;
            smartClick(cardInner);
            isActionClicking = false;

            let foundCab = null;
            for (let i = 0; i < 8; i++) {
                await new Promise(r => setTimeout(r, 25));
                const popCab = document.querySelector('.MAvpC5h97oUOHMjn .HEbRoGG3le4LuAeo, div[role="tooltip"] .HEbRoGG3le4LuAeo');
                if (popCab && popCab.textContent.trim()) {
                    foundCab = popCab.textContent.trim();
                    break;
                }
            }

            smartClick(document.body);
            await new Promise(r => setTimeout(r, 25));
            if (document.querySelector('.MAvpC5h97oUOHMjn')) {
                isActionClicking = true;
                smartClick(cardInner);
                isActionClicking = false;
                await new Promise(r => setTimeout(r, 25));
            }

            if (foundCab) {
                cabCache[key] = foundCab;
                if (timeRow.isConnected && isCabinetEnabled) {
                    renderCabBadge(timeRow, foundCab);
                }
            }
        }

        silentStyle?.remove();
        isFetchingCabs = false;
        setTimeout(() => { isProcessingDom = false; }, 50);
    }

    let lastCheckedWeek = null;

    async function checkAndSyncEmptyWeekends(days) {
        if (!STATE.zip) { lastCheckedWeek = null; return; }
        // Если уже идет автопереключение ИЛИ панель открыта самим учителем — не вмешиваемся
        if (isTogglingWeekend || !days.length || document.querySelector(SELECTORS.toggleContainer)) return;

        const weekKey = document.querySelector(`${SELECTORS.summaryHeader} ${SELECTORS.dateLabel}`)?.textContent.trim() || '';
        if (!weekKey || weekKey === lastCheckedWeek) return;

        const getWeekendState = () => {
            const hdrs = Array.from(document.querySelectorAll(`${SELECTORS.summaryHeader} ${SELECTORS.header}`));
            const curDays = Array.from(document.querySelectorAll(SELECTORS.day));
            const satIdx = hdrs.findIndex(h => h.textContent.toLowerCase().includes('сб'));
            const sunIdx = hdrs.findIndex(h => h.textContent.toLowerCase().includes('вс'));
            return {
                hasSat: satIdx !== -1,
                emptySat: satIdx !== -1 && !curDays[satIdx]?.querySelector(CONFIG.SEL.lesson),
                emptySun: sunIdx !== -1 && !curDays[sunIdx]?.querySelector(CONFIG.SEL.lesson)
            };
        };

        let { hasSat, emptySat, emptySun } = getWeekendState();
        const needCabCheck = sessionStorage.getItem('msh_cabinet_enabled') === null;

        if (hasSat && !emptySat && !emptySun && !needCabCheck) {
            lastCheckedWeek = weekKey;
            return;
        }

        const btn = document.querySelector(SELECTORS.settingsBtn);
        if (!btn) return;

        isTogglingWeekend = true;
        lastCheckedWeek = weekKey;

        btn.click();
        await new Promise(r => setTimeout(r, 50));

        const setToggle = (keyword, targetChecked) => {
            document.querySelectorAll(SELECTORS.toggleContainer).forEach(c => {
                const txt = c.textContent.toLowerCase(), inp = c.querySelector('input');
                if (txt.includes('кабинет') && inp) {
                    isCabinetEnabled = inp.checked;
                    sessionStorage.setItem('msh_cabinet_enabled', isCabinetEnabled);
                }
                if (txt.includes(keyword) && inp && inp.checked !== targetChecked) {
                    (inp || c).click();
                }
            });
        };

        if (!hasSat) {
            setToggle('суббот', true);
            for (let i = 0; i < 10; i++) {
                await new Promise(r => setTimeout(r, 30));
                ({ hasSat, emptySat, emptySun } = getWeekendState());
                if (hasSat) break;
            }
        }

        if (emptySat) setToggle('суббот', false);
        if (emptySun) setToggle('воскрес', false);

        await new Promise(r => setTimeout(r, 50));

        // Закрываем панель ТОЛЬКО если она сейчас открыта
        if (document.querySelector(SELECTORS.toggleContainer)) {
            (document.querySelector(SELECTORS.settingsBtn) || btn).click();
        }

        setTimeout(() => {
            isTogglingWeekend = false;
            runPipeline();
        }, 150);
    }

    // --- УНИВЕРСАЛЬНЫЙ ПЕРЕХОД (УРОК / ЖУРНАЛ) ---
    let isActionClicking = false;

    // Универсальный хелпер клика с координатами центра для React
    function smartClick(el) {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(e => {
            try { el.dispatchEvent(new PointerEvent(e, opts)); } catch (_) {}
            el.dispatchEvent(new MouseEvent(e, opts));
        });
        if (typeof el.click === 'function') el.click();
    }

    async function executeCardAction(lessonCard, triggerEl, buttonText) {
        if (triggerEl) triggerEl.style.opacity = '0.5';

        const target = lessonCard.querySelector('.m0Kra9tNIDzJFtd8') || lessonCard;
        const findBtn = () => Array.from(document.querySelectorAll('.base-Popper-root button, div[role="tooltip"] button, button'))
            .find(b => b.textContent.trim().includes(buttonText));

        let btn = findBtn();
        if (!btn) {
            isActionClicking = true;
            smartClick(target);
            isActionClicking = false;

            for (let i = 0; i < 20 && !btn; i++) {
                await new Promise(r => setTimeout(r, 40));
                btn = findBtn();
            }
        }

        smartClick(btn);
        if (triggerEl) triggerEl.style.opacity = '1';
    }

    // --- ДЕЛЕГИРОВАННЫЙ СЛУШАТЕЛЬ КЛИКОВ, ПОДСКАЗОК И ТУМБЛЕРОВ ---
    if (!window.__meshScheduleJournalBind) {
        document.addEventListener('mouseover', (e) => {
            if (!STATE.zip) return;
            const toJ = e.target.closest(`${SELECTORS.group}, ${SELECTORS.btnMark}, button[data-test-component*="Book"]`);
            const toL = e.target.closest(`${SELECTORS.btnHw}, button[data-test-component*="Home"]`);
            if (toJ && !toJ.title) toJ.title = 'Перейти в журнал класса';
            if (toL && !toL.title) toL.title = 'Перейти к уроку и домашнему заданию';
        }, true);

        document.addEventListener('change', (e) => {
            const container = e.target.closest(SELECTORS.toggleContainer);
            const inp = container?.querySelector('input');
            if (container?.textContent.toLowerCase().includes('кабинет') && inp) {
                isCabinetEnabled = inp.checked;
                sessionStorage.setItem('msh_cabinet_enabled', isCabinetEnabled);
                runPipeline();
            }
        }, true);

        document.addEventListener('click', (e) => {
            if (!STATE.zip || isActionClicking) return;
            const card = e.target.closest(SELECTORS.lesson);
            if (!card) return;

            const toJournal = e.target.closest(`${SELECTORS.group}, ${SELECTORS.btnMark}, button[data-test-component*="Book"]`);
            const toLesson = e.target.closest(`${SELECTORS.btnHw}, button[data-test-component*="Home"]`);

            if (toJournal || toLesson) {
                e.preventDefault();
                e.stopPropagation();
                executeCardAction(card, toJournal || toLesson, toJournal ? 'К журналу' : 'К уроку');
            }
        }, true);

        window.__meshScheduleJournalBind = true;
    }

    // --- ДЕЛЕГИРОВАННЫЙ СЛУШАТЕЛЬ КЛИКОВ, ПОДСКАЗОК И ТУМБЛЕРОВ ---
    if (!window.__meshScheduleJournalBind) {
        document.addEventListener('mouseover', (e) => {
            const groupEl = e.target.closest(SELECTORS.group);
            const marksEl = e.target.closest(SELECTORS.btnMark);
            const hwEl = e.target.closest(SELECTORS.btnHw);

            if (!STATE.zip) {
                if (groupEl && groupEl.title) groupEl.title = '';
                if (marksEl && marksEl.title) marksEl.title = '';
                if (hwEl && hwEl.title) hwEl.title = '';
                return;
            }

            if (groupEl && !groupEl.title) groupEl.title = 'Перейти в журнал класса';
            if (marksEl && !marksEl.title) marksEl.title = 'Перейти в журнал класса';
            if (hwEl && !hwEl.title) hwEl.title = 'Перейти к уроку и домашнему заданию';
        }, true);

        // Отслеживаем переключение тумблеров в меню настроек отображения
        document.addEventListener('change', (e) => {
            const container = e.target.closest(SELECTORS.toggleContainer);
            if (container && container.textContent.toLowerCase().includes('кабинет')) {
                const inp = container.querySelector('input');
                if (inp) {
                    isCabinetEnabled = inp.checked;
                    sessionStorage.setItem('msh_cabinet_enabled', isCabinetEnabled);
                    runPipeline();
                }
            }
        }, true);

        // Обработка кликов
        document.addEventListener('click', async (e) => {
            if (!STATE.zip) return;

            const groupEl = e.target.closest(SELECTORS.group);
            const marksEl = e.target.closest(SELECTORS.btnMark);
            const hwEl = e.target.closest(SELECTORS.btnHw);
            const lessonCard = e.target.closest(SELECTORS.lesson);

            if (!lessonCard) return;

            if (groupEl || marksEl) {
                e.preventDefault(); e.stopPropagation();
                await executeCardAction(lessonCard, marksEl || groupEl, 'К журналу');
            } else if (hwEl) {
                e.preventDefault(); e.stopPropagation();
                await executeCardAction(lessonCard, hwEl, 'К уроку');
            }
        }, true);

        window.__meshScheduleJournalBind = true;
    }

    function runPipeline() {
        const days = Array.from(document.querySelectorAll(SELECTORS.day));
        if (!days.length) return;

        if (STATE.zip) checkAndSyncEmptyWeekends(days);

        document.body.classList.toggle('mshhlpr-zipping-active', STATE.zip);
        document.querySelectorAll(SELECTORS.elasticWindow).forEach(el => el.remove());

        // Если показ кабинетов отключен, зачищаем ранее внедренные элементы
        if (!isCabinetEnabled) {
            document.querySelectorAll('.msh-injected-cab').forEach(el => el.remove());
        }

        const slotPitch = CONFIG.CARD_HEIGHT + CONFIG.CARD_GAP;
        const dayCardGroups = new Map();

        let maxLessonBottom = 0;
        const allWeekCards = [];
        days.forEach((day, dayIdx) => {
            const lessonEls = Array.from(day.querySelectorAll(CONFIG.SEL.lesson));
            lessonEls.forEach((l, lIdx) => {
                const wrapper = l.closest('div[style*="position: absolute"]') || l;

                if (!wrapper.dataset.meshOrigWidth) {
                    wrapper.dataset.meshOrigWidth = wrapper.style.width || '100%';
                    wrapper.dataset.meshOrigLeft = wrapper.style.left || '0%';
                    wrapper.dataset.meshOrigTop = wrapper.style.top || '0px';
                    wrapper.dataset.meshOrigHeight = wrapper.style.height || `${CONFIG.CARD_HEIGHT}px`;
                }

                const topVal = parseFloat(wrapper.dataset.meshOrigTop) || 0;
                const hVal = parseFloat(wrapper.dataset.meshOrigHeight) || 104;
                maxLessonBottom = Math.max(maxLessonBottom, topVal + hVal);

                const grpEl = l.querySelector(CONFIG.SEL.group);
                const grpName = grpEl?.textContent.toLowerCase() || '';
                const isNdo = CONFIG.NDO_KEYWORDS.some(kw => grpName.includes(kw));
                const timeText = l.querySelector(CONFIG.SEL.time)?.textContent.trim() || '';
                const slotNum = getLessonSlotIndex(timeText, lIdx + 1);

                const mrkBadge = l.querySelector(CONFIG.SEL.btnMark);
                const hwBadge = l.querySelector(CONFIG.SEL.btnHw);

                if (STATE.zip) {
                    if (grpEl) grpEl.title = 'Перейти в журнал класса';
                    if (mrkBadge) mrkBadge.title = 'Перейти в журнал класса';
                    if (hwBadge) hwBadge.title = 'Перейти к уроку и домашнему заданию';
                } else {
                    if (grpEl) grpEl.title = '';
                    if (mrkBadge) mrkBadge.title = '';
                    if (hwBadge) hwBadge.title = '';
                }

                const card = {
                    dayEl: day,
                    dayIdx,
                    el: l,
                    wrapper,
                    isNdo,
                    slotNum,
                    topVal
                };

                allWeekCards.push(card);
                if (!dayCardGroups.has(dayIdx)) dayCardGroups.set(dayIdx, []);
                dayCardGroups.get(dayIdx).push(card);
            });
        });

        const uncompressedHeight = Math.max(1200, maxLessonBottom + 60);
        const visibleWeekCards = allWeekCards.filter(c => !(c.isNdo && STATE.ndo));
        let minSlot = 1, maxSlot = 7;
        if (visibleWeekCards.length > 0) {
            const slots = visibleWeekCards.map(c => c.slotNum);
            minSlot = Math.min(...slots);
            maxSlot = Math.max(...slots);
        }
        const totalActiveSlots = Math.max(1, maxSlot - minSlot + 1);

        days.forEach((day, dayIdx) => {
            const dayCards = dayCardGroups.get(dayIdx) || [];

            day.style.height = STATE.zip ? `${totalActiveSlots * slotPitch}px` : `${uncompressedHeight}px`;

            const slotMap = new Map();
            dayCards.forEach(c => {
                const groupKey = STATE.zip ? c.slotNum : `top_${Math.round(c.topVal / 25) * 25}`;
                if (!slotMap.has(groupKey)) slotMap.set(groupKey, []);
                slotMap.get(groupKey).push(c);
            });

            slotMap.forEach(slotCards => {
                const visibleInSlot = slotCards.filter(c => !(c.isNdo && STATE.ndo));

                slotCards.forEach(c => {
                    if (c.isNdo && STATE.ndo) {
                        c.wrapper.style.display = 'none';
                    }
                });

                const count = visibleInSlot.length;
                visibleInSlot.forEach((c, idx) => {
                    c.wrapper.style.display = '';

                    if (count === 1) {
                        c.wrapper.style.width = '100%';
                        c.wrapper.style.left = '0%';
                        if (STATE.zip && isCabinetEnabled) ensureCabinetRendered(c.el);
                        else c.el.querySelector('.msh-injected-cab')?.remove();
                    } else if (count > 1) {
                        const widthPct = 100 / count;
                        c.wrapper.style.width = `${widthPct}%`;
                        c.wrapper.style.left = `${idx * widthPct}%`;
                        c.el.querySelector('.msh-injected-cab')?.remove();
                    }

                    if (STATE.zip) {
                        const relIdx = c.slotNum - minSlot;
                        c.wrapper.style.top = `${relIdx * slotPitch}px`;
                        c.wrapper.style.height = `${CONFIG.CARD_HEIGHT}px`;
                    } else {
                        c.wrapper.style.top = c.wrapper.dataset.meshOrigTop;
                        c.wrapper.style.height = c.wrapper.dataset.meshOrigHeight;
                        c.wrapper.style.width = c.wrapper.dataset.meshOrigWidth || '100%';
                        if (c.wrapper.dataset.meshOrigLeft) c.wrapper.style.left = c.wrapper.dataset.meshOrigLeft;
                    }
                });
            });

            if (STATE.zip) {
                const visibleDayCards = dayCards.filter(c => !(c.isNdo && STATE.ndo));
                if (visibleDayCards.length > 0) {
                    const dayMax = Math.max(...visibleDayCards.map(c => c.slotNum));

                    for (let s = minSlot; s < dayMax; s++) {
                        const slotCards = slotMap.get(s);
                        if (!slotCards || slotCards.every(c => c.isNdo && STATE.ndo)) {
                            const relIdx = s - minSlot;
                            const windowEl = document.createElement('div');
                            windowEl.className = 'mshhlpr-elastic-window';
                            windowEl.style.top = `${relIdx * slotPitch}px`;
                            windowEl.style.height = `${CONFIG.CARD_HEIGHT}px`;

                            const bellInfo = getBellByNumber(s);
                            const label = bellInfo ? `${s} УРОК (${bellInfo.orig})` : `ОКНО (${s} УРОК)`;
                            windowEl.setAttribute('data-window-label', label);

                            day.appendChild(windowEl);
                        }
                    }
                }
            }
        });

        updateRuler(STATE.zip ? minSlot : null, STATE.zip ? maxSlot : null, slotPitch, uncompressedHeight);
        generateScheduleStats(days);
    }

    function updateRuler(minSlot, maxSlot, slotPitch, uncompressedHeight) {
        const ruler = document.querySelector(SELECTORS.ruler);
        if (!ruler) return;

        let container = ruler.querySelector(SELECTORS.customRuler);

        if (!STATE.zip || minSlot === null) {
            ruler.classList.remove('mshhlpr-custom-ruler-active');
            container?.remove();
            ruler.style.height = `${uncompressedHeight || 1200}px`;
            return;
        }

        ruler.classList.add('mshhlpr-custom-ruler-active');
        ruler.style.height = `${(maxSlot - minSlot + 1) * slotPitch}px`;

        if (!container) {
            container = document.createElement('div');
            container.id = 'mshhlpr-custom-ruler-container';
            ruler.appendChild(container);
        }

        let rulerHtml = '';
        for (let s = minSlot; s <= maxSlot; s++) {
            const relIdx = s - minSlot;
            const bell = getBellByNumber(s);
            let timeHtml = `<span>${s} ур.</span>`;
            if (bell && bell.orig) {
                const parts = bell.orig.split('-');
                timeHtml = parts.length === 2
                    ? `<span>${parts[0]}</span><span>-</span><span>${parts[1]}</span>`
                    : `<span>${bell.orig}</span>`;
            }
            rulerHtml += `
                <div class="mshhlpr-ruler-slot" style="top: ${relIdx * slotPitch}px; height: ${CONFIG.CARD_HEIGHT}px;">
                    <span class="mshhlpr-ruler-num">${s}</span>
                    <div class="mshhlpr-ruler-time">${timeHtml}</div>
                </div>`;
        }
        container.innerHTML = rulerHtml;
    }

    function generateScheduleStats(days) {
        const dayHeaders = document.querySelectorAll(SELECTORS.summaryHeader + ' ' + SELECTORS.header);

        days.forEach((day, dayIdx) => {
            const hdr = dayHeaders[dayIdx] || day.querySelector(SELECTORS.header);
            if (!hdr) return;

            hdr.querySelectorAll(SELECTORS.dayStatsInline).forEach(el => el.remove());

            const dateSpan = hdr.querySelector(SELECTORS.dateLabel) || hdr.firstElementChild;
            const dayNameSpan = hdr.querySelector(SELECTORS.dayNameLabel) || hdr.lastElementChild;

            let totalLessons = 0;
            const missingHw = [], missingMarks = [], missingTopic = [];

            day.querySelectorAll(SELECTORS.lesson).forEach(l => {
                const cardParent = l.closest('div[style*="position: absolute"]') || l;
                if (cardParent.style.display === 'none') return;

                const hwBadge = l.querySelector(SELECTORS.btnHw);
                const mrkBadge = l.querySelector(SELECTORS.btnMark);
                if (!hwBadge && !mrkBadge) return;

                totalLessons++;
                const grp = l.querySelector(SELECTORS.group)?.textContent.trim() || 'Урок';

                // Красный домик (dDPk8Oap464er0y1) — отсутствие ДЗ на прошедшем уроке (серый iHwmFfNLyqw9_9Qt игнорируется)
                const isMissingHw = hwBadge?.classList.contains('dDPk8Oap464er0y1') || !!hwBadge?.querySelector('.dDPk8Oap464er0y1') || hwBadge?.classList.contains('LzfOfTqaSQRzzPQJ86I6');

                // Красная книга (dDPk8Oap464er0y1) — отсутствие оценок на прошедшем уроке (серая iHwmFfNLyqw9_9Qt игнорируется)
                const isMissingMark = mrkBadge?.classList.contains('dDPk8Oap464er0y1') || !!mrkBadge?.querySelector('.dDPk8Oap464er0y1') || mrkBadge?.classList.contains('LzfOfTqaSQRzzPQJ86I6');

                if (isMissingHw) missingHw.push(grp);
                if (isMissingMark) missingMarks.push(grp);

                const cdDiv = l.querySelector('.cdISCvPwy4Q2oujR');
                const spans = cdDiv ? Array.from(cdDiv.querySelectorAll('span')) : [];

                const secondSpanText = spans[1] ? spans[1].textContent.trim().toLowerCase() : '';

                const isTopicMissing = !spans[1] ||
                    secondSpanText.length === 0 ||
                    secondSpanText.includes('корпус') ||
                    secondSpanText.includes('каб');

                if (isTopicMissing) {
                    missingTopic.push(grp);
                }
            });

            const statPill = (lbl, arr) => {
                if (!arr.length) return '';
                const tipText = `<strong>Не заполнено (${lbl}):</strong><br>${arr.join('<br>')}`;
                return `<div class="mshhlpr-stat-pill msh-stat-err" data-msh-tip="${encodeURIComponent(tipText)}">${lbl}: ${arr.length}</div>`;
            };

            const statsContainer = document.createElement('div');
            statsContainer.className = SELECTORS.dayStatsInline.replace('.', '');
            statsContainer.innerHTML = `
                <div class="mshhlpr-total-column">
                    <span class="${SELECTORS.totalMini.replace('.', '')}">${totalLessons} ур.</span>
                </div>
                <div class="${SELECTORS.statStack.replace('.', '')}">
                    ${statPill('КТП', missingTopic)}
                    ${statPill('ДЗ', missingHw)}
                    ${statPill('Оценки', missingMarks)}
                </div>
            `;

            if (dateSpan && dateSpan.nextSibling) {
                hdr.insertBefore(statsContainer, dateSpan.nextSibling);
            } else if (dayNameSpan) {
                hdr.insertBefore(statsContainer, dayNameSpan);
            } else {
                hdr.appendChild(statsContainer);
            }
        });

        initGlobalTooltip();
    }

    function initGlobalTooltip() {
        // 1. Самовосстановление DOM-элемента: создаем, если он был удален при уходе со страницы
        let tip = document.getElementById('mshhlpr-global-stat-tooltip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'mshhlpr-global-stat-tooltip';
            document.body.appendChild(tip);
        }

        // 2. Слушатели мыши вешаем строго один раз на весь жизненный цикл вкладки
        if (window.__mshStatTipInited) return;
        window.__mshStatTipInited = true;

        document.addEventListener('mouseover', e => {
            const pill = e.target.closest(SELECTORS.statPill);
            const currentTip = document.getElementById('mshhlpr-global-stat-tooltip');
            if (!currentTip) return;

            if (pill && pill.dataset.mshTip) {
                currentTip.innerHTML = decodeURIComponent(pill.dataset.mshTip);
                currentTip.style.display = 'block';

                const rect = pill.getBoundingClientRect();
                const tipRect = currentTip.getBoundingClientRect();

                let left = rect.left + (rect.width / 2) - (tipRect.width / 2);
                let top = rect.bottom + 6;

                if (left < 10) left = 10;
                if (left + tipRect.width > window.innerWidth - 10) {
                    left = window.innerWidth - tipRect.width - 10;
                }

                currentTip.style.left = `${left}px`;
                currentTip.style.top = `${top}px`;
                currentTip.style.opacity = '1';
            } else {
                currentTip.style.opacity = '0';
                currentTip.style.display = 'none';
            }
        });

        window.addEventListener('scroll', () => {
            const currentTip = document.getElementById('mshhlpr-global-stat-tooltip');
            if (currentTip) {
                currentTip.style.opacity = '0';
                currentTip.style.display = 'none';
            }
        }, { passive: true });
    }

    const saveState = () => chrome.storage.local.get(['activeTeacher', 'profiles'], res => {
        const key = res.activeTeacher || ACTIVE_TEACHER || 'default';
        ACTIVE_TEACHER = key;
        const p = res.profiles || {};
        if (!p[key]) p[key] = {};
        p[key] = { ...p[key], zipScheduleEnabled: STATE.zip, ndoHidden: STATE.ndo };
        chrome.storage.local.set({ profiles: p }, runPipeline);
    });

    const updateTogglesUI = () => {
        const zipEl = document.querySelector(SELECTORS.zipToggle);
        if (zipEl) zipEl.checked = STATE.zip;
        const ndoEl = document.querySelector(SELECTORS.ndoToggle);
        if (ndoEl) ndoEl.checked = STATE.ndo;
    };

    function injectToggleUI() {
        // 1. Проверяем, что мы находимся именно в расписании недели, а не на странице урока
        const isSchedule = location.pathname.includes('/schedule') && !location.pathname.includes('/lesson');
        if (!isSchedule) {
            document.getElementById(SELECTORS.scheduleControls.replace('#', ''))?.remove();
            return;
        }

        // 2. Ищем ТОЛЬКО шапку расписания (по оригинальному классу или наличию шестерёнки настроек недели)
        const aside = document.querySelector(SELECTORS.scheduleAside)
            || document.querySelector('aside:has(button[data-test-component="scheduleHeaderSettingsView"])');

        // 3. Защита от утечки: запрещаем внедрение внутрь всплывающих шторок, модалок и диалогов ДЗ
        if (!aside || aside.closest('[role="dialog"], [class*="Drawer"], [class*="Modal"]')) {
            return;
        }

        let controls = document.querySelector(SELECTORS.scheduleControls);
        if (!controls) {
            const tgl = (id, txt, chk) => `
                <label class="mshhlpr-universal-toggle-btn mshhlpr-compact-toggle">
                        <span class="mshhlpr-universal-toggle-text">${txt}</span>
                        <div class="mshhlpr-ios-switch mshhlpr-compact-switch">
                            <input type="checkbox" id="${id}" ${chk ? 'checked' : ''}>
                            <span class="mshhlpr-ios-slider"></span>
                        </div>
                </label>
            `;

            controls = document.createElement('div');
            controls.id = SELECTORS.scheduleControls.replace('#', '');
            controls.style.cssText = 'display: inline-flex; align-items: center; gap: 6px; margin-right: 8px; flex-wrap: nowrap;';
            controls.innerHTML = `
                ${tgl('mesh-zip-tgl', 'Сжать', STATE.zip)}
                ${tgl('mesh-ndo-tgl', 'Скрыть НДО', STATE.ndo)}
                <button id="mesh-b-btn" class="mshhlpr-universal-toggle-btn mshhlpr-compact-toggle" type="button">
                    <span class="mshhlpr-universal-toggle-text">🔔 Звонки</span>
                </button>
            `;

            const printBtn = document.querySelector(SELECTORS.printButton);
            if (printBtn && printBtn.parentElement === aside) printBtn.after(controls);
            else aside.prepend(controls);

            document.querySelector(SELECTORS.zipToggle)?.addEventListener('change', e => {
                STATE.zip = e.target.checked;
                saveState();
            });
            document.querySelector(SELECTORS.ndoToggle)?.addEventListener('change', e => {
                STATE.ndo = e.target.checked;
                saveState();
            });
            document.querySelector(SELECTORS.bellButton)?.addEventListener('click', openBellModal);
        } else {
            const printBtn = document.querySelector(SELECTORS.printButton);
            if (printBtn && printBtn.parentElement === aside && printBtn.nextElementSibling !== controls) printBtn.after(controls);
        }
    }

    function openBellModal() {
        if (document.querySelector(SELECTORS.bellModal)) return;
        const ov = document.createElement('div');
        ov.id = 'mesh-bell-modal';
        ov.className = 'mshhlpr-modal-overlay';
        ov.innerHTML = `
            <div class="mshhlpr-modal-content" style="width:450px">
                <div class="mshhlpr-modal-header">
                    <span>🔔 Расписание звонков</span>
                    <button class="mshhlpr-modal-close" type="button">&times;</button>
                </div>
                <div class="mshhlpr-modal-body" style="flex-direction:column;padding:20px">
                    <div style="font-size:13px;color:#666;margin-bottom:15px;text-align:left;line-height:1.4">
                        Укажите звонки текстом. Они определяют порядок слотов и печать PDF.<br>
                        <b>Формат:</b> <code>1 урок 08:30-09:10</code>
                    </div>
                    <textarea id="mesh-b-text" style="width:100%;height:260px;font-family:monospace;font-size:13px;padding:12px;border:1px solid #ccc;border-radius:6px;resize:vertical;box-sizing:border-box">${BELLS_TEXT}</textarea>
                </div>
                <div class="mshhlpr-modal-footer" style="justify-content:flex-end;gap:10px">
                    <button id="mesh-b-res" type="button" class="mshhlpr-action-btn-secondary">Сбросить</button>
                    <button id="mesh-b-sav" type="button" class="mshhlpr-action-btn-primary">Сохранить</button>
                </div>
            </div>`;
        document.body.appendChild(ov);

        const close = () => ov.remove();
        ov.querySelector(SELECTORS.modalClose).onclick = close;
        ov.onclick = e => e.target === ov && close();

        document.querySelector(SELECTORS.bellReset).onclick = () => {
            document.querySelector(SELECTORS.bellText).value = CONFIG.DEFAULT_BELLS;
        };

        document.querySelector(SELECTORS.bellSave).onclick = () => {
            chrome.storage.local.get(['activeTeacher', 'profiles'], res => {
                const key = res.activeTeacher || ACTIVE_TEACHER || 'default';
                ACTIVE_TEACHER = key;
                const profiles = res.profiles || {};
                if (!profiles[key]) profiles[key] = {};
                profiles[key].bellSchedule = document.querySelector(SELECTORS.bellText).value.trim();
                chrome.storage.local.set({ profiles }, () => {
                    updateParsedBells();
                    runPipeline();
                    close();
                });
            });
        };
    }

    function injectStyles() {
        if (document.querySelector(SELECTORS.scheduleCss)) return;
        const css = document.createElement('style');
        css.id = 'mshhlpr-sch-css';
        css.textContent = `
            aside.rUlQ9EWlNWIMbbZh.Et14spNe2tEZiyY3 {
                height: auto !important; min-height: 0 !important;
                padding: 2px 10px !important; display: flex !important;
                align-items: center !important; gap: 4px !important;
            }
            .wwzPs6NXE0deYHCZ {
                display: flex !important; justify-content: space-between !important;
                align-items: center !important; width: 100% !important;
            }
            body.mshhlpr-zipping-active .Yqc7KGCueoAVFI1x,
            body.mshhlpr-zipping-active .cdISCvPwy4Q2oujR > span:nth-child(2) {
                display: -webkit-box !important; -webkit-line-clamp: 1 !important;
                -webkit-box-orient: vertical !important; overflow: hidden !important; line-height: 1.2 !important;
            }
            body.mshhlpr-zipping-active .cdISCvPwy4Q2oujR > span:first-child,
            body.mshhlpr-zipping-active .As5rq3Q894A706VT {
                cursor: pointer !important; color: #2e7d32 !important;
                text-decoration: underline !important; text-underline-offset: 2px !important;
                transition: opacity 0.15s ease, color 0.15s ease !important;
            }
            body.mshhlpr-zipping-active .cdISCvPwy4Q2oujR > span:first-child:hover,
            body.mshhlpr-zipping-active .As5rq3Q894A706VT:hover {
                color: #1b5e20 !important; opacity: 0.8 !important;
            }
            body.mshhlpr-zipping-active .m0Kra9tNIDzJFtd8 { height: 104px !important; }
            body.mshhlpr-zipping-active .L1Nsyp1sHwxsskJt { display: none !important; }
            body.mshhlpr-zipping-active .nkAfYFPTIKgFNq2L { transition: height 0.2s ease !important; }
            body.mshhlpr-zipping-active .nkAfYFPTIKgFNq2L > div[style*="position: absolute"] {
                transition: top 0.2s ease, width 0.2s ease, left 0.2s ease !important;
            }

            /* --- ИЗОЛИРОВАННОЕ СКРЫТИЕ ПОДСКАЗОК УРОКОВ (АКТИВНО ТОЛЬКО ВНУТРИ СЕТКИ РАСПИСАНИЯ) --- */
            body.mshhlpr-zipping-active:has(.nkAfYFPTIKgFNq2L) div[role="tooltip"].base-Popper-root:not(:has(input)):not(:has([data-test-component*="iconButtonInPopover"])) {
                opacity: 0 !important; pointer-events: none !important;
                position: absolute !important; z-index: -9999 !important;
            }

            button[data-test-component="scheduleHeaderSettingsView"],
            button[data-test-component="scheduleHeaderExportExcel"] {
                position: relative !important; z-index: 100 !important;
                pointer-events: auto !important; cursor: pointer !important;
            }
            div.base-Popper-root:has(input),
            div.base-Popper-root:has([data-test-component*="iconButtonInPopover"]) {
                opacity: 1 !important; pointer-events: auto !important; z-index: 999999 !important;
            }

            body.mshhlpr-zipping-active [data-test-component*="Home-badgeStatus"],
            body.mshhlpr-zipping-active [data-test-component*="Book-badgeStatus"] {
                cursor: pointer !important; transition: transform 0.15s ease, opacity 0.15s ease !important;
                border-radius: 4px !important;
            }
            body.mshhlpr-zipping-active [data-test-component*="Home-badgeStatus"]:hover,
            body.mshhlpr-zipping-active [data-test-component*="Book-badgeStatus"]:hover {
                transform: scale(1.18) !important; opacity: 0.85 !important;
            }

            .kDceJpxARRwfSjiN.mshhlpr-custom-ruler-active {
                position: relative !important; overflow: hidden !important; transition: height 0.2s ease !important;
            }
            .kDceJpxARRwfSjiN.mshhlpr-custom-ruler-active > .LO5wubRYAFsh8TAK { visibility: hidden !important; }
            #mshhlpr-custom-ruler-container {
                position: absolute !important; top: 0 !important; left: 0 !important;
                right: 0 !important; bottom: 0 !important; visibility: visible !important;
            }
            .mshhlpr-ruler-slot {
                position: absolute !important; left: 0 !important; right: 0 !important;
                display: flex !important; flex-direction: column !important; align-items: center !important;
                justify-content: center !important; border-bottom: 1px dashed rgba(0,0,0,0.08) !important;
                box-sizing: border-box !important;
            }
            .mshhlpr-ruler-num { font-weight: 800 !important; font-size: 14px !important; color: #2e7d32 !important; line-height: 1 !important; }
            .mshhlpr-ruler-time {
                font-size: 9.5px !important; color: #666 !important; margin-top: 2px !important;
                display: flex !important; flex-direction: column !important; align-items: center !important;
                justify-content: center !important; line-height: 1 !important; text-align: center !important;
            }
            .mshhlpr-elastic-window {
                position: absolute !important; left: 2px !important; right: 2px !important;
                width: calc(100% - 4px) !important; background: rgba(0, 0, 0, 0.02) !important;
                border: 1px dashed rgba(0, 0, 0, 0.15) !important; border-radius: 8px !important;
                box-sizing: border-box !important; display: flex !important; align-items: center !important;
                justify-content: center !important; pointer-events: none !important;
            }
            .mshhlpr-elastic-window::after {
                content: attr(data-window-label); font-size: 12px; font-weight: 700;
                color: rgba(0, 0, 0, 0.35); text-transform: uppercase; letter-spacing: 0.5px;
            }
            .BGhWmbpXf3A9L1IQ { overflow: visible !important; position: relative !important; z-index: 50 !important; }
            .QN6g3q4k70_f36be {
                display: flex !important; align-items: center !important; gap: 2px !important;
                overflow: visible !important; position: relative !important; min-width: 0 !important; flex-wrap: nowrap !important;
            }
            .mshhlpr-day-stats-inline {
                display: grid !important; grid-template-columns: auto minmax(0, 1fr) !important;
                align-items: center !important; gap: 2px !important; font-size: 10px !important;
                font-weight: 700 !important; line-height: 1 !important; user-select: none !important;
                margin: 0 auto !important; min-width: 0 !important; max-width: 100% !important; flex-shrink: 1 !important;
            }
            .mshhlpr-total-column { display: flex !important; align-items: center !important; justify-content: center !important; min-width: 0 !important; line-height: 1 !important; }
            .mshhlpr-total-mini {
                color: #2e7d32 !important; font-size: clamp(9px, 0.8vw, 11px) !important;
                font-weight: 800 !important; white-space: nowrap !important; line-height: 1 !important; transform: scaleY(0.96) !important;
            }
            .mshhlpr-stat-stack {
                display: flex !important; flex-direction: column !important; align-items: flex-start !important;
                gap: 0 !important; min-width: 0 !important; max-width: 100% !important; line-height: 1 !important;
            }
            .mshhlpr-stat-pill {
                padding: 0 3px !important; border-radius: 3px !important; font-size: clamp(7px, 0.7vw, 9px) !important;
                white-space: nowrap !important; display: inline-flex !important; align-items: center !important;
                background: #ffebee !important; color: #c62828 !important; border: 1px dashed #e53935 !important;
                cursor: help !important; width: fit-content !important; max-width: 100% !important; overflow: hidden !important;
                text-overflow: ellipsis !important; box-sizing: border-box !important; flex-shrink: 1 !important; line-height: 1 !important;
                min-height: 0 !important; transform: scaleY(0.9) !important;
            }
            #mshhlpr-global-stat-tooltip {
                display: none; opacity: 0; position: fixed !important; z-index: 9999999999 !important;
                background-color: #222 !important; color: #fff !important; border-radius: 6px !important;
                box-shadow: 0 8px 24px rgba(0,0,0,0.5) !important; font-size: 11px !important; font-weight: 400 !important;
                line-height: 1.4 !important; padding: 8px 12px !important; pointer-events: none !important;
                width: max-content !important; max-width: 250px !important; transition: opacity 0.15s ease !important; font-family: inherit !important;
            }
            .mshhlpr-stat-tooltip::after {
                content: "" !important; position: absolute !important; bottom: 100% !important; left: 50% !important;
                margin-left: -5px !important; border: 5px solid transparent !important; border-bottom-color: #222 !important;
            }
            .mshhlpr-stat-pill:hover .mshhlpr-stat-tooltip { visibility: visible !important; opacity: 1 !important; }
        `;
        document.head.appendChild(css);
    }
};