(function() {
    var stream = document.getElementById('chat-stream');
    var emptyEl = document.getElementById('chat-empty');
    var form = document.getElementById('composer');
    var input = document.getElementById('message-input');
    var sendBtn = document.getElementById('send-btn');
    var sendLoader = document.getElementById('send-loader');
    var sendArrow = document.getElementById('send-arrow');
    var clearBtn = document.getElementById('clear-btn');
    var composerWrap = document.getElementById('composer');
    var progressBarWrap = document.getElementById('progress-bar-wrap');
    var progressEmoji = document.getElementById('progress-emoji');
    var progressLabel = document.getElementById('progress-label');
    var progressStatus = document.getElementById('progress-status');
    var charCountEl = document.getElementById('char-count');
    var exportBtn = document.querySelector('.export-btn');
    var clearBtnH = document.querySelector('.clear-btn');
    var uploadBtn = document.getElementById('upload-btn');
    var fileInput = document.getElementById('file-input');
    var attachmentPreview = document.getElementById('attachment-preview');
    var sidebarToggleBtn = document.getElementById('sidebar-toggle');
    var sidebarEl = document.getElementById('session-sidebar');
    var sidebarCloseBtn = document.getElementById('sidebar-close');
    var sidebarBackdrop = document.getElementById('sidebar-backdrop');
    var newChatBtn = document.getElementById('new-chat-btn');
    var sessionListEl = document.getElementById('session-list');
    var sessionCountEl = document.getElementById('session-count');

    // Resolusi URL api.php dari lokasi file JS ini (bukan URL halaman),
    // biar tetap bener walau halaman dibuka tanpa trailing slash (mis. /c0n73xt).
    var scriptEl = document.currentScript || (function() {
        var allScripts = document.getElementsByTagName('script');
        return allScripts[allScripts.length - 1];
    })();
    var API_URL = (scriptEl && scriptEl.src) ? String(scriptEl.src).replace(/[?#].*$/, '').replace(/[^/]*$/, 'api.php') : 'api.php';

    if (input) input.focus();

    var messages = [];
    var busy = false;
    var STORE_KEY = 'debz_sessions_v8';
    var LEGACY_KEY = 'debz_chat_history_v7';
    var sessions = [];
    var activeSessionId = null;
    var MAX_CHARS = Number.MAX_SAFE_INTEGER;
    var abortController = null;
    window.lastToolProgress = {};
    var selectedFiles = [];

    var hljsObserver = new MutationObserver(function(mutations) {
        if (typeof hljs !== 'undefined') {
            mutations.forEach(function(mutation) {
                if (mutation.addedNodes.length) {
                    var newBlocks = stream.querySelectorAll('pre code:not(.hljs)');
                    newBlocks.forEach(function(block) {
                        hljs.highlightElement(block);
                    });
                }
            });
        }
    });
    if (stream) hljsObserver.observe(stream, { childList: true, subtree: true });

    function showToast(text, duration) {
        duration = duration || 2000;
        var t = document.getElementById('toast');
        if (!t) return;
        t.textContent = text;
        t.classList.add('show');
        setTimeout(function() { t.classList.remove('show'); }, duration);
    }

    /* ==================== Session Manager ==================== */
    function cleanTitle(text) {
        var t = String(text)
            .replace(/<div[\s\S]*?<\/div>/g, '')
            .replace(/[#*`>_~\[\]()]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (t.length > 38) t = t.slice(0, 38) + '…';
        return t || 'Chat Baru';
    }

    function saveStore() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify({ activeId: activeSessionId, sessions: sessions }));
        } catch(e) {
            showToast('Storage penuh! Hapus session lama biar muat.');
        }
    }

    function createSession(title) {
        var s = {
            id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            title: title || 'Chat Baru',
            titleSet: !!title,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: []
        };
        sessions.unshift(s);
        activeSessionId = s.id;
        saveStore();
        return s;
    }

    function getSession(id) {
        for (var i = 0; i < sessions.length; i++) {
            if (sessions[i].id === id) return sessions[i];
        }
        return null;
    }

    function activeSession() {
        var s = getSession(activeSessionId);
        if (!s) {
            if (sessions.length) {
                activeSessionId = sessions[0].id;
                s = sessions[0];
            } else {
                s = createSession(null);
            }
        }
        return s;
    }

    function loadStore() {
        var store = null;
        try {
            var raw = localStorage.getItem(STORE_KEY);
            if (raw) store = JSON.parse(raw);
        } catch(e) {}

        if (store && Array.isArray(store.sessions)) {
            sessions = store.sessions.filter(function(s) {
                return s && s.id && Array.isArray(s.messages);
            });
            if (store.activeId && getSession(store.activeId)) {
                activeSessionId = store.activeId;
            } else if (sessions.length) {
                activeSessionId = sessions[0].id;
            }
        }

        // Migrasi otomatis dari history versi lama (single chat)
        if (!sessions.length) {
            var legacy = [];
            try {
                var lraw = localStorage.getItem(LEGACY_KEY);
                if (lraw) legacy = JSON.parse(lraw) || [];
            } catch(e) {}
            if (Array.isArray(legacy) && legacy.length) {
                var firstUser = null;
                legacy.forEach(function(m) {
                    if (!firstUser && m && m.role === 'user' && m.content) firstUser = m.content;
                });
                var s = createSession(firstUser ? cleanTitle(firstUser) : 'Chat Lama');
                s.messages = legacy.filter(function(m) {
                    if (!m || !m.role) return false;
                    if (m.role === 'assistant' && (!m.content || !m.content.trim())) return false;
                    return true;
                });
                s.titleSet = true;
                s.createdAt = (s.messages[0] && s.messages[0].timestamp) || Date.now();
                s.updatedAt = (s.messages[s.messages.length - 1] && s.messages[s.messages.length - 1].timestamp) || Date.now();
                activeSessionId = s.id;
                saveStore();
                try { localStorage.removeItem(LEGACY_KEY); } catch(e) {}
            }
        }

        if (!sessions.length) createSession(null);
    }

    function resetTypewriter() {
        if (typeTimeout) clearTimeout(typeTimeout);
        typeLineIdx = 0;
        typeCharIdx = 0;
        currentSpan = null;
        if (typingContainer) typingContainer.innerHTML = '';
        if (emptyEl) {
            emptyEl.style.display = 'flex';
            if (stream && emptyEl.parentNode !== stream) stream.appendChild(emptyEl);
            if (typingContainer) typeTimeout = setTimeout(runTypewriter, 300);
        }
    }

    function loadSessionView() {
        var s = activeSession();
        // Buang pesan assistant kosong (sisa error/abort yang gak keisi)
        var cleaned = s.messages.filter(function(m) {
            if (!m || !m.role) return false;
            if (m.role === 'assistant' && (!m.content || !m.content.trim())) return false;
            return true;
        });
        if (cleaned.length !== s.messages.length) {
            s.messages = cleaned;
            saveStore();
        }
        messages = s.messages;
        if (stream) stream.innerHTML = '';
        if (messages.length) {
            messages.forEach(function(m) {
                renderMessage(m.role, m.content, false, false, m.timestamp);
            });
            applyHighlighting();
            scrollDown(true);
        } else {
            resetTypewriter();
        }
    }

    function formatRelTime(ts) {
        if (!ts) return 'baru aja';
        var diff = Date.now() - ts;
        var mnt = Math.floor(diff / 60000);
        if (mnt < 1) return 'baru aja';
        if (mnt < 60) return mnt + ' menit lalu';
        var hr = Math.floor(mnt / 60);
        if (hr < 24) return hr + ' jam lalu';
        var dy = Math.floor(hr / 24);
        if (dy < 30) return dy + ' hari lalu';
        return new Date(ts).toLocaleDateString('id-ID');
    }

    function renderSessionList() {
        if (sessionCountEl) sessionCountEl.textContent = sessions.length + ' session' + (sessions.length === 1 ? '' : 's');
        if (!sessionListEl) return;
        if (!sessions.length) {
            sessionListEl.innerHTML = '<div class="session-empty">Belum ada session</div>';
            return;
        }
        var sorted = sessions.slice().sort(function(a, b) {
            return (b.updatedAt || 0) - (a.updatedAt || 0);
        });
        var html = '';
        sorted.forEach(function(s) {
            var count = (s.messages || []).length;
            var isActive = s.id === activeSessionId;
            html += '<div class="session-item' + (isActive ? ' active' : '') + '" data-id="' + s.id + '" title="' + escapeHTML(s.title) + '">'
                + '<div class="session-icon">' + (count ? '💬' : '✨') + '</div>'
                + '<div class="session-info">'
                + '<div class="session-title">' + escapeHTML(s.title) + '</div>'
                + '<div class="session-meta">' + count + ' pesan · ' + formatRelTime(s.updatedAt || s.createdAt) + '</div>'
                + '</div>'
                + '<button type="button" class="session-del" data-del="' + s.id + '" title="Hapus session ini"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>'
                + '</div>';
        });
        sessionListEl.innerHTML = html;
    }

    function openSidebar() {
        if (sidebarEl) sidebarEl.classList.add('open');
        if (sidebarBackdrop) sidebarBackdrop.classList.add('show');
        renderSessionList();
    }

    function closeSidebar() {
        if (sidebarEl) sidebarEl.classList.remove('open');
        if (sidebarBackdrop) sidebarBackdrop.classList.remove('show');
    }

    function switchSession(id) {
        if (busy) {
            showToast('Tungguin Debz kelar jawab dulu..');
            return;
        }
        var s = getSession(id);
        if (!s) return;
        if (s.id === activeSessionId) { closeSidebar(); return; }
        activeSessionId = s.id;
        saveStore();
        loadSessionView();
        renderSessionList();
        closeSidebar();
    }

    function deleteSession(id) {
        var s = getSession(id);
        if (!s) return;
        if (busy && id === activeSessionId) {
            showToast('Tungguin Debz kelar jawab dulu..');
            return;
        }
        if (!confirm('Hapus session "' + s.title + '"? Semua chat di dalamnya bakal ilang permanen.')) return;
        var wasActive = (id === activeSessionId);
        sessions = sessions.filter(function(x) { return x.id !== id; });
        if (wasActive) {
            if (sessions.length) {
                activeSessionId = sessions[0].id;
            } else {
                activeSessionId = null;
                createSession(null);
            }
            saveStore();
            loadSessionView();
        } else {
            saveStore();
        }
        renderSessionList();
        showToast('Session dihapus!');
    }

    function newChat() {
        if (busy) {
            showToast('Tungguin Debz kelar jawab dulu..');
            return;
        }
        var cur = activeSession();
        if (cur && cur.messages.length === 0) {
            closeSidebar();
            showToast('Udah di chat kosong nih');
            return;
        }
        createSession(null);
        loadSessionView();
        renderSessionList();
        closeSidebar();
        if (window.innerWidth > 600 && input) input.focus();
    }

    function exportChat() {
        if (!messages.length) {
            showToast('Belum ada chat untuk di-export');
            return;
        }
        var markdownData = '# Chat Export - Debz AI\n\n';
        messages.forEach(function(m) {
            var role = m.role === 'user' ? '**You**' : '**Debz AI**';
            markdownData += role + ':\n' + m.content + '\n\n---\n\n';
        });
        var blob = new Blob([markdownData], { type: 'text/markdown' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'debz-chat-' + new Date().toISOString().slice(0,10) + '.md';
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('Chat exported!');
    }

    if (exportBtn) exportBtn.addEventListener('click', exportChat);

    function clearAllChats() {
        var s = activeSession();
        if (s) {
            s.messages = [];
            s.title = 'Chat Baru';
            s.titleSet = false;
            messages = s.messages;
        }
        saveStore();
        if (stream) stream.innerHTML = '';
        resetTypewriter();
        renderSessionList();
        showToast('Chat cleared!');
    }

    if (clearBtnH) {
        clearBtnH.addEventListener('click', function() {
            if (busy) { showToast('Tungguin Debz kelar jawab dulu..'); return; }
            if (confirm('Yakin mau hapus semua chat di session ini?')) clearAllChats();
        });
    }

    /* ==================== Sidebar events ==================== */
    if (sidebarToggleBtn) sidebarToggleBtn.addEventListener('click', openSidebar);
    if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeSidebar);
    if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);
    if (newChatBtn) newChatBtn.addEventListener('click', newChat);

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeSidebar();
    });

    if (sessionListEl) {
        sessionListEl.addEventListener('click', function(e) {
            var target = e.target || e.srcElement;
            if (!target || !target.closest) return;
            var delBtn = target.closest('.session-del');
            if (delBtn) {
                e.stopPropagation();
                deleteSession(delBtn.getAttribute('data-del'));
                return;
            }
            var item = target.closest('.session-item');
            if (item) switchSession(item.getAttribute('data-id'));
        });
    }

    if (sidebarEl) {
        var touchStartX = null;
        sidebarEl.addEventListener('touchstart', function(e) {
            if (!e.touches || !e.touches.length) return;
            touchStartX = e.touches[0].clientX;
        }, { passive: true });
        sidebarEl.addEventListener('touchend', function(e) {
            if (touchStartX === null) return;
            if (!e.changedTouches || !e.changedTouches.length) { touchStartX = null; return; }
            var dx = e.changedTouches[0].clientX - touchStartX;
            if (dx < -50) closeSidebar();
            touchStartX = null;
        }, { passive: true });
    }

    function showProgress(emoji, label) {
        if (!progressBarWrap) return;
        if (progressStatus) {
            progressStatus.style.display = 'none'; 
        }
        progressEmoji.textContent = emoji || '⏳';
        progressLabel.textContent = label || 'Processing...';
        progressBarWrap.classList.add('active');
        progressBarWrap.style.marginBottom = '0px';
        scrollDown();
    }

    function hideProgress() {
        if (progressBarWrap) progressBarWrap.classList.remove('active');
    }

    var lastProgressKey = '';
    var tokenCounter = document.createElement('span');
    tokenCounter.className = 'token-count';
    tokenCounter.textContent = '0 tokens';
    if (progressBarWrap) {
        progressBarWrap.appendChild(tokenCounter);
    }

    /* Elapsed timer: jam berjalan di progress bar biar keliatan proses masih hidup */
    var elapsedSpan = document.createElement('span');
    elapsedSpan.className = 'progress-elapsed';
    elapsedSpan.textContent = '';
    if (progressBarWrap) {
        progressBarWrap.appendChild(elapsedSpan);
    }
    var elapsedTimer = null;

    function startElapsed() {
        stopElapsed();
        var t0 = Date.now();
        if (elapsedSpan) elapsedSpan.textContent = '· 0s';
        elapsedTimer = setInterval(function() {
            if (!elapsedSpan) return;
            var s = Math.floor((Date.now() - t0) / 1000);
            elapsedSpan.textContent = '· ' + s + 's';
        }, 1000);
    }

    function stopElapsed() {
        if (elapsedTimer) clearInterval(elapsedTimer);
        elapsedTimer = null;
        if (elapsedSpan) elapsedSpan.textContent = '';
    }

    var tokenCount = 0;

    function updateProgressFromGlobal() {
        var p = window.lastToolProgress;
        if (p && p.label) {
            var key = p.emoji + '|' + p.label + '|' + p.status;
            if (key !== lastProgressKey) {
                lastProgressKey = key;
                showProgress(p.emoji, p.label);
            }
        }
    }

    var typingLines = ["Inisialisasi sistem otak buatan... ⚙️", "Koneksi server berhasil ✅", "Lagi nungguin lu ngetik nih 🥺", "Mau curhat, Gibah, Coding? Sabi lah 💤"];
    var typingContainer = document.getElementById('typing-container');
    var typeLineIdx = 0;
    var typeCharIdx = 0;
    var typeTimeout = null;
    var currentSpan = null;
    var cursorSpan = document.createElement('span');
    cursorSpan.className = 'cursor-blink';
    var currentChars = [];

    function runTypewriter() {
        if (!emptyEl || emptyEl.style.display === 'none') return;
        if (typeLineIdx < typingLines.length) {
            if (typeCharIdx === 0) {
                currentChars = [...typingLines[typeLineIdx]];
                currentSpan = document.createElement('span');
                currentSpan.className = 'typewriter-text';
                if(typingContainer) {
                    typingContainer.appendChild(currentSpan);
                    typingContainer.appendChild(cursorSpan);
                }
            }
            if (typeCharIdx < currentChars.length) {
                currentSpan.innerHTML += currentChars[typeCharIdx];
                typeCharIdx++;
                typeTimeout = setTimeout(runTypewriter, 40);
            } else {
                typeLineIdx++;
                typeCharIdx = 0;
                typeTimeout = setTimeout(runTypewriter, 800);
            }
        } else {
            if(cursorSpan && cursorSpan.parentNode) cursorSpan.remove();
        }
    }

    if (emptyEl && typingContainer) typeTimeout = setTimeout(runTypewriter, 300);

    window.copyCode = function(btn) {
        var pre = btn.closest('.code-wrapper').querySelector('pre');
        var code = pre ? pre.innerText : '';
        navigator.clipboard.writeText(code).then(function() {
            btn.textContent = '✓ Copied';
            btn.classList.add('copied');
            setTimeout(function() {
                btn.textContent = 'Copy';
                btn.classList.remove('copied');
            }, 2000);
        }).catch(function() {
            btn.textContent = '✗ Gagal';
            setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
        });
    };

    function applyHighlighting() {
        if (typeof hljs !== 'undefined') {
            document.querySelectorAll('pre code:not(.hljs)').forEach(function(block) {
                hljs.highlightElement(block);
            });
        }
    }

    /* ============ Init sessions ============ */
    loadStore();
    loadSessionView();

    function persist() {
        var s = activeSession();
        if (s) {
            s.updatedAt = Date.now();
            if (!s.titleSet) {
                var firstUser = null;
                for (var i = 0; i < s.messages.length; i++) {
                    if (s.messages[i].role === 'user' && s.messages[i].content) {
                        firstUser = s.messages[i].content;
                        break;
                    }
                }
                if (firstUser) {
                    s.title = cleanTitle(firstUser);
                    s.titleSet = true;
                }
            }
        }
        saveStore();
        renderSessionList();
    }

    function md(text){
        if (!text) return '';
        var s = text.replace(/\[\d+\.\d+:\d+\.\d+\]\s*/g, '');
        var codeBlocks = [];
        
        s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, function(match, lang, code) {
            lang = lang || 'text';
            var idx = codeBlocks.length;
            var escapedCode = escapeHTML(code.replace(/^\n+|\n+$/g,''));
            codeBlocks.push('<div class="code-wrapper"><div class="code-header"><span>' + escapeHTML(lang) + '</span><button class="copy-btn" onclick="copyCode(this)">Copy</button></div><pre><code class="language-' + escapeHTML(lang) + '">' + escapedCode + '</code></pre></div>');
            return '\x00CB' + idx + '\x00';
        });

        var inlineCodes = [];
        s = s.replace(/`([^`\n]+)`/g, function(match, code) {
            var idx = inlineCodes.length;
            inlineCodes.push('<code>' + escapeHTML(code) + '</code>');
            return '\x00IC' + idx + '\x00';
        });

        s = escapeHTML(s);
        s = s.replace(/^(\|.+\|)\n(\|[\s\-:|]+\|)\n((?:\|.+\|\n?)*)/gm, function(match, header, sep, body) {
            var headers = header.split('|').filter(function(c){ return c.trim(); });
            var rows = body.trim().split('\n');
            var html = '<table><thead><tr>';
            headers.forEach(function(h) { html += '<th>' + h.trim() + '</th>'; });
            html += '</tr></thead><tbody>';
            rows.forEach(function(row) {
                var cells = row.split('|').filter(function(c){ return c.trim(); });
                html += '<tr>';
                cells.forEach(function(c) { html += '<td>' + c.trim() + '</td>'; });
                html += '</tr>';
            });
            html += '</tbody></table>';
            return html;
        });

        s = s.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
        s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        s = s.replace(/^---+$/gm, '<hr>');
        s = s.replace(/^> (.+)$/gm, 'blockquote>$1</blockquote>');
        s = s.replace(/<\/blockquote>\n<blockquote>/g, '<br>');
        s = s.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
        s = s.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
        s = s.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
        s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
        s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
        s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
        s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        s = s.replace(/\n\n+/g, '</p><p>');
        s = s.replace(/\n/g, '<br>');

        inlineCodes.forEach(function(code, idx) { s = s.replace('\x00IC' + idx + '\x00', code); });
        codeBlocks.forEach(function(block, idx) { s = s.replace('\x00CB' + idx + '\x00', block); });

        if (!s.startsWith('<')) s = '<p>' + s + '</p>';
        return s;
    }

    function escapeHTML(str){
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    }

    function checkOverflow(wrap) {
        var textDiv = wrap.querySelector('.msg-text');
        var toggleBtn = wrap.querySelector('.expand-toggle');
        if (!textDiv || !toggleBtn) return;
        textDiv.classList.remove('collapsed');
        if (textDiv.scrollHeight > 300) {
            textDiv.classList.add('collapsed');
            toggleBtn.style.display = 'inline-flex';
            toggleBtn.classList.remove('expanded');
            toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg> Show more';
        } else {
            toggleBtn.style.display = 'none';
        }
    }

    function formatTime(ts) {
        if (!ts) return '';
        var d = new Date(ts);
        return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    }

    function renderMessage(role, htmlContent, withAnim, isStreaming, timestamp){
        if (emptyEl) {
            emptyEl.style.display = 'none';
            if (typeTimeout) clearTimeout(typeTimeout);
        }
        var wrap = document.createElement('div');
        wrap.className = 'msg ' + role;
        if (withAnim !== false) wrap.style.animation = 'msgIn 0.3s ease-out';
        var avatarHtml = role === 'user' ? '<div class="msg-avatar-wrap"><div class="msg-avatar">😄</div></div>' : '<div class="msg-avatar-wrap"><span class="ai-name">DEBZ</span><div class="msg-avatar">🤖</div></div>';
        var ts = timestamp || Date.now();
        var timeStr = formatTime(ts);
        var bubbleInner = '<div class="msg-text">' + htmlContent + '</div>' + 
                          '<div class="expand-toggle" style="display:none"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg> Show more</div>';
        var actionsHtml = '';
        if (role === 'assistant' && !isStreaming) {
            actionsHtml = '<div class="msg-actions"><button class="msg-action-btn" onclick="copyMsgText(this)" data-msg-idx="' + (messages.length) + '"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</button><button class="msg-action-btn" onclick="regenerateMsg(this)" data-msg-idx="' + (messages.length) + '"><svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>Regen</button></div>';
        } else if (role === 'user') {
            actionsHtml = '<div class="msg-actions"><button class="msg-action-btn" onclick="copyMsgText(this)" data-msg-idx="' + (messages.length) + '"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</button></div>';
        }
        wrap.innerHTML = avatarHtml + '<div class="msg-body"><div class="msg-bubble">' + bubbleInner + '</div>' + actionsHtml + '<div class="msg-timestamp">' + timeStr + '</div></div>';
        var toggleBtn = wrap.querySelector('.expand-toggle');
        var textDiv = wrap.querySelector('.msg-text');
        toggleBtn.addEventListener('click', function() {
            if (textDiv.classList.contains('collapsed')) {
                textDiv.classList.remove('collapsed');
                toggleBtn.classList.add('expanded');
                toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg> Show less';
            } else {
                textDiv.classList.add('collapsed');
                toggleBtn.classList.remove('expanded');
                toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg> Show more';
                wrap.scrollIntoView({behavior: 'smooth', block: 'nearest'});
            }
        });
        if (stream) stream.appendChild(wrap);
        if (!isStreaming) setTimeout(function() { checkOverflow(wrap); }, 50);
        scrollDown();
        return wrap;
    }

    window.copyMsgText = function(btn) {
        var msgWrap = btn.closest('.msg');
        var textDiv = msgWrap.querySelector('.msg-text');
        var text = textDiv.innerText || textDiv.textContent;
        navigator.clipboard.writeText(text).then(function() {
            btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>Copied';
            btn.classList.add('copied');
            setTimeout(function() {
                btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy';
                btn.classList.remove('copied');
            }, 2000);
        }).catch(function() {
            btn.innerHTML = '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Error';
            setTimeout(function() { btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy'; }, 2000);
        });
    };

    window.regenerateMsg = function(btn) {
        if (busy) return;
        var idx = parseInt(btn.getAttribute('data-msg-idx'));
        if (isNaN(idx) || idx < 1) return;
        btn.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"><animate attributeName="stroke-dasharray" from="0 63" to="63 0" dur="1s" repeatCount="indefinite"/></circle></svg>Regen..';
        btn.disabled = true;
        var lastAssistantIdx = -1;
        for (var i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant') {
                lastAssistantIdx = i;
                break;
            }
        }
        if (lastAssistantIdx === -1) return;
        messages.splice(lastAssistantIdx, 1);
        var allMsgs = stream.querySelectorAll('.msg.assistant');
        if (allMsgs.length) allMsgs[allMsgs.length - 1].remove();
        persist();
        var lastUserMsg = '';
        for (var j = messages.length - 1; j >= 0; j--) {
            if (messages[j].role === 'user') {
                lastUserMsg = messages[j].content;
                break;
            }
        }
        if (lastUserMsg && form) {
            input.value = lastUserMsg;
            form.dispatchEvent(new Event('submit'));
        }
    };

    function scrollDown(force) {
        if (!stream) return;
        var threshold = 80;
        var isAtBottom = (stream.scrollHeight - stream.scrollTop - stream.clientHeight) <= threshold;
        if (force || isAtBottom) {
            stream.scrollTop = stream.scrollHeight;
        }
    }

    function setBusy(state){
        busy = state;
        if (input) input.disabled = state;
        if (state) {
            if (sendArrow) sendArrow.style.display = 'none';
            if (sendLoader) sendLoader.style.display = 'flex';
        } else {
            if (sendArrow) sendArrow.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
            if (sendArrow) sendArrow.style.display = 'inline-block';
            if (sendLoader) sendLoader.style.display = 'none';
        }
    }

    function resetInputHeight() {
        if (!input) return;
        input.style.height = '42px';
        input.style.overflowY = 'hidden';
        if (composerWrap) composerWrap.style.borderRadius = '30px';
    }

    function updateCharCount() {
        if (!charCountEl || !input) return;
        var len = input.value.length;
        if (len === 0) {
            charCountEl.textContent = '';
            charCountEl.className = 'char-count';
        } else {
            charCountEl.textContent = len + ' / ' + MAX_CHARS;
            if (len > MAX_CHARS * 0.9) charCountEl.className = 'char-count danger';
            else if (len > MAX_CHARS * 0.75) charCountEl.className = 'char-count warn';
            else charCountEl.className = 'char-count';
        }
    }

    if (input) {
        input.addEventListener('input', function(){
            this.style.height = '42px';
            var newHeight = Math.min(this.scrollHeight, 150);
            this.style.height = newHeight + 'px';
            if (this.scrollHeight > 50) {
                if (composerWrap) composerWrap.style.borderRadius = '20px';
            } else {
                if (composerWrap) composerWrap.style.borderRadius = '30px';
            }
            if (this.scrollHeight > 150) {
                this.style.overflowY = 'auto';
            } else {
                this.style.overflowY = 'hidden';
            }
            updateCharCount();
        });
        input.addEventListener('keydown', function(e) {
            var isMobile = window.innerWidth <= 768;
            if (e.key === 'Enter' && !e.shiftKey) {
                if (!isMobile && form) {
                    e.preventDefault(); 
                    form.dispatchEvent(new Event('submit'));
                }
            }
        });
    }

    if (uploadBtn && fileInput) {
        uploadBtn.addEventListener('click', function() { fileInput.click(); });
        fileInput.addEventListener('change', function() {
            if (this.files && this.files.length > 0) {
                for (var i = 0; i < this.files.length; i++) {
                    selectedFiles.push(this.files[i]);
                }
                renderAttachmentPreviews();
                fileInput.value = '';
            }
        });
    }

    function renderAttachmentPreviews() {
        if (!attachmentPreview) return;
        if (selectedFiles.length === 0) {
            attachmentPreview.style.display = 'none';
            attachmentPreview.innerHTML = '';
            return;
        }
        attachmentPreview.style.display = 'flex';
        var html = '';
        selectedFiles.forEach(function(file, index) {
            var isImage = file.type.startsWith('image/');
            if (isImage) {
                var objectUrl = URL.createObjectURL(file);
                html += '<div style="position: relative; width: 60px; height: 60px; border-radius: 8px; overflow: hidden; border: 1px solid #333; flex-shrink: 0;"><img src="' + objectUrl + '" style="width: 100%; height: 100%; object-fit: cover;"><button type="button" onclick="removeAttachment(' + index + ')" style="position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,0.7); color: #fff; border: none; border-radius: 50%; width: 18px; height: 18px; font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center;">✕</button></div>';
            } else {
                html += '<div style="position: relative; display: flex; align-items: center; gap: 6px; background: #222; padding: 6px 10px; border-radius: 8px; border: 1px solid #333; font-size: 12px; color: #fff; flex-shrink: 0;"><span>📄 ' + escapeHTML(file.name) + '</span><button type="button" onclick="removeAttachment(' + index + ')" style="background: transparent; color: #aaa; border: none; cursor: pointer; font-size: 14px;">✕</button></div>';
            }
        });
        attachmentPreview.innerHTML = html;
    }

    window.removeAttachment = function(index) {
        selectedFiles.splice(index, 1);
        renderAttachmentPreviews();
    };

    if (form) {
        form.addEventListener('submit', async function(e){
            e.preventDefault();
            if (busy) return;
            var text = input ? input.value.trim() : '';
            if (!text && selectedFiles.length === 0) return;
            if (text.length > MAX_CHARS) {
                showToast('Terlalu panjang! Max ' + MAX_CHARS + ' karakter.');
                return;
            }
            var filesToSend = [...selectedFiles];
            var localPreviews = filesToSend.map(function(file) {
                return { isImage: file.type.startsWith('image/'), url: URL.createObjectURL(file), name: file.name };
            });
            if (input) input.value = '';
            resetInputHeight();
            updateCharCount();
            selectedFiles = [];
            renderAttachmentPreviews();

            var ts = Date.now();
            var displayContent = text;
            if (localPreviews.length > 0) {
                displayContent += '<div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px;">';
                localPreviews.forEach(function(item) {
                    if (item.isImage) {
                        displayContent += '<div style="width: 70px; height: 70px; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,0.2); flex-shrink: 0;"><img src="' + item.url + '" style="width: 100%; height: 100%; object-fit: cover;"></div>';
                    } else {
                        displayContent += '<div style="background: rgba(0,0,0,0.2); padding: 4px 8px; border-radius: 4px; font-size: 11px;">📄 ' + escapeHTML(item.name) + '</div>';
                    }
                });
                displayContent += '</div>';
            }
            messages.push({ role: 'user', content: displayContent, timestamp: ts });
            renderMessage('user', displayContent, true, false, ts);
            persist();

            var placeholder = renderMessage('assistant', '<div style="display: flex; align-items: center; gap: 8px;"><div class="typing-indicator"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div><span style="font-size: 11px; color: #86868b; font-style: italic;">tunggu debz lagi mikir..</span></div>', true, true);
            var assistantIndex = messages.length;
            messages.push({ role: 'assistant', content: '', timestamp: ts });

            setBusy(true);
            lastProgressKey = '';
            abortController = new AbortController();

            try {
                var systemPrompt = 'Lu adalah Debz AI, asisten virtual santai. Gunakan bahasa gaul Indonesia (gue, lu). DILARANG keras menyertakan format timestamp seperti atau format subtitle. Jawab natural. Kamu bisa membantu coding, curhat, bahas apa aja. Gunakan markdown untuk code block, bold, dll saat diperlukan.';
                var formData = new FormData();
                var historyPayload = [{ role: 'system', content: systemPrompt }].concat(
                    messages.slice(0, assistantIndex).map(function(m){
                        return { role: m.role, content: m.content };
                    })
                );
                formData.append('messages', JSON.stringify(historyPayload));
                formData.append('prompt', text);
                formData.append('max_tokens', 10000000);
                formData.append('run_mode', '1');
                
                filesToSend.forEach(function(file) { formData.append('images[]', file); });

                var response = await fetch(API_URL, {
                    method: 'POST',
                    signal: abortController.signal,
                    body: formData
                });

                if (!response.ok) {
                    placeholder.querySelector('.msg-text').innerHTML = '<span style="color:#fca5a5;">⚠️ HTTP Error ' + response.status + ' - ' + response.statusText + '</span>';
                    messages[assistantIndex].content = '[error] HTTP ' + response.status;
                    persist();
                    hideProgress();
                    setBusy(false);
                    return;
                }

                var reader = response.body.getReader();
                var decoder = new TextDecoder("utf-8");
                var fullContent = '';
                var bubbleText = placeholder.querySelector('.msg-text');
                var buffer = '';
                var doneReceived = false;

                var watchdogTimer = null;
                var lastHeartbeat = Date.now();
                function resetWatchdog() {
                    lastHeartbeat = Date.now();
                    if (watchdogTimer) clearTimeout(watchdogTimer);
                    if (document.hidden) return; 
                    watchdogTimer = setTimeout(function() {
                        if (abortController) {
                            abortController.abort();
                            showToast('Koneksi ke server mati (heartbeat berhenti)');
                        }
                    }, 180000); 
                }
                showProgress('🤖', 'Mikir dulu...');
                startElapsed();
                resetWatchdog();

                while (true) {
                    var result = await reader.read();
                    if (result.done) break;
                    resetWatchdog();

                    buffer += decoder.decode(result.value, { stream: true });
                    var lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (var i = 0; i < lines.length; i++) {
                        var line = lines[i].trim();
                        if (!line) continue;
                        // Ping keepalive dari server — bukti koneksi masih hidup
                        if (line === ': ka') { resetWatchdog(); continue; }
                        if (line === '[DONE]') { doneReceived = true; resetWatchdog(); continue; }
                        if (line.startsWith('data:')) line = line.substring(5).trim();

                        try {
                            var parsed = JSON.parse(line);

                            if (parsed.error) {
                                var errMsgAPI = typeof parsed.error === 'string' ? parsed.error : (parsed.error.message || JSON.stringify(parsed.error));
                                fullContent += "\n\n⚠️ **API Error:** " + errMsgAPI;
                                bubbleText.innerHTML = md(fullContent);
                                scrollDown();
                                continue;
                            }

                            if (parsed.type === 'status') {
                                if (parsed.phase === 'thinking') showProgress('🧠', 'Muter Otak');
                                else if (parsed.phase === 'writing') showProgress('✍️', 'Debz lagi nulis jawaban...');
                                continue;
                            }
                            if (parsed.type === 'tool') {
                                if (parsed.phase === 'start') {
                                    showProgress('🛠️', (parsed.name || 'Tool') + (parsed.detail ? ': ' + parsed.detail : ''));
                                } else if (parsed.phase === 'result' && parsed.summary) {
                                    showProgress('✅', (parsed.name || 'Tool') + ' · ' + parsed.summary);
                                }
                                continue;
                            }
                            if (parsed.type === 'usage') {
                                if (parsed.total_tokens > 0) {
                                    tokenCount = parsed.total_tokens;
                                    tokenCounter.textContent = tokenCount + ' tokens';
                                }
                                continue;
                            }

                            if (parsed.status || parsed.progress) {
                                showProgress(parsed.emoji || '⚙️', parsed.status || parsed.progress);
                                continue;
                            }

                            if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.tool_calls) {
                                var toolName = parsed.choices[0].delta.tool_calls[0].function.name;
                                if (toolName) showProgress('🛠️', 'Menjalankan: ' + toolName);
                            }
                            
                            var delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
                            var piece = (delta && delta.content) || (parsed.message && parsed.message.content) || parsed.response || (parsed.choices && parsed.choices[0] && parsed.choices[0].text) || '';
                            
                            if (piece) {
                                fullContent += piece;
                                var tempContent = fullContent;
                                var matches = tempContent.match(/```/g);
                                if (matches && matches.length % 2 !== 0) tempContent += '\n```';
                                bubbleText.innerHTML = md(tempContent);
                                scrollDown();
                            }
                        } catch(e) {}
                    }
                }
                if (watchdogTimer) clearTimeout(watchdogTimer);
                stopElapsed();

                if (!fullContent && !doneReceived) fullContent = "⚠️ Maaf, Gak ada balesan..";

                // Ending pasti: kelar beneran, atau stream keputus tanpa DONE
                if (!doneReceived && fullContent && fullContent.indexOf('⚠️') !== 0) {
                    fullContent += '\n\n*— stream terputus sebelum selesai —*';
                } else if (doneReceived && !fullContent) {
                    fullContent = fullContent || '⚠️ Maaf, Gak ada balesan..';
                }
                bubbleText.innerHTML = md(fullContent);
                messages[assistantIndex].content = fullContent;
                messages[assistantIndex].timestamp = Date.now();
                persist();
                checkOverflow(placeholder);

                var msgBody = placeholder.querySelector('.msg-body');
                if (msgBody && !msgBody.querySelector('.msg-actions')) {
                    var actionsHtml = '<div class="msg-actions"><button class="msg-action-btn" onclick="copyMsgText(this)" data-msg-idx="' + assistantIndex + '"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</button><button class="msg-action-btn" onclick="regenerateMsg(this)" data-msg-idx="' + assistantIndex + '"><svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>Regen</button></div>';
                    msgBody.insertAdjacentHTML('beforeend', actionsHtml);
                }
                hideProgress();
                
            } catch(err) {
                console.error(err);
                stopElapsed();
                var errDetail = err.message ? err.message : String(err);
                if (err.name === 'AbortError') {
                    var currentSavedText = fullContent ? fullContent + '\n\n*(Dibatalkan)*' : '\n\n*(Dibatalkan)*';
                    placeholder.querySelector('.msg-text').innerHTML = md(currentSavedText);
                    messages[assistantIndex].content = currentSavedText;
                    persist();
                } else {
                    var errText = fullContent ? fullContent + '\n\n⚠️ Error: ' + errDetail : '⚠️ Error: ' + errDetail;
                    placeholder.querySelector('.msg-text').innerHTML = md(errText);
                    messages[assistantIndex].content = errText;
                    persist();
                }
                hideProgress();
            } finally {
                abortController = null;
                setBusy(false);
                lastProgressKey = '';
                if(window.innerWidth > 600 && input) input.focus();
            }
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', function(){
            if (!confirm('Yakin mau hapus semua obrolan?')) return;
            clearAllChats();
        });
    }

    if (sendBtn) {
        sendBtn.addEventListener('click', function(e) {
            if (busy && abortController) {
                e.preventDefault();
                abortController.abort();
            }
        });
    }

    document.querySelectorAll('.suggestion-chip').forEach(function(chip) {
        chip.addEventListener('click', function() {
            if (input) input.value = this.textContent;
            if (input) input.focus();
            updateCharCount();
            if (form) form.dispatchEvent(new Event('submit'));
        });
    });
})();
