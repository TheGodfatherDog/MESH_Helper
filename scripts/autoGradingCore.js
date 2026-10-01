// scripts/autoGradingCore.js

(() => {
    const pad = value => String(value).padStart(2, '0');

    function parsePortalDate(value) {
        if (value instanceof Date) return new Date(value.getTime());
        if (Array.isArray(value) && value.length >= 3) {
            return new Date(Number(value[0]), Number(value[1]) - 1, Number(value[2]));
        }
        if (typeof value !== 'string') return null;

        const raw = value.trim();
        let match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
        if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));

        match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function formatPortalDate(value) {
        const date = parsePortalDate(value);
        if (!date) return '';
        return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
    }

    function formatIsoDate(value) {
        const date = parsePortalDate(value);
        if (!date) return '';
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function getEffectiveDeadline(datePreparedFor, settings = {}) {
        if (settings.deadlineMode === 'none') return null;
        const date = parsePortalDate(datePreparedFor);
        if (!date) return null;

        const isPortalDefault = !settings.deadlineMode || settings.deadlineMode === 'default';
        const dayOffset = isPortalDefault
            ? 1
            : Number.isFinite(Number(settings.deadlineDayOffset))
            ? Number(settings.deadlineDayOffset)
            : 1;
        const time = isPortalDefault
            ? '00:00'
            : /^\d{2}:\d{2}$/.test(settings.deadlineTime || '')
            ? settings.deadlineTime
            : '00:00';
        const [hours, minutes] = time.split(':').map(Number);

        date.setDate(date.getDate() + dayOffset);
        date.setHours(hours, minutes, 0, 0);
        return date;
    }

    function isPastHomework(homework, settings, now = new Date()) {
        const deadline = getEffectiveDeadline(homework?.date_prepared_for, settings) ||
            getEffectiveDeadline(homework?.date_prepared_for, { deadlineMode: 'default' });
        return Boolean(deadline && now.getTime() >= deadline.getTime());
    }

    function validateThresholds(settings) {
        const values = [settings.grade3, settings.grade4, settings.grade5].map(Number);
        if (values.some(value => !Number.isFinite(value) || value < 0)) {
            return 'Пороги должны быть неотрицательными числами.';
        }
        if (!(values[0] < values[1] && values[1] < values[2])) {
            return 'Пороги для 3, 4 и 5 должны возрастать.';
        }
        if (settings.thresholdUnit === 'percent' && values[2] > 100) {
            return 'Процентный порог не может быть больше 100%.';
        }
        return '';
    }

    function getBaseGrade(score, maxScore, settings) {
        const safeScore = Number(score) || 0;
        const safeMax = Number(maxScore) || 0;
        const value = settings.thresholdUnit === 'points'
            ? safeScore
            : (safeMax > 0 ? safeScore / safeMax * 100 : 0);

        if (value >= Number(settings.grade5)) return 5;
        if (value >= Number(settings.grade4)) return 4;
        if (value >= Number(settings.grade3)) return 3;
        return 2;
    }

    function pickBestAttempt(attempts) {
        return [...attempts].sort((left, right) => {
            const leftScale = Number(left.recommended_mark_scale) || 0;
            const rightScale = Number(right.recommended_mark_scale) || 0;
            const leftRate = leftScale > 0 ? Number(left.recommended_mark || 0) / leftScale : 0;
            const rightRate = rightScale > 0 ? Number(right.recommended_mark || 0) / rightScale : 0;
            if (rightRate !== leftRate) return rightRate - leftRate;
            return getAttemptTime(right) - getAttemptTime(left);
        })[0] || null;
    }

    function getAttemptTime(attempt) {
        const raw = attempt?.completed_at || attempt?.finished_at || attempt?.updated_at || attempt?.started_at;
        const value = raw ? new Date(raw).getTime() : 0;
        return Number.isNaN(value) ? 0 : value;
    }

    function getAttemptTestKey(attempt) {
        const context = attempt?.context || {};
        return [
            context.work_id || 'work',
            context.material_id || attempt?.activity_id || 'material'
        ].join(':');
    }

    function summarizeAttempts(attempts = []) {
        const groups = new Map();
        const validAttempts = attempts.filter(attempt => Number(attempt?.recommended_mark_scale) > 0);
        validAttempts.forEach(attempt => {
            const key = getAttemptTestKey(attempt);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(attempt);
        });

        let score = 0;
        let maxScore = 0;
        let extraAttempts = 0;
        let firstCompletedAt = null;

        groups.forEach(group => {
            const best = pickBestAttempt(group);
            if (best) {
                score += Number(best.recommended_mark) || 0;
                maxScore += Number(best.recommended_mark_scale) || 0;
            }
            extraAttempts += Math.max(0, group.length - 1);
            group.forEach(attempt => {
                const timestamp = getAttemptTime(attempt);
                if (timestamp && (!firstCompletedAt || timestamp < firstCompletedAt)) firstCompletedAt = timestamp;
            });
        });

        const testsCount = groups.size;
        return {
            score,
            maxScore,
            testsCount,
            attemptsCount: validAttempts.length,
            extraAttempts,
            averageExtraAttempts: testsCount > 0 ? extraAttempts / testsCount : 0,
            firstCompletedAt: firstCompletedAt ? new Date(firstCompletedAt) : null
        };
    }

    function calculateGrade(summary, settings) {
        const baseGrade = getBaseGrade(summary.score, summary.maxScore, settings);
        if (!settings.penalizeAttempts || baseGrade === 2) {
            return { baseGrade, finalGrade: baseGrade, penalty: 0 };
        }

        const penalty = Number(summary.averageExtraAttempts) || 0;
        const finalGrade = Math.max(3, Math.round(baseGrade - penalty));
        return { baseGrade, finalGrade, penalty };
    }

    function getLateGrade(calculatedGrade, isLate, settings) {
        if (!isLate || settings.lateMode === 'calculated') return calculatedGrade;
        if (settings.lateMode === 'skip') return null;
        const fixed = Number(settings.lateMode);
        return [2, 3, 4, 5].includes(fixed) ? fixed : calculatedGrade;
    }

    window.MESH_AUTO_GRADING_CORE = Object.freeze({
        calculateGrade,
        formatIsoDate,
        formatPortalDate,
        getAttemptTime,
        getBaseGrade,
        getEffectiveDeadline,
        getLateGrade,
        isPastHomework,
        parsePortalDate,
        summarizeAttempts,
        validateThresholds
    });
})();
