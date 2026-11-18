<?php
/**
 * Punkt wejścia dla Apache + PHP (produkcja, także za Cloudflare).
 *
 * Nie duplikujemy HTML-a: bierzemy index.html jako szablon i doklejamy
 * do adresów plików parametr ?v=<time()> — nowy co sekundę. Dzięki temu
 * Cloudflare i przeglądarka nie podadzą starej wersji JS/CSS po wdrożeniu.
 *
 * Mapa importów (importmap) jest po to, żeby parametr trafił nie tylko do
 * main.js, ale też do modułów importowanych wewnątrz (model.js, render.js, ...).
 */

declare(strict_types=1);

$root = __DIR__;
$version = time();

$html = @file_get_contents($root . '/index.html');
if ($html === false) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Brak pliku index.html obok index.php.';
    exit;
}

/** Dokleja ?v=... do adresu (używa &, jeśli adres ma już parametry). */
function with_version(string $url, int $version): string
{
    return $url . (strpos($url, '?') === false ? '?' : '&') . 'v=' . $version;
}

// 1. Arkusz stylów i moduł wejściowy.
$html = str_replace(
    ['href="css/app.css"', 'src="js/main.js"'],
    [
        'href="' . with_version('css/app.css', $version) . '"',
        'src="' . with_version('js/main.js', $version) . '"',
    ],
    $html
);

// 2. Mapa importów — każdy plik z js/ (także w podkatalogach) dostaje ten sam ?v=...
$modules = [];
$jsRoot = $root . '/js';
if (is_dir($jsRoot)) {
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($jsRoot, FilesystemIterator::SKIP_DOTS)
    );
    foreach ($iterator as $file) {
        if (!$file->isFile() || strtolower($file->getExtension()) !== 'js') {
            continue;
        }
        $relative = str_replace('\\', '/', substr($file->getPathname(), strlen($root) + 1));
        $url = './' . $relative;
        $modules[$url] = with_version($url, $version);
    }
}

$head = '';

// Wersja aplikacji z package.json (pokazywana w pasku statusu).
$package = json_decode((string) @file_get_contents($root . '/package.json'), true);
if (is_array($package) && isset($package['version']) && is_string($package['version'])) {
    $head .= '  <meta name="app-version" content="'
        . htmlspecialchars($package['version'], ENT_QUOTES, 'UTF-8') . '">' . "\n";
}

if ($modules) {
    ksort($modules);
    $json = json_encode(['imports' => $modules], JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    if ($json !== false) {
        $head .= "  <script type=\"importmap\">\n" . $json . "\n  </script>\n";
    }
}

if ($head !== '') {
    $html = str_replace('</head>', $head . '</head>', $html);
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');
echo $html;
