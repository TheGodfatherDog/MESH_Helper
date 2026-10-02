// scripts/autoGrading.js

window.initAutoGrading = function () {
    const LOG = '[МЭШ][autoGrading]';
    const BUTTON_ID = 'mshhlpr-auto-grading-btn';
    const MODAL_ID = 'mshhlpr-auto-grading-modal';
    const HELP_TOOLTIP_ID = 'mshhlpr-auto-grading-tooltip';
    const SETTINGS_KEY = 'meshAutoGradingSettings';
    const NO_PORTAL_KEY = 'meshAutoGradingNoPortal';
    const NO_PORTAL_TIP = 'У ученика нет доступа к порталу, поэтому отметка за ЦДЗ не выставляется. Если доступ появился, нажмите «Есть доступ» — отметка будет рассчитана по обычным правилам.';
    const REQUEST_TIMEOUT_MS = 20000;
    const CORE_API = 'https://authedu.mosreg.ru/api/ej/core/teacher/v1';
    const PLAN_API = 'https://authedu.mosreg.ru/api/ej/plan/teacher/v1';
    const LRS_V2_API = 'https://authedu.mosreg.ru/api/lrs/v2';
    const core = window.MESH_AUTO_GRADING_CORE;

    if (!core) {
        console.error(`${LOG} Не загружен модуль расчётов.`);
        return;
    }

    const defaults = Object.freeze({
        scope: 'current',
        thresholdUnit: 'percent',
        grade3: 50,
        grade4: 70,
        grade5: 85,
        absentMode: 'skip',
        penalizeAttempts: false,
        missingMode: '2',
        existingMode: 'skip',
        lateMode: 'calculated',
        deadlineMode: 'default',
        deadlineDayOffset: 1,
        deadlineTime: '00:00'
    });

    let activeModalState = null;
    let noPortalList = [];
    let lastPathname = '';
    let routeCheckScheduled = false;

    const escapeHtml = value => String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');

    const helpButton = (text, label = 'Показать подсказку') => `
        <button class="mshhlpr-ag-help" type="button" aria-label="${escapeHtml(label)}"
            data-msh-ag-tip="${escapeHtml(text)}">?</button>`;

    const asArray = value => {
        if (Array.isArray(value)) return value;
        if (!value || typeof value !== 'object') return [];
        for (const key of ['data', 'items', 'content', 'student_profiles', 'student_homeworks', 'homeworks']) {
            if (Array.isArray(value[key])) return value[key];
        }
        return [];
    };

    function isDigitalEntry(entry) {
        return Boolean(entry && !entry.deleted_at && entry.is_digital_homework === true);
    }

    function digitalEntries(homework) {
        return (homework?.homework_entries || []).filter(isDigitalEntry);
    }

    function getHomeworkIdFromPath() {
        return location.pathname.match(/^\/teacher\/study-process\/home-tasks\/(\d+)/)?.[1] || '';
    }

    function buildQuery(params) {
        const query = new URLSearchParams();
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') return;
            query.set(key, Array.isArray(value) ? value.join(',') : String(value));
        });
        const result = query.toString();
        return result ? `?${result}` : '';
    }

    async function getAuth() {
        const session = await chrome.storage.session.get([
            'currentBearerToken',
            'currentProfileId',
            'currentAid'
        ]);
        if (!session.currentBearerToken) {
            throw new Error('Токен MESH ещё не получен. Обновите страницу портала и повторите попытку.');
        }
        return {
            token: session.currentBearerToken,
            profileId: session.currentProfileId || '',
            aid: String(session.currentAid || '')
        };
    }

    async function getHeaders(subsystem = 'teacherweb') {
        const auth = await getAuth();
        const headers = {
            accept: 'application/json',
            authorization: `Bearer ${auth.token}`,
            'content-type': 'application/json',
            'profile-id': auth.profileId,
            'x-mes-hostid': '9',
            'x-mes-roleid': '9',
            'x-mes-subsystem': subsystem
        };
        if (auth.aid) headers.aid = auth.aid;
        return headers;
    }

    async function requestJson(url, options = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            const text = response.status === 204 ? '' : await response.text();
            let data = null;
            if (text) {
                try { data = JSON.parse(text); } catch { data = text; }
            }
            if (!response.ok) {
                const message = data?.message || data?.error || `HTTP ${response.status}`;
                const error = new Error(String(message));
                error.status = response.status;
                error.data = data;
                throw error;
            }
            return { data, headers: response.headers, status: response.status };
        } catch (error) {
            if (error?.name === 'AbortError') throw new Error('MESH не ответил за 20 секунд.');
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    async function coreGet(path, params = {}) {
        return requestJson(`${CORE_API}${path}${buildQuery(params)}`, {
            headers: await getHeaders('teacherweb')
        });
    }

    async function planGet(path, params = {}) {
        return requestJson(`${PLAN_API}${path}${buildQuery(params)}`, {
            headers: await getHeaders('teacherweb')
        });
    }

    async function lrsRequest(body, page = 0) {
        return requestJson(`${LRS_V2_API}/bulk/results?page=${page}&size=50`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: await getHeaders('teacherweb'),
            body: JSON.stringify(body)
        });
    }

    async function fetchLrsResults(entries) {
        const requestBody = {
            results: entries.map(entry => ({ work_id: String(entry.id), work_type: 1 }))
        };
        if (!requestBody.results.length) return [];

        let page = 0;
        let pages = 1;
        const results = [];
        do {
            const response = await lrsRequest(requestBody, page);
            const payload = response.data || {};
            results.push(...asArray(payload));
            pages = Number(payload.totalPages ?? payload.total_pages ?? 1) || 1;
            page += 1;
        } while (page < pages);
        return results;
    }

    async function fetchAllCore(path, params, perPage = 300) {
        let page = 1;
        let pages = 1;
        const items = [];
        do {
            const response = await coreGet(path, { ...params, page, per_page: perPage });
            items.push(...asArray(response.data));
            pages = Number(
                response.headers.get('x-pagination-total-pages') ||
                response.headers.get('X-Pagination-Total-Pages') ||
                response.data?.totalPages ||
                response.data?.total_pages ||
                1
            ) || 1;
            page += 1;
        } while (page <= pages);
        return items;
    }

    async function mapLimit(items, limit, worker) {
        const results = new Array(items.length);
        let cursor = 0;
        async function run() {
            while (cursor < items.length) {
                const index = cursor++;
                results[index] = await worker(items[index], index);
            }
        }
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
        return results;
    }

    async function readSettings() {
        const stored = await chrome.storage.local.get([SETTINGS_KEY]);
        const saved = stored[SETTINGS_KEY] || {};
        const settings = { ...defaults, ...saved };
        if (Object.keys(saved).length &&
            !Object.prototype.hasOwnProperty.call(saved, 'deadlineMode') &&
            (Number(saved.deadlineDayOffset) !== 1 || saved.deadlineTime !== '00:00')) {
            settings.deadlineMode = 'custom';
        }
        if (!Object.prototype.hasOwnProperty.call(saved, 'absentMode')) {
            settings.absentMode = saved.skipAbsent === false ? 'completed' : 'skip';
        }
        settings.scope = 'current';
        return settings;
    }

    async function saveSettings(settings) {
        await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    }

    async function readNoPortalList() {
        const stored = await chrome.storage.local.get([NO_PORTAL_KEY]);
        noPortalList = core.normalizeNoPortalList(stored[NO_PORTAL_KEY]);
        return noPortalList;
    }

    async function saveNoPortalList(list) {
        noPortalList = core.normalizeNoPortalList(list);
        await chrome.storage.local.set({ [NO_PORTAL_KEY]: noPortalList });
        return noPortalList;
    }

    function studentNameFromProfile(profile) {
        return {
            lastName: profile.last_name || profile.user?.last_name || '',
            firstName: profile.first_name || profile.user?.first_name || '',
            fullName: getProfileName(profile)
        };
    }

    function applyRowDecision(row, settings) {
        const existingMark = row.existingMark;
        const ignoreDeadlineForAbsent = row.absent && settings.absentMode === 'completed' && row.isCompleted;
        let proposedGrade = row.isCompleted
            ? core.getLateGrade(row.calculation.finalGrade, row.isLate && !ignoreDeadlineForAbsent, settings)
            : (settings.missingMode === '2' ? 2 : null);
        let action = existingMark ? 'update' : 'create';
        let reason = '';

        if (row.noPortalAccess) {
            proposedGrade = null;
            action = 'skip';
            reason = 'Нет доступа к порталу';
        } else if (row.absent && settings.absentMode === 'skip') {
            proposedGrade = null;
            action = 'skip';
            reason = 'Отсутствовал на целевом уроке';
        } else if (row.absent && !row.isCompleted) {
            proposedGrade = null;
            action = 'skip';
            reason = 'Не выполнено при отсутствии';
        } else if (existingMark && settings.existingMode === 'skip') {
            proposedGrade = null;
            action = 'skip';
            reason = `Уже стоит ${existingMark.name}`;
        } else if (!row.hasDeadline && !row.isCompleted) {
            proposedGrade = null;
            action = 'skip';
            reason = 'Нет дедлайна';
        } else if (row.hasDeadline && row.deadlinePassed === false && !row.isCompleted) {
            proposedGrade = null;
            action = 'skip';
            reason = 'Срок сдачи ещё не наступил';
        } else if (!row.isCompleted && settings.missingMode === 'skip') {
            proposedGrade = null;
            action = 'skip';
            reason = 'ЦДЗ не выполнено';
        } else if (row.isLate && settings.lateMode === 'skip') {
            proposedGrade = null;
            action = 'skip';
            reason = 'Выполнено после дедлайна';
        } else if (existingMark && Number(existingMark.name) === Number(proposedGrade)) {
            action = 'skip';
            reason = 'Отметка уже совпадает';
        }

        row.proposedGrade = proposedGrade;
        row.action = action;
        row.reason = reason;
    }

    function refreshPreviewAccess(modal) {
        if (!activeModalState?.rows) return;
        activeModalState.rows.forEach(row => {
            row.noPortalKey = core.studentHasNoPortalAccess(row.studentName, noPortalList);
            row.noPortalAccess = Boolean(row.noPortalKey);
            applyRowDecision(row, activeModalState.settings);
        });
        renderPreview(modal, activeModalState);
    }

    async function getCurrentHomework() {
        const homeworkId = getHomeworkIdFromPath();
        if (!homeworkId) throw new Error('Откройте страницу конкретного домашнего задания.');
        return (await coreGet(`/homeworks/${homeworkId}`)).data;
    }

    async function getGroup(groupId) {
        const response = await planGet(`/groups/${groupId}`);
        return response.data;
    }

    function selectHomeworks(homeworks) {
        return homeworks.filter(homework => !homework.deleted_at && digitalEntries(homework).length);
    }

    async function collectHomeworks(currentHomework) {
        return [currentHomework];
    }

    async function getScheduleItem(homework, aid) {
        const isoDate = core.formatIsoDate(homework.date_prepared_for);
        const response = await planGet('/schedule_items', {
            academic_year_id: aid,
            group_id: homework.group_id,
            from: isoDate,
            to: isoDate,
            with_course_calendar_info: true,
            with_group_class_subject_info: true,
            with_lesson_info: true,
            with_period: true,
            with_rooms_info: true,
            per_page: 100
        });
        return asArray(response.data).find(item =>
            item.homeworks_to_verify?.some(link => Number(link.id) === Number(homework.id))
        ) || null;
    }

    async function getProfiles(studentIds, aid) {
        if (!studentIds.length) return [];
        return fetchAllCore('/student_profiles', {
            ids: studentIds,
            academic_year_id: aid,
            with_archived_groups: true
        }, 100);
    }

    async function getControlForm(homework, group, profiles, aid) {
        let educationLevelId = group.education_level_id || profiles.find(profile => profile.education_level_id)?.education_level_id;
        if (!educationLevelId && group.class_level_id) {
            const classLevels = asArray((await coreGet('/class_levels')).data);
            educationLevelId = classLevels.find(level => Number(level.id) === Number(group.class_level_id))?.education_level_id;
        }
        const schoolId = profiles.find(profile => profile.school_id)?.school_id || group.school_id;
        if (!educationLevelId || !schoolId) return null;

        const response = await coreGet('/control_forms', {
            type: 'digital_training',
            education_level_id: educationLevelId,
            with_grade_system: true,
            with_deleted: false,
            academic_year_id: aid,
            school_id: schoolId,
            subject_id: homework.subject_id
        });
        return asArray(response.data)[0] || null;
    }

    function isAbsentOnLesson(attendances, studentId, scheduleLessonId) {
        return attendances.some(item =>
            Number(item.student_profile_id) === Number(studentId) &&
            Number(item.schedule_lesson_id) === Number(scheduleLessonId) &&
            Boolean(item.absence_reason_id || item.nonattendance_reason_id || item.id)
        );
    }

    function getProfileName(profile) {
        return profile.full_name || profile.user_name || profile.short_name || [
            profile.last_name || profile.user?.last_name,
            profile.first_name || profile.user?.first_name,
            profile.middle_name || profile.user?.middle_name
        ].filter(Boolean).join(' ') || `Ученик ${profile.id}`;
    }

    function findStudentMark(marks, studentId) {
        return marks.find(mark => Number(mark.student_profile_id) === Number(studentId)) || null;
    }

    function attemptsForStudent(lrsResults, profile, assignedEntryIds) {
        const personId = String(profile.person_id || '');
        const entryIds = new Set(assignedEntryIds.map(Number));
        return lrsResults.filter(result => {
            const context = result.context || {};
            return String(context.person_id || '') === personId && entryIds.has(Number(context.work_id));
        });
    }

    async function buildHomeworkPreview(homework, settings) {
        const auth = await getAuth();
        const entries = digitalEntries(homework);
        if (!entries.length) return { rows: [], warning: 'В ЦДЗ нет автопроверяемых заданий.' };

        const studentIds = [...new Set(entries.flatMap(entry => entry.student_ids || []).map(Number).filter(Boolean))];
        const [group, profiles, studentHomeworks, lrsResults, scheduleItem] = await Promise.all([
            getGroup(homework.group_id),
            getProfiles(studentIds, auth.aid),
            fetchAllCore('/student_homeworks', { homework_entry_ids: entries.map(entry => entry.id) }, 100),
            fetchLrsResults(entries),
            getScheduleItem(homework, auth.aid)
        ]);

        if (!scheduleItem) {
            return { rows: [], warning: 'Не найден целевой урок для домашнего задания.' };
        }

        const controlForm = await getControlForm(homework, group, profiles, auth.aid);
        if (!controlForm) {
            return { rows: [], warning: 'Не найдена форма контроля «Цифровое задание».' };
        }

        const date = core.formatPortalDate(homework.date_prepared_for);
        const [marks, attendances] = await Promise.all([
            fetchAllCore('/marks', {
                control_form_id: controlForm.id,
                schedule_lesson_id: scheduleItem.id,
                with_non_numeric_entries: true
            }, 300),
            fetchAllCore('/attendances', {
                academic_year_id: auth.aid,
                subject_id: homework.subject_id,
                student_profile_ids: studentIds,
                start_at: date,
                stop_at: date
            }, 300)
        ]);

        const studentHomeworkByStudent = new Map();
        studentHomeworks.forEach(item => {
            const studentId = Number(item.student_id || item.student_profile_id);
            if (!studentHomeworkByStudent.has(studentId)) studentHomeworkByStudent.set(studentId, []);
            studentHomeworkByStudent.get(studentId).push(item);
        });

        const deadline = core.getEffectiveDeadline(homework.date_prepared_for, settings);
        const deadlinePassed = !deadline || Date.now() >= deadline.getTime();
        const rows = profiles.map(profile => {
            const assignedEntryIds = entries
                .filter(entry => entry.student_ids?.map(Number).includes(Number(profile.id)))
                .map(entry => Number(entry.id));
            const attempts = attemptsForStudent(lrsResults, profile, assignedEntryIds);
            const summary = core.summarizeAttempts(attempts);
            const calculation = core.calculateGrade(summary, settings);
            const existingMark = findStudentMark(marks, profile.id);
            const absent = isAbsentOnLesson(attendances, profile.id, scheduleItem.id);
            const isCompleted = summary.testsCount > 0 && summary.maxScore > 0;
            const isLate = Boolean(isCompleted && summary.firstCompletedAt && deadline && summary.firstCompletedAt > deadline);
            const studentName = studentNameFromProfile(profile);
            const noPortalKey = core.studentHasNoPortalAccess(studentName, noPortalList);
            const row = {
                key: `${homework.id}:${profile.id}`,
                homework,
                profile,
                studentName,
                group,
                scheduleItem,
                controlForm,
                existingMark,
                studentHomeworks: studentHomeworkByStudent.get(Number(profile.id)) || [],
                absent,
                isCompleted,
                isLate,
                hasDeadline: Boolean(deadline),
                deadlinePassed,
                noPortalKey,
                noPortalAccess: Boolean(noPortalKey),
                summary,
                calculation
            };
            applyRowDecision(row, settings);
            return row;
        });

        return { rows, warning: '' };
    }

    function readForm(modal) {
        const value = id => modal.querySelector(`#${id}`)?.value;
        const checked = id => Boolean(modal.querySelector(`#${id}`)?.checked);
        const deadlineModeValue = value('msh-ag-deadline-mode');
        const isCustomDeadline = /^\d+$/.test(deadlineModeValue || '');
        return {
            scope: 'current',
            thresholdUnit: value('msh-ag-unit'),
            grade3: Number(value('msh-ag-grade3')),
            grade4: Number(value('msh-ag-grade4')),
            grade5: Number(value('msh-ag-grade5')),
            absentMode: value('msh-ag-absent-mode'),
            penalizeAttempts: checked('msh-ag-penalty'),
            missingMode: value('msh-ag-missing'),
            existingMode: value('msh-ag-existing'),
            lateMode: value('msh-ag-late'),
            deadlineMode: isCustomDeadline ? 'custom' : deadlineModeValue,
            deadlineDayOffset: isCustomDeadline ? Number(deadlineModeValue) : 1,
            deadlineTime: value('msh-ag-deadline-time')
        };
    }

    function getStatusBadge(row) {
        if (row.noPortalAccess) return '<span class="mshhlpr-ag-badge mshhlpr-ag-badge-portal">Нет доступа</span>';
        if (row.absent) return '<span class="mshhlpr-ag-badge mshhlpr-ag-badge-muted">Отсутствовал</span>';
        if (!row.isCompleted) return '<span class="mshhlpr-ag-badge mshhlpr-ag-badge-danger">Не выполнено</span>';
        if (row.isLate) return '<span class="mshhlpr-ag-badge mshhlpr-ag-badge-warning">Просрочено</span>';
        return '<span class="mshhlpr-ag-badge mshhlpr-ag-badge-success">Выполнено</span>';
    }

    function renderPreview(modal, state) {
        const body = modal.querySelector('#msh-ag-preview-body');
        const summary = modal.querySelector('#msh-ag-summary');
        const applyButton = modal.querySelector('#msh-ag-apply');
        const actionable = state.rows.filter(row => row.action === 'create' || row.action === 'update');
        const homeworksCount = new Set(state.rows.map(row => row.homework.id)).size;
        const noPortalCount = state.rows.filter(row => row.noPortalAccess).length;

        summary.innerHTML = `
            <span><b>${homeworksCount}</b> ЦДЗ</span>
            <span><b>${state.rows.length}</b> учеников</span>
            <span><b>${actionable.length}</b> изменений</span>
            <span><b>${state.rows.filter(row => row.action === 'skip').length}</b> пропусков</span>
            ${noPortalCount ? `<span><b>${noPortalCount}</b> без доступа</span>` : ''}
            <button id="msh-ag-chart-toggle" class="mshhlpr-ag-chart-toggle" type="button" aria-expanded="${Boolean(state.chartOpen)}" ${actionable.length ? '' : 'disabled'}>${state.chartOpen ? 'Скрыть диаграмму' : 'Показать диаграмму'}</button>
        `;
        updateModalHeading(modal, state);
        renderGradeChart(modal, state);

        if (!state.rows.length) {
            body.innerHTML = `<tr><td colspan="8" class="mshhlpr-ag-empty">${escapeHtml(state.warning || 'Нет подходящих ЦДЗ.')}</td></tr>`;
            applyButton.disabled = true;
            return;
        }

        body.innerHTML = state.rows.map(row => {
            const percentage = row.summary.maxScore > 0
                ? `${Math.round(row.summary.score / row.summary.maxScore * 100)}%`
                : '—';
            const grade = row.proposedGrade ?? '—';
            const existingGrade = row.existingMark ? escapeHtml(row.existingMark.name) : '—';
            const gradeCell = row.noPortalAccess
                ? `<span class="mshhlpr-ag-grade">${existingGrade} → <b>—</b> ${helpButton(NO_PORTAL_TIP, 'Почему отметка не выставляется')}</span>`
                : `<span class="mshhlpr-ag-grade">${existingGrade} → <b>${grade}</b></span>`;
            const actionText = row.action === 'update' ? 'Перевыставить' : row.action === 'create' ? 'Выставить' : row.reason;
            const actionCell = row.noPortalAccess
                ? `Не выставлять <button type="button" class="mshhlpr-ag-restore" data-msh-ag-restore="${escapeHtml(row.noPortalKey)}">Есть доступ</button>`
                : escapeHtml(actionText);
            return `
                <tr class="${getGradeRowClass(row)}">
                    <td>${escapeHtml(getProfileName(row.profile))}</td>
                    <td>${escapeHtml(row.group.name || row.group.short_name || row.homework.group_id)}</td>
                    <td>${escapeHtml(core.formatPortalDate(row.homework.date_prepared_for))}</td>
                    <td>${getStatusBadge(row)}</td>
                    <td>${row.summary.score}/${row.summary.maxScore || '—'} <small>${percentage}</small></td>
                    <td>${row.summary.attemptsCount}${row.summary.extraAttempts ? ` <small>(+${row.summary.extraAttempts})</small>` : ''}</td>
                    <td>${gradeCell}</td>
                    <td class="mshhlpr-ag-action-${row.action}">${actionCell}</td>
                </tr>`;
        }).join('');
        applyButton.disabled = actionable.length === 0;
    }

    function getGradeRowClass(row) {
        const grade = Number(row.proposedGrade);
        return [2, 3, 4, 5].includes(grade) ? `mshhlpr-ag-grade-row-${grade}` : '';
    }

    function updateModalHeading(modal, state) {
        const heading = modal.querySelector('#msh-ag-title');
        const homework = state.rows[0]?.homework || state.homework;
        const group = state.rows[0]?.group;
        const groupName = group?.name || group?.short_name;
        const date = homework?.date_prepared_for ? core.formatPortalDate(homework.date_prepared_for) : '';
        heading.textContent = [
            'Автоматическое выставление отметок за ЦДЗ',
            groupName,
            date ? `к уроку ${date}` : ''
        ].filter(Boolean).join(' · ');
    }

    function renderGradeChart(modal, state) {
        const container = modal.querySelector('#msh-ag-grade-chart');
        if (!container) return;
        const grades = [2, 3, 4, 5];
        const counts = grades.map(grade => state.rows.filter(row =>
            (row.action === 'create' || row.action === 'update') && Number(row.proposedGrade) === grade
        ).length);
        const total = counts.reduce((sum, count) => sum + count, 0);
        const colors = { 2: '#e46a6a', 3: '#e7ad4b', 4: '#6d9cd9', 5: '#64ad78' };
        const stops = [];
        let current = 0;
        grades.forEach((grade, index) => {
            const next = current + (total ? counts[index] / total * 100 : 0);
            if (counts[index]) stops.push(`${colors[grade]} ${current}% ${next}%`);
            current = next;
        });
        if (!total) {
            container.hidden = true;
            return;
        }
        const isOpen = Boolean(state.chartOpen);
        container.hidden = !isOpen;
        if (!isOpen) return;
        container.innerHTML = `
            <div class="mshhlpr-ag-chart" role="img" aria-label="Распределение отметок">
                <div class="mshhlpr-ag-chart-pie" style="background: conic-gradient(${stops.join(', ')});"></div>
                <div class="mshhlpr-ag-chart-legend">${grades.map((grade, index) => `
                    <span class="mshhlpr-ag-chart-item"><i style="background:${colors[grade]}"></i>${grade}: <b>${counts[index]}</b></span>`).join('')}
                </div>
            </div>`;
    }

    function setLoading(modal, loading, text = 'Загрузка данных…') {
        const loadButton = modal.querySelector('#msh-ag-load');
        const applyButton = modal.querySelector('#msh-ag-apply');
        const status = modal.querySelector('#msh-ag-status');
        loadButton.disabled = loading;
        applyButton.disabled = true;
        loadButton.textContent = loading ? 'Загрузка…' : 'Рассчитать';
        status.textContent = loading ? text : '';
        status.className = loading ? 'mshhlpr-ag-status is-loading' : 'mshhlpr-ag-status';
    }

    function showError(modal, error) {
        const status = modal.querySelector('#msh-ag-status');
        status.textContent = error?.message || String(error);
        status.className = 'mshhlpr-ag-status is-error';
    }

    function renderNoPortalList(modal, list = noPortalList) {
        const container = modal.querySelector('#msh-ag-no-portal-list');
        if (!container) return;
        if (!list.length) {
            container.innerHTML = '<p class="mshhlpr-ag-no-portal-empty">Пока никого. Впишите фамилию и имя через запятую.</p>';
            return;
        }
        container.innerHTML = `<ul class="mshhlpr-ag-no-portal-list">${list.map(item => `
            <li class="mshhlpr-ag-no-portal-item">
                <span>${escapeHtml(item.label)}</span>
                <button type="button" class="mshhlpr-ag-restore" data-msh-ag-restore="${escapeHtml(item.key)}">Есть доступ</button>
            </li>`).join('')}</ul>`;
    }

    function setNoPortalStatus(modal, text, kind = '') {
        const status = modal.querySelector('#msh-ag-no-portal-status');
        if (!status) return;
        status.textContent = text;
        status.className = `mshhlpr-ag-inline-status${kind ? ` is-${kind}` : ''}`;
    }

    async function commitNoPortalInput(modal, { silentIfEmpty = false } = {}) {
        const textarea = modal.querySelector('#msh-ag-no-portal-input');
        const text = textarea?.value || '';
        if (!text.trim()) {
            if (!silentIfEmpty) setNoPortalStatus(modal, 'Введите фамилии и имена через запятую.', 'warning');
            return noPortalList;
        }

        const parsed = core.parseNoPortalInput(text);
        let merged = { list: noPortalList, added: 0 };
        if (parsed.entries.length) {
            merged = core.mergeNoPortalEntries(noPortalList, parsed.entries);
            await saveNoPortalList(merged.list);
            renderNoPortalList(modal);
            refreshPreviewAccess(modal);
        }
        textarea.value = parsed.invalid.join(', ');

        const messages = [];
        if (parsed.entries.length) {
            messages.push(merged.added ? `Без доступа к порталу: ${merged.added}` : 'Эти ученики уже отмечены');
            if (activeModalState?.rows) {
                const keys = new Set(parsed.entries.map(item => item.key));
                const found = new Set(activeModalState.rows
                    .filter(row => keys.has(row.noPortalKey))
                    .map(row => row.noPortalKey)).size;
                messages.push(`В текущей таблице найдено: ${found}`);
            }
        }
        if (parsed.invalid.length) messages.push(`Нужны фамилия и имя: ${parsed.invalid.join(', ')}`);
        setNoPortalStatus(
            modal,
            messages.join('. ') + (messages.length ? '.' : ''),
            parsed.invalid.length && !parsed.entries.length ? 'warning' : 'success'
        );
        return noPortalList;
    }

    async function restorePortalAccess(modal, key) {
        const current = noPortalList.find(item => item.key === key);
        if (!current) return;
        await saveNoPortalList(noPortalList.filter(item => item.key !== key));
        renderNoPortalList(modal);
        refreshPreviewAccess(modal);
        setNoPortalStatus(modal, `${current.label}: доступ к порталу есть, отметка считается как обычно.`, 'success');
    }

    async function loadPreview(modal) {
        await readNoPortalList();
        await commitNoPortalInput(modal, { silentIfEmpty: true });
        const settings = readForm(modal);
        const validationError = core.validateThresholds(settings);
        if (validationError) return showError(modal, new Error(validationError));

        setLoading(modal, true);
        try {
            await saveSettings(settings);
            const currentHomework = await getCurrentHomework();
            const homeworks = await collectHomeworks(currentHomework);
            const pastDigitalHomeworks = selectHomeworks(homeworks);
            if (!pastDigitalHomeworks.length) {
                const hasDigital = homeworks.some(homework => digitalEntries(homework).length);
                activeModalState = {
                    rows: [],
                    settings,
                    homework: currentHomework,
                    warning: hasDigital ? 'Дедлайн по ЦДЗ ещё не наступил.' : 'Нет подходящих ЦДЗ.'
                };
                setLoading(modal, false);
                renderPreview(modal, activeModalState);
                return;
            }
            const processed = await mapLimit(pastDigitalHomeworks, 3, async (homework, index) => {
                setLoading(modal, true, `Загрузка ЦДЗ ${index + 1} из ${pastDigitalHomeworks.length}…`);
                try {
                    return await buildHomeworkPreview(homework, settings);
                } catch (error) {
                    console.warn(`${LOG} Не удалось обработать ЦДЗ ${homework.id}:`, error?.message || error);
                    return { rows: [], warning: `ЦДЗ ${homework.id}: ${error?.message || error}` };
                }
            });
            const rows = processed.flatMap(item => item.rows);
            const warnings = processed.map(item => item.warning).filter(Boolean);
            activeModalState = { rows, settings, homework: currentHomework, warning: warnings.join(' ') };
            setLoading(modal, false);
            renderPreview(modal, activeModalState);
            if (warnings.length) {
                const status = modal.querySelector('#msh-ag-status');
                status.textContent = warnings.join(' ');
                status.className = 'mshhlpr-ag-status is-warning';
            }
        } catch (error) {
            setLoading(modal, false);
            showError(modal, error);
        }
    }

    function createMarkPayload(row) {
        const base = row.existingMark ? { ...row.existingMark } : {};
        delete base.created_at;
        delete base.updated_at;
        return {
            ...base,
            id: row.existingMark?.id,
            name: String(row.proposedGrade),
            comment: row.existingMark?.comment || '',
            control_form_id: row.controlForm.id,
            student_profile_id: row.profile.id,
            schedule_lesson_id: row.scheduleItem.id,
            mark_type_id: 1,
            is_point: false,
            point_date: null,
            grade_origins: [{
                grade_origin: String(row.proposedGrade),
                grade_system_id: row.controlForm.grade_system_id
            }]
        };
    }

    async function writeMark(row) {
        const payload = createMarkPayload(row);
        const headers = await getHeaders('teacherweb');
        if (row.action === 'update') {
            return requestJson(`${CORE_API}/marks/${row.existingMark.id}`, {
                method: 'PUT', headers, body: JSON.stringify(payload)
            });
        }
        return requestJson(`${CORE_API}/marks`, {
            method: 'POST', headers, body: JSON.stringify(payload)
        });
    }

    async function applyPreview(modal) {
        const rows = (activeModalState?.rows || []).filter(row => row.action === 'create' || row.action === 'update');
        if (!rows.length) return;
        const creates = rows.filter(row => row.action === 'create').length;
        const updates = rows.filter(row => row.action === 'update').length;
        const confirmed = window.confirm(
            `Будут записаны отметки: ${creates}. Перевыставлены: ${updates}.\n\nПродолжить?`
        );
        if (!confirmed) return;

        setLoading(modal, true, `Запись 0 из ${rows.length}…`);
        const successes = [];
        const failures = [];
        for (let index = 0; index < rows.length; index += 1) {
            const row = rows[index];
            setLoading(modal, true, `Запись ${index + 1} из ${rows.length}: ${getProfileName(row.profile)}`);
            try {
                await writeMark(row);
                successes.push(row);
                row.action = 'skip';
                row.reason = `Выставлено ${row.proposedGrade}`;
                row.existingMark = { name: String(row.proposedGrade) };
                row.proposedGrade = null;
            } catch (error) {
                failures.push({ row, error });
                row.action = 'skip';
                row.reason = `Ошибка: ${error?.message || error}`;
            }
        }

        setLoading(modal, false);
        renderPreview(modal, activeModalState);
        const status = modal.querySelector('#msh-ag-status');
        status.textContent = failures.length
            ? `Записано: ${successes.length}. Ошибок: ${failures.length}.`
            : `Готово: записано ${successes.length} отметок.`;
        status.className = failures.length ? 'mshhlpr-ag-status is-warning' : 'mshhlpr-ag-status is-success';
    }

    function updateThresholdLabels(modal) {
        const suffix = modal.querySelector('#msh-ag-unit').value === 'percent' ? '%' : 'баллов';
        modal.querySelectorAll('[data-threshold-suffix]').forEach(element => { element.textContent = suffix; });
    }

    function updateDeadlineControls(modal) {
        const mode = modal.querySelector('#msh-ag-deadline-mode').value;
        const timeInput = modal.querySelector('#msh-ag-deadline-time');
        const showTime = /^\d+$/.test(mode);
        timeInput.classList.toggle('is-hidden', !showTime);
        timeInput.disabled = !showTime;
        timeInput.closest('.mshhlpr-ag-deadline').classList.toggle('is-time-hidden', !showTime);
    }

    function initHelpTooltips(modal) {
        document.getElementById(HELP_TOOLTIP_ID)?.remove();
        const tooltip = document.createElement('div');
        tooltip.id = HELP_TOOLTIP_ID;
        tooltip.className = 'mshhlpr-ag-tooltip';
        tooltip.setAttribute('role', 'tooltip');
        document.body.appendChild(tooltip);

        const hide = () => {
            tooltip.classList.remove('is-visible');
            tooltip.style.display = 'none';
        };
        const show = button => {
            const text = button?.dataset.mshAgTip;
            if (!text) return;
            tooltip.textContent = text;
            tooltip.style.display = 'block';
            const buttonRect = button.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            let left = buttonRect.right + 8;
            let top = buttonRect.top + buttonRect.height / 2 - tooltipRect.height / 2;
            if (left + tooltipRect.width > window.innerWidth - 12) {
                left = buttonRect.left - tooltipRect.width - 8;
            }
            left = Math.max(12, left);
            top = Math.max(12, Math.min(top, window.innerHeight - tooltipRect.height - 12));
            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
            tooltip.classList.add('is-visible');
        };

        modal.addEventListener('mouseover', event => {
            const button = event.target.closest('.mshhlpr-ag-help');
            if (button) show(button);
        });
        modal.addEventListener('mouseout', event => {
            if (event.target.closest('.mshhlpr-ag-help')) hide();
        });
        modal.addEventListener('focusin', event => {
            const button = event.target.closest('.mshhlpr-ag-help');
            if (button) show(button);
        });
        modal.addEventListener('focusout', event => {
            if (event.target.closest('.mshhlpr-ag-help')) hide();
        });
        modal.addEventListener('scroll', hide, true);
        return () => tooltip.remove();
    }

    function showModal() {
        document.getElementById(MODAL_ID)?.remove();
        document.getElementById(HELP_TOOLTIP_ID)?.remove();
        activeModalState = null;
        const overlay = document.createElement('div');
        overlay.id = MODAL_ID;
        overlay.className = 'mshhlpr-modal-overlay mshhlpr-ag-overlay';
        overlay.innerHTML = `
            <div class="mshhlpr-modal-content mshhlpr-ag-modal">
                <div class="mshhlpr-modal-header">
                    <span id="msh-ag-title">Автоматическое выставление отметок за ЦДЗ</span>
                    <button class="mshhlpr-modal-close" type="button" aria-label="Закрыть">&times;</button>
                </div>
                <div class="mshhlpr-ag-layout">
                    <aside class="mshhlpr-ag-settings">
                        <div class="mshhlpr-section-title">Пороги отметок</div>
                        <label class="mshhlpr-form-group">
                            <span class="mshhlpr-form-label">Единица</span>
                            <select id="msh-ag-unit" class="mshhlpr-select">
                                <option value="percent">Проценты</option>
                                <option value="points">Абсолютные баллы</option>
                            </select>
                        </label>
                        <div class="mshhlpr-ag-thresholds">
                            ${[3, 4, 5].map(grade => `
                                <label class="mshhlpr-form-group">
                                    <span class="mshhlpr-form-label">На ${grade}</span>
                                    <span class="mshhlpr-ag-input-with-suffix">
                                        <input id="msh-ag-grade${grade}" class="mshhlpr-input" type="number" min="0" step="1">
                                        <small data-threshold-suffix>%</small>
                                    </span>
                                </label>`).join('')}
                        </div>

                        <div class="mshhlpr-section-title">Дедлайн</div>
                        <div class="mshhlpr-ag-deadline">
                            <select id="msh-ag-deadline-mode" class="mshhlpr-select">
                                <option value="default">По умолчанию</option>
                                <option value="0">В дату урока</option>
                                <option value="1">На следующий день</option>
                                <option value="2">Через два дня</option>
                                <option value="none">Нет дедлайна</option>
                            </select>
                            <input id="msh-ag-deadline-time" class="mshhlpr-input" type="time">
                        </div>
                        <div class="mshhlpr-ag-deadline-note">
                            <span>Правило определения просрочки</span>
                            ${helpButton('По умолчанию: день урока включительно. ЦДЗ начинает считаться просроченным после окончания этого дня. При варианте «Нет дедлайна» выполненные работы не помечаются просроченными, а за невыполненные не выставляется 2.', 'Как работает дедлайн')}
                        </div>

                        <div class="mshhlpr-section-title">Правила</div>
                        <label class="mshhlpr-form-group">
                            <span class="mshhlpr-form-label">Для отсутствующих на целевом уроке</span>
                            <select id="msh-ag-absent-mode" class="mshhlpr-select">
                                <option value="skip">Не выставлять оценки</option>
                                <option value="completed">Выставить только за выполненное</option>
                            </select>
                            <span class="mshhlpr-ag-label-help">${helpButton('Проверяется отсутствие именно на уроке, к которому привязано ЦДЗ: учитываются дата «Задано на урок» и идентификатор этого урока. Вариант «Не выставлять оценки» исключает ученика из расчёта. При варианте «Выставить только за выполненное» отметка ставится только за выполненное ЦДЗ по общим порогам; дедлайн и правило для просроченных работ не учитываются.', 'Как учитывается отсутствие')}</span>
                        </label>
                        <div class="mshhlpr-ag-rule-row">
                            <label class="mshhlpr-ag-check"><input id="msh-ag-penalty" type="checkbox"> Понижать за дополнительные попытки</label>
                            ${helpButton('За дополнительные попытки оценка снижается пропорционально количеству тестов. Если результат прошёл порог на положительную отметку, итоговая оценка не может быть ниже 3.', 'Как рассчитывается штраф за попытки')}
                        </div>
                        <label class="mshhlpr-form-group">
                            <span class="mshhlpr-form-label">Невыполненное ЦДЗ</span>
                            <select id="msh-ag-missing" class="mshhlpr-select">
                                <option value="2">Поставить 2</option>
                                <option value="skip">Не ставить отметку</option>
                            </select>
                        </label>
                        <label class="mshhlpr-form-group">
                            <span class="mshhlpr-form-label">Уже есть отметка</span>
                            <select id="msh-ag-existing" class="mshhlpr-select">
                                <option value="skip">Не изменять</option>
                                <option value="overwrite">Перевыставить</option>
                            </select>
                        </label>
                        <label class="mshhlpr-form-group">
                            <span class="mshhlpr-form-label">Выполнено после дедлайна</span>
                            <select id="msh-ag-late" class="mshhlpr-select">
                                <option value="calculated">Оценка по результату</option>
                                <option value="skip">Не ставить отметку</option>
                                <option value="2">Поставить 2</option>
                                <option value="3">Поставить 3</option>
                                <option value="4">Поставить 4</option>
                                <option value="5">Поставить 5</option>
                            </select>
                        </label>

                        <div class="mshhlpr-section-title mshhlpr-ag-section-with-help">
                            <span>Нет доступа к порталу</span>
                            ${helpButton('Список учеников без доступа к порталу хранится в этом браузере. При расчёте им не выставляется отметка за ЦДЗ. Кнопка «Есть доступ» снимает отметку, и оценка считается по обычным правилам.', 'Ученики без доступа к порталу')}
                        </div>
                        <label class="mshhlpr-form-group">
                            <span class="mshhlpr-form-label">Фамилия и имя через запятую</span>
                            <textarea id="msh-ag-no-portal-input" class="mshhlpr-textarea" rows="3"
                                placeholder="Алексеева Анна, Семёнов Пётр"></textarea>
                        </label>
                        <button id="msh-ag-no-portal-add" class="mshhlpr-ag-mini-btn" type="button">Отметить без доступа</button>
                        <p class="mshhlpr-ag-no-portal-note">Список сохраняется локально и используется при каждом расчёте.</p>
                        <div id="msh-ag-no-portal-status" class="mshhlpr-ag-inline-status"></div>
                        <div id="msh-ag-no-portal-list"></div>
                    </aside>

                    <main class="mshhlpr-ag-preview">
                        <div id="msh-ag-summary" class="mshhlpr-ag-summary">
                            <span>Настройте правила и нажмите «Рассчитать».</span>
                        </div>
                        <div id="msh-ag-status" class="mshhlpr-ag-status"></div>
                        <div id="msh-ag-grade-chart" class="mshhlpr-ag-grade-chart" hidden></div>
                        <div class="mshhlpr-ag-table-wrap">
                            <table class="mshhlpr-ag-table">
                                <thead><tr>
                                    <th>Ученик</th><th>Класс</th><th>Дата</th><th>Статус</th>
                                    <th>Результат</th><th>Попытки</th><th>Отметка</th><th>Действие</th>
                                </tr></thead>
                                <tbody id="msh-ag-preview-body">
                                    <tr><td colspan="8" class="mshhlpr-ag-empty">Предпросмотр ещё не рассчитан.</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </main>
                </div>
                <div class="mshhlpr-modal-footer mshhlpr-ag-footer">
                    <span>Запись отметок начнётся только после дополнительного подтверждения.</span>
                    <span class="mshhlpr-ag-footer-actions">
                        <button id="msh-ag-cancel" class="mshhlpr-action-btn-secondary" type="button">Закрыть</button>
                        <button id="msh-ag-load" class="mshhlpr-btn mshhlpr-btn-info" type="button">Рассчитать</button>
                        <button id="msh-ag-apply" class="mshhlpr-btn mshhlpr-btn-success" type="button" disabled>Выставить отметки</button>
                    </span>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const destroyTooltip = initHelpTooltips(overlay);
        const close = () => {
            destroyTooltip();
            overlay.remove();
        };
        overlay.querySelector('.mshhlpr-modal-close').onclick = close;
        overlay.querySelector('#msh-ag-cancel').onclick = close;
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        overlay.querySelector('#msh-ag-load').onclick = () => loadPreview(overlay);
        overlay.querySelector('#msh-ag-apply').onclick = () => applyPreview(overlay);
        overlay.querySelector('#msh-ag-unit').onchange = () => updateThresholdLabels(overlay);
        overlay.querySelector('#msh-ag-deadline-mode').onchange = () => updateDeadlineControls(overlay);
        overlay.querySelector('#msh-ag-no-portal-add').onclick = () => commitNoPortalInput(overlay);
        overlay.querySelector('#msh-ag-no-portal-input').addEventListener('keydown', event => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                commitNoPortalInput(overlay);
            }
        });
        overlay.addEventListener('click', event => {
            const chartToggle = event.target.closest('#msh-ag-chart-toggle');
            if (!chartToggle || !activeModalState) return;
            activeModalState.chartOpen = !activeModalState.chartOpen;
            renderPreview(overlay, activeModalState);
        });
        overlay.addEventListener('click', event => {
            const restore = event.target.closest('[data-msh-ag-restore]');
            if (!restore || !overlay.contains(restore)) return;
            event.preventDefault();
            restorePortalAccess(overlay, restore.dataset.mshAgRestore);
        });

        readSettings().then(settings => {
            Object.entries({
                'msh-ag-unit': settings.thresholdUnit,
                'msh-ag-grade3': settings.grade3,
                'msh-ag-grade4': settings.grade4,
                'msh-ag-grade5': settings.grade5,
                'msh-ag-absent-mode': settings.absentMode,
                'msh-ag-missing': settings.missingMode,
                'msh-ag-existing': settings.existingMode,
                'msh-ag-late': settings.lateMode,
                'msh-ag-deadline-mode': settings.deadlineMode === 'custom'
                    ? settings.deadlineDayOffset
                    : settings.deadlineMode,
                'msh-ag-deadline-time': settings.deadlineTime
            }).forEach(([id, value]) => { overlay.querySelector(`#${id}`).value = String(value); });
            overlay.querySelector('#msh-ag-penalty').checked = settings.penalizeAttempts;
            updateThresholdLabels(overlay);
            updateDeadlineControls(overlay);
        });
        readNoPortalList()
            .then(list => renderNoPortalList(overlay, list))
            .catch(error => console.warn(`${LOG} Не удалось прочитать список без доступа:`, error));
    }

    function injectButton() {
        const homeworkId = getHomeworkIdFromPath();
        if (!homeworkId) {
            document.getElementById(BUTTON_ID)?.remove();
            return;
        }
        if (document.getElementById(BUTTON_ID)) return;

        const actionButton = [...document.querySelectorAll('button')]
            .find(button => button.textContent.trim().includes('Действия с заданием'));
        if (!actionButton) return;

        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.className = 'mshhlpr-btn mshhlpr-btn-primary mshhlpr-ag-launch';
        button.innerHTML = '<span aria-hidden="true">✓</span> Автооценка ЦДЗ';
        button.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            showModal();
        };
        actionButton.insertAdjacentElement('afterend', button);
    }

    function handleRouteChange() {
        if (location.pathname !== lastPathname) {
            lastPathname = location.pathname;
            document.getElementById(BUTTON_ID)?.remove();
            document.getElementById(MODAL_ID)?.remove();
            document.getElementById(HELP_TOOLTIP_ID)?.remove();
        }
        injectButton();
    }

    function scheduleRouteCheck() {
        if (routeCheckScheduled) return;
        routeCheckScheduled = true;
        requestAnimationFrame(() => {
            routeCheckScheduled = false;
            handleRouteChange();
        });
    }

    const observer = new MutationObserver(scheduleRouteCheck);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    handleRouteChange();
    console.log(`${LOG} Модуль готов.`);
};
