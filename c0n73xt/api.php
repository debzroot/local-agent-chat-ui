<?php

set_time_limit(0);
ini_set('max_execution_time', '0');

while (ob_get_level() > 0) { ob_end_clean(); }

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit(0);
}

$configFile = __DIR__ . '/.ai-config.ini';
$config = file_exists($configFile) ? parse_ini_file($configFile) : [];
$apiKey = $config['AI_API_KEY'] ?? '';
$model = $config['AI_MODEL'] ?? 'gpt-4o-mini';

// Endpoint responses: prioritas AI_ENDPOINT_RESPONSES, kalau kosong diturunkan dari AI_ENDPOINT
$responsesEndpoint = trim($config['AI_ENDPOINT_RESPONSES'] ?? '');
if ($responsesEndpoint === '') {
    $base = trim($config['AI_ENDPOINT'] ?? 'https://api.openai.com/v1/chat/completions');
    $responsesEndpoint = preg_replace('#/chat/completions$#', '/responses', $base);
    if ($responsesEndpoint === $base) {
        $responsesEndpoint = rtrim($base, '/') . '/responses';
    }
}

/* ============ action=model (dipertahankan dari versi lama) ============ */
if (isset($_GET['action']) && $_GET['action'] === 'model') {
    header('Content-Type: application/json');
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        echo json_encode(['model' => $model]);
        exit;
    }
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $inputData = json_decode(file_get_contents('php://input'), true);
        $newModel = $inputData['model'] ?? '';
        if (empty($newModel)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Model tidak boleh kosong']);
            exit;
        }
        if (file_exists($configFile)) {
            $content = file_get_contents($configFile);
            $content = preg_replace('/^AI_MODEL\s*=.*$/m', 'AI_MODEL = ' . $newModel, $content);
            if (strpos($content, 'AI_MODEL') === false) {
                $content = rtrim($content) . "\nAI_MODEL = " . $newModel . "\n";
            }
            file_put_contents($configFile, $content);
        } else {
            file_put_contents($configFile, "AI_MODEL = " . $newModel . "\n");
        }
        echo json_encode(['success' => true, 'model' => $newModel]);
        exit;
    }
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

if (empty($apiKey) || $apiKey === 'YOUR_API_KEY_HERE') {
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode(['error' => 'AI_API_KEY not configured. Edit .ai-config.ini.']);
    exit;
}

/* ============ Ambil input ============ */
$messages = [];
if (!empty($_POST['messages'])) {
    $messages = json_decode($_POST['messages'], true);
}
if (empty($messages)) {
    $inputRaw = file_get_contents('php://input');
    $input = json_decode($inputRaw, true);
    if (!empty($input['messages'])) $messages = $input['messages'];
}
if (empty($messages) || !is_array($messages)) {
    header('Content-Type: application/json');
    http_response_code(400);
    echo json_encode(['error' => 'Invalid request / messages empty']);
    exit;
}

/* ============ SSE headers ============ */
header('Content-Type: text/event-stream; charset=utf-8');
header('Cache-Control: no-cache, no-transform');
header('Connection: keep-alive');
header('X-Accel-Buffering: no');

@ini_set('output_buffering', 'off');
@ini_set('zlib.output_compression', 'Off');
@ini_set('implicit_flush', true);
if (function_exists('apache_setenv')) {
    @apache_setenv('no-gzip', '1');
}
while (ob_get_level() > 0) { @ob_end_flush(); }
flush();

set_time_limit(0);

/* ============ Helpers ============ */
function emit($obj) {
    echo 'data: ' . json_encode($obj, JSON_UNESCAPED_UNICODE) . "\n\n";
    flush();
}
function emitDone() {
    echo "data: [DONE]\n\n";
    flush();
}
function trunc($s, $n) {
    $s = (string)$s;
    if (function_exists('mb_substr')) return mb_substr($s, 0, $n);
    return substr($s, 0, $n);
}
function toolDetailFromArgs($argsRaw) {
    $a = json_decode((string)$argsRaw, true);
    if (!is_array($a)) return '';
    foreach (['path', 'file', 'query', 'command', 'pattern', 'url', 'name', 'skill', 'search'] as $k) {
        if (!empty($a[$k]) && is_string($a[$k])) return trunc($a[$k], 64);
    }
    foreach ($a as $v) {
        if (is_string($v) && $v !== '') return trunc($v, 64);
    }
    return '';
}
function summarizeToolOutput($textRaw) {
    $t = json_decode((string)$textRaw, true);
    if (is_array($t)) {
        if (isset($t['total_lines'])) return $t['total_lines'] . ' baris';
        if (isset($t['total_count'])) return $t['total_count'] . ' hasil';
        if (isset($t['bytes_written'])) return $t['bytes_written'] . ' bytes';
        if (isset($t['exit_code'])) return 'exit ' . $t['exit_code'];
        if (isset($t['status']) && is_string($t['status'])) return $t['status'];
    }
    $flat = trim(preg_replace('/\s+/', ' ', (string)$textRaw));
    return $flat === '' ? 'ok' : trunc($flat, 64);
}

/* ============ Bangun payload Responses API ============ */
$instructions = '';
$input = [];

foreach ($messages as $m) {
    if (!is_array($m) || empty($m['role'])) continue;
    $role = $m['role'];
    $content = isset($m['content']) && is_string($m['content']) ? $m['content'] : '';

    if ($role === 'system') {
        $instructions .= ($instructions !== '' ? "\n" : '') . $content;
        continue;
    }

    // Buang HTML preview attachment (blob URL mati / div dekoratif) supaya model gak kepasang sampah
    $content = preg_replace('/<div style="display: flex; gap: 6px;[\s\S]*<\/div>\s*$/u', '', $content);
    $content = trim($content);

    if ($role === 'user') {
        $input[] = [
            'type' => 'message',
            'role' => 'user',
            'content' => [['type' => 'input_text', 'text' => $content]]
        ];
    } else {
        $input[] = [
            'type' => 'message',
            'role' => 'assistant',
            'content' => [['type' => 'output_text', 'text' => $content]]
        ];
    }
}

// Tempelkan gambar yang di-upload ke pesan user terakhir
if (!empty($_FILES['images']) && is_array($_FILES['images']['name'])) {
    $lastUserIdx = -1;
    foreach ($input as $i => $item) {
        if (isset($item['role']) && $item['role'] === 'user') $lastUserIdx = $i;
    }
    if ($lastUserIdx === -1) {
        // tidak ada pesan user sama sekali — buat satu biar gambar punya wadah
        $input[] = ['type' => 'message', 'role' => 'user', 'content' => []];
        $lastUserIdx = count($input) - 1;
    }
    foreach ($_FILES['images']['name'] as $idx => $name) {
        if ($_FILES['images']['error'][$idx] !== UPLOAD_ERR_OK) continue;
        $tmpName = $_FILES['images']['tmp_name'][$idx];
        $fileType = mime_content_type($tmpName);
        if (strpos($fileType, 'image/') === 0) {
            $imgData = base64_encode(file_get_contents($tmpName));
            $input[$lastUserIdx]['content'][] = [
                'type' => 'input_image',
                'image_url' => 'data:' . $fileType . ';base64,' . $imgData
            ];
        }
    }
}

if (empty($input)) {
    emit(['choices' => [['delta' => ['content' => '⚠️ Tidak ada pesan yang bisa diproses.']]]]);
    emitDone();
    exit;
}

$payload = [
    'model' => $model,
    'input' => $input,
    'stream' => true
];
if ($instructions !== '') $payload['instructions'] = $instructions;

/* ============ Stream & terjemahkan ============ */
$buffer = '';
$emittedAnything = false;
$doneSent = false;
$endedCalls = [];
$resultsSent = [];

function processUpstreamBlock($block) {
    global $emittedAnything, $doneSent, $endedCalls, $resultsSent;

    $dataJson = '';
    $lines = explode("\n", $block);
    foreach ($lines as $ln) {
        $ln = rtrim($ln, "\r");
        if (strncmp($ln, 'data:', 5) === 0) {
            $dataJson .= trim(substr($ln, 5));
        } elseif ($ln !== '' && $ln[0] === ':') {
            echo ": ka\n\n";
            flush();
        }
    }
    if ($dataJson === '' || $dataJson === '[DONE]') return;

    $obj = json_decode($dataJson, true);
    if (!is_array($obj)) return;

    $emittedAnything = true;
    $type = isset($obj['type']) ? $obj['type'] : '';
    $item = isset($obj['item']) && is_array($obj['item']) ? $obj['item'] : null;

    if ($type === 'response.created') {
        emit(['type' => 'status', 'phase' => 'thinking']);
    }
    elseif ($type === 'response.output_item.added' && $item) {
        $itype = isset($item['type']) ? $item['type'] : '';
        if ($itype === 'function_call') {
            $callId = isset($item['call_id']) ? $item['call_id'] : 'idx_' . (isset($obj['output_index']) ? $obj['output_index'] : rand());
            emit([
                'type' => 'tool',
                'phase' => 'start',
                'id' => $callId,
                'name' => isset($item['name']) ? $item['name'] : 'tool',
                'detail' => toolDetailFromArgs(isset($item['arguments']) ? $item['arguments'] : '')
            ]);
        }
        elseif ($itype === 'function_call_output') {
            $callId = isset($item['call_id']) ? $item['call_id'] : '';
            if ($callId === '' || !in_array($callId, $resultsSent)) {
                if ($callId !== '') $resultsSent[] = $callId;
                $txt = '';
                if (isset($item['output']) && is_array($item['output'])) {
                    foreach ($item['output'] as $op) {
                        if (isset($op['text'])) $txt .= $op['text'];
                    }
                }
                emit([
                    'type' => 'tool',
                    'phase' => 'result',
                    'id' => $callId,
                    'summary' => summarizeToolOutput($txt)
                ]);
            }
        }
        elseif ($itype === 'reasoning') {
            emit(['type' => 'status', 'phase' => 'thinking']);
        }
        elseif ($itype === 'message') {
            emit(['type' => 'status', 'phase' => 'writing']);
        }
    }
    elseif ($type === 'response.output_item.done' && $item) {
        $itype = isset($item['type']) ? $item['type'] : '';
        if ($itype === 'function_call') {
            $callId = isset($item['call_id']) ? $item['call_id'] : '';
            if ($callId !== '' && !in_array($callId, $endedCalls)) {
                $endedCalls[] = $callId;
                emit([
                    'type' => 'tool',
                    'phase' => 'end',
                    'id' => $callId,
                    'name' => isset($item['name']) ? $item['name'] : 'tool'
                ]);
            }
        }
        elseif ($itype === 'function_call_output') {
            $callId = isset($item['call_id']) ? $item['call_id'] : '';
            if ($callId !== '' && !in_array($callId, $resultsSent)) {
                $resultsSent[] = $callId;
                $txt = '';
                if (isset($item['output']) && is_array($item['output'])) {
                    foreach ($item['output'] as $op) {
                        if (isset($op['text'])) $txt .= $op['text'];
                    }
                }
                emit([
                    'type' => 'tool',
                    'phase' => 'result',
                    'id' => $callId,
                    'summary' => summarizeToolOutput($txt)
                ]);
            }
        }
    }
    elseif ($type === 'response.output_text.delta') {
        $d = isset($obj['delta']) ? $obj['delta'] : '';
        if ($d !== '') {
            emit(['choices' => [['delta' => ['content' => $d]]]]);
        }
    }
    elseif ($type === 'response.completed') {
        $usage = isset($obj['response']['usage']) && is_array($obj['response']['usage']) ? $obj['response']['usage'] : [];
        emit([
            'type' => 'usage',
            'input_tokens' => isset($usage['input_tokens']) ? $usage['input_tokens'] : 0,
            'output_tokens' => isset($usage['output_tokens']) ? $usage['output_tokens'] : 0,
            'total_tokens' => isset($usage['total_tokens']) ? $usage['total_tokens'] : 0
        ]);
        $doneSent = true;
        emitDone();
    }
    elseif ($type === 'response.failed' || $type === 'response.incomplete' || $type === 'error') {
        $msg = '⚠️ Response gagal.';
        if (isset($obj['response']['error']['message'])) $msg = '⚠️ ' . $obj['response']['error']['message'];
        elseif (isset($obj['message'])) $msg = '⚠️ ' . $obj['message'];
        emit(['choices' => [['delta' => ['content' => $msg]]]]);
        $doneSent = true;
        emitDone();
    }
}

$ch = curl_init($responsesEndpoint);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Authorization: Bearer ' . $apiKey,
    'Content-Type: application/json',
    'Accept: text/event-stream'
]);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload, JSON_UNESCAPED_UNICODE));
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 30);
curl_setopt($ch, CURLOPT_TIMEOUT, 0);
// Safety net: kalau upstream 5 menit kedepan gak ngirim apa-apa (stalled mati),
// putuskan koneksi biar worker php -S gak kesandera selamanya.
curl_setopt($ch, CURLOPT_LOW_SPEED_LIMIT, 1);
curl_setopt($ch, CURLOPT_LOW_SPEED_TIME, 300);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);

curl_setopt($ch, CURLOPT_WRITEFUNCTION, function($curl, $data) {
    global $buffer, $emittedAnything;

    // Deteksi body error non-SSE dari gateway (JSON error langsung)
    if (!$emittedAnything) {
        $trimmed = ltrim((string)$data);
        if ($trimmed !== '' && $trimmed[0] === '{' && strpos($trimmed, '"error"') !== false) {
            $decoded = json_decode($trimmed, true);
            $msg = isset($decoded['error']['message']) ? $decoded['error']['message'] : $trimmed;
            emit(['choices' => [['delta' => ['content' => '⚠️ Gateway error: ' . $msg]]]]);
            $emittedAnything = true;
            return strlen($data);
        }
    }

    $buffer .= $data;
    while (($pos = strpos($buffer, "\n\n")) !== false) {
        $block = substr($buffer, 0, $pos);
        $buffer = substr($buffer, $pos + 2);
        processUpstreamBlock($block);
    }
    return strlen($data);
});

/* ============ Stream + heartbeat (dijamin gak pernah gantung diam) ============
 * Loop curl_multi: tiap iterasi nunggu max 1 detik, kalau 15 detik gak ada
 * data dari upstream, kirim ping ": ka" ke browser. Browser pake heartbeat
 * ini sebagai bukti koneksi masih hidup — bukan aturan timeout arbitrer.
 * Kalau upstream beneran stalled >5 menit (LOW_SPEED), koneksi diputus &
 * error di-emit eksplisit. */
$mh = curl_multi_init();
curl_multi_add_handle($mh, $ch);

$lastKa = time();
$running = 0;

do {
    curl_multi_exec($mh, $running);
    if ($running > 0) {
        $sel = @curl_multi_select($mh, 1);
        if ($sel === -1) usleep(100000); // jaga-jaga biar gak busy-loop
    }
    if ($running > 0 && !$doneSent && (time() - $lastKa) >= 15) {
        $lastKa = time();
        echo ": ka\n\n";
        flush();
    }
} while ($running > 0);

$curlErrno = curl_errno($ch);
$curlError = curl_error($ch);
curl_multi_remove_handle($mh, $ch);
curl_close($ch);
curl_multi_close($mh);

// Sisa buffer yang belum kepotong \n\n
$rest = trim($buffer);
if ($rest !== '') {
    processUpstreamBlock($rest);
}

if ($curlErrno !== 0) {
    emit(['choices' => [['delta' => ['content' => '⚠️ **System Error:** cURL gagal - ' . $curlError]]]]);
}

if (!$doneSent) {
    emitDone();
}
