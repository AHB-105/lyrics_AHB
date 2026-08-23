<?php
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json');

$title = isset($_GET['title']) ? $_GET['title'] : '';
$artist = isset($_GET['artist']) ? $_GET['artist'] : '';

if (empty($title)) {
    http_response_code(400);
    echo json_encode(['error' => 'No title']);
    exit;
}

$params = ['track_name' => $title];
if (!empty($artist)) {
    $params['artist_name'] = $artist;
}

$url = 'https://lrclib.net/api/search?' . http_build_query($params);

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_HTTPHEADER => ['User-Agent: LyricKaraoke/1.0'],
]);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode !== 200 || !$response) {
    http_response_code(502);
    echo json_encode(['error' => 'lrclib request failed']);
    exit;
}

$results = json_decode($response, true);
if (empty($results)) {
    http_response_code(404);
    echo json_encode(['error' => 'No lyrics found', 'results' => []]);
    exit;
}

$best = null;
foreach ($results as $r) {
    if (!empty($r['syncedLyrics'])) { $best = $r; break; }
}
if (!$best) {
    foreach ($results as $r) {
        if (!empty($r['plainLyrics'])) { $best = $r; break; }
    }
}
if (!$best) {
    http_response_code(404);
    echo json_encode(['error' => 'No lyrics content']);
    exit;
}

echo json_encode([
    'trackName' => $best['trackName'] ?? '',
    'artistName' => $best['artistName'] ?? '',
    'syncedLyrics' => $best['syncedLyrics'] ?? null,
    'plainLyrics' => $best['plainLyrics'] ?? null,
]);
