<?php
session_start();

$ip = $_SERVER['REMOTE_ADDR'];
$is_local = in_array($ip, ['127.0.0.1', '::', '::1']) 
            || $_SERVER['SERVER_NAME'] === 'localhost'
            || strpos($ip, '192.168.') === 0 
            || strpos($ip, '10.') === 0;

if (isset($_GET['logout'])) {
    $_SESSION = [];
    session_destroy();
    header('Location: ' . strtok($_SERVER['REQUEST_URI'], '?'));
    exit;
}

define('AUTH_PASSWORD', 'local-agent-2026');

$ip = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
$lock_file = sys_get_temp_dir() . '/lock_' . md5($ip) . '.json';
$max_attempts = 5;
$lockout_time = 900;
$attempts = 0;
$last_attempt = 0;
$error = '';

if (file_exists($lock_file)) {
    $data = json_decode(file_get_contents($lock_file), true);
    $attempts = $data['attempts'] ?? 0;
    $last_attempt = $data['last_attempt'] ?? 0;
    
    if ($attempts >= $max_attempts && (time() - $last_attempt) < $lockout_time) {
        http_response_code(429);
        die('<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Locked</title><style>body{background:#0f0f14;color:#ff453a;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;}</style></head><body><div><h2>Akses Diblokir</h2><p>Terlalu banyak percobaan. Coba lagi nanti.</p></div></body></html>');
    } elseif ((time() - $last_attempt) >= $lockout_time) {
        $attempts = 0;
    }
}

if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['auth_password'], $_POST['csrf_token'])) {
    if (hash_equals($_SESSION['csrf_token'], $_POST['csrf_token'])) {
        if (hash_equals(hash('sha256', AUTH_PASSWORD), hash('sha256', $_POST['auth_password']))) {
            $_SESSION['authenticated'] = true;
            session_regenerate_id(true);
            if (file_exists($lock_file)) unlink($lock_file);
            header('Location: ' . $_SERVER['REQUEST_URI']);
            exit;
        } else {
            $attempts++;
            file_put_contents($lock_file, json_encode(['attempts' => $attempts, 'last_attempt' => time()]));
            $error = 'Akses Ditolak.';
        }
    } else {
        $error = 'Sesi tidak valid.';
    }
}

if (empty($_SESSION['authenticated'])) {
    ?>
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>Restricted Access</title>
        <style>
            * { box-sizing: border-box; }
            body { margin: 0; padding: 0; height: 100vh; display: flex; justify-content: center; align-items: center; background: #0f0f14; font-family: 'Saira', sans-serif; }
            .login-box { background: #151516; border: 1px solid #2c2c2e; padding: 30px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); width: 90%; max-width: 350px; text-align: center; }
            .login-box h2 { color: #f5f5f7; margin-top: 0; font-size: 16px; margin-bottom: 20px; letter-spacing: 1px; }
            .input-group { margin-bottom: 15px; }
            .input-group input { width: 100%; padding: 12px; background: #1c1c1e; border: 1px solid #3a3a3c; color: #f5f5f7; border-radius: 6px; font-family: inherit; font-size: 14px; outline: none; transition: 0.2s; text-align: center; }
            .input-group input:focus { border-color: #34c759; }
            button { width: 100%; padding: 12px; background: #34c759; color: #000; border: none; border-radius: 6px; font-family: inherit; font-size: 14px; font-weight: 700; cursor: pointer; transition: 0.2s; }
            button:hover { background: #2ebd4e; }
            .error { color: #ff453a; font-size: 12px; margin-bottom: 15px; }
        </style>
    </head>
    <body>
        <div class="login-box">
            <h2>AUTHENTICATION REQUIRED</h2>
            <?php if ($error): ?><div class="error"><?= htmlspecialchars($error) ?></div><?php endif; ?>
            <form method="POST">
                <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($_SESSION['csrf_token']) ?>">
                <div class="input-group">
                    <input type="password" name="auth_password" placeholder="Password" required autofocus>
                </div>
                <button type="submit">ENTER</button>
            </form>
        </div>
    </body>
    </html>
    <?php
    exit;
}

if (!defined('BASE_URL')) define('BASE_URL', '');
if (!defined('ROOT_PATH')) define('ROOT_PATH', __DIR__);

$page_title    = $page_title ?? 'c0n73xt';
$page_desc     = $page_desc ?? 'Priv8 c0n73xt';
$page_path     = $page_path ?? '♾️ C0N73XT';

// Force no-cache agar browser selalu load versi terbaru
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');

function get_file_version($path) {
    $full_path = ROOT_PATH . $path;
    return file_exists($full_path) ? filemtime($full_path) : time();
}
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title><?= htmlspecialchars($page_title) ?></title>
    <link rel="icon" href="<?= BASE_URL ?>/favicon.ico" type="image/x-icon">
    <link rel="icon" type="image/png" sizes="16x16" href="<?= BASE_URL ?>/favicon-16x16.png">
    <link rel="icon" type="image/png" sizes="32x32" href="<?= BASE_URL ?>/favicon-32x32.png">
    <link rel="apple-touch-icon" sizes="180x180" href="<?= BASE_URL ?>/apple-touch-icon.png">
    <link href="<?= BASE_URL ?>/css/external/hurmit-nerd-font.css?v=<?= get_file_version('/css/external/hurmit-nerd-font.css') ?>" rel="stylesheet">
    <link href="<?= BASE_URL ?>/css/external/720887c719-css2.css?v=<?= get_file_version('/css/external/720887c719-css2.css') ?>" rel="stylesheet">
    <link href="<?= BASE_URL ?>/css/external/b3fd2d7bf9-atom-one-dark.min.css?v=<?= get_file_version('/css/external/b3fd2d7bf9-atom-one-dark.min.css') ?>" rel="stylesheet">
    <link href="<?= BASE_URL ?>/c0n73xt/chat-ui.css?v=<?= get_file_version('/c0n73xt/chat-ui.css') ?>" rel="stylesheet">
</head>
<body>

    <div class="sidebar-backdrop" id="sidebar-backdrop"></div>

    <aside class="session-sidebar" id="session-sidebar" aria-label="Daftar session chat">
        <div class="sidebar-header">
            <div class="sidebar-title-wrap">
                <span class="sidebar-logo">🗂️</span>
                <span class="sidebar-title">Sessions</span>
            </div>
            <button type="button" class="sidebar-close" id="sidebar-close" title="Tutup sidebar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
        <button type="button" class="new-chat-btn" id="new-chat-btn" title="Buat chat baru">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>Chat Baru</span>
        </button>
        <div class="session-list" id="session-list"></div>
        <div class="sidebar-footer">
            <span class="sidebar-count" id="session-count">0 sessions</span>
            <span class="sidebar-hint">geser kiri / ESC untuk tutup</span>
        </div>
    </aside>

    <div class="article-wrapper">
        <div class="chat-header">
            <div class="header-left">
                <button type="button" class="header-btn sidebar-toggle" id="sidebar-toggle" title="Sessions / Riwayat Chat">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
                </button>
                <span class="status-dot"></span>
                <span class="status-text"><strong>Debz AI</strong> &middot; Siap ✨</span>
            </div>
            <div class="header-right" style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
                <button type="button" class="header-btn export-btn" title="Export Chat">Export</button>
                <button type="button" class="header-btn clear-btn" title="Hapus Chat">Hapus</button>
                <a href="?logout=1" class="header-btn logout-btn">Logout</a>
            </div>
        </div>

        <div class="chat-stream" id="chat-stream">
            <div class="chat-empty" id="chat-empty">
                <div class="empty-avatar">🤖</div>
                <div id="typing-container" class="typing-container"></div>
                <div class="suggestions">
                    <span class="suggestion-chip">HALLO ?</SPAN>
                    <Span class="suggestion-chip">INFO ARTIKEL TECH VIRAL HARI INI !</span>
                    <span class="suggestion-chip">BANTU DEBUG ERROR DONG !</span>
                    <span class="suggestion-chip">BUATIN PROJEK BARU !</span>
                </div>
            </div>
        </div>

        <div class="progress-bar-wrap" id="progress-bar-wrap">
            <div class="progress-spinner" id="progress-spinner"></div>
            <span class="progress-emoji" id="progress-emoji">⏳</span>
            <span class="progress-label" id="progress-label">Proses...</span> 
        </div>

        <form class="chat-composer" id="composer" autocomplete="off">
            <div id="attachment-preview" style="display: none; padding: 8px; gap: 8px; overflow-x: auto; align-items: center;"></div>
            <div class="composer-row"> 
                <button type="button" id="upload-btn" title="Upload File" style="background: transparent; border: none; color: #86868b; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 8px; border-radius: 50%; transition: 0.2s;">
                    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2.2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                </button>
                <input type="file" id="file-input" multiple accept="image/*,.pdf,.txt" style="display: none;">
  
                <textarea id="message-input" placeholder="✏️️" rows="1"></textarea>
                <button type="submit" id="send-btn">
                    <span id="send-arrow">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 19V5M5 12l7-7 7 7"/>
                        </svg>
                    </span>
                    <span class="send-loader" id="send-loader" style="display:none"></span>
                </button>
            </div>
        </form>
    </div>

    <div class="toast" id="toast"></div>

    <script src="<?= BASE_URL ?>/js/external/a46e01eb6c-highlight.min.js?v=<?= get_file_version('/js/external/a46e01eb6c-highlight.min.js') ?>"></script>
    <script src="<?= BASE_URL ?>/c0n73xt/chat-ui.js?v=<?= get_file_version('/c0n73xt/chat-ui.js') ?>"></script>
</body>
</html>
