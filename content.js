// content.js

(() => {
    console.log('[МЭШ][content.js] Диспетчер расширения запущен.');

    window.MESH_VERSION_INFO = {
        displayVersion: chrome.runtime.getManifest().version_name || `v.${chrome.runtime.getManifest().version}`
    };

    // 1. Сначала ВСЕГДА запускаем определение профиля
    if (typeof initIdentity === 'function') {
        initIdentity();
    }

    let isRunning = false;

    function startModules() {
        if (isRunning) return;
        console.log('[МЭШ][content.js] Активация модулей расширения...');

        if (typeof initAboutMe === 'function') initAboutMe();
        if (typeof initMaxButton === 'function') initMaxButton();
        if (typeof initContentBlocker === 'function') initContentBlocker();
        if (typeof initScheduleZipper === 'function') initScheduleZipper();
        if (typeof initJournalTools === 'function') initJournalTools();
        if (typeof initTools === 'function') initTools();
        if (typeof initExportPupils === 'function') initExportPupils();
        if (typeof initKtpHelper === 'function') initKtpHelper();
        if (typeof initSchedulePDF === 'function') initSchedulePDF();
        if (typeof initSelfAnalysis === 'function') initSelfAnalysis();
        if (typeof initNoHomework === 'function') initNoHomework();
        if (typeof initMathSymbols === 'function') initMathSymbols();
        if (typeof initCheckScheduleTeachers === 'function') initCheckScheduleTeachers();
        if (typeof initAutoGrading === 'function') initAutoGrading();


        isRunning = true;
    }

    // Слушаем любые изменения статуса расширения в хранилище
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.extensionEnabled) {
            console.log('[МЭШ][content.js] Статус расширения изменен. Перезагрузка...');
            window.location.reload();
        }
    });

    // Первичная проверка при загрузке
    chrome.storage.local.get(['extensionEnabled'], (result) => {
        const isEnabled = result.extensionEnabled !== false;
        console.log('[МЭШ][content.js] Состояние расширения:', isEnabled);

        if (isEnabled) {
            startModules();
        }
    });
})();
