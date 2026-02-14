/**
 * Storyline History Plugin
 *
 * Adds a "Storyline History" button to the Storylines screen that opens
 * a modal showing all past (inactive) storylines for the player's promotion.
 * Displays workers involved, dates, duration, and storyline names.
 *
 * Permissions: events, database
 */

let fs = require('fs');
let path = require('path');

let PAGE_SIZE = 20;

let api = null;

// --- File loading helpers ---

function loadFile(filename) {
    return fs.readFileSync(path.join(__dirname, filename), 'utf8');
}

// --- Database query helpers ---

function getPromotionId() {
    let state = api.game.getState();
    if (state?.promotionId) {
        return state.promotionId;
    }

    let saveRow = api.database.get('SELECT saveUserPromotion FROM saveinfo LIMIT 1');
    if (saveRow?.saveUserPromotion) {
        return saveRow.saveUserPromotion;
    }

    return null;
}

function buildSearchClause(searchTerm, params) {
    if (!searchTerm) return '';

    params.push('%' + searchTerm + '%', '%' + searchTerm + '%');
    return ' AND (s.storylineName LIKE ? OR c.contractName LIKE ?)';
}

function getStorylineCount(promotionId, searchClause, params) {
    let sql =
        'SELECT COUNT(DISTINCT s.storylineID) as total ' +
        'FROM storylines s ' +
        'LEFT JOIN storylineworkers sw ON s.storylineID = sw.storylineID ' +
        'LEFT JOIN contracts c ON sw.contractID = c.contractID ' +
        'WHERE s.active = 0 AND s.promotionID = ?' + searchClause;

    let result = api.database.get(sql, params);
    return result ? result.total : 0;
}

function getStorylineIds(promotionId, searchClause, params, page) {
    let sql =
        'SELECT DISTINCT s.storylineID ' +
        'FROM storylines s ' +
        'LEFT JOIN storylineworkers sw ON s.storylineID = sw.storylineID ' +
        'LEFT JOIN contracts c ON sw.contractID = c.contractID ' +
        'WHERE s.active = 0 AND s.promotionID = ?' + searchClause +
        ' ORDER BY s.endDate DESC, s.startDate DESC ' +
        'LIMIT ? OFFSET ?';

    let queryParams = params.concat([PAGE_SIZE, page * PAGE_SIZE]);
    return api.database.query(sql, queryParams);
}

function getStorylineDetails(idList) {
    let placeholders = idList.map(function () { return '?'; }).join(', ');

    let sql =
        'SELECT s.storylineID, s.storylineName, s.startDate, s.endDate, s.overview, ' +
        'c.contractName, w.name as workerName ' +
        'FROM storylines s ' +
        'LEFT JOIN storylineworkers sw ON s.storylineID = sw.storylineID ' +
        'LEFT JOIN contracts c ON sw.contractID = c.contractID ' +
        'LEFT JOIN workers w ON c.workerID = w.workerID ' +
        'WHERE s.storylineID IN (' + placeholders + ') ' +
        'ORDER BY s.endDate DESC, s.startDate DESC, c.contractName';

    return api.database.query(sql, idList);
}

function getStorylineRatings(idList) {
    let placeholders = idList.map(function () { return '?'; }).join(', ');

    let sql =
        'SELECT storylineID, ROUND(AVG(segmentRating), 1) as avgRating, ' +
        'COUNT(*) as segmentCount ' +
        'FROM storylinehistories ' +
        'WHERE storylineID IN (' + placeholders + ') ' +
        'GROUP BY storylineID';

    let rows = api.database.query(sql, idList);
    let map = {};
    for (let i = 0; i < rows.length; i++) {
        map[rows[i].storylineID] = {
            avgRating: rows[i].avgRating,
            segmentCount: rows[i].segmentCount
        };
    }
    return map;
}

function calculateDuration(startDate, endDate) {
    if (!startDate || !endDate) return null;

    let start = new Date(startDate);
    let end = new Date(endDate);
    return Math.round((end - start) / (1000 * 60 * 60 * 24));
}

function resolveStorylineName(storyline) {
    if (storyline.storylineName) return storyline.storylineName;
    if (storyline.workers.length > 0) return storyline.workers.join(' vs ');
    return 'Unnamed Storyline #' + storyline.storylineID;
}

function groupStorylineRows(rows, ratingsMap) {
    let grouped = {};
    let order = [];

    for (let i = 0; i < rows.length; i++) {
        let row = rows[i];

        if (!grouped[row.storylineID]) {
            let ratingInfo = ratingsMap[row.storylineID] || null;
            grouped[row.storylineID] = {
                storylineID: row.storylineID,
                storylineName: row.storylineName || '',
                startDate: row.startDate || '',
                endDate: row.endDate || '',
                overview: row.overview || '',
                workers: [],
                avgRating: ratingInfo ? ratingInfo.avgRating : null,
                segmentCount: ratingInfo ? ratingInfo.segmentCount : 0
            };
            order.push(row.storylineID);
        }

        let workerName = row.contractName || row.workerName;
        if (workerName) {
            grouped[row.storylineID].workers.push(workerName);
        }
    }

    return order.map(function (id) {
        let s = grouped[id];
        s.durationDays = calculateDuration(s.startDate, s.endDate);
        s.storylineName = resolveStorylineName(s);
        return s;
    });
}

// --- IPC handler ---

function handleGetHistory(event, data) {
    if (!api) return { error: 'Plugin not active' };

    let promotionId;
    try {
        promotionId = getPromotionId();
    } catch (e) {
        api.console.warn('Storyline History: could not determine promotion: ' + e.message);
        return { error: 'Could not determine promotion' };
    }

    if (!promotionId) return { error: 'No save loaded' };

    try {
        let searchTerm = (data?.search) ? data.search.trim() : '';
        let page = (data?.page) ? data.page : 0;

        let params = [promotionId];
        let searchClause = buildSearchClause(searchTerm, params);

        let total = getStorylineCount(promotionId, searchClause, params);
        let ids = getStorylineIds(promotionId, searchClause, params, page);

        if (ids.length === 0) {
            return { storylines: [], total: total, page: page, pageSize: PAGE_SIZE };
        }

        let idList = ids.map(function (r) { return r.storylineID; });
        let ratingsMap = getStorylineRatings(idList);
        let rows = getStorylineDetails(idList);
        let storylines = groupStorylineRows(rows, ratingsMap);

        return { storylines: storylines, total: total, page: page, pageSize: PAGE_SIZE };
    } catch (e) {
        api.console.error('Storyline History query failed:', e.message);
        return { error: e.message };
    }
}

// --- Plugin lifecycle ---

module.exports = {
    activate: function (pluginAPI) {
        api = pluginAPI;
        api.console.log('Storyline History plugin activated.');

        api.ipc.handle('get-history', handleGetHistory);

        api.ui.injectCSS(loadFile('styles.css'));

        api.events.on('database:opened', function () {
            try {
                setTimeout(function () {
                    api.ui.executeJS(loadFile('renderer.js'));
                }, 1000);
            } catch (e) {
                api.console.warn('Storyline History: failed to inject UI on database open: ' + e.message);
            }
        });
    },

    deactivate: function () {
        if (api) {
            api.console.log('Storyline History plugin deactivating.');
            api.ui.executeJS(
                'if (window.__storylineHistoryCleanup) window.__storylineHistoryCleanup();'
            );
        }
        api = null;
    }
};
