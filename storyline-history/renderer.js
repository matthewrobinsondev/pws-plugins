(function () {
    // Prevent double-init
    if (window.__storylineHistoryInit) return;
    window.__storylineHistoryInit = true;

    let PLUGIN_ID = 'storyline-history';
    let IPC_CHANNEL = 'get-history';
    let DEBOUNCE_MS = 300;
    let INJECT_DELAY_MS = 100;

    // State
    let currentPage = 0;
    let currentSearch = '';
    let searchTimeout = null;

    let MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // --- Utility functions ---

    function formatDate(dateStr) {
        if (!dateStr) return '?';
        let parts = dateStr.split('-');
        if (parts.length !== 3) return dateStr;
        return MONTHS[parseInt(parts[1], 10) - 1] + ' ' + parseInt(parts[2], 10) + ', ' + parts[0];
    }

    function escapeHtml(str) {
        let div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function getScoreClass(rating) {
        if (rating >= 75) return 'shScoreGood';
        if (rating < 60) return 'shScorePoor';
        return 'shScoreOk';
    }

    function toggleClass(el, className, add) {
        if (!el) return;
        if (add) {
            el.classList.add(className);
        } else {
            el.classList.remove(className);
        }
    }

    // --- Card rendering ---

    function renderCard(storyline) {
        let duration = storyline.durationDays !== null ? storyline.durationDays + ' days' : '';
        let html = '<div class="shStorylineCard">';

        // Card body
        html += '<div class="shCardBody">';
        html += '<div class="shCardTitle">' + escapeHtml(storyline.storylineName) + '</div>';
        html += '<div class="shCardMeta">';
        html += '<span>' + formatDate(storyline.startDate) + ' - ' + formatDate(storyline.endDate) + '</span>';
        if (duration) html += '<span>' + escapeHtml(duration) + '</span>';
        if (storyline.segmentCount > 0) html += '<span>' + storyline.segmentCount + ' segments</span>';
        html += '</div>';
        if (storyline.workers && storyline.workers.length > 0) {
            html += '<div class="shCardWorkers">Workers: ' + escapeHtml(storyline.workers.join(', ')) + '</div>';
        }
        if (storyline.overview) {
            html += '<div class="shCardOverview">' + escapeHtml(storyline.overview) + '</div>';
        }
        html += '</div>';

        // Score badge
        if (storyline.avgRating !== null) {
            html += '<div class="shCardScore">';
            html += '<div class="shScoreValue ' + getScoreClass(storyline.avgRating) + '">' + storyline.avgRating + '%</div>';
            html += '<div class="shScoreLabel">Avg Rating</div>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // --- Modal ---

    function createModal() {
        if (document.getElementById('storylineHistoryModal')) return;

        let modal = document.createElement('div');
        modal.id = 'storylineHistoryModal';
        modal.innerHTML =
            '<div class="shModalContent">' +
            '  <div class="shHeader">' +
            '    <h2>Storyline History</h2>' +
            '    <span class="shCloseBtn" id="shCloseBtn">&times;</span>' +
            '  </div>' +
            '  <div class="shSearchBar">' +
            '    <input type="text" class="shSearchInput" id="shSearchInput" placeholder="Search by storyline name or worker...">' +
            '  </div>' +
            '  <div class="shBody" id="shBody">' +
            '    <div class="shLoading">Loading...</div>' +
            '  </div>' +
            '  <div class="shFooter">' +
            '    <span class="shPageBtn" id="shPrevBtn">Prev</span>' +
            '    <span id="shPageInfo"></span>' +
            '    <span class="shPageBtn" id="shNextBtn">Next</span>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(modal);

        // Close handlers
        document.getElementById('shCloseBtn').addEventListener('click', closeModal);
        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeModal();
        });

        // Search with debounce
        document.getElementById('shSearchInput').addEventListener('input', function (e) {
            clearTimeout(searchTimeout);
            let value = e.target.value;
            searchTimeout = setTimeout(function () {
                currentSearch = value;
                currentPage = 0;
                loadData();
            }, DEBOUNCE_MS);
        });

        // Pagination
        document.getElementById('shPrevBtn').addEventListener('click', function () {
            if (currentPage > 0) {
                currentPage--;
                loadData();
            }
        });
        document.getElementById('shNextBtn').addEventListener('click', function () {
            currentPage++;
            loadData();
        });
    }

    function openModal() {
        createModal();
        currentPage = 0;
        currentSearch = '';
        let input = document.getElementById('shSearchInput');
        if (input) input.value = '';
        document.getElementById('storylineHistoryModal').classList.add('shOpen');
        loadData();
    }

    function closeModal() {
        let modal = document.getElementById('storylineHistoryModal');
        if (modal) modal.classList.remove('shOpen');
    }

    // --- Data loading ---

    function updatePagination(page, totalPages, total) {
        let pageInfo = document.getElementById('shPageInfo');
        if (pageInfo) {
            pageInfo.textContent = 'Page ' + (page + 1) + ' of ' + Math.max(totalPages, 1) + ' (' + total + ' storylines)';
        }
        toggleClass(document.getElementById('shPrevBtn'), 'shDisabled', page <= 0);
        toggleClass(document.getElementById('shNextBtn'), 'shDisabled', page >= totalPages - 1);
    }

    function renderStorylines(storylines) {
        return storylines.map(renderCard).join('');
    }

    function loadData() {
        let body = document.getElementById('shBody');
        if (!body) return;

        body.innerHTML = '<div class="shLoading">Loading...</div>';

        plugins.invoke(PLUGIN_ID, IPC_CHANNEL, {
            search: currentSearch,
            page: currentPage
        }).then(function (result) {
            if (!result || result.error) {
                body.innerHTML = '<div class="shNoResults">Error: ' + escapeHtml(result ? result.error : 'Unknown error') + '</div>';
                return;
            }

            let storylines = result.storylines || [];
            let total = result.total || 0;
            let page = result.page || 0;
            let pageSize = result.pageSize || 20;
            let totalPages = Math.ceil(total / pageSize);

            if (storylines.length === 0) {
                body.innerHTML = '<div class="shNoResults">No past storylines found.</div>';
            } else {
                body.innerHTML = renderStorylines(storylines);
            }

            updatePagination(page, totalPages, total);
        }).catch(function () {
            body.innerHTML = '<div class="shNoResults">Failed to load storyline history.</div>';
        });
    }

    // --- Button injection ---

    function injectButton() {
        let page = document.getElementById('myStorylinePage');
        if (!page) return;
        if (document.getElementById('shHistoryBtn')) return;

        let buttonArea = page.querySelector('.buttonArea');
        if (buttonArea) {
            let li = document.createElement('li');
            li.id = 'shHistoryBtn';
            li.className = 'button clickable';
            li.textContent = 'Storyline History';
            li.addEventListener('click', openModal);
            buttonArea.appendChild(li);
        }
    }

    // --- Page navigation observer ---

    let observer = new MutationObserver(function (mutations) {
        for (let i = 0; i < mutations.length; i++) {
            if (mutations[i].attributeName === 'data-active-page') {
                let activePage = document.body.getAttribute('data-active-page');
                if (activePage === 'myStorylinePage') {
                    setTimeout(injectButton, INJECT_DELAY_MS);
                }
                break;
            }
        }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-active-page'] });

    // Try to inject now if already on the storyline page
    if (document.body.getAttribute('data-active-page') === 'myStorylinePage') {
        setTimeout(injectButton, INJECT_DELAY_MS);
    }

    // --- Cleanup for plugin deactivation ---

    window.__storylineHistoryCleanup = function () {
        observer.disconnect();
        let modal = document.getElementById('storylineHistoryModal');
        if (modal) modal.remove();
        let btn = document.getElementById('shHistoryBtn');
        if (btn) btn.remove();
        window.__storylineHistoryInit = false;
        window.__storylineHistoryCleanup = null;
    };
})();
