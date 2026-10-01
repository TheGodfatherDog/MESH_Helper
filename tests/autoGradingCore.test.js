const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'scripts', 'autoGradingCore.js'), 'utf8'),
    sandbox
);

const core = sandbox.window.MESH_AUTO_GRADING_CORE;
const settings = {
    thresholdUnit: 'percent',
    grade3: 50,
    grade4: 70,
    grade5: 85,
    penalizeAttempts: true,
    deadlineMode: 'default',
    deadlineDayOffset: 1,
    deadlineTime: '00:00',
    lateMode: 'calculated'
};

const deadline = core.getEffectiveDeadline('30.09.2026', settings);
assert.equal(deadline.getFullYear(), 2026);
assert.equal(deadline.getMonth(), 9);
assert.equal(deadline.getDate(), 1);
assert.equal(deadline.getHours(), 0);
assert.equal(core.isPastHomework(
    { date_prepared_for: '30.09.2026' },
    settings,
    new Date(2026, 8, 30, 23, 59)
), false);
assert.equal(core.isPastHomework(
    { date_prepared_for: '30.09.2026' },
    settings,
    new Date(2026, 9, 1, 0, 0)
), true);
assert.equal(core.getEffectiveDeadline('30.09.2026', { deadlineMode: 'none' }), null);
assert.equal(core.isPastHomework(
    { date_prepared_for: '30.09.2026' },
    { deadlineMode: 'none' },
    new Date(2026, 9, 1, 0, 0)
), true);
const customDeadline = core.getEffectiveDeadline('30.09.2026', {
    deadlineMode: 'custom', deadlineDayOffset: 0, deadlineTime: '20:00'
});
assert.equal(customDeadline.getDate(), 30);
assert.equal(customDeadline.getHours(), 20);

const attempt = (test, score, max, index) => ({
    context: { material_id: test },
    recommended_mark: score,
    recommended_mark_scale: max,
    started_at: `2026-09-30T10:${String(index).padStart(2, '0')}:00+03:00`
});

const tenTestsOneRepeat = Array.from({ length: 10 }, (_, index) => attempt(index, 10, 10, index));
tenTestsOneRepeat.push(attempt(0, 10, 10, 11));
const oneRepeatSummary = core.summarizeAttempts(tenTestsOneRepeat);
assert.equal(oneRepeatSummary.averageExtraAttempts, 0.1);
assert.equal(core.calculateGrade(oneRepeatSummary, settings).finalGrade, 5);

const tenTestsSixRepeats = Array.from({ length: 10 }, (_, index) => attempt(index, 10, 10, index));
for (let index = 0; index < 6; index += 1) tenTestsSixRepeats.push(attempt(index, 10, 10, index + 20));
const sixRepeatSummary = core.summarizeAttempts(tenTestsSixRepeats);
assert.equal(sixRepeatSummary.averageExtraAttempts, 0.6);
assert.equal(core.calculateGrade(sixRepeatSummary, settings).finalGrade, 4);

const failingSummary = core.summarizeAttempts([attempt('only', 1, 10, 1), attempt('only', 1, 10, 2)]);
assert.equal(core.calculateGrade(failingSummary, settings).baseGrade, 2);
assert.equal(core.calculateGrade(failingSummary, settings).finalGrade, 2);

assert.equal(core.validateThresholds(settings), '');
assert.match(core.validateThresholds({ ...settings, grade4: 40 }), /возрастать/);

console.log('autoGradingCore: OK');
