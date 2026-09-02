# local-agent-chat-ui

Custom Chat WebUI untuk local AI automation agents — PHP + vanilla JS, streaming SSE, upload gambar, session sidebar, terminal bridge (FastAPI WebSocket).

## Struktur

Repo ini **mirror web root**. Isi repo ditaruh di document root server, UI diakses lewat path `/c0n73xt/`:

```
/                       <- taruh isi repo ini di sini (document root)
├── c0n73xt/            <- aplikasi utama (akses via http://localhost/c0n73xt/)
│   ├── index.php       <- halaman login + chat UI
│   ├── api.php         <- SSE proxy ke AI endpoint (OpenAI-compatible)
│   ├── chat-ui.js      <- logic UI (chat, session, upload)
│   ├── chat-ui.css     <- styling
│   ├── backend.py      <- terminal bridge (FastAPI + WebSocket, port 8000, opsional)
│   ├── .ai-config.ini  <- konfigurasi AI (API key, endpoint, model)
│   └── .htaccess       <- protect file config dari akses langsung
├── css/external/       <- fonts & stylesheet external (offline, no CDN)
├── js/external/        <- highlight.js (offline)
└── favicon.ico, favicon-*.png, apple-touch-icon.png
```

## Setup

1. **Konfigurasi AI** — edit `c0n73xt/.ai-config.ini`:

   ```ini
   AI_API_KEY=YOUR_API_KEY_HERE
   AI_ENDPOINT=https://api.openai.com/v1/chat/completions
   AI_MODEL=gpt-4o-mini
   ```

   Endpoint harus OpenAI-compatible. Untuk server lokal (mis. llama.cpp / vLLM / LM Studio), pakai misalnya `http://localhost:8642/v1/chat/completions`.

2. **Password login** — ubah konstanta di `c0n73xt/index.php`:

   ```php
   define('AUTH_PASSWORD', 'local-agent-2026');
   ```

3. **Jalankan web server** (salah satu):

   ```bash
   # PHP built-in (cepet buat tes):
   php -S 0.0.0.0:666 -t .
   # lalu buka http://localhost:666/c0n73xt/

   # atau Apache/NGINX: taruh isi repo di document root,
   # pastikan PHP + mod_rewrite aktif.
   ```

4. **(Opsional) Terminal bridge** — kalau mau fitur terminal via WebSocket:

   ```bash
   pip install fastapi uvicorn
   python3 c0n73xt/backend.py   # jalan di port 8000
   ```

## Catatan

- Semua asset (font, highlight.js) di-serve lokal dari repo — gak ada dependency CDN, jadi jalan mulus offline.
- `api.php` stream respons AI via SSE (text/event-stream) dan auto-retry heartbeat.
- File `.htaccess` menolak akses langsung ke file `.ini/.env/.log` (Apache saja; `php -S` mengabaikannya).
