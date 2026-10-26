/**
 * =============================================================================
 * Модуль: vpr.js
 * Описание: Единый контроллер Генератора ВПР для расширения «МЭШ Помогатор».
 * Архитектура (3 режима в одном файле):
 *   1. Контентный скрипт МЭШ (authedu.mosreg.ru):
 *      Отслеживает раздел /teacher/study-process/home-tasks и внедряет кнопку
 *      «🖨️ Генератор ВПР по информатике» в верхнюю панель <aside>.
 *   2. Вкладка Генератора (vpr.html):
 *      Динамически сканирует каталог /scripts/VPRGenerator/Предметы/<Предмет>/<Класс>,
 *      загружает метаданные заданий (task_*.py --meta) через песочницу Brython,
 *      генерирует индивидуальные варианты (--generate) и открывает вкладку редактора.
 *   3. Вкладка Редактора А4 (vpr.html?mode=editor):
 *      Формирует альбомные листы А4 (297×210 мм), позволяет точечно перегенерировать
 *      любое задание по клику на его кружок номера, генерирует ключи и вызывает печать.
 * =============================================================================
 */

(() => {
    const $ = id => document.getElementById(id);
    const isExtPage = location.protocol === 'chrome-extension:' && !!$('generatorView');
    const isEditorMode = isExtPage && new URLSearchParams(location.search).get('mode') === 'editor';

    // =========================================================================
    // РЕЖИМ 1: КОНТЕНТНЫЙ СКРИПТ НА СТРАНИЦЕ МЭШ (ВНЕДРЕНИЕ КНОПКИ В ASIDE)
    // =========================================================================
    if (!isExtPage) {
        const TARGET_PATH = '/teacher/study-process/home-tasks';
        const BTN_ID = 'mesh-vpr-generator-btn';

        function injectVprButton() {
            if (!location.pathname.includes(TARGET_PATH)) {
                $(BTN_ID)?.remove();
                return;
            }
            const schoolBtn = document.querySelector('button[data-test-component="schoolButtonChoice"]');
            const aside = document.querySelector('aside.rUlQ9EWlNWIMbbZh.Et14spNe2tEZiyY3')
                       || schoolBtn?.closest('aside')
                       || document.querySelector('aside');
            if (!aside || $(BTN_ID)) return;

            const btn = document.createElement('button');
            btn.id = BTN_ID;
            btn.type = 'button';
            btn.className = 'mshhlpr-universal-toggle-btn mshhlpr-compact-toggle';
            btn.style.cssText = 'margin-right:8px!important;flex-shrink:0!important;cursor:pointer!important;position:relative!important;z-index:100!important;';
            btn.innerHTML = `<span class="mshhlpr-universal-toggle-text">🖨️ Генератор ВПР по информатике</span>`;

            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const url = chrome.runtime.getURL('scripts/VPRGenerator/vpr.html');
                try {
                    chrome.runtime.sendMessage({ action: 'openVprGenerator' }, (res) => {
                        if (chrome.runtime.lastError || !res) window.open(url, '_blank');
                    });
                } catch { window.open(url, '_blank'); }
            };

            aside.prepend(btn);
        }

        let obsStarted = false;
        window.initVprGenerator = function () {
            if (obsStarted) return;
            obsStarted = true;
            let scheduled = false;
            new MutationObserver(() => {
                if (!scheduled) {
                    scheduled = true;
                    requestAnimationFrame(() => { injectVprButton(); scheduled = false; });
                }
            }).observe(document.body, { childList: true, subtree: true });
            injectVprButton();
        };

        chrome.storage.local.get(['extensionEnabled'], r => {
            if (r.extensionEnabled !== false) window.initVprGenerator();
        });
        return;
    }

    // =========================================================================
    // ОБЩИЙ МОСТ К PYTHON SANDBOX И ФАЙЛОВОЙ СИСТЕМЕ (ДЛЯ ГЕНЕРАТОРА И РЕДАКТОРА)
    // =========================================================================
    const BASE_SUBJECTS_PATH = 'scripts/VPRGenerator/Предметы';
    const pyCodeCache = new Map(), metaCache = new Map(), pendingReqs = new Map();
    let subjectsRootEntry = null, reqCounter = 0, sandboxReady = false, sandboxReadyPromise = null;

    window.addEventListener('message', (e) => {
        if (!e.data) return;
        if (e.data.type === 'PY_SANDBOX_READY') { sandboxReady = true; return; }
        if (e.data.type === 'PY_RESULT') {
            const resolve = pendingReqs.get(e.data.reqId);
            if (resolve) { pendingReqs.delete(e.data.reqId); resolve(e.data); }
        }
    });

    const ensureSandboxReady = () => sandboxReady ? Promise.resolve() : (sandboxReadyPromise ||= new Promise(resolve => {
        const timer = setInterval(() => {
            if (sandboxReady) { clearInterval(timer); resolve(); return; }
            $('pythonSandboxFrame')?.contentWindow?.postMessage({ type: 'PY_PING' }, '*');
        }, 40);
    }));

    async function runPythonCode(code, arg) {
        await ensureSandboxReady();
        return new Promise((resolve, reject) => {
            const win = $('pythonSandboxFrame')?.contentWindow;
            if (!win) return reject(new Error('Песочница Python не найдена'));
            const reqId = ++reqCounter;
            pendingReqs.set(reqId, r => r.ok ? resolve(r.stdout) : reject(new Error(r.error || 'Ошибка Python')));
            win.postMessage({ type: 'PY_EXEC', reqId, code, arg }, '*');
        });
    }

    const getPackageRoot = () => new Promise((res, rej) => chrome?.runtime?.getPackageDirectoryEntry ? chrome.runtime.getPackageDirectoryEntry(res) : rej(new Error('API недоступно')));
    const getSubDir = (parent, path) => new Promise((res, rej) => parent.getDirectory(path, { create: false }, res, rej));
    const readFileText = (entry) => new Promise((res, rej) => entry.file(f => {
        const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f, 'utf-8');
    }, rej));
    const readAllEntries = (dir) => new Promise((res, rej) => {
        const reader = dir.createReader(), all = [];
        const next = () => reader.readEntries(b => b.length ? (all.push(...b), next()) : res(all), rej);
        next();
    });

    async function getTaskCodeByKey(key) {
        if (pyCodeCache.has(key)) return pyCodeCache.get(key);
        const root = await getPackageRoot();
        const fileEntry = await new Promise((res, rej) => root.getFile(`${BASE_SUBJECTS_PATH}/${key}`, { create: false }, res, rej));
        const code = await readFileText(fileEntry);
        pyCodeCache.set(key, code);
        return code;
    }

    // =========================================================================
    // РЕЖИМ 3: ВКЛАДКА РЕДАКТОРА ЛИСТОВ А4 И ПЕЧАТИ (vpr.html?mode=editor)
    // =========================================================================
    if (isEditorMode) {
        document.body.classList.add('mode-editor');

        let DATA = null;
        const CIRCLED = ["①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩","⑪","⑫","⑬","⑭","⑮","⑯","⑰","⑱","⑲","⑳","㉑","㉒","㉓","㉔","㉕","㉖","㉗","㉘","㉙","㉚"];

        const applyZoom = () => {
            const val = $('zoomSelect').value;
            const scale = val === 'fit'
                ? Math.min(1.0, Math.max(0.4, (window.innerWidth - 60) / ((297 / 25.4) * 96)))
                : parseFloat(val);
            document.documentElement.style.setProperty('--zoom-scale', scale);
        };

        const buildTableHtml = (t) => {
            const tbl = t.table || t.code_table || (Array.isArray(t.answer_table) ? {
                headers: t.answer_table, rows: [t.answer_table.map(() => '&nbsp;')]
            } : null);
            if (!tbl || !Array.isArray(tbl.headers)) return '';
            return `<table class="answer-grid"><tr>${tbl.headers.map(h => `<td>${h}</td>`).join('')}</tr>` +
                (tbl.rows || []).map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') + `</table>`;
        };

        const renderTaskHtml = (t, idx, vIdx) => {
            const lines = String(t.task || '').split('\n').map(s => s.trim()).filter(Boolean);
            const [title = '', ...body] = lines;
            const tbl = buildTableHtml(t);
            let h = `<div class="task-block"><div class="task-title"><span class="task-circle" contenteditable="false" data-v="${vIdx}" data-t="${idx}" title="Нажмите, чтобы перегенерировать это задание"><span class="tc-num">${CIRCLED[idx] || `${idx + 1}.`}</span><span class="tc-icon">🔄</span></span><span>${title}</span></div><div class="task-body">`;
            if (tbl) {
                if (!body.length) h += `<div class="task-line-with-table">${tbl}</div>`;
                else {
                    body.slice(0, -1).forEach(l => { h += `<div class="task-line">${l}</div>`; });
                    h += `<div class="task-line-with-table"><span class="task-line-text">${body[body.length - 1]}</span>${tbl}</div>`;
                }
                const isAnsTbl = Array.isArray(t.answer_table) || ((t.table || t.code_table)?.rows || []).some(r => r.some(c => !String(c ?? '').replace(/&nbsp;/g, '').trim()));
                if (!isAnsTbl) h += `<div class="answer-line">Ответ: ___________</div>`;
            } else if (Array.isArray(t.variants) && t.variants.length) {
                body.forEach(l => { h += `<div class="task-line">${l}</div>`; });
                const isInline = t.variant_style === 'inline' || (t.variant_style !== 'block' && t.variants.every(v => String(v).length < 25 && !String(v).includes('\\')));
                if (isInline) {
                    h += `<div class="variants-inline-flow">${t.variants.map((v, i) => `<span class="variant-chip"><strong>${i + 1})</strong> ${v}</span>`).join('')}<span class="inline-answer">Ответ: ___________</span></div>`;
                } else {
                    t.variants.forEach((v, i) => {
                        h += i === t.variants.length - 1
                            ? `<div class="task-line last-variant-row"><div><strong>${i + 1})</strong> ${v}</div><div class="inline-answer">Ответ: ___________</div></div>`
                            : `<div class="task-line"><strong>${i + 1})</strong> ${v}</div>`;
                    });
                }
            } else {
                body.forEach(l => { h += `<div class="task-line">${l}</div>`; });
                h += `<div class="answer-line">Ответ: ___________</div>`;
            }
            return h + `</div></div>`;
        };

        const fillColumn = (col, tasks, vIdx) => {
            const maxH = col.clientHeight, overflow = [];
            let full = false;
            tasks.forEach((task, idx) => {
                if (full) return overflow.push({ task, idx });
                const wrap = document.createElement('div');
                wrap.innerHTML = renderTaskHtml(task, idx, vIdx);
                const node = wrap.firstElementChild;
                col.appendChild(node);
                if (col.scrollHeight > maxH + 1) {
                    col.removeChild(node);
                    full = true;
                    overflow.push({ task, idx });
                }
            });
            return overflow;
        };

        const createSheet = (vp, label, cls = '') => {
            const c = document.createElement('div');
            c.className = 'sheet-container';
            c.innerHTML = `<div class="sheet-label">${label}</div><div class="page ${cls}" contenteditable="true"><div class="overflow-badge"></div></div>`;
            vp.appendChild(c);
            return c.querySelector('.page');
        };

        const headerHtml = (num, student, cls, short = false) => short
            ? `<div class="variant-header"><div class="variant-left">Вариант ${num}</div></div>`
            : `<div class="variant-header"><div class="variant-left">Вариант ${num}</div><div class="variant-right">${student} &nbsp;&nbsp;&nbsp; Класс: ${cls}</div></div>`;

        const checkOverflows = () => {
            let overflowCount = 0;
            let maxExMm = 0;
            let firstOverflowSheet = null;

            document.querySelectorAll('.page:not(.keys-card)').forEach(p => {
                const badge = p.querySelector('.overflow-badge');
                if (!badge) return;
                let ex = 0;
                p.querySelectorAll('.column-block').forEach(c => { ex = Math.max(ex, c.scrollHeight - c.clientHeight); });
                const isOver = ex > 2;
                badge.style.display = isOver ? 'block' : 'none';
                if (isOver) {
                    const mm = Math.max(1, Math.round((ex / 96) * 25.4));
                    badge.innerText = `⚠️ Не влезает: +${mm} мм — уменьшите кегль или включите двустороннюю печать!`;
                    overflowCount++;
                    maxExMm = Math.max(maxExMm, mm);
                    if (!firstOverflowSheet) firstOverflowSheet = p.closest('.sheet-container');
                }
            });

            const topWarn = $('toolbarOverflowWarn');
            if (topWarn) {
                if (overflowCount > 0) {
                    topWarn.style.display = 'inline-flex';
                    topWarn.innerText = `⚠️ Не влезает (${overflowCount} л., до +${maxExMm} мм)`;
                    topWarn.title = 'Нажмите, чтобы перейти к проблемному листу';
                    topWarn.onclick = () => firstOverflowSheet?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else {
                    topWarn.style.display = 'none';
                    topWarn.onclick = null;
                }
            }
        };

        const rebuildPages = () => {
            if (!DATA) return;
            const rootStyle = document.documentElement.style;
            rootStyle.setProperty('--font-family', $('fontFamilySelect').value);
            rootStyle.setProperty('--font-size', $('fontSizeSelect').value);
            rootStyle.setProperty('--page-padding', $('marginsSelect').value);
            rootStyle.setProperty('--zoom-scale', '1');

            const vp = $('viewportArea');
            vp.innerHTML = '';

            const isTwoCol = $('twoColumnsCheckbox').checked, isDuplex = $('duplexCheckbox').checked;
            const step = isTwoCol ? 2 : 1, modeCls = isTwoCol ? 'two-columns-mode' : 'one-column-mode';
            let sheetNum = 1;

            for (let i = 0; i < DATA.variants.length; i += step) {
                const pair = DATA.variants.slice(i, i + step), cur = sheetNum++;
                const desc = isTwoCol ? `Вар. ${i + 1}${pair[1] ? ' и ' + (i + 2) : ''}` : `Вариант ${i + 1}`;
                const front = createSheet(vp, isDuplex ? `📄 Лист ${cur} (ЛИЦО • ${desc})` : `📄 Лист ${cur} (${desc})`, modeCls);
                const overflows = [];

                for (let s = 0; s < step; s++) {
                    const col = document.createElement('div');
                    col.className = 'column-block';
                    front.appendChild(col);
                    const v = pair[s], vIdx = i + s;
                    if (!v) { overflows.push([]); continue; }
                    col.innerHTML = headerHtml(vIdx + 1, v.student, DATA.className);
                    if (isDuplex) overflows.push(fillColumn(col, v.tasks, vIdx));
                    else col.insertAdjacentHTML('beforeend', v.tasks.map((t, idx) => renderTaskHtml(t, idx, vIdx)).join(''));
                }

                if (isDuplex) {
                    const backOrder = isTwoCol ? [1, 0] : [0];
                    const backDesc = isTwoCol ? `Вар. ${pair[1] ? i + 2 : '—'} слева, Вар. ${i + 1} справа` : `Вариант ${i + 1}`;
                    const back = createSheet(vp, `📄 Лист ${cur} (ОБОРОТ • ${backDesc})`, modeCls);
                    backOrder.forEach(s => {
                        const col = document.createElement('div');
                        col.className = 'column-block';
                        if (pair[s]) {
                            const vIdx = i + s;
                            col.innerHTML = headerHtml(vIdx + 1, null, null, true) + overflows[s].map(x => renderTaskHtml(x.task, x.idx, vIdx)).join('');
                        }
                        back.appendChild(col);
                    });
                }
            }

            // Генерация листов с ключами и ответами
            const taskCount = DATA.variants[0]?.tasks.length || 0;
            const ths = Array.from({ length: taskCount }, (_, i) => `<th>№${i + 1}</th>`).join('');
            let idx = 0, part = 1;

            while (idx < DATA.variants.length || idx === 0) {
                const sfx = part > 1 ? ` (Часть ${part})` : '';
                const page = createSheet(vp, `📄 Лист ${sheetNum++} (КЛЮЧИ И ОТВЕТЫ${sfx})`, 'keys-card');
                page.innerHTML = `<h2 style="margin-top:0;border-bottom:2px solid #000;padding-bottom:4px;font-size:1.1em;">КЛЮЧИ И ОТВЕТЫ (Класс: ${DATA.className})${sfx}</h2><table class="keys-table"><thead><tr><th style="width:45px;">Вар.</th><th>Ученик</th>${ths}</tr></thead><tbody></tbody></table>`;
                const tbody = page.querySelector('tbody'), maxH = page.clientHeight;
                let added = 0;

                while (idx < DATA.variants.length) {
                    const v = DATA.variants[idx], tr = document.createElement('tr');
                    tr.innerHTML = `<td>${idx + 1}</td><td>${v.student}</td>` + v.tasks.map(t => `<td><b>${t.answer || '—'}</b></td>`).join('');
                    tbody.appendChild(tr);
                    if (page.scrollHeight > maxH && added > 0) { tbody.removeChild(tr); break; }
                    added++; idx++;
                }
                if (!DATA.variants.length) break;
                part++;
            }

            checkOverflows();
            applyZoom();
        };

        ['fontFamilySelect', 'fontSizeSelect', 'marginsSelect', 'twoColumnsCheckbox', 'duplexCheckbox'].forEach(id => $(id).addEventListener('change', rebuildPages));
        $('zoomSelect').addEventListener('change', applyZoom);
        $('printBtn').addEventListener('click', () => window.print());
        $('viewportArea').addEventListener('input', checkOverflows);

        // Клик по кружочку номера задания — перегенерация только этого задания
        $('viewportArea').addEventListener('click', async (e) => {
            const circle = e.target.closest('.task-circle');
            if (!circle || circle.classList.contains('is-loading')) return;
            e.preventDefault();
            e.stopPropagation();

            const vIdx = Number(circle.dataset.v), tIdx = Number(circle.dataset.t);
            const curTask = DATA?.variants?.[vIdx]?.tasks?.[tIdx];
            if (!curTask?._key) return;

            circle.classList.add('is-loading');
            try {
                const code = await getTaskCodeByKey(curTask._key);
                const nextTask = JSON.parse(await runPythonCode(code, '--generate'));
                nextTask._key = curTask._key;
                DATA.variants[vIdx].tasks[tIdx] = nextTask;
                localStorage.setItem('msh_vpr_editor_data', JSON.stringify(DATA));
                rebuildPages();
            } catch (err) {
                alert('Ошибка перегенерации: ' + err.message);
                circle.classList.remove('is-loading');
            }
        });

        window.addEventListener('resize', () => { if ($('zoomSelect').value === 'fit') applyZoom(); });

        const raw = localStorage.getItem('msh_vpr_editor_data');
        if (raw) {
            DATA = JSON.parse(raw);
            document.title = `${DATA.className}_Варианты ВПР`;
            rebuildPages();
        }
        return;
    }

    // =========================================================================
    // РЕЖИМ 2: ВКЛАДКА НАСТРОЙКИ И ГЕНЕРАЦИИ ВАРИАНТОВ (vpr.html)
    // =========================================================================
    async function initCatalog() {
        try {
            const root = await getPackageRoot();
            subjectsRootEntry = await getSubDir(root, BASE_SUBJECTS_PATH);
            const subjects = (await readAllEntries(subjectsRootEntry))
                .filter(e => e.isDirectory && !e.name.startsWith('.'))
                .map(e => e.name)
                .sort((a, b) => a === 'Информатика' ? -1 : b === 'Информатика' ? 1 : a.localeCompare(b, 'ru', { numeric: true }));

            if (!subjects.length) {
                $('tasksContainer').innerHTML = `<em>В папке "${BASE_SUBJECTS_PATH}" нет предметов.</em>`;
                return;
            }
            $('subjectSelector').innerHTML = subjects.map(s => `<option value="${s}">${s}</option>`).join('');
            await onSubjectChange();
        } catch (err) {
            $('tasksContainer').innerHTML = `<div style="color:#dc2626;padding:8px;">Не удалось прочитать <b>${BASE_SUBJECTS_PATH}</b>:<br><small>${err.message}</small></div>`;
        }
    }

    async function onSubjectChange() {
        const subject = $('subjectSelector').value;
        if (!subject || !subjectsRootEntry) return;
        try {
            const classes = (await readAllEntries(await getSubDir(subjectsRootEntry, subject)))
                .filter(e => e.isDirectory && !e.name.startsWith('.'))
                .map(e => e.name)
                .sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
            $('classSelector').innerHTML = classes.map(c => `<option value="${c}">${c}</option>`).join('');
            await onClassChange();
        } catch {
            $('classSelector').innerHTML = '';
            $('tasksContainer').innerHTML = `<em>В предмете "${subject}" нет папок классов.</em>`;
        }
    }

    async function onClassChange() {
        const subject = $('subjectSelector').value, folder = $('classSelector').value;
        if (!subject || !folder || !subjectsRootEntry) return;

        const numMatch = folder.match(/^(\d+)/), clsInput = $('className');
        if (numMatch && /^\d+(-|$)/.test(clsInput.value)) {
            clsInput.value = `${numMatch[1]}-${clsInput.value.split('-')[1] || '1'}`;
        }

        $('tasksContainer').innerHTML = '<div style="color:#64748b;padding:10px;">⏳ Загрузка заданий (.py)...</div>';
        try {
            const pyFiles = (await readAllEntries(await getSubDir(subjectsRootEntry, `${subject}/${folder}`)))
                .filter(e => e.isFile && e.name.startsWith('task_') && e.name.endsWith('.py'));
            if (!pyFiles.length) {
                $('tasksContainer').innerHTML = '<em>В выбранной папке нет файлов task_*.py</em>';
                return;
            }

            const tasks = [];
            for (const entry of pyFiles) {
                const key = `${subject}/${folder}/${entry.name}`;
                if (!pyCodeCache.has(key)) pyCodeCache.set(key, await readFileText(entry));
                if (!metaCache.has(key)) {
                    try {
                        const parsed = JSON.parse(await runPythonCode(pyCodeCache.get(key), '--meta'));
                        metaCache.set(key, { key, id: parsed.id ?? 999, title: parsed.title || entry.name });
                    } catch (e) { console.warn(`[VPR] Ошибка META в ${entry.name}:`, e); }
                }
                if (metaCache.has(key)) tasks.push(metaCache.get(key));
            }

            tasks.sort((a, b) => a.id - b.id);
            $('tasksContainer').innerHTML = tasks.map(t => `
                <label class="vpr-task-item">
                    <input type="checkbox" class="task-cb" value="${t.key}" checked>
                    <span class="vpr-task-title-text"><b>${t.id}.</b> ${t.title}</span>
                    <div class="vpr-qty-box">
                        <button type="button" class="vpr-qty-btn" data-dir="-1">−</button>
                        <input type="number" class="vpr-qty-input" value="1" min="1" max="50">
                        <button type="button" class="vpr-qty-btn" data-dir="1">+</button>
                    </div>
                </label>`).join('');
        } catch (err) {
            $('tasksContainer').innerHTML = `<div style="color:#dc2626;">Ошибка: ${err.message}</div>`;
        }
    }

    const updateCount = () => {
        $('countBadge').innerText = `${$('studentsList').value.split('\n').filter(s => s.trim()).length} уч.`;
    };

    async function generate() {
        const className = $('className').value.trim() || 'Класс';
        const students = $('studentsList').value.split('\n').map(s => s.trim()).filter(Boolean);
        const keys = [];
        document.querySelectorAll('.vpr-task-item').forEach(row => {
            const cb = row.querySelector('.task-cb');
            const qty = Math.max(1, Math.min(50, parseInt(row.querySelector('.vpr-qty-input')?.value, 10) || 1));
            if (cb?.checked) {
                for (let i = 0; i < qty; i++) keys.push(cb.value);
            }
        });
        if (!students.length || !keys.length) return alert('Укажите учеников и выберите хотя бы одно задание!');

        const btn = $('genBtn');
        btn.disabled = true;
        btn.textContent = '⏳ Генерация вариантов...';

        try {
            const variants = [];
            for (let s = 0; s < students.length; s++) {
                const tasks = [];
                for (const key of keys) {
                    let generated = null;
                    for (let attempt = 0; attempt < 3; attempt++) {
                        try {
                            const taskObj = JSON.parse(await runPythonCode(pyCodeCache.get(key), '--generate'));
                            if (taskObj && taskObj.task) {
                                taskObj._key = key;
                                generated = taskObj;
                                break;
                            }
                        } catch {}
                    }
                    tasks.push(generated || { task: 'Ошибка генерации задания', answer: '—', _key: key });
                }
                variants.push({ variantNum: s + 1, student: students[s], tasks });
            }
            localStorage.setItem('msh_vpr_editor_data', JSON.stringify({ className, variants }));
            window.open(chrome.runtime.getURL('scripts/VPRGenerator/vpr.html?mode=editor'), '_blank');
        } catch (err) {
            alert('Ошибка генерации: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = '✨ Сгенерировать варианты';
        }
    }

    $('subjectSelector').addEventListener('change', onSubjectChange);
    $('classSelector').addEventListener('change', onClassChange);
    $('studentsList').addEventListener('input', updateCount);
    $('pasteBtn').addEventListener('click', async () => {
        try {
            const t = await navigator.clipboard.readText();
            if (t) { const el = $('studentsList'); el.value = el.value.trim() ? `${el.value.trim()}\n${t.trim()}` : t.trim(); updateCount(); }
        } catch { alert('Используйте Ctrl+V'); }
    });
    $('clearBtn').addEventListener('click', () => { $('studentsList').value = ''; updateCount(); });
    $('selectAllBtn').addEventListener('click', () => document.querySelectorAll('.task-cb').forEach(c => { c.checked = true; }));
    $('deselectAllBtn').addEventListener('click', () => document.querySelectorAll('.task-cb').forEach(c => { c.checked = false; }));
    $('tasksContainer').addEventListener('click', (e) => {
        if (e.target.closest('.vpr-qty-box')) e.preventDefault();
        const btn = e.target.closest('.vpr-qty-btn');
        if (btn) {
            const inp = btn.parentElement.querySelector('.vpr-qty-input');
            inp.value = Math.max(1, Math.min(50, (parseInt(inp.value, 10) || 1) + Number(btn.dataset.dir)));
        }
    });
    $('bulkQtySelect')?.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        if (val > 0) {
            document.querySelectorAll('.vpr-task-item').forEach(row => {
                if (row.querySelector('.task-cb')?.checked) row.querySelector('.vpr-qty-input').value = val;
            });
        }
        e.target.value = '';
    });
    $('genBtn').addEventListener('click', generate);

    updateCount();
    initCatalog();
})();