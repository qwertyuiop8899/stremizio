// Worker Unificato: UIndex + Il Corsaro Nero + Knaben con o senza Real-Debrid (Versione Vercel)

import * as cheerio from 'cheerio';
import { promises as fs } from 'fs';
import path from 'path';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// ✅ Improved HTML Entity Decoder
function decodeHtmlEntities(text) {
    const entities = {
        '&amp;': '&',
        '&lt;': '<', 
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&nbsp;': ' ',
        '&#8217;': "'",
        '&#8220;': '"',
        '&#8221;': '"',
        '&#8211;': '–',
        '&#8212;': '—'
    };
    
    return text.replace(/&[#\w]+;/g, match => entities[match] || match);
}

// ✅ Enhanced Query Cleaning (from uiai.js)
function cleanSearchQuery(query) {
    console.log(`🧹 Cleaning query: "${query}"`);
    
    // Remove IMDb ID pattern if present
    if (query.match(/^tt\d+$/)) {
        console.log(`⚠️ Raw IMDb ID detected: ${query}. This should be converted to movie title before calling scraper.`);
        return null;
    }
    
    // Clean up the query for better search results
    const cleaned = query
        .replace(/\s*\(\d{4}\)\s*$/, '') // Remove year at the end
        .replace(/[^\p{L}\p{N}\s.-]/gu, ' ') // Replace special chars, keeping unicode letters/numbers
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
    
    console.log(`✨ Cleaned query: "${cleaned}"`);
    return cleaned;
}

// ✅ Enhanced Quality Extraction
function extractQuality(title) {
    if (!title) return '';
    
    // More comprehensive quality patterns
    const qualityPatterns = [
        /\b(2160p|4k|uhd)\b/i,
        /\b(1080p)\b/i,
        /\b(720p)\b/i,
        /\b(480p|sd)\b/i,
        /\b(webrip|web-rip)\b/i,
        /\b(bluray|blu-ray|bdremux|bd)\b/i,
        /\b(remux)\b/i,
        /\b(hdrip|hdr)\b/i,
        /\b(cam|ts|tc)\b/i
    ];
    
    for (const pattern of qualityPatterns) {
        const match = title.match(pattern);
        if (match) return match[1].toLowerCase();
    }
    
    return '';
}

// ✅ Improved Info Hash Extraction
function extractInfoHash(magnet) {
    if (!magnet) return null;
    const match = magnet.match(/btih:([A-Fa-f0-9]{40}|[A-Za-z2-7]{32})/i);
    if (!match) return null;
    
    // Convert base32 to hex if needed
    if (match[1].length === 32) {
        // This is base32, convert to hex (simplified)
        return match[1].toUpperCase();
    }
    
    return match[1].toUpperCase();
}

// ✅ Enhanced Size Parsing
function parseSize(sizeStr) {
    if (!sizeStr || sizeStr === '-' || sizeStr.toLowerCase() === 'unknown') return 0;
    
    const match = sizeStr.match(/([\d.,]+)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)/i);
    if (!match) return 0;
    
    const [, value, unit] = match;
    const cleanValue = parseFloat(value.replace(',', '.'));
    
    const multipliers = {
        'B': 1,
        'KB': 1024, 'KIB': 1024,
        'MB': 1024 ** 2, 'MIB': 1024 ** 2,
        'GB': 1024 ** 3, 'GIB': 1024 ** 3,  
        'TB': 1024 ** 4, 'TIB': 1024 ** 4
    };
    
    return cleanValue * (multipliers[unit.toUpperCase()] || 1);
}

// ✅ Formattazione dimensione file
function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// ✅ Italian Language Detection
function isItalian(title, italianMovieTitle = null) {
    if (!title) return false;
    // Regex to find Italian language indicators as whole words, case-insensitive.
    // This now includes more common tags like MULTI, DUAL, subita, nuita, etc.
    const italianRegex = /\b(ita|italian|sub[.\s]?ita|multi|dual|nuita)\b/i;
    if (italianRegex.test(title)) {
        return true;
    }

    if (italianMovieTitle) {
        const normalizedTorrentTitle = title.toLowerCase();
        const normalizedItalianTitle = italianMovieTitle.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        const italianWords = normalizedItalianTitle.split(' ')
            .filter(word => word.length > 2) // Filtra parole troppo corte
            .filter(word => !['del', 'al', 'dal', 'nel', 'sul', 'un', 'il', 'lo', 'la', 'gli', 'le', 'con', 'per', 'che', 'non'].includes(word)); // Filtra parole comuni
        
        if (italianWords.length > 0) {
            const matchingWords = italianWords.filter(word => 
                normalizedTorrentTitle.includes(word)
            );
            
            // Se almeno il 60% delle parole del titolo italiano sono presenti, è probabile che sia in italiano.
            const percentageMatch = matchingWords.length / italianWords.length;
            if (percentageMatch > 0.6) { // Soglia alzata per essere più precisi ed evitare falsi positivi
                console.log(`🇮🇹 Matched Italian title words in "${title}" (score: ${percentageMatch.toFixed(2)})`);
                return true;
            }
        }
    }

    return false;
}

// ✅ NUOVA FUNZIONE: Filtro per categorie per adulti
function isAdultCategory(categoryText) {
    if (!categoryText) return false;
    // Normalize by converting to lowercase and removing common separators.
    const normalizedCategory = categoryText.toLowerCase().replace(/[\s/.-]/g, '');

    // Keywords that identify adult categories.
    const adultCategoryKeywords = ['xxx', 'adult', 'porn', 'hard', 'hentai', 'stepmom', 'stepdad', 'stepsister', 'stepson', 'incest', 'eroz', 'foradults', 'mature', 'nsfw'];
    return adultCategoryKeywords.some(keyword => normalizedCategory.includes(keyword));
}


// ✅ NUOVA FUNZIONE: Validazione per query di ricerca brevi (Migliorata)
function isGoodShortQueryMatch(torrentTitle, searchQuery) {
    const cleanedSearchQuery = searchQuery
        .toLowerCase()
        .replace(/\s\(\d{4}\)/, '') // Rimuove l'anno tra parentesi
        .replace(/[^\p{L}\p{N}\s.-]/gu, ' ') // Keep unicode letters/numbers and dots/hyphens
        .replace(/\s+/g, ' ')
        .trim();

    // Applica il controllo solo per query brevi per non essere troppo restrittivo
    if (cleanedSearchQuery.length > 8 || cleanedSearchQuery.length < 2) { // Soglia aumentata
        return true;
    }

    const normalizedTorrentTitle = torrentTitle.toLowerCase();
    const searchWords = new Set(cleanedSearchQuery.split(' ').filter(w => w.length > 0));

    // 1. Tutte le parole della ricerca devono essere presenti nel titolo del torrent
    for (const word of searchWords) {
        const wordRegex = new RegExp(`\\b${word}\\b`, 'i');
        if (!wordRegex.test(normalizedTorrentTitle)) {
            console.log(`🏴‍☠️ [Short Query] Parola mancante: "${word}" non trovata in "${torrentTitle}"`);
            return false;
        }
    }

    return true;
}

// --- NUOVA SEZIONE: SCRAPER PER IL CORSARO NERO ---

const CORSARO_BASE_URL = "https://ilcorsaronero.link";

async function fetchCorsaroNeroSingle(searchQuery, type = 'movie') {
    console.log(`🏴‍☠️ [Single Query] Searching Il Corsaro Nero for: "${searchQuery}" (type: ${type})`);

    try {
        let searchCategory;
        let outputCategory;
        switch (type) {
            case 'movie':
                searchCategory = 'film';
                outputCategory = 'Movies';
                break;
            case 'series':
                searchCategory = 'serie-tv';
                outputCategory = 'TV';
                break;
            case 'anime':
                searchCategory = 'anime';
                outputCategory = 'Anime';
                break;
            default:
                searchCategory = 'serie-tv';
                outputCategory = 'TV';
        }
        const searchUrl = `${CORSARO_BASE_URL}/search?q=${encodeURIComponent(searchQuery)}&cat=${searchCategory}`;
        
        const searchResponse = await fetch(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });
        if (!searchResponse.ok) {
            throw new Error(`CorsaroNero search failed with status ${searchResponse.status}`);
        }
        const searchHtml = await searchResponse.text();

        const $ = cheerio.load(searchHtml);
        const rows = $('tbody tr');
        
        if (rows.length === 0) {
            console.log('🏴‍☠️ No results found on CorsaroNero.');
            return [];
        }

        console.log(`🏴‍☠️ Found ${rows.length} potential results on CorsaroNero. Fetching details...`);
        // Limit the number of detail pages to fetch to avoid "Too many subrequests" error on Cloudflare.
        const MAX_DETAILS_TO_FETCH = 6;
        const rowsToProcess = rows.toArray().slice(0, MAX_DETAILS_TO_FETCH);

        console.log(`🏴‍☠️ Found ${rows.length} potential results on CorsaroNero. Fetching details for top ${rowsToProcess.length}...`);

        const streamPromises = rowsToProcess.map(async (row) => {
            const titleElement = $(row).find('th a');
            if (!titleElement.length) return null;
            const torrentTitle = titleElement.text().trim();

            console.log(`🏴‍☠️   - Processing row: "${torrentTitle}"`);
            // --- NUOVA MODIFICA: Validazione per query brevi ---
            if (!isGoodShortQueryMatch(torrentTitle, searchQuery)) {
                return null;
            }
            // --- FINE MODIFICA ---

            const torrentPath = titleElement.attr('href');
            if (!torrentPath) return null;

            // --- OTTIMIZZAZIONE: Estrai la dimensione dalla pagina dei risultati ---
            const cells = $(row).find('td');
            const sizeStr = cells.length > 3 ? cells.eq(3).text().trim() : 'Unknown';
            const sizeInBytes = parseSize(sizeStr);
            // --- FINE OTTIMIZZAZIONE ---

            const torrentPageUrl = `${CORSARO_BASE_URL}${torrentPath}`;

            try {
                const detailResponse = await fetch(torrentPageUrl, { headers: { 'Referer': searchUrl } });
                if (!detailResponse.ok) return null;

                const detailHtml = await detailResponse.text();
                const $$ = cheerio.load(detailHtml);

                // --- MODIFICA: Logica di estrazione del magnet link più robusta ---
                let magnetLink = $$('a[href^="magnet:?"]').attr('href');
                
                // Fallback 1: Selettore specifico originale
                if (!magnetLink) {
                    const mainDiv = $$("div.w-full:nth-child(2)");
                    if (mainDiv.length) {
                        magnetLink = mainDiv.find("a.w-full:nth-child(1)").attr('href');
                    }
                }

                // Fallback 2: Cerca un link con un'icona a forma di magnete (comune)
                if (!magnetLink) {
                    magnetLink = $$('a:has(i.fa-magnet)').attr('href');
                }

                // Fallback 3: Search the entire page text for a magnet link pattern (very robust)
                if (!magnetLink) {
                    const bodyHtml = $$.html(); // Get the full HTML content of the page
                    // This regex looks for a magnet link inside quotes or as plain text.
                    const magnetMatch = bodyHtml.match(/["'>\s](magnet:\?xt=urn:btih:[^"'\s<>]+)/i);
                    if (magnetMatch && magnetMatch[1]) {
                        magnetLink = magnetMatch[1];
                        console.log('🏴‍☠️ [Magnet Fallback] Found magnet link using raw HTML search.');
                    }
                }
                // --- FINE MODIFICA ---
                
                if (magnetLink && magnetLink.startsWith('magnet:')) {
                    const seeds = $(row).find('td.text-green-500').text().trim() || '0';
                    const leechs = $(row).find('td.text-red-500').text().trim() || '0';
                    const infoHash = extractInfoHash(magnetLink);
                    
                    if (!infoHash) {
                        console.log(`🏴‍☠️   - Failed to extract infohash for: "${torrentTitle}"`);
                        return null;
                    }

                    return {
                        magnetLink: magnetLink,
                        websiteTitle: torrentTitle,
                        title: torrentTitle,
                        filename: torrentTitle,
                        quality: extractQuality(torrentTitle),
                        size: sizeStr,
                        source: 'CorsaroNero',
                        seeders: parseInt(seeds) || 0,
                        leechers: parseInt(leechs) || 0,
                        infoHash: infoHash,
                        mainFileSize: sizeInBytes,
                        pubDate: new Date().toISOString(), // Not available, using current time
                        categories: [outputCategory]
                    };
                }

                console.log(`🏴‍☠️   - Failed to find magnet for: "${torrentTitle}"`);
                return null;
            } catch (e) {
                console.error(`🏴‍☠️ Error fetching CorsaroNero detail page ${torrentPageUrl}:`, e.message);
                return null;
            }
        });

        const settledStreams = await Promise.allSettled(streamPromises);
        const streams = settledStreams
            .filter(result => result.status === 'fulfilled' && result.value)
            .map(result => result.value);

        console.log(`🏴‍☠️ Successfully parsed ${streams.length} streams from CorsaroNero.`);
        return streams;

    } catch (error) {
        console.error(`❌ Error in fetchCorsaroNeroData:`, error);
        return [];
    }
}

async function fetchCorsaroNeroData(originalQuery, type = 'movie') {
    const searchStrategies = [];

    // Strategy 1: Original query, cleaned
    const cleanedOriginal = cleanSearchQuery(originalQuery);
    if (cleanedOriginal) {
        searchStrategies.push({
            query: cleanedOriginal,
            description: 'Original cleaned'
        });
    }

    // Strategy 2: Remove extra words like "film", "movie", etc. (solo per film)
    if (type === 'movie') {
        const simplified = cleanedOriginal?.replace(/\b(movie|film|dvd|bluray|bd)\b/gi, '').trim();
        if (simplified && simplified !== cleanedOriginal && simplified.length > 2) {
            searchStrategies.push({
                query: simplified,
                description: 'Simplified movie'
            });
        }
    }

    let allResults = [];
    const seenHashes = new Set();

    for (const strategy of searchStrategies) {
        if (!strategy.query) continue;

        console.log(`🏴‍☠️ [Strategy: ${strategy.description}] Searching CorsaroNero for: "${strategy.query}"`);

        try {
            const results = await fetchCorsaroNeroSingle(strategy.query, type);
            const newResults = results.filter(result => {
                if (!result.infoHash || seenHashes.has(result.infoHash)) return false;
                seenHashes.add(result.infoHash);
                return true;
            });
            allResults.push(...newResults);
            if (allResults.length >= 20) break;
        } catch (error) {
            console.error(`❌ CorsaroNero Strategy "${strategy.description}" failed:`, error.message);
        }
    }
    
    console.log(`🏴‍☠️ Multi-strategy search for CorsaroNero found ${allResults.length} total unique results.`);
    return allResults;
}

// --- FINE NUOVA SEZIONE ---


// --- NUOVA SEZIONE: SCRAPER PER KNABEN.ORG ---

const KNABEN_BASE_URL = "https://knaben.org";

async function fetchKnabenData(searchQuery, type = 'movie') {
    // Knaben non ha categorie separate per film/serie nella ricerca, quindi 'type' è ignorato.
    const cleanedQuery = searchQuery.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!cleanedQuery) {
        console.log('🦉 Query is empty after cleaning, skipping Knaben search.');
        return [];
    }
    
    console.log(`🦉 [HTML Scraper] Searching Knaben.org for: "${cleanedQuery}"`);

    try {
        const searchUrl = `${KNABEN_BASE_URL}/search/${encodeURIComponent(cleanedQuery)}/`;
        
        const response = await fetch(searchUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Referer': `${KNABEN_BASE_URL}/`
            }
        });

        if (!response.ok) {
            throw new Error(`Knaben.org HTML search failed with status ${response.status}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        const rows = $('table.table tbody tr');
        if (rows.length === 0) {
            console.log('🦉 No results found on Knaben.org.');
            return [];
        }

        console.log(`🦉 Found ${rows.length} potential results on Knaben.org.`);

        const streams = rows.toArray().map(row => {
            const $row = $(row);

            const cells = $row.find('td');
            // --- NUOVA MODIFICA: Filtro per contenuti per adulti ---
            // Estrai la categoria dalla prima cella per il filtraggio.
            const torrentTitleForLog = $row.find('td:nth-child(2) a[title]').first().text().trim();
            const categoryText = cells.eq(0).text().trim();
            if (isAdultCategory(categoryText) || isAdultCategory(torrentTitleForLog)) {
                // Usiamo un selettore temporaneo per ottenere il titolo solo per il logging,
                // nel caso in cui questo risultato venga scartato.
                console.log(`🦉 Filtering adult content by category: "${torrentTitleForLog}" (Category: ${categoryText})`);
                return null; // Scarta il risultato
            }
            // --- FINE MODIFICA ---


            // Trova il titolo dall'attributo 'title' del primo link principale nella seconda cella.
            const titleElement = $row.find('td:nth-child(2) a[title]').first();
            const torrentTitle = titleElement.text().trim();

            // Trova il magnet link cercando un link che inizi con 'magnet:?' nella riga.
            const magnetElement = $row.find('a[href^="magnet:?"]').first();
            const magnetLink = magnetElement.attr('href');

            // Se non troviamo titolo o magnet, la riga non è valida.
            // Questo gestisce anche le righe che hanno solo un link "Refresh magnet".
            if (!torrentTitle || !magnetLink) return null;

            const infoHash = extractInfoHash(magnetLink);
            if (!infoHash) return null;

            // Estrai gli altri dati dalle celle corrispondenti.
            const sizeStr = cells.eq(2).text().trim();
            const seeds = cells.eq(4).text().trim(); // 5th column
            const leechs = cells.eq(5).text().trim(); // 6th column
            const sizeInBytes = parseSize(sizeStr);

            return {
                magnetLink: magnetLink,
                websiteTitle: torrentTitle,
                title: torrentTitle,
                filename: torrentTitle,
                quality: extractQuality(torrentTitle),
                size: sizeStr,
                source: 'Knaben',
                seeders: parseInt(seeds) || 0,
                leechers: parseInt(leechs) || 0,
                infoHash: infoHash.toUpperCase(),
                mainFileSize: sizeInBytes,
                pubDate: new Date().toISOString(), // Not available
                categories: [type === 'movie' ? 'Movies' : 'TV'] // Assume category from search type
            };
        }).filter(Boolean);

        console.log(`🦉 Successfully parsed ${streams.length} streams from Knaben.org.`);
        return streams;

    } catch (error) {
        console.error(`❌ Error in fetchKnabenData (HTML Scraper):`, error);
        return [];
    }
}

// --- FINE NUOVA SEZIONE ---

// --- NUOVA SEZIONE: JACKETTIO INTEGRATION ---

class Jackettio {
    constructor(baseUrl, apiKey, password = null) {
        this.baseUrl = baseUrl; // e.g., "https://eschiano-jackett.elfhosted.com"
        this.apiKey = apiKey;
        this.password = password; // Optional password for authenticated instances
    }

    async search(query, category = null, italianOnly = false) {
        if (!query) return [];
        
        try {
            const params = new URLSearchParams({
                apikey: this.apiKey,
                q: query,
                ...(category && { cat: category }) // 2000=Movies, 5000=TV, 5070=Anime
            });
            
            const url = `${this.baseUrl}/api/v2.0/indexers/all/results?${params}`;
            
            console.log(`🔍 [Jackettio] Searching for: "${query}" (category: ${category || 'all'}) ${italianOnly ? '[ITALIAN ONLY]' : ''}`);
            
            const headers = {
                'User-Agent': 'Stremizio/2.0'
            };
            
            // Add password if provided (for authenticated instances)
            if (this.password) {
                headers['Authorization'] = `Basic ${btoa(`api:${this.password}`)}`;
            }
            
            const response = await fetch(url, { headers });

            if (!response.ok) {
                throw new Error(`Jackettio API error: ${response.status}`);
            }

            const data = await response.json();
            
            if (!data.Results || data.Results.length === 0) {
                console.log('🔍 [Jackettio] No results found.');
                return [];
            }

            console.log(`🔍 [Jackettio] Found ${data.Results.length} raw results.`);
            
            // Parse Jackett results to our standard format
            const streams = data.Results.map(result => {
                // Jackett può restituire sia magnet che torrent file
                let magnetLink = result.MagnetUri || result.Link;
                
                // Se è un .torrent file, prova a estrarre l'hash
                if (!magnetLink || !magnetLink.startsWith('magnet:')) {
                    console.log(`⚠️ [Jackettio] Skipping non-magnet result: ${result.Title}`);
                    return null;
                }

                const infoHash = extractInfoHash(magnetLink);
                if (!infoHash) {
                    console.log(`⚠️ [Jackettio] Failed to extract hash from: ${result.Title}`);
                    return null;
                }

                // ✅ FILTER: Italian only check
                if (italianOnly && !isItalian(result.Title)) {
                    console.log(`🚫 [Jackettio] Skipping non-Italian: ${result.Title}`);
                    return null;
                }

                // Parse seeders/peers
                const seeders = result.Seeders || 0;
                const leechers = result.Peers || 0;
                
                // Parse size
                const sizeInBytes = result.Size || 0;
                const sizeStr = formatBytes(sizeInBytes);

                // Determine category
                let outputCategory = 'Unknown';
                const categoryDesc = (result.CategoryDesc || '').toLowerCase();
                if (categoryDesc.includes('movie')) {
                    outputCategory = 'Movies';
                } else if (categoryDesc.includes('tv') || categoryDesc.includes('series')) {
                    outputCategory = 'TV';
                } else if (categoryDesc.includes('anime')) {
                    outputCategory = 'Anime';
                }

                return {
                    magnetLink: magnetLink,
                    websiteTitle: result.Title,
                    title: result.Title,
                    filename: result.Title,
                    quality: extractQuality(result.Title),
                    size: sizeStr,
                    source: 'Jackettio',
                    seeders: seeders,
                    leechers: leechers,
                    infoHash: infoHash,
                    mainFileSize: sizeInBytes,
                    pubDate: result.PublishDate || new Date().toISOString(),
                    categories: [outputCategory]
                };
            }).filter(Boolean);

            console.log(`🔍 [Jackettio] Successfully parsed ${streams.length} ${italianOnly ? 'ITALIAN ' : ''}streams.`);
            return streams;

        } catch (error) {
            console.error(`❌ [Jackettio] Search failed:`, error.message);
            return [];
        }
    }
}

async function fetchJackettioData(searchQuery, type = 'movie', jackettioInstance = null) {
    if (!jackettioInstance) {
        console.log('⚠️ [Jackettio] Instance not configured, skipping.');
        return [];
    }

    try {
        // Map type to Jackett category codes
        let category = null;
        if (type === 'movie') {
            category = '2000'; // Movies
        } else if (type === 'series') {
            category = '5000'; // TV
        } else if (type === 'anime') {
            category = '5070'; // TV/Anime
        }

        // ✅ ONLY ITALIAN RESULTS
        const results = await jackettioInstance.search(searchQuery, category, true);
        return results;

    } catch (error) {
        console.error(`❌ Error in fetchJackettioData:`, error);
        return [];
    }
}

// --- FINE NUOVA SEZIONE ---

// ✅ Advanced HTML Parsing (inspired by JSDOM approach in uiai.js)
function parseUIndexHTML(html) {
    const results = [];
    
    // Split by table rows and filter for torrent rows
    const rows = html.split(/<tr[^>]*>/gi).filter(row => 
        row.includes('magnet:?xt=urn:btih:') && 
        row.includes('<td')
    );
    
    console.log(`📊 Processing ${rows.length} potential torrent rows`);
    
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        
        try {
            // Extract magnet link with better regex
            const magnetMatch = row.match(/href=["'](magnet:\?xt=urn:btih:[^"']+)["']/i);
            if (!magnetMatch) continue;
            
            let magnetLink = decodeHtmlEntities(magnetMatch[1]);
            
            // Parse table cells more reliably
            const cellRegex = /<td[^>]*>(.*?)<\/td>/gis;
            const cells = [];
            let cellMatch;
            
            while ((cellMatch = cellRegex.exec(row)) !== null) {
                cells.push(cellMatch[1].trim());
            }
            
            if (cells.length < 3) continue;
            
            // Extract title - try multiple patterns
            let title = "";
            const titleCell = cells[1] || "";
            
            // Pattern 1: details.php link
            const detailsMatch = titleCell.match(/<a[^>]*href=["']\/details\.php[^"']*["'][^>]*>([^<]+)<\/a>/i);
            if (detailsMatch) {
                title = detailsMatch[1].trim();
            } else {
                // Pattern 2: Second anchor tag
                const anchors = titleCell.match(/<a[^>]*>([^<]+)<\/a>/gi);
                if (anchors && anchors.length >= 2) {
                    const secondAnchor = anchors[1].match(/>([^<]+)</);
                    if (secondAnchor) title = secondAnchor[1].trim();
                } else if (anchors && anchors.length === 1) {
                    const singleAnchor = anchors[0].match(/>([^<]+)</);
                    if (singleAnchor) title = singleAnchor[1].trim();
                }
            }
            
            // Clean title
            title = decodeHtmlEntities(title);
            
            // Extract size from third cell
            let sizeStr = "Unknown";
            const sizeCell = cells[2] || "";
            const sizeMatch = sizeCell.match(/([\d.,]+\s*(?:B|KB|MB|GB|TB|KiB|MiB|GiB|TiB))/i);
            if (sizeMatch) {
                sizeStr = sizeMatch[1].trim();
            }
            
            // Extract category
            let category = "Unknown";
            const categoryCell = cells[0] || "";
            const categoryMatch = categoryCell.match(/<a[^>]*>([^<]+)<\/a>/i);
            if (categoryMatch) {
                category = decodeHtmlEntities(categoryMatch[1].trim());
            }
            
            // Extract seeders/leechers if available (usually in later cells)
            let seeders = 0, leechers = 0;
            if (cells.length > 4) {
                const seedMatch = cells[4]?.match(/(\d+)/);
                if (seedMatch) seeders = parseInt(seedMatch[1]);
            }
            if (cells.length > 5) {
                const leechMatch = cells[5]?.match(/(\d+)/);
                if (leechMatch) leechers = parseInt(leechMatch[1]);
            }
            
            // Skip if essential data is missing
            if (!title || title.length < 3 || !magnetLink) continue;
            
            const sizeInBytes = parseSize(sizeStr);
            const infoHash = extractInfoHash(magnetLink);
            
            if (!infoHash) {
                console.log(`⚠️ Skipping result without valid info hash: ${title}`);
                continue;
            }
            
            results.push({
                magnetLink,
                title,
                size: sizeStr,
                category,
                quality: extractQuality(title),
                infoHash,
                seeders,
                leechers,
                sizeInBytes,
                source: 'UIndex'
            });
            
            console.log(`✅ Parsed: ${title} (${sizeStr}) - ${infoHash}`);
            
        } catch (error) {
            console.error(`❌ Error parsing row ${i}:`, error.message);
            continue;
        }
    }
    
    console.log(`📊 Successfully parsed ${results.length} torrents`);
    return results;
}

// ✅ Multi-Strategy Search (try different query variations)
async function searchUIndexMultiStrategy(originalQuery, type = 'movie') {
    const searchStrategies = [];
    
    // Strategy 1: Original query
    const cleanedOriginal = cleanSearchQuery(originalQuery);
    if (cleanedOriginal) {
        searchStrategies.push({
            query: cleanedOriginal,
            description: 'Original cleaned'
        });
    }
    
    // Strategy 2: Remove extra words for movies
    if (type === 'movie') {
        const simplified = cleanedOriginal?.replace(/\b(movie|film|dvd|bluray|bd)\b/gi, '').trim();
        if (simplified && simplified !== cleanedOriginal) {
            searchStrategies.push({
                query: simplified,
                description: 'Simplified movie'
            });
        }
    }
    
    // Strategy 3: For series, try alternative episode format
    if (type === 'series' && originalQuery.includes('S') && originalQuery.includes('E')) {
        const altFormat = originalQuery.replace(/S(\d+)E(\d+)/i, '$1x$2');
        if (altFormat !== originalQuery) {
            searchStrategies.push({
                query: cleanSearchQuery(altFormat),
                description: 'Alternative episode format'
            });
        }
    }
    
    let allResults = [];
    const seenHashes = new Set();
    
    for (const strategy of searchStrategies) {
        if (!strategy.query) continue;
        
        console.log(`🔍 Trying strategy: ${strategy.description} - "${strategy.query}"`);
        
        try {
            const results = await fetchUIndexSingle(strategy.query, type);
            
            // Deduplicate by info hash
            const newResults = results.filter(result => {
                if (!result.infoHash || seenHashes.has(result.infoHash)) return false;
                seenHashes.add(result.infoHash);
                return true;
            });
            
            console.log(`📊 Strategy "${strategy.description}" found ${newResults.length} unique results`);
            allResults.push(...newResults);
            
            // If we got good results, don't try too many more strategies
            if (allResults.length >= 20) break;
            
        } catch (error) {
            console.error(`❌ Strategy "${strategy.description}" failed:`, error.message);
            continue;
        }
        
        // Small delay between strategies
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`🎉 Multi-strategy search found ${allResults.length} total unique results`);
    return allResults;
}

// ✅ Single UIndex Search with Enhanced Error Handling
async function fetchUIndexSingle(searchQuery, type = 'movie') {
    try {
        console.log(`🔍 Searching UIndex for: "${searchQuery}" (type: ${type})`);
        
        let category = 0; // Default to 'All'
        if (type === 'movie') {
            category = 1; // Movie category
        } else if (type === 'series') {
            category = 2; // TV category
        } else if (type === 'anime') {
            category = 7; // Anime category
        }

        const searchUrl = `https://uindex.org/search.php?search=${encodeURIComponent(searchQuery)}&c=${category}`;
        
        const response = await fetch(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Cache-Control': 'no-cache'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const html = await response.text();
        
        // Basic validation
        if (!html.includes('<table') || !html.includes('magnet:')) {
            console.log('⚠️ Page doesn\'t contain expected torrent table');
            return [];
        }
        
        return parseUIndexHTML(html);
        
    } catch (error) {
        console.error(`❌ Error fetching from UIndex:`, error);
        return [];
    }
}

// ✅ Enhanced Result Processing and Sorting
function processAndSortResults(results, italianTitle = null) {
    // Filter out invalid results
    const validResults = results.filter(result => 
        result.title && 
        result.title.length > 3 && 
        result.infoHash && 
        result.infoHash.length >= 32
    );
    
    // Sort by Italian, then quality, then by size, then by seeders
    validResults.sort((a, b) => {
        // Prioritize Italian results
        const aIsItalian = isItalian(a.title, italianTitle);
        const bIsItalian = isItalian(b.title, italianTitle);
        if (aIsItalian && !bIsItalian) return -1;
        if (!aIsItalian && bIsItalian) return 1;

        const qualityOrder = { 
            '2160p': 6, '4k': 6, 'uhd': 6,
            'remux': 5,
            '1080p': 4, 
            '720p': 3, 
            'webrip': 2,
            '480p': 1,
            'cam': 0, 'ts': 0, 'tc': 0
        };
        
        const qualityDiff = (qualityOrder[b.quality] || 0) - (qualityOrder[a.quality] || 0);
        if (qualityDiff !== 0) return qualityDiff;
        
        // Then by file size
        const sizeDiff = (b.sizeInBytes || 0) - (a.sizeInBytes || 0);
        if (sizeDiff !== 0) return sizeDiff;
        
        // Finally by seeders
        return (b.seeders || 0) - (a.seeders || 0);
    });
    
    return validResults;
}

// ✅ Sorting by Quality and Seeders
function sortByQualityAndSeeders(results) {
    results.sort((a, b) => {
        const qualityOrder = { 
            '2160p': 6, '4k': 6, 'uhd': 6,
            'remux': 5,
            '1080p': 4, 
            '720p': 3, 
            'webrip': 2,
            '480p': 1,
            'cam': 0, 'ts': 0, 'tc': 0
        };
        
        const qualityDiff = (qualityOrder[b.quality] || 0) - (qualityOrder[a.quality] || 0);
        if (qualityDiff !== 0) return qualityDiff;
        
        // Finally by seeders
        return (b.seeders || 0) - (a.seeders || 0);
    });
    return results;
}

// ✅ NUOVA FUNZIONE: Limita i risultati per qualità
function limitResultsByQuality(results, limit = 3) {
    const qualityCounts = {};
    const limitedResults = [];

    // L'array `results` in input deve essere pre-ordinato
    for (const result of results) {
        // Normalizza la qualità. Usa 'unknown' per qualità vuote.
        const quality = result.quality || 'unknown';
        
        if (qualityCounts[quality] === undefined) {
            qualityCounts[quality] = 0;
        }

        if (qualityCounts[quality] < limit) {
            limitedResults.push(result);
            qualityCounts[quality]++;
        }
    }
    
    console.log(`Limiting by quality: reduced ${results.length} to ${limitedResults.length} results.`);
    return limitedResults;
}

// ✅ Funzione di logging asincrona che non blocca la risposta
async function logRequest(request, response, duration) {
    const { method } = request;
    const url = new URL(request.url);
    const { status } = response;
    const logData = {
        timestamp: new Date().toISOString(),
        method: request.method,
        url: url.pathname,
        status: response.status,
        durationMs: duration,
        // Vercel specific headers
        vercelId: request.headers['x-vercel-id'] || 'N/A',
        vercelCountry: request.headers['x-vercel-ip-country'] || 'N/A',
    };

    console.log(`[Analytics Log Sent]: ${JSON.stringify(logData)}`);
}


// ✅ Real-Debrid API integration
class RealDebrid {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.real-debrid.com/rest/1.0';
    }

    async checkCache(hashes) {
        if (!hashes || hashes.length === 0) return {};
        
        const results = {};
        const batchSize = 40; // RD limit is 40 hashes per request
        
        for (let i = 0; i < hashes.length; i += batchSize) {
            const batch = hashes.slice(i, i + batchSize);
            const url = `${this.baseUrl}/torrents/instantAvailability/${batch.join('/')}`;

            try {
                const response = await fetch(url, {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`
                    }
                });
                const data = await response.json();

                if (response.ok) {
                    batch.forEach(hash => {
                        const hashLower = hash.toLowerCase();
                        const cacheInfo = data[hashLower];
                        const isCached = cacheInfo && cacheInfo.rd && cacheInfo.rd.length > 0;
                        let downloadLink = null;
                        let isActuallyCachedAndStreamable = false; // New flag to indicate if a streamable file was found
                        
                        if (isCached) {
                            const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                            const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];

                            let bestFile = null;

                            for (const variant of cacheInfo.rd) {
                                for (const fileId in variant) {
                                    const file = variant[fileId];
                                    if (!file.filename) continue;
                                    const lowerFilename = file.filename.toLowerCase();

                                    const hasVideoExtension = videoExtensions.some(ext => lowerFilename.endsWith(ext));
                                    if (!hasVideoExtension) {
                                        continue; // Must be a video file
                                    }

                                    // Filter out small files that are likely samples or trailers.
                                    const isLikelyJunk = junkKeywords.some(junk => lowerFilename.includes(junk)) && file.filesize < 250 * 1024 * 1024; // 250 MB threshold
                                    if (isLikelyJunk) {
                                        continue;
                                    }
                                    if (!bestFile || file.filesize > bestFile.filesize) {
                                        bestFile = file;
                                    }
                                }
                            }

                            if (bestFile) {
                                downloadLink = bestFile.link;
                                isActuallyCachedAndStreamable = true; // Found a streamable file
                            } else {
                                console.warn(`⚠️ Torrent ${hashLower} is in RD cache but no suitable video file found for direct streaming.`);
                            }
                        }

                        results[hashLower] = {
                            cached: isActuallyCachedAndStreamable, // Use the new flag
                            downloadLink: downloadLink,
                            service: 'Real-Debrid'
                        };
                    });
                }

                if (i + batchSize < hashes.length) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (error) {
                console.error('Cache check failed:', error);
                batch.forEach(hash => {
                    const hashLower = hash.toLowerCase();
                    results[hashLower] = { cached: false, downloadLink: null, service: 'Real-Debrid' };
                });
            }
        }

        return results;
    }

    async addMagnet(magnetLink) {
        const formData = new FormData();
        formData.append('magnet', magnetLink);

        const response = await fetch(`${this.baseUrl}/torrents/addMagnet`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Real-Debrid API error: ${response.status}`);
        }

        return await response.json();
    }

    async getTorrents() {
        const response = await fetch(`${this.baseUrl}/torrents`, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });
        if (!response.ok) {
            throw new Error(`Failed to get torrents list from Real-Debrid: ${response.status}`);
        }
        return await response.json();
    }

    async deleteTorrent(torrentId) {
        const response = await fetch(`${this.baseUrl}/torrents/delete/${torrentId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });

        if (response.status !== 204) {
            console.error(`Failed to delete torrent ${torrentId} from Real-Debrid.`);
        }
    }

    async selectFiles(torrentId, fileIds = 'all') {
        const formData = new FormData();
        formData.append('files', fileIds);

        const response = await fetch(`${this.baseUrl}/torrents/selectFiles/${torrentId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.apiKey}` },
            body: formData
        });

        if (response.status !== 204) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Failed to select files on Real-Debrid: ${response.status} - ${errorData.error || 'Unknown error'}`);
        }
    }

    async getTorrentInfo(torrentId) {
        const response = await fetch(`${this.baseUrl}/torrents/info/${torrentId}`, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });

        if (!response.ok) {
            throw new Error(`Failed to get torrent info from Real-Debrid: ${response.status}`);
        }
        return await response.json();
    }

    async unrestrictLink(link) {
        const formData = new FormData();
        formData.append('link', link);

        const response = await fetch(`${this.baseUrl}/unrestrict/link`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Real-Debrid API error: ${response.status}`);
        }

        return await response.json();
    }
}

// ✅ Torbox API integration
class Torbox {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.torbox.app/v1/api';
    }

    async checkCache(hashes) {
        if (!hashes || hashes.length === 0) return {};
        
        const results = {};
        
        // Torbox supports bulk check via POST
        try {
            const response = await fetch(`${this.baseUrl}/torrents/checkcached`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    hashes: hashes,
                    format: 'object',
                    list_files: true
                })
            });

            if (!response.ok) {
                throw new Error(`Torbox API error: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.success && data.data) {
                hashes.forEach(hash => {
                    const cacheInfo = data.data[hash.toLowerCase()];
                    const isCached = cacheInfo && cacheInfo.cached === true;
                    let downloadLink = null;
                    let isActuallyCachedAndStreamable = false;
                    
                    if (isCached && cacheInfo.files && cacheInfo.files.length > 0) {
                        const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                        const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];
                        
                        let bestFile = null;
                        
                        for (const file of cacheInfo.files) {
                            const lowerName = file.name.toLowerCase();
                            
                            const hasVideoExtension = videoExtensions.some(ext => lowerName.endsWith(ext));
                            if (!hasVideoExtension) continue;
                            
                            const isLikelyJunk = junkKeywords.some(junk => lowerName.includes(junk)) && file.size < 250 * 1024 * 1024;
                            if (isLikelyJunk) continue;
                            
                            if (!bestFile || file.size > bestFile.size) {
                                bestFile = file;
                            }
                        }
                        
                        if (bestFile) {
                            // Store the hash and best file info for later retrieval
                            downloadLink = hash; // We'll use this to request the actual download later
                            isActuallyCachedAndStreamable = true;
                        } else {
                            console.warn(`⚠️ Torrent ${hash} is in Torbox cache but no suitable video file found.`);
                        }
                    }
                    
                    results[hash.toLowerCase()] = {
                        cached: isActuallyCachedAndStreamable,
                        downloadLink: downloadLink,
                        service: 'Torbox',
                        torboxData: cacheInfo // Store original data for file selection
                    };
                });
            }
        } catch (error) {
            console.error('Torbox cache check failed:', error);
            hashes.forEach(hash => {
                results[hash.toLowerCase()] = { cached: false, downloadLink: null, service: 'Torbox' };
            });
        }
        
        return results;
    }

    async addTorrent(magnetLink) {
        const response = await fetch(`${this.baseUrl}/torrents/createtorrent`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                magnet: magnetLink,
                seed: 1 // Enable seeding
            })
        });

        if (!response.ok) {
            throw new Error(`Torbox API error: ${response.status}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(`Torbox error: ${data.error || 'Unknown error'}`);
        }
        
        return data.data;
    }

    async getTorrents() {
        const response = await fetch(`${this.baseUrl}/torrents/mylist`, {
            headers: { 
                'Authorization': `Bearer ${this.apiKey}` 
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to get torrents list from Torbox: ${response.status}`);
        }
        
        const data = await response.json();
        if (!data.success) {
            throw new Error(`Torbox error: ${data.error || 'Unknown error'}`);
        }
        
        return data.data || [];
    }

    async deleteTorrent(torrentId) {
        const response = await fetch(`${this.baseUrl}/torrents/controltorrent`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                torrent_id: torrentId,
                operation: 'delete'
            })
        });

        const data = await response.json();
        if (!data.success) {
            console.error(`Failed to delete torrent ${torrentId} from Torbox.`);
        }
    }

    async getTorrentInfo(torrentId) {
        const torrents = await this.getTorrents();
        const torrent = torrents.find(t => t.id === parseInt(torrentId));
        
        if (!torrent) {
            throw new Error(`Torrent ${torrentId} not found in Torbox`);
        }
        
        return torrent;
    }

    async createDownload(torrentId, fileId = null) {
        const body = {
            torrent_id: parseInt(torrentId),
            file_id: fileId ? parseInt(fileId) : undefined,
            zip_link: false
        };

        const response = await fetch(`${this.baseUrl}/torrents/requestdl`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`Torbox API error: ${response.status}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(`Torbox error: ${data.error || 'Unknown error'}`);
        }
        
        return data.data; // Returns direct download URL
    }
}

// ✅ Debrid Service Factory - Supports both services simultaneously
function createDebridServices(config) {
    const services = {
        realdebrid: null,
        torbox: null,
        useRealDebrid: false,
        useTorbox: false,
        mediaflowProxy: null // NEW: MediaFlow Proxy config
    };
    
    // Check RealDebrid
    if (config.use_rd && config.rd_key && config.rd_key.length > 5) {
        console.log('🔵 Real-Debrid enabled');
        services.realdebrid = new RealDebrid(config.rd_key);
        services.useRealDebrid = true;
    }
    
    // Check Torbox
    if (config.use_torbox && config.torbox_key && config.torbox_key.length > 5) {
        console.log('📦 Torbox enabled');
        services.torbox = new Torbox(config.torbox_key);
        services.useTorbox = true;
    }
    
    // Check MediaFlow Proxy (for RD sharing)
    if (config.mediaflow_url && config.mediaflow_password) {
        console.log('🔀 MediaFlow Proxy enabled for RD sharing');
        services.mediaflowProxy = {
            url: config.mediaflow_url,
            password: config.mediaflow_password
        };
    }
    
    if (!services.useRealDebrid && !services.useTorbox) {
        console.log('⚪ No debrid service enabled - using P2P mode');
    }
    
    return services;
}

// ✅ MediaFlow Proxy Helper
function proxyThroughMediaFlow(directUrl, mediaflowConfig) {
    if (!mediaflowConfig || !mediaflowConfig.url) {
        return directUrl; // No proxy configured, return direct URL
    }
    
    try {
        // MediaFlow Proxy format: {mediaflow_url}/proxy/stream?d={base64_encoded_direct_url}&password={password}
        const encodedUrl = btoa(directUrl);
        const mediaflowUrl = mediaflowConfig.url.replace(/\/$/, ''); // Remove trailing slash
        const password = mediaflowConfig.password || '';
        
        const proxiedUrl = `${mediaflowUrl}/proxy/stream?d=${encodedUrl}&password=${encodeURIComponent(password)}`;
        
        console.log(`🔀 Proxying URL through MediaFlow`);
        return proxiedUrl;
    } catch (error) {
        console.error(`❌ MediaFlow proxy failed, using direct URL:`, error.message);
        return directUrl;
    }
}

// ✅ Helper functions (unchanged)
function getQualitySymbol(quality) {
    const qualityStr = String(quality).toLowerCase();
    
    if (qualityStr.includes('2160') || qualityStr.includes('4k') || qualityStr.includes('uhd')) {
        return '🔥';
    } else if (qualityStr.includes('1080')) {
        return '⭐';
    } else if (qualityStr.includes('720')) {
        return '✅';
    } else if (qualityStr.includes('480')) {
        return '📺';
    } else {
        return '🎬';
    }
}

function extractImdbId(id) {
    if (id.startsWith('tt')) return id;
    if (id.match(/^\d+$/)) return `tt${id}`;
    return null;
}

async function getTMDBDetailsByImdb(imdbId, tmdbApiKey) {
    try {
        const response = await fetch(`${TMDB_BASE_URL}/find/${imdbId}?api_key=${tmdbApiKey}&external_source=imdb_id`);
        if (!response.ok) throw new Error(`TMDB API error: ${response.status}`);
        const data = await response.json();
        
        if (data.movie_results?.[0]) {
            const movie = data.movie_results[0];
            const year = new Date(movie.release_date).getFullYear();
            return {
                title: movie.title,
                year: year,
                type: 'movie',
                tmdbId: movie.id
            };
        }
        
        if (data.tv_results?.[0]) {
            const show = data.tv_results[0];
            const year = new Date(show.first_air_date).getFullYear();
            return {
                title: show.name,
                year: year,
                type: 'series',
                tmdbId: show.id
            };
        }
        
        return null;
    } catch (error) {
        console.error('TMDB fetch error:', error);
        return null;
    }
}

async function getKitsuDetails(kitsuId) {
    try {
        const response = await fetch(`https://kitsu.io/api/edge/anime/${kitsuId}`);
        if (!response.ok) throw new Error(`Kitsu API error: ${response.status}`);
        const data = await response.json();
        const anime = data.data;
        const attributes = anime.attributes;
        
        // Collect all potential titles to maximize search success
        const titles = new Set();
        if (attributes.canonicalTitle) titles.add(attributes.canonicalTitle);
        if (attributes.titles.en) titles.add(attributes.titles.en);
        if (attributes.titles.en_jp) titles.add(attributes.titles.en_jp);
        if (attributes.abbreviatedTitles) {
            attributes.abbreviatedTitles.forEach(t => titles.add(t));
        }

        const year = attributes.startDate ? new Date(attributes.startDate).getFullYear() : null;

        return {
            titles: Array.from(titles), // Return an array of possible titles
            year: year,
            type: 'series',
            kitsuId: kitsuId
        };
    } catch (error) {
        console.error('Kitsu fetch error:', error);
        return null;
    }
}

// ✅ Enhanced caching with better cleanup
const cache = new Map();
const CACHE_TTL = 1800000; // 30 minutes
const MAX_CACHE_ENTRIES = 1000;

function cleanupCache() {
    const now = Date.now();
    const entries = Array.from(cache.entries());
    
    // Remove expired entries
    const validEntries = entries.filter(([key, { timestamp }]) => 
        now - timestamp <= CACHE_TTL
    );
    
    // If still too many entries, remove oldest
    if (validEntries.length > MAX_CACHE_ENTRIES) {
        validEntries.sort((a, b) => b[1].timestamp - a[1].timestamp);
        validEntries.splice(MAX_CACHE_ENTRIES);
    }
    
    // Rebuild cache
    cache.clear();
    validEntries.forEach(([key, value]) => cache.set(key, value));
    
    console.log(`🧹 Cache cleanup: kept ${cache.size} entries`);
}

let lastCleanup = 0;
function maybeCleanupCache() {
    const now = Date.now();
    if (now - lastCleanup > 300000) { // Every 5 minutes
        cleanupCache();
        lastCleanup = now;
    }
}

// ✅ Enhanced main fetch function
async function fetchUIndexData(searchQuery, type = 'movie', italianTitle = null) {
    console.log(`🔄 Fetching UIndex results for: "${searchQuery}" (type: ${type})`);

    // Check cache first
    const cacheKey = `uindex:${searchQuery}:${type}`;
    if (cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            console.log(`⚡ Using cached results for UIndex: "${searchQuery}"`);
            return cached.data;
        } else {
            cache.delete(cacheKey);
        }
    }

    try {
        // Use multi-strategy search for better results
        const rawResults = await searchUIndexMultiStrategy(searchQuery, type);
        
        if (!rawResults.length) {
            console.log('⚠️ No results found from any search strategy for UIndex');
            return [];
        }

        // Process and sort results
        const processedResults = processAndSortResults(rawResults, italianTitle);
        
        // Convert to expected format
        const formattedResults = processedResults.map(result => {
            let finalCategory = result.category || 'Unknown';
            const lowerCategory = finalCategory.toLowerCase();
            if (lowerCategory.startsWith('movie')) {
                finalCategory = 'Movies';
            } else if (lowerCategory.startsWith('tv') || lowerCategory.startsWith('telefilm') || lowerCategory.startsWith('serie')) {
                finalCategory = 'TV';
            } else if (lowerCategory.startsWith('anime')) {
                finalCategory = 'Anime';
            }
            return {
                magnetLink: result.magnetLink,
                websiteTitle: result.title,
                title: result.title,
                filename: result.title,
                quality: result.quality,
                size: result.size,
                source: result.source,
                seeders: result.seeders,
                leechers: result.leechers,
                infoHash: result.infoHash,
                mainFileSize: result.sizeInBytes,
                pubDate: new Date().toISOString(),
                categories: [finalCategory]
            };
        });

        // Cache results
        cache.set(cacheKey, {
            data: formattedResults,
            timestamp: Date.now()
        });

        console.log(`🎉 Successfully processed ${formattedResults.length} results for UIndex "${searchQuery}"`);
        return formattedResults;

    } catch (error) {
        console.error('❌ Error in fetchUIndexData:', error);
        return [];
    }
}

// ✅ Matching functions (unchanged but improved logging)
function isExactEpisodeMatch(torrentTitle, showTitleOrTitles, seasonNum, episodeNum, isAnime = false) {
    if (!torrentTitle || !showTitleOrTitles) return false;
    
    torrentTitle = torrentTitle.replace(/<[^>]*>/g, '')
        .replace(/[\[.*?\]]/g, '')
        .replace(/\(.*?\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    
    const normalizedTorrentTitle = torrentTitle.toLowerCase();
    const titlesToCheck = Array.isArray(showTitleOrTitles) ? showTitleOrTitles : [showTitleOrTitles];

    const titleIsAMatch = titlesToCheck.some(showTitle => {
        const normalizedShowTitle = showTitle.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        const showWords = normalizedShowTitle.split(' ')
            .filter(word => word.length > 2)
            .filter(word => !['the', 'and', 'or', 'in', 'on', 'at', 'to'].includes(word));
        
        if (showWords.length === 0) return false;

        const matchingWords = showWords.filter(word => 
            normalizedTorrentTitle.includes(word)
        );
        
        const percentageMatch = matchingWords.length / showWords.length;
        return percentageMatch >= 0.6;
    });
    
    if (!titleIsAMatch) {
        return false;
    }
    
    if (isAnime) {
        // For anime, a simple episode number match is often sufficient and more reliable.
        // Look for ` 01 `, ` E01`, ` - 01`, ` [01] ` etc.
        const episodeStr = String(episodeNum).padStart(2, '0');
        const animePatterns = [
            new RegExp(`\\b${episodeNum}\\b(?!p|i|\\.)`), // e.g., " 01 " but not "1080p" or "7.1"
            new RegExp(`\\b${episodeStr}\\b(?!p|i|\\.)`),
            new RegExp(`\\s-\\s${episodeStr}\\b`),
            new RegExp(`e${episodeStr}`, 'i')
        ];
        const matches = animePatterns.some(pattern => pattern.test(normalizedTorrentTitle));
        console.log(`${matches ? '✅' : '❌'} [ANIME] Episode match for "${torrentTitle}" Ep.${episodeNum}`);
        return matches;
    }
    
    const seasonStr = String(seasonNum).padStart(2, '0');
    const episodeStr = String(episodeNum).padStart(2, '0');
    
    const patterns = [
        new RegExp(`s${seasonStr}e${episodeStr}`, 'i'),
        new RegExp(`${seasonNum}x${episodeStr}`, 'i'),
        new RegExp(`[^0-9]${seasonNum}${episodeStr}[^0-9]`, 'i'),
        new RegExp(`season\s*${seasonNum}\s*episode\s*${episodeNum}`, 'i'),
        new RegExp(`s${seasonStr}\.?e${episodeStr}`, 'i'),
        new RegExp(`${seasonStr}${episodeStr}`, 'i')
    ];
        
    const matches = patterns.some(pattern => pattern.test(normalizedTorrentTitle));
    console.log(`${matches ? '✅' : '❌'} Episode match for "${torrentTitle}" S${seasonStr}E${episodeStr}`);
    return matches;
}

function isExactMovieMatch(torrentTitle, movieTitle, year) {
    if (!torrentTitle || !movieTitle) return false;
    
    torrentTitle = torrentTitle.replace(/<[^>]*>/g, '')
        .replace(/[\[.*?\]]/g, '')
        .replace(/\(.*?\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    
    const normalizedTorrentTitle = torrentTitle.toLowerCase();
    const normalizedMovieTitle = movieTitle.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    
    let hasEnoughMovieWords;

    const movieWords = normalizedMovieTitle.split(' ').filter(word => word.length > 2 && !['the', 'and', 'or', 'in', 'on', 'at', 'to'].includes(word));

    if (movieWords.length === 0) {
        // Handle very short titles like "F1" or "IT" where word-based matching would fail
        const titleRegex = new RegExp(`\\b${normalizedMovieTitle.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
        hasEnoughMovieWords = titleRegex.test(normalizedTorrentTitle);
    } else {
        const matchingWords = movieWords.filter(word => 
            normalizedTorrentTitle.includes(word)
        );
        const percentageMatch = matchingWords.length / movieWords.length;
        hasEnoughMovieWords = percentageMatch >= 0.7;
        if (!hasEnoughMovieWords) {
            console.log(`❌ Movie match failed for "${torrentTitle}" - ${percentageMatch.toFixed(2)} match`);
        }
    }
    
    if (!hasEnoughMovieWords) {
        return false;
    }
    
    const yearMatch = torrentTitle.match(/(?:19|20)\d{2}/);
    
    const yearMatches = !yearMatch || 
           yearMatch[0] === year.toString() || 
           Math.abs(parseInt(yearMatch[0]) - parseInt(year)) <= 1;
           
    console.log(`${yearMatches ? '✅' : '❌'} Year match for "${torrentTitle}" (${year})`);
    return yearMatches;
}

// ✅ Enhanced stream handler with better error handling and logging
async function handleStream(type, id, config, workerOrigin) {
    maybeCleanupCache();
    
    // The ID from Stremio might be URL-encoded, especially on Android.
    const decodedId = decodeURIComponent(id);
    
    console.log(`\n🎯 Processing ${type} with ID: ${decodedId}`);
    
    const startTime = Date.now();
    
    try {
        // Usa la configurazione passata, con fallback alle variabili d'ambiente
        const tmdbKey = config.tmdb_key;
        
        // ✅ Use debrid services factory (supports both RD and Torbox)
        const debridServices = createDebridServices(config);
        const useRealDebrid = debridServices.useRealDebrid;
        const useTorbox = debridServices.useTorbox;
        const rdService = debridServices.realdebrid;
        const torboxService = debridServices.torbox;

        let imdbId = null;
        let kitsuId = null;
        let season = null;
        let episode = null;
        let mediaDetails = null;

        if (decodedId.startsWith('kitsu:')) {
            const parts = decodedId.split(':');
            kitsuId = parts[1];
            season = parts[2];
            episode = parts[3];
            
            if (episode === undefined) {
                console.log('⚠️ Episode number missing from Kitsu ID, defaulting to episode 1.');
                episode = '1';
            }

            if (!kitsuId || !season || !episode) {
                console.log('❌ Invalid Kitsu series format');
                return { streams: [] };
            }
            
            console.log(`🌸 Looking up Kitsu details for: ${kitsuId}`);
            mediaDetails = await getKitsuDetails(kitsuId);
        } else {
            imdbId = decodedId;
            if (type === 'series') {
                const parts = decodedId.split(':');
                imdbId = parts[0];
                season = parts[1];
                episode = parts[2];
                
                if (!season || !episode) {
                    console.log('❌ Invalid series format');
                    return { streams: [] };
                }
            }
            
            const cleanImdbId = extractImdbId(imdbId);
            if (!cleanImdbId) {
                console.log('❌ Invalid IMDB ID format');
                return { streams: [] };
            }
            
            console.log(`🔍 Looking up TMDB details for: ${cleanImdbId}`);
            mediaDetails = await getTMDBDetailsByImdb(cleanImdbId, tmdbKey);
        }

        if (!mediaDetails) {
            console.log('❌ Could not find media details');
            return { streams: [] };
        }
        
        // --- NUOVA MODIFICA: Ottieni il titolo in italiano ---
        let italianTitle = null;
        let originalTitle = null;
        if (mediaDetails.tmdbId && !kitsuId) { // Solo per film/serie da TMDB
            try {
                const detailsWithExtras = await getTMDBDetails(mediaDetails.tmdbId, mediaDetails.type, tmdbKey, 'translations');
                const italianTranslation = detailsWithExtras?.translations?.translations?.find(t => t.iso_639_1 === 'it');
                
                if (italianTranslation && (italianTranslation.data.title || italianTranslation.data.name)) {
                    const foundTitle = italianTranslation.data.title || italianTranslation.data.name;
                    // Usa il titolo italiano solo se è diverso da quello inglese per evitare falsi positivi
                    if (foundTitle && foundTitle.toLowerCase() !== mediaDetails.title.toLowerCase()) {
                        italianTitle = foundTitle;
                        console.log(`🇮🇹 Found Italian title: "${italianTitle}"`);
                    }
                }

                if (detailsWithExtras && (detailsWithExtras.original_title || detailsWithExtras.original_name)) {
                    const foundOriginalTitle = detailsWithExtras.original_title || detailsWithExtras.original_name;
                    if (foundOriginalTitle && foundOriginalTitle.toLowerCase() !== mediaDetails.title.toLowerCase()) {
                        originalTitle = foundOriginalTitle;
                        console.log(`🌍 Found original title: "${originalTitle}"`);
                    }
                }
            } catch (e) {
                console.warn("⚠️ Could not fetch extra titles from TMDB.", e.message);
            }
        }
        // --- FINE MODIFICA ---

        const displayTitle = Array.isArray(mediaDetails.titles) ? mediaDetails.titles[0] : mediaDetails.title;
        console.log(`✅ Found: ${displayTitle} (${mediaDetails.year})`);

        // Build search queries
        const searchQueries = [];
        if (type === 'series') {
            if (kitsuId) { // Anime search strategy
                const uniqueQueries = new Set();
                // Use all available titles from Kitsu to build search queries
                for (const title of mediaDetails.titles) {
                    // 1. Title + episode number (e.g., "Naruto 24")
                    uniqueQueries.add(`${title} ${episode}`);
                    // 2. Title + SxxExx (e.g., "Naruto S01E24")
                    uniqueQueries.add(`${title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`);
                    // 3. Title + season pack (e.g., "Naruto S01")
                    uniqueQueries.add(`${title} S${String(season).padStart(2, '0')}`);
                    // 4. Just title
                    uniqueQueries.add(title);
                }
                searchQueries.push(...uniqueQueries);
            } else { // Regular series search strategy
                let baseQuery = `${mediaDetails.title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
                if (mediaDetails.tmdbId) {
                    const tvShowDetails = await getTVShowDetails(mediaDetails.tmdbId, season, episode, tmdbKey);
                    if (tvShowDetails && tvShowDetails.episodeTitle) {
                        baseQuery += ` ${tvShowDetails.episodeTitle}`;
                    }
                }
                searchQueries.push(baseQuery);
                searchQueries.push(`${mediaDetails.title} S${String(season).padStart(2, '0')}`);
                searchQueries.push(mediaDetails.title);
            }
        } else { // Movie
            searchQueries.push(`${mediaDetails.title} ${mediaDetails.year}`);
            searchQueries.push(mediaDetails.title); // Aggiunto per completezza
        }

        // --- NUOVA MODIFICA: Aggiungi titolo italiano alle query di ricerca ---
        if (italianTitle) {
            console.log(`🇮🇹 Adding Italian title "${italianTitle}" to search queries.`);
            if (type === 'series' && !kitsuId) {
                searchQueries.push(`${italianTitle} S${String(season).padStart(2, '0')}`);
                searchQueries.push(italianTitle);
            } else if (type === 'movie') {
                searchQueries.push(`${italianTitle} ${mediaDetails.year}`);
                searchQueries.push(italianTitle);
            }
        }

        if (originalTitle) {
            console.log(`🌍 Adding original title "${originalTitle}" to search queries.`);
            if (type === 'series' && !kitsuId) {
                searchQueries.push(`${originalTitle} S${String(season).padStart(2, '0')}`);
                searchQueries.push(originalTitle);
            } else if (type === 'movie') {
                searchQueries.push(`${originalTitle} ${mediaDetails.year}`);
                searchQueries.push(originalTitle);
            }
        }
        
        // Rimuovi duplicati e logga
        const finalSearchQueries = [...new Set(searchQueries)];
        console.log(`📚 Final search queries:`, finalSearchQueries);
        // --- FINE MODIFICA ---

        // --- NUOVA LOGICA DI AGGREGAZIONE E DEDUPLICAZIONE ---
        const allRawResults = [];
        const searchType = kitsuId ? 'anime' : type;
        const TOTAL_RESULTS_TARGET = 50; // Stop searching when we have enough results to avoid excessive subrequests.
        let totalQueries = 0;

        // ✅ Initialize Jackettio if ENV vars are set
        let jackettioInstance = null;
        if (config.jackett_url && config.jackett_api_key) {
            jackettioInstance = new Jackettio(
                config.jackett_url, 
                config.jackett_api_key,
                config.jackett_password // Optional password
            );
            console.log('🔍 [Jackettio] Instance initialized (ITALIAN ONLY mode)');
        }

        for (const query of finalSearchQueries) {
            console.log(`\n🔍 Searching all sources for: "${query}"`);

            // Stop searching if we have a good number of results to process.
            if (allRawResults.length >= TOTAL_RESULTS_TARGET * 4) { // *4 because we have 4 sources (including Jackettio)
                console.log(`🎯 Target of ~${TOTAL_RESULTS_TARGET} unique results likely reached. Stopping further searches.`);
                break;
            }

            const searchPromises = [
                fetchUIndexData(query, searchType, italianTitle),
                fetchCorsaroNeroData(query, searchType),
                fetchKnabenData(query, searchType)
            ];

            // Add Jackettio if configured
            if (jackettioInstance) {
                searchPromises.push(fetchJackettioData(query, searchType, jackettioInstance));
            }

            const results = await Promise.allSettled(searchPromises);

            // Process UIndex results
            if (results[0].status === 'fulfilled' && results[0].value) {
                console.log(`📊 UIndex returned ${results[0].value.length} results for query.`);
                allRawResults.push(...results[0].value);
            } else if (results[0].status === 'rejected') {
                console.error('❌ UIndex search failed:', results[0].reason);
            }

            // Process CorsaroNero results
            if (results[1].status === 'fulfilled' && results[1].value) {
                console.log(`🏴‍☠️ CorsaroNero returned ${results[1].value.length} results for query.`);
                allRawResults.push(...results[1].value);
            } else if (results[1].status === 'rejected') {
                console.error('❌ CorsaroNero search failed:', results[1].reason);
            }

            // Process Knaben results
            if (results[2].status === 'fulfilled' && results[2].value) {
                console.log(`🦉 Knaben.org returned ${results[2].value.length} results for query.`);
                allRawResults.push(...results[2].value);
            } else if (results[2].status === 'rejected') {
                console.error('❌ Knaben.org search failed:', results[2].reason);
            }

            // Process Jackettio results (if configured)
            if (jackettioInstance && results[3]) {
                if (results[3].status === 'fulfilled' && results[3].value) {
                    console.log(`🔍 Jackettio returned ${results[3].value.length} results for query.`);
                    allRawResults.push(...results[3].value);
                } else if (results[3].status === 'rejected') {
                    console.error('❌ Jackettio search failed:', results[3].reason);
                }
            }

            totalQueries++;
            if (totalQueries < finalSearchQueries.length) {
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }

        console.log(`🔎 Found a total of ${allRawResults.length} raw results from all sources. Performing smart deduplication...`);

        // Smart Deduplication
        const bestResults = new Map();
        for (const result of allRawResults) {
            if (!result.infoHash) continue;
            const hash = result.infoHash;
            const isNewItalian = isItalian(result.title, italianTitle);

            if (!bestResults.has(hash)) {
                bestResults.set(hash, result);
            } else {
                const existing = bestResults.get(hash);
                const isExistingItalian = isItalian(existing.title, italianTitle);

                let isNewBetter = false;
                // An Italian version is always better than a non-Italian one.
                if (isNewItalian && !isExistingItalian) {
                    isNewBetter = true;
                } else if (isNewItalian === isExistingItalian) {
                    // If language is the same, prefer Jackettio (private instance)
                    if (result.source === 'Jackettio' && existing.source !== 'Jackettio') {
                        isNewBetter = true;
                    } else if (existing.source === 'Jackettio' && result.source !== 'Jackettio') {
                        isNewBetter = false; // Keep Jackettio
                    } else if (result.source === 'CorsaroNero' && existing.source !== 'CorsaroNero' && existing.source !== 'Jackettio') {
                        isNewBetter = true;
                    } else if (result.source === existing.source || (result.source !== 'CorsaroNero' && existing.source !== 'CorsaroNero' && result.source !== 'Jackettio' && existing.source !== 'Jackettio')) {
                        // If source is also the same, or neither is the preferred one, prefer more seeders
                        if ((result.seeders || 0) > (existing.seeders || 0)) {
                            isNewBetter = true;
                        }
                    }
                }
                
                if (isNewBetter) {
                    bestResults.set(hash, result);
                }
            }
        }

        let results = Array.from(bestResults.values());
        console.log(`✨ After smart deduplication, we have ${results.length} unique, high-quality results.`);
        // --- FINE NUOVA LOGICA ---
        
        if (!results || results.length === 0) {
            console.log('❌ No results found from any source after all fallbacks');
            return { streams: [] };
        }
        
        console.log(`📡 Found ${results.length} total torrents from all sources after fallbacks`);
        
        // ✅ Apply exact matching filters
        let filteredResults = results;
        
        if (type === 'series') {
            const originalCount = filteredResults.length;
            filteredResults = filteredResults.filter(result => 
                isExactEpisodeMatch(
                    result.title || result.websiteTitle,
                    kitsuId ? mediaDetails.titles : mediaDetails.title,
                    parseInt(season),
                    parseInt(episode),
                    !!kitsuId
                )
            );
            console.log(`📺 Episode filtering: ${filteredResults.length} of ${originalCount} results match`);
            
            // If exact matching removed too many results, be more lenient
            if (filteredResults.length === 0 && originalCount > 0) {
                console.log('⚠️ Exact filtering removed all results, using broader match');
                filteredResults = results.slice(0, Math.min(10, results.length));
            }
        } else if (type === 'movie') {
            const originalCount = filteredResults.length;
            let movieDetails = null;
            if (mediaDetails.tmdbId) {
                movieDetails = await getTMDBDetails(mediaDetails.tmdbId, 'movie', tmdbKey);
            }
            filteredResults = filteredResults.filter(result => {
                const mainTitleMatch = isExactMovieMatch(
                    result.title || result.websiteTitle,
                    mediaDetails.title,
                    mediaDetails.year
                );
                if (mainTitleMatch) return true;

                if (movieDetails && movieDetails.original_title && movieDetails.original_title !== mediaDetails.title) {
                    return isExactMovieMatch(
                        result.title || result.websiteTitle,
                        movieDetails.original_title,
                        mediaDetails.year
                    );
                }
                return false;
            });
            console.log(`🎬 Movie filtering: ${filteredResults.length} of ${originalCount} results match`);
            
            // If exact matching removed too many results, be more lenient
            if (filteredResults.length === 0 && originalCount > 0) {
                console.log('⚠️ Exact filtering removed all results, using broader match');
                filteredResults = results.slice(0, Math.min(15, results.length));
            }
        }
        
        // Limit results for performance
        const maxResults = 30; // Increased limit
        filteredResults = filteredResults.slice(0, maxResults);
        
        console.log(`🔄 Checking debrid services for ${filteredResults.length} results...`);
        const hashes = filteredResults.map(t => t.infoHash.toLowerCase()).filter(h => h && h.length >= 32);
        
        if (hashes.length === 0) {
            console.log('❌ No valid info hashes found');
            return { streams: [] };
        }

        // ✅ Check cache for enabled services in parallel
        let rdCacheResults = {};
        let rdUserTorrents = [];
        let torboxCacheResults = {};
        let torboxUserTorrents = [];

        const cacheChecks = [];
        
        if (useRealDebrid) {
            console.log('🔵 Checking Real-Debrid cache...');
            cacheChecks.push(
                Promise.all([
                    rdService.checkCache(hashes),
                    rdService.getTorrents().catch(e => {
                        console.error("⚠️ Failed to fetch RD user torrents.", e.message);
                        return [];
                    })
                ]).then(([cache, torrents]) => {
                    rdCacheResults = cache;
                    rdUserTorrents = torrents;
                })
            );
        }
        
        if (useTorbox) {
            console.log('📦 Checking Torbox cache...');
            cacheChecks.push(
                Promise.all([
                    torboxService.checkCache(hashes),
                    torboxService.getTorrents().catch(e => {
                        console.error("⚠️ Failed to fetch Torbox user torrents.", e.message);
                        return [];
                    })
                ]).then(([cache, torrents]) => {
                    torboxCacheResults = cache;
                    torboxUserTorrents = torrents;
                })
            );
        }
        
        await Promise.all(cacheChecks);
        
        console.log(`✅ Cache check complete. RD: ${rdUserTorrents.length} torrents, Torbox: ${torboxUserTorrents.length} torrents`);
        
        // ✅ Build streams with enhanced error handling - supports multiple debrid services
        const streams = [];
        
        for (const result of filteredResults) {
            try {
                const qualityDisplay = result.quality ? result.quality.toUpperCase() : 'Unknown';
                const qualitySymbol = getQualitySymbol(qualityDisplay);
                const italianIcon = isItalian(result.title, italianTitle) ? '🇮🇹 ' : '';
                const encodedConfig = btoa(JSON.stringify(config));
                const infoHashLower = result.infoHash.toLowerCase();
                
                // ✅ REAL-DEBRID STREAM (if enabled)
                if (useRealDebrid) {
                    const rdCacheData = rdCacheResults[infoHashLower];
                    const rdUserTorrent = rdUserTorrents.find(t => t.hash?.toLowerCase() === infoHashLower);
                    
                    let streamUrl = '';
                    let cacheType = 'none';
                    let streamError = null;
                    
                    if (rdCacheData?.cached && rdCacheData.downloadLink) {
                        cacheType = 'global';
                        try {
                            console.log(`🔵 ⚡ Getting RD stream URL for GLOBAL cached: ${result.title}`);
                            const unrestricted = await rdService.unrestrictLink(rdCacheData.downloadLink);
                            let directUrl = unrestricted.download;
                            
                            // ✅ Proxy through MediaFlow if configured
                            if (debridServices.mediaflowProxy) {
                                streamUrl = proxyThroughMediaFlow(directUrl, debridServices.mediaflowProxy);
                            } else {
                                streamUrl = directUrl;
                            }
                        } catch (error) {
                            console.error(`❌ RD unrestrict failed. Fallback to add. Error:`, error.message);
                            cacheType = 'none';
                            streamUrl = `${workerOrigin}/rd-add/${encodedConfig}/${encodeURIComponent(result.magnetLink)}`;
                            streamError = error.message;
                        }
                    } else if (rdUserTorrent && rdUserTorrent.status === 'downloaded') {
                        cacheType = 'personal';
                        streamUrl = `${workerOrigin}/rd-stream-personal/${encodedConfig}/${rdUserTorrent.id}`;
                        console.log(`🔵 👤 Found in RD PERSONAL cache: ${result.title}`);
                    } else {
                        cacheType = 'none';
                        streamUrl = `${workerOrigin}/rd-add/${encodedConfig}/${encodeURIComponent(result.magnetLink)}`;
                    }
                    
                    const isCached = cacheType === 'global' || cacheType === 'personal';
                    const cachedIcon = isCached ? '⚡ ' : '📥🧲 ';
                    const errorIcon = streamError ? '⚠️ ' : '';
                    
                    const streamName = [
                        cachedIcon + errorIcon + '🔵 ',
                        `[${result.source}]`,
                        italianIcon,
                        qualitySymbol,
                        qualityDisplay,
                        `👥 ${result.seeders || 0}/${result.leechers || 0}`,
                        result.size && result.size !== 'Unknown' ? `💾 ${result.size}` : null
                    ].filter(Boolean).join(' | ');
                    
                    const debugInfo = streamError ? `\n⚠️ Stream error: ${streamError}` : '';
                    let cacheInfoText;
                    if (cacheType === 'global') {
                        cacheInfoText = '🔗 Streaming da cache Globale Real-Debrid';
                    } else if (cacheType === 'personal') {
                        cacheInfoText = '🔗 Streaming da cache Personale Real-Debrid';
                    } else {
                        cacheInfoText = '📥🧲 Aggiungi a Real-Debrid';
                    }
                    
                    const streamTitle = [
                        `🎬 ${result.title}`,
                        `📡 ${result.source} | 💾 ${result.size} | 👥 ${result.seeders || 0} seeds`,
                        cacheInfoText,
                        result.categories?.[0] ? `📂 ${result.categories[0]}` : '',
                        debugInfo
                    ].filter(Boolean).join('\n');
                    
                    streams.push({
                        name: streamName,
                        title: streamTitle,
                        url: streamUrl,
                        behaviorHints: {
                            bingeGroup: 'uindex-realdebrid-optimized',
                            notWebReady: false
                        },
                        _meta: { 
                            infoHash: result.infoHash, 
                            cached: isCached, 
                            cacheSource: cacheType, 
                            service: 'realdebrid',
                            originalSize: result.size, 
                            quality: result.quality, 
                            seeders: result.seeders, 
                            error: streamError 
                        }
                    });
                }
                
                // ✅ TORBOX STREAM (if enabled)
                if (useTorbox) {
                    const torboxCacheData = torboxCacheResults[infoHashLower];
                    const torboxUserTorrent = torboxUserTorrents.find(t => t.hash?.toLowerCase() === infoHashLower);
                    
                    let streamUrl = '';
                    let cacheType = 'none';
                    let streamError = null;
                    
                    if (torboxCacheData?.cached && torboxCacheData.downloadLink) {
                        cacheType = 'global';
                        streamUrl = `${workerOrigin}/torbox-stream/${encodedConfig}/${encodeURIComponent(result.infoHash)}`;
                        console.log(`📦 ⚡ Torbox GLOBAL cache available: ${result.title}`);
                    } else if (torboxUserTorrent && torboxUserTorrent.download_finished === true) {
                        cacheType = 'personal';
                        streamUrl = `${workerOrigin}/torbox-stream-personal/${encodedConfig}/${torboxUserTorrent.id}`;
                        console.log(`📦 👤 Found in Torbox PERSONAL cache: ${result.title}`);
                    } else {
                        cacheType = 'none';
                        streamUrl = `${workerOrigin}/torbox-add/${encodedConfig}/${encodeURIComponent(result.magnetLink)}`;
                    }
                    
                    const isCached = cacheType === 'global' || cacheType === 'personal';
                    const cachedIcon = isCached ? '⚡ ' : '📥🧲 ';
                    const errorIcon = streamError ? '⚠️ ' : '';
                    
                    const streamName = [
                        cachedIcon + errorIcon + '📦 ',
                        `[${result.source}]`,
                        italianIcon,
                        qualitySymbol,
                        qualityDisplay,
                        `👥 ${result.seeders || 0}/${result.leechers || 0}`,
                        result.size && result.size !== 'Unknown' ? `💾 ${result.size}` : null
                    ].filter(Boolean).join(' | ');
                    
                    let cacheInfoText;
                    if (cacheType === 'global') {
                        cacheInfoText = '🔗 Streaming da cache Globale Torbox';
                    } else if (cacheType === 'personal') {
                        cacheInfoText = '🔗 Streaming da cache Personale Torbox';
                    } else {
                        cacheInfoText = '📥🧲 Aggiungi a Torbox';
                    }
                    
                    const streamTitle = [
                        `🎬 ${result.title}`,
                        `📡 ${result.source} | 💾 ${result.size} | 👥 ${result.seeders || 0} seeds`,
                        cacheInfoText,
                        result.categories?.[0] ? `📂 ${result.categories[0]}` : '',
                    ].filter(Boolean).join('\n');
                    
                    streams.push({
                        name: streamName,
                        title: streamTitle,
                        url: streamUrl,
                        behaviorHints: {
                            bingeGroup: 'uindex-torbox-optimized',
                            notWebReady: false
                        },
                        _meta: { 
                            infoHash: result.infoHash, 
                            cached: isCached, 
                            cacheSource: cacheType, 
                            service: 'torbox',
                            originalSize: result.size, 
                            quality: result.quality, 
                            seeders: result.seeders 
                        }
                    });
                }
                
                // ✅ P2P STREAM (if no debrid service enabled)
                if (!useRealDebrid && !useTorbox) {
                    const streamName = [
                        '[P2P]',
                        `[${result.source}]`,
                        italianIcon,
                        qualitySymbol,
                        qualityDisplay,
                        `👥 ${result.seeders || 0}/${result.leechers || 0}`,
                        result.size && result.size !== 'Unknown' ? `💾 ${result.size}` : null
                    ].filter(Boolean).join(' | ');

                    const streamTitle = [
                        `🎬 ${result.title}`,
                        `📡 ${result.source} | 💾 ${result.size} | 👥 ${result.seeders || 0} seeds`,
                        '🔗 Link Magnet diretto (P2P)',
                        result.categories?.[0] ? `📂 ${result.categories[0]}` : ''
                    ].filter(Boolean).join('\n');

                    streams.push({
                        name: streamName,
                        title: streamTitle,
                        infoHash: result.infoHash,
                        behaviorHints: {
                            bingeGroup: 'uindex-p2p',
                            notWebReady: true
                        },
                        _meta: { infoHash: result.infoHash, cached: false, quality: result.quality, seeders: result.seeders }
                    });
                }
                
            } catch (error) {
                console.error(`❌ Error processing result:`, error);
                
                // Return a basic stream even if processing failed
                streams.push({
                    name: `❌ ${result.title} (Error)`,
                    title: `Error processing: ${error.message}`,
                    url: result.magnetLink,
                    behaviorHints: {
                        bingeGroup: 'uindex-error',
                        notWebReady: true
                    }
                });
            }
        }
        
        // ✅ Enhanced sorting: source, italian, cached first, then by quality, then by seeders
        streams.sort((a, b) => {
            const aCached = a.name.includes('⚡');
            const bCached = b.name.includes('⚡');
            const aError = a.name.includes('❌');
            const bError = b.name.includes('❌');
            const aItalian = a.name.includes('🇮🇹');
            const bItalian = b.name.includes('🇮🇹');
            const aIsCorsaro = a.name.includes('[CorsaroNero]');
            const bIsCorsaro = b.name.includes('[CorsaroNero]');

            // Errors go to bottom
            if (aError !== bError) return aError ? 1 : -1;

            // Cached streams go to top
            if (aCached !== bCached) return aCached ? -1 : 1;

            // Prioritize Italian results
            if (aItalian !== bItalian) return aItalian ? -1 : 1;

            // Then prioritize CorsaroNero
            if (aIsCorsaro !== bIsCorsaro) return aIsCorsaro ? -1 : 1;
            
            // Then by quality symbols (🔥 > ⭐ > ✅ > 📺 > 🎬)
            const qualityOrder = { '🔥': 5, '⭐': 4, '✅': 3, '📺': 2, '🎬': 1 };
            const getQuality = (name) => {
                const parts = name.split('|');
                for(const part of parts) {
                    const trimmed = part.trim();
                    if(qualityOrder[trimmed]) {
                        return qualityOrder[trimmed];
                    }
                }
                return 0;
            };
            const aQuality = getQuality(a.name);
            const bQuality = getQuality(b.name);
            if (aQuality !== bQuality) return bQuality - aQuality;
            
            // Finally by seeders
            const aSeeds = parseInt(a.name.match(/👥 (\d+)/)?.[1]) || 0;
            const bSeeds = parseInt(b.name.match(/👥 (\d+)/)?.[1]) || 0;
            return bSeeds - aSeeds;
        });
        const cachedCount = streams.filter(s => s.name.includes('⚡')).length;
        const totalTime = Date.now() - startTime;
        
        console.log(`🎉 Successfully processed ${streams.length} streams in ${totalTime}ms`);
        console.log(`⚡ ${cachedCount} cached streams available for instant playback`);
        
        return { 
            streams,
            _debug: {
                originalQuery: searchQueries[0],
                totalResults: results.length,
                filteredResults: filteredResults.length,
                finalStreams: streams.length,
                cachedStreams: cachedCount,
                processingTimeMs: totalTime,
                tmdbData: mediaDetails
            }
        };
        
    } catch (error) {
        const totalTime = Date.now() - startTime;
        console.error(`❌ Error in handleStream after ${totalTime}ms:`, error);
        
        return { 
            streams: [],
            _debug: {
                error: error.message,
                processingTimeMs: totalTime,
                step: 'handleStream'
            }
        };
    }
}

// ✅ TMDB helper functions (keeping existing but adding better error handling)
async function getTMDBDetails(tmdbId, type = 'movie', tmdbApiKey, append = 'external_ids') {
    try {
        const response = await fetch(`${TMDB_BASE_URL}/${type}/${tmdbId}?api_key=${tmdbApiKey}&append_to_response=${append}`);
        if (!response.ok) throw new Error(`TMDB API error: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error('TMDB fetch error:', error);
        return null;
    }
}

async function getTVShowDetails(tmdbId, seasonNum, episodeNum, tmdbApiKey) {
    try {
        const showResponse = await fetch(
            `${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${tmdbApiKey}&append_to_response=external_ids`
        );
        if (!showResponse.ok) throw new Error(`TMDB API error: ${showResponse.status}`);
        const showData = await showResponse.json();

        const episodeResponse = await fetch(
            `${TMDB_BASE_URL}/tv/${tmdbId}/season/${seasonNum}/episode/${episodeNum}?api_key=${tmdbApiKey}`
        );
        if (!episodeResponse.ok) throw new Error(`TMDB API error: ${episodeResponse.status}`);
        const episodeData = await episodeResponse.json();

        return {
            showTitle: showData.name,
            episodeTitle: episodeData.name,
            seasonNumber: seasonNum,
            episodeNumber: episodeNum,
            airDate: episodeData.air_date,
            imdbId: showData.external_ids?.imdb_id
        };
    } catch (error) {
        console.error('TMDB fetch error:', error);
        return null;
    }
}

// ✅ Enhanced search endpoint for testing
async function handleSearch({ query, type }, config) {
    if (!query) throw new Error('Missing required parameter: query');
    if (!['movie', 'series', 'anime'].includes(type)) throw new Error('Invalid type. Must be "movie", "series", or "anime"');

    console.log(`🔍 Handling search: "${query}" (${type})`);
    
    try {
        // --- MODIFICA: RICERCA E ORDINAMENTO SEPARATO ---
        const [uindexResults, corsaroNeroResults, knabenResults] = await Promise.allSettled([
            fetchUIndexData(query, type, null), // italianTitle non è disponibile qui
            fetchCorsaroNeroData(query, type), // Non richiede config
            fetchKnabenData(query, type)      // Non richiede config
        ]);

        let corsaroAggregatedResults = [];
        if (corsaroNeroResults.status === 'fulfilled' && corsaroNeroResults.value) {
            corsaroAggregatedResults.push(...corsaroNeroResults.value);
        }

        let uindexAggregatedResults = [];
        if (uindexResults.status === 'fulfilled' && uindexResults.value) {
            uindexAggregatedResults.push(...uindexResults.value);
        }

        let knabenAggregatedResults = [];
        if (knabenResults.status === 'fulfilled' && knabenResults.value) {
            knabenAggregatedResults.push(...knabenResults.value);
        }

        // Deduplicate and sort
        const seenHashes = new Set();
        
        const uniqueCorsaro = corsaroAggregatedResults.filter(r => {
            if (!r.infoHash || seenHashes.has(r.infoHash)) return false;
            seenHashes.add(r.infoHash);
            return true;
        });
        const sortedCorsaro = sortByQualityAndSeeders(uniqueCorsaro);
        const limitedCorsaro = limitResultsByQuality(sortedCorsaro, 5);

        const uniqueUindex = uindexAggregatedResults.filter(r => {
            if (!r.infoHash || seenHashes.has(r.infoHash)) return false;
            seenHashes.add(r.infoHash);
            return true;
        });
        const sortedUindex = sortByQualityAndSeeders(uniqueUindex);
        const limitedUindex = limitResultsByQuality(sortedUindex, 5);

        const uniqueKnaben = knabenAggregatedResults.filter(r => {
            if (!r.infoHash || seenHashes.has(r.infoHash)) return false;
            seenHashes.add(r.infoHash);
            return true;
        });
        const sortedKnaben = sortByQualityAndSeeders(uniqueKnaben);
        const limitedKnaben = limitResultsByQuality(sortedKnaben, 5);

        const results = [...limitedCorsaro, ...limitedKnaben, ...limitedUindex];
        // --- FINE MODIFICA ---

        return {
            query: query,
            type: type,
            totalResults: results.length,
            results: results.slice(0, 50).map(result => ({
                title: result.title,
                filename: result.filename,
                quality: result.quality,
                size: result.size,
                seeders: result.seeders,
                leechers: result.leechers,
                magnetLink: result.magnetLink,
                infoHash: result.infoHash,
                source: result.source
            }))
        };
    } catch (error) {
        console.error(`❌ Error in handleSearch:`, error);
        throw error;
    }
}

// ✅ Main Vercel Serverless Function handler
export default async function handler(req, res) {
    const startTime = Date.now();
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
    
    // Set CORS headers for all responses
    Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
    
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    // Vercel adaptation: get env from process.env
    const env = process.env;

    const url = new URL(req.url, `https://${req.headers.host}`);
    console.log(`🌐 ${req.method} ${url.pathname} - ${req.headers['user-agent']?.substring(0, 50) || 'Unknown'}`);

    // ✅ Serve la pagina di configurazione alla root
    if (url.pathname === '/') {
        try {
            // Vercel adaptation: read template.html from the filesystem
            const templatePath = path.join(process.cwd(), 'template.html');
            const templateHtml = await fs.readFile(templatePath, 'utf-8');
            res.setHeader('Content-Type', 'text/html;charset=UTF-8');
            return res.status(200).send(templateHtml);
        } catch (e) {
             console.error("Error reading template.html:", e);
             return res.status(500).send('Template not found.');
        }
    }

    try {
        // Stremio manifest
        // Gestisce sia /manifest.json che /{config}/manifest.json
        if (url.pathname.endsWith('/manifest.json')) {
            const manifest = {
                id: 'community.stremizio.plus.ita',
                version: '2.0.0',
                name: 'Stremizio 2.0',
                description: 'Streaming da UIndex, CorsaroNero, Knaben e Jackettio con o senza Real-Debrid.',
                logo: `${url.origin}/logo.png`,
                resources: ['stream'],
                types: ['movie', 'series', 'anime'],
                idPrefixes: ['tt', 'kitsu'],
                catalogs: [],
                behaviorHints: {
                    adult: false,
                    p2p: true, // Indica che può restituire link magnet
                    configurable: false // Rimosso per evitare il pulsante "Configure" dopo l'installazione
                }
            };

            res.setHeader('Content-Type', 'application/json');
            return res.status(200).send(JSON.stringify(manifest, null, 2));
        }

        // Stream endpoint (main functionality)
        // Gestisce il formato /{config}/stream/{type}/{id} inviato da Stremio
        if (url.pathname.includes('/stream/')) {
            const pathParts = url.pathname.split('/'); // e.g., ['', '{config}', 'stream', '{type}', '{id}.json']

            // Estrae la configurazione dal primo segmento del path
            const encodedConfigStr = pathParts[1]; 
            let config = {};
            if (encodedConfigStr) {
                try {
                    config = JSON.parse(atob(encodedConfigStr));
                } catch (e) {
                    console.error("Errore nel parsing della configurazione (segmento 1) dall'URL:", e);
                }
            }

            // ✅ Add Jackettio ENV vars if available (fallback for private use)
            if (env.JACKETT_URL && env.JACKETT_API_KEY) {
                config.jackett_url = env.JACKETT_URL;
                config.jackett_api_key = env.JACKETT_API_KEY;
                config.jackett_password = env.JACKETT_PASSWORD; // Optional
                console.log('🔍 [Jackettio] Using ENV configuration');
            }

            // ✅ Add MediaFlow Proxy ENV vars if available (for RD sharing)
            if (env.MEDIAFLOW_URL && env.MEDIAFLOW_PASSWORD) {
                config.mediaflow_url = env.MEDIAFLOW_URL;
                config.mediaflow_password = env.MEDIAFLOW_PASSWORD;
                console.log('🔀 [MediaFlow] Using ENV configuration for RD sharing');
            }

            // Estrae tipo e id dalle posizioni corrette
            const type = pathParts[3];
            const idWithSuffix = pathParts[4] || '';
            const id = idWithSuffix.replace(/\.json$/, '');

            if (!type || !id || id.includes('config=')) { // Aggiunto controllo per evitare ID errati
                res.setHeader('Content-Type', 'application/json');
                return res.status(400).send(JSON.stringify({ streams: [], error: 'Invalid stream path' }));
            }

            // Passa la configurazione estratta (o un oggetto vuoto) a handleStream.
            // Usa solo la configurazione dall'URL, senza fallback.
            const result = await handleStream(type, id, config, url.origin);
            const responseTime = Date.now() - startTime;
            
            console.log(`✅ Stream request completed in ${responseTime}ms`);
            
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('X-Response-Time', `${responseTime}ms`);
            res.setHeader('X-Results-Count', result.streams?.length || 0);
            return res.status(200).send(JSON.stringify(result));
        }
        
        // Endpoint to handle adding magnets to Real-Debrid for Android/Web compatibility
        if (url.pathname.startsWith('/rd-add/')) {
            const pathParts = url.pathname.split('/'); // e.g., ['', 'rd-add', 'config_string', 'magnet_link']
            const encodedConfigStr = pathParts[2];
            const encodedMagnet = pathParts[3];
            
            const htmlResponse = (title, message, isError = false) => `
                <!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title>
                <style>body{font-family:sans-serif;background-color:#1E1E1E;color:#E0E0E0;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;padding:1em;} .container{max-width:90%;padding:2em;background-color:#2A2A2A;border-radius:8px;box-shadow:0 4px 8px rgba(0,0,0,0.3);} h1{color:${isError ? '#FF6B6B' : '#4EC9B0'};}</style>
                </head><body><div class="container"><h1>${title}</h1><p>${message}</p></div></body></html>`;
            
            let userConfig = {};
            res.setHeader('Content-Type', 'text/html');
            try {
                if (!encodedConfigStr) throw new Error("Configurazione mancante nell'URL.");
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(htmlResponse('Errore di Configurazione', `Impossibile leggere la configurazione dall'URL: ${e.message}`, true));
            }

            if (!userConfig.rd_key) {
                return res.status(400).send(htmlResponse('Errore di Configurazione', 'La chiave API di Real-Debrid non è stata configurata. Impossibile aggiungere il torrent.', true));
            }

            if (!encodedMagnet) {
                return res.status(400).send(htmlResponse('Errore', 'Link magnet non valido.', true));
            }

            try {
                // ... (tutta la logica interna di /rd-add/ rimane invariata) ...
                // ...

                const magnetLink = decodeURIComponent(encodedMagnet);
                const infoHash = extractInfoHash(magnetLink);
                if (!infoHash) throw new Error('Magnet link non valido o senza info hash.');

                const realdebrid = new RealDebrid(userConfig.rd_key);

                // --- Robust Torrent Handling ---
                const userTorrents = await realdebrid.getTorrents();
                let torrent = userTorrents.find(t => t.hash.toLowerCase() === infoHash.toLowerCase());

                if (torrent) {
                    try {
                        const errorStates = ['error', 'magnet_error', 'virus', 'dead'];
                        const torrentInfo = await realdebrid.getTorrentInfo(torrent.id);
                        if (errorStates.includes(torrentInfo.status)) {
                            console.log(`🗑️ Found stale/failed torrent (ID: ${torrent.id}, Status: ${torrentInfo.status}). Deleting it.`);
                            await realdebrid.deleteTorrent(torrent.id);
                            torrent = null; // Force re-adding
                        }
                    } catch (e) {
                        console.warn(`⚠️ Could not get info for existing torrent ${torrent.id}. Deleting it as a precaution.`, e.message);
                        await realdebrid.deleteTorrent(torrent.id).catch(err => console.error(`Error during precautionary delete: ${err.message}`));
                        torrent = null; // Force re-adding
                    }
                }

                let torrentId;
                if (!torrent) {
                    console.log(`ℹ️ Adding new torrent with hash ${infoHash}.`);
                    const addResponse = await realdebrid.addMagnet(magnetLink);
                    torrentId = addResponse.id;
                    if (!torrentId) throw new Error('Impossibile ottenere l\'ID del torrent da Real-Debrid.');
                } else {
                    torrentId = torrent.id;
                    console.log(`ℹ️ Using existing torrent. ID: ${torrentId}`);
                }

                let torrentInfo;
                let actionTaken = false;
                for (let i = 0; i < 15; i++) { // Poll for up to ~30 seconds
                    if (i === 0) await new Promise(resolve => setTimeout(resolve, 1500));

                    torrentInfo = await realdebrid.getTorrentInfo(torrentId);
                    const status = torrentInfo.status;
                    console.log(`[Attempt ${i + 1}/15] Torrent ${torrentId} status: ${status}`);

                    if (status === 'waiting_files_selection') {
                        console.log(`▶️ Torrent requires file selection. Selecting main video file...`);
                        if (!torrentInfo.files || torrentInfo.files.length === 0) throw new Error('Torrent is empty or invalid.');
                        
                        const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                        const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];

                        const videoFiles = torrentInfo.files.filter(file => {
                            const lowerPath = file.path.toLowerCase();
                            return videoExtensions.some(ext => lowerPath.endsWith(ext)) &&
                                   !junkKeywords.some(junk => lowerPath.includes(junk));
                        });
                        
                        const fileToDownload = videoFiles.length > 0
                            ? videoFiles.reduce((max, file) => (file.bytes > max.bytes ? file : max), videoFiles[0])
                            : torrentInfo.files.reduce((max, file) => (file.bytes > max.bytes ? file : max), torrentInfo.files[0]);

                        if (!fileToDownload) throw new Error('Impossibile determinare il file da scaricare nel torrent.');
                        
                        await realdebrid.selectFiles(torrentId, fileToDownload.id);
                        console.log(`✅ Download started for file: ${fileToDownload.path}`);
                        actionTaken = true;
                        break;
                    }

                    if (['queued', 'downloading', 'downloaded'].includes(status)) {
                        console.log(`ℹ️ Torrent is already active (status: ${status}). No action needed.`);
                        actionTaken = true;
                        break;
                    }

                    if (status === 'magnet_conversion') {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    }

                    const errorStates = ['error', 'magnet_error', 'virus', 'dead'];
                    if (errorStates.includes(status)) {
                        throw new Error(`Torrent has a critical error state: ${status}`);
                    }

                    await new Promise(resolve => setTimeout(resolve, 2000));
                }

                if (!actionTaken) {
                    throw new Error(`Torrent did not become active after polling. Last status: ${torrentInfo.status}`);
                }

                if (torrentInfo.status === 'downloaded') {
                    console.log('✅ Torrent already downloaded. Getting stream link directly...');
                    try {
                        if (!torrentInfo.links || torrentInfo.links.length === 0) throw new Error('Torrent scaricato ma Real-Debrid non ha fornito un link.');
                        
                        let downloadLink;
                        if (torrentInfo.links.length === 1) {
                            downloadLink = torrentInfo.links[0];
                        } else {
                            const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                            const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];
                            const selectedVideoFiles = torrentInfo.files.filter(file => file.selected === 1 && videoExtensions.some(ext => file.path.toLowerCase().endsWith(ext)) && !junkKeywords.some(junk => file.path.toLowerCase().includes(junk)));
                            let mainFile = selectedVideoFiles.length > 0 ? selectedVideoFiles.reduce((max, file) => (file.bytes > (max?.bytes || 0) ? file : max), null) : torrentInfo.files.filter(f => f.selected === 1).reduce((max, file) => (file.bytes > (max?.bytes || 0) ? file : max), null);
                            if (!mainFile) throw new Error('Torrent completato ma nessun file valido risulta selezionato.');
                            const filename = mainFile.path.split('/').pop();
                            downloadLink = torrentInfo.links.find(link => decodeURIComponent(link).endsWith(filename));
                            if (!downloadLink) throw new Error(`Could not match filename "${filename}" to any of the available links.`);
                        }

                        const unrestricted = await realdebrid.unrestrictLink(downloadLink);
                        console.log(`🚀 Redirecting directly to stream: ${unrestricted.download}`);
                        
                        res.setHeader('Location', unrestricted.download);
                        return res.status(302).end();

                    } catch (redirectError) {
                        console.error(`❌ Failed to get direct stream link, falling back to polling page. Error: ${redirectError.message}`);
                    }
                }

                const pollingPage = `
                    <!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Caricamento in corso...</title>
                    <style>
                        body{font-family:sans-serif;background-color:#1E1E1E;color:#E0E0E0;display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;padding:1em;}
                        .container{max-width:90%;padding:2em;background-color:#2A2A2A;border-radius:8px;box-shadow:0 4px 8px rgba(0,0,0,0.3);}
                        h1{color:#4EC9B0; margin-bottom: 0.5em;}
                        #status{font-size:1.2em; margin-top: 1em; min-height: 2em;}
                        .progress-bar{width:80%;background-color:#333;border-radius:5px;overflow:hidden;margin-top:1em;}
                        #progress{width:0%;height:20px;background-color:#4EC9B0;transition:width 0.5s ease-in-out;}
                        .loader { border: 4px solid #f3f3f3; border-top: 4px solid #4EC9B0; border-radius: 50%; width: 40px; height: 40px; animation: spin 2s linear infinite; }
                        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    </style>
                    </head><body><div class="container">
                        <div class="loader"></div>
                        <h1>Aggiunto a Real-Debrid</h1>
                        <p>Attendi il completamento del download. Lo streaming partirà in automatico.</p>
                        <div id="status">Inizializzazione...</div>
                        <div class="progress-bar"><div id="progress"></div></div>
                    </div> 
                    <script>
                        const torrentId = '${torrentId}';
                        const statusEl = document.getElementById('status');
                        const progressEl = document.getElementById('progress');
                        let pollCount = 0;
                        const maxPolls = 180; // 30 minutes timeout (180 polls * 10 seconds)

                        function pollStatus() {
                            if (pollCount++ > maxPolls) {
                                statusEl.textContent = 'Errore: Timeout. Il download sta impiegando troppo tempo. Controlla il tuo account Real-Debrid.';
                                statusEl.style.color = '#FF6B6B';
                                return;
                            }

                            fetch('/rd-status/${encodedConfigStr}/' + torrentId)
                                .then(res => res.json())
                                .then(data => {
                                    if (data.status === 'ready' && data.url) {
                                        statusEl.textContent = 'Download completato! Avvio dello streaming...';
                                        window.location.href = data.url;
                                    } else if (data.status === 'downloading') {
                                        statusEl.textContent = \`Download in corso... \${data.progress}% (\${data.speed} KB/s)\`;
                                        progressEl.style.width = data.progress + '%';
                                        setTimeout(pollStatus, 5000); // Poll faster when downloading
                                    } else if (data.status === 'queued') {
                                        statusEl.textContent = 'In coda su Real-Debrid...';
                                        setTimeout(pollStatus, 10000); // Poll slower when queued
                                    } else if (data.status === 'magnet_conversion' || data.status === 'waiting_files_selection') {
                                        statusEl.textContent = 'Analisi del torrent in corso...';
                                        setTimeout(pollStatus, 7000);
                                    } else if (data.status === 'error') {
                                        statusEl.textContent = 'Errore: ' + data.message;
                                        statusEl.style.color = '#FF6B6B';
                                    } else {
                                        statusEl.textContent = 'Errore: stato sconosciuto (' + data.status + '). Controlla il tuo account Real-Debrid.';
                                        statusEl.style.color = '#FF6B6B';
                                    }
                                })
                                .catch(err => {
                                    statusEl.textContent = 'Errore di connessione durante il controllo dello stato.';
                                    statusEl.style.color = '#FF6B6B';
                                });
                        }
                        setTimeout(pollStatus, 2000); // Initial delay
                    </script>
                    </body></html>
                `;
                return res.status(200).send(pollingPage);

            } catch (error) {
                console.error('❌ Error adding magnet to RD:', error);
                return res.status(500).send(htmlResponse('Errore', `Impossibile aggiungere il torrent a Real-Debrid: ${error.message}`, true));
            }
        }

        // Endpoint to stream from a user's personal torrents
        if (url.pathname.startsWith('/rd-stream-personal/')) {
            const pathParts = url.pathname.split('/'); // e.g., ['', 'rd-stream-personal', 'config_string', 'torrent_id']
            const encodedConfigStr = pathParts[2];
            const torrentId = pathParts[3];

            const htmlResponse = (title, message, isError = false) => `
                <!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title>
                <style>body{font-family:sans-serif;background-color:#1E1E1E;color:#E0E0E0;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;padding:1em;} .container{max-width:90%;padding:2em;background-color:#2A2A2A;border-radius:8px;box-shadow:0 4px 8px rgba(0,0,0,0.3);} h1{color:${isError ? '#FF6B6B' : '#4EC9B0'};}</style>
                </head><body><div class="container"><h1>${title}</h1><p>${message}</p></div></body></html>`;
            
            res.setHeader('Content-Type', 'text/html');
            let userConfig = {};
            try {
                if (!encodedConfigStr) throw new Error("Configurazione mancante nell'URL.");
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(htmlResponse('Errore di Configurazione', `Impossibile leggere la configurazione dall'URL: ${e.message}`, true));
            }

            if (!torrentId) {
                return res.status(400).send(htmlResponse('Errore', 'ID torrent non valido.', true));
            }

            try {
                // ... (tutta la logica interna di /rd-stream-personal/ rimane invariata) ...
                // ...
                console.log(`👤 Streaming from personal torrent ID: ${torrentId}`);
                const realdebrid = new RealDebrid(userConfig.rd_key);
                const torrentInfo = await realdebrid.getTorrentInfo(torrentId);

                if (torrentInfo.status !== 'downloaded') {
                    throw new Error(`Il torrent non è ancora pronto. Stato: ${torrentInfo.status}. Riprova più tardi.`);
                }

                if (!torrentInfo.links || torrentInfo.links.length === 0) {
                    throw new Error('Torrent scaricato ma Real-Debrid non ha fornito un link.');
                }

                let downloadLink;
                if (torrentInfo.links.length === 1) {
                    downloadLink = torrentInfo.links[0];
                } else {
                    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                    const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];

                    let bestFile = null;
                    const selectedFiles = torrentInfo.files.filter(f => f.selected === 1);

                    for (const file of selectedFiles) {
                        const lowerPath = file.path.toLowerCase();
                        
                        const hasVideoExtension = videoExtensions.some(ext => lowerPath.endsWith(ext));
                        if (!hasVideoExtension) continue;

                        const isLikelyJunk = junkKeywords.some(junk => lowerPath.includes(junk)) && file.bytes < 250 * 1024 * 1024;
                        if (isLikelyJunk) continue;

                        if (!bestFile || file.bytes > bestFile.bytes) {
                            bestFile = file;
                        }
                    }

                    if (!bestFile) {
                        bestFile = selectedFiles.reduce((max, file) => (file.bytes > (max?.bytes || 0) ? file : max), null);
                    }

                    if (!bestFile) throw new Error('Impossibile determinare il file principale nel torrent.');

                    const filename = bestFile.path.split('/').pop();
                    downloadLink = torrentInfo.links.find(link => decodeURIComponent(link).endsWith(filename));

                    if (!downloadLink) throw new Error(`Impossibile trovare il link per il file: ${filename}`);
                }

                const unrestricted = await realdebrid.unrestrictLink(downloadLink);
                let finalStreamUrl = unrestricted.download;
                
                // ✅ Proxy through MediaFlow if configured
                if (userConfig.mediaflow_url && userConfig.mediaflow_password) {
                    const mediaflowConfig = {
                        url: userConfig.mediaflow_url,
                        password: userConfig.mediaflow_password
                    };
                    finalStreamUrl = proxyThroughMediaFlow(finalStreamUrl, mediaflowConfig);
                }
                
                console.log(`🚀 Redirecting to personal stream`);

                res.setHeader('Location', finalStreamUrl);
                return res.status(302).end();

            } catch (error) {
                console.error('❌ Error streaming from personal RD torrent:', error);
                return res.status(500).send(htmlResponse('Errore', `Impossibile avviare lo streaming dal torrent personale: ${error.message}`, true));
            }
        }

        // Endpoint to poll torrent status
        if (url.pathname.startsWith('/rd-status/')) {
            const pathParts = url.pathname.split('/'); // e.g., ['', 'rd-status', 'config_string', 'torrent_id']
            const encodedConfigStr = pathParts[2];
            const torrentId = pathParts[3];

            res.setHeader('Content-Type', 'application/json');
            let userConfig = {};
            try {
                if (!encodedConfigStr) throw new Error("Configurazione mancante nell'URL.");
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(JSON.stringify({ status: 'error', message: `Configurazione non valida: ${e.message}` }));
            }

            if (!torrentId) {
                return res.status(400).send(JSON.stringify({ status: 'error', message: 'Missing torrent ID' }));
            }

            try {
                // ... (tutta la logica interna di /rd-status/ rimane invariata) ...
                // ...
                const realdebrid = new RealDebrid(userConfig.rd_key);
                const torrentInfo = await realdebrid.getTorrentInfo(torrentId);

                if (torrentInfo.links && torrentInfo.links.length > 0) {
                    let downloadLink;

                    if (torrentInfo.links.length === 1) {
                        downloadLink = torrentInfo.links[0];
                    } else {
                        const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                        const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];

                        const selectedVideoFiles = torrentInfo.files.filter(file => {
                            if (file.selected !== 1) return false;
                            const lowerPath = file.path.toLowerCase();
                            return videoExtensions.some(ext => lowerPath.endsWith(ext)) && !junkKeywords.some(junk => lowerPath.includes(junk));
                        });

                        let mainFile = selectedVideoFiles.length > 0
                            ? selectedVideoFiles.reduce((max, file) => (file.bytes > (max?.bytes || 0) ? file : max), null)
                            : torrentInfo.files.filter(file => file.selected === 1).reduce((max, file) => (file.bytes > (max?.bytes || 0) ? file : max), null);

                        if (!mainFile) throw new Error('Torrent completato ma nessun file valido risulta selezionato.');
                        
                        const filename = mainFile.path.split('/').pop();
                        downloadLink = torrentInfo.links.find(link => decodeURIComponent(link).endsWith(filename));

                        if (!downloadLink) throw new Error(`Could not match filename "${filename}" to any of the available links.`);
                    }

                    const unrestricted = await realdebrid.unrestrictLink(downloadLink);

                    return res.status(200).send(JSON.stringify({ status: 'ready', url: unrestricted.download }));
                }

                if (['queued', 'downloading', 'magnet_conversion', 'waiting_files_selection'].includes(torrentInfo.status)) {
                    return res.status(200).send(JSON.stringify({
                        status: torrentInfo.status,
                        progress: torrentInfo.progress || 0,
                        speed: torrentInfo.speed ? Math.round(torrentInfo.speed / 1024) : 0
                    }));
                }
                
                if (torrentInfo.status === 'downloaded') {
                    throw new Error('Torrent scaricato, ma Real-Debrid non ha fornito un link valido.');
                } else {
                    throw new Error(`Stato del torrent non gestito o in errore su Real-Debrid: ${torrentInfo.status} - ${torrentInfo.error || 'Sconosciuto'}`);
                }

            } catch (error) {
                console.error(`❌ Error checking RD status for ${torrentId}:`, error);
                return res.status(500).send(JSON.stringify({ status: 'error', message: error.message }));
            }
        }

        // ✅ TORBOX ROUTES - Add torrent to Torbox
        if (url.pathname.startsWith('/torbox-add/')) {
            const pathParts = url.pathname.split('/');
            const encodedConfigStr = pathParts[2];
            const encodedMagnet = pathParts[3];
            
            const htmlResponse = (title, message, isError = false) => `
                <!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title>
                <style>body{font-family:sans-serif;background-color:#1E1E1E;color:#E0E0E0;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;padding:1em;} .container{max-width:90%;padding:2em;background-color:#2A2A2A;border-radius:8px;box-shadow:0 4px 8px rgba(0,0,0,0.3);} h1{color:${isError ? '#FF6B6B' : '#4EC9B0'};}</style>
                </head><body><div class="container"><h1>${title}</h1><p>${message}</p></div></body></html>`;
            
            let userConfig = {};
            res.setHeader('Content-Type', 'text/html');
            try {
                if (!encodedConfigStr) throw new Error("Configurazione mancante nell'URL.");
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(htmlResponse('Errore di Configurazione', `Impossibile leggere la configurazione dall'URL: ${e.message}`, true));
            }

            if (!userConfig.torbox_key) {
                return res.status(400).send(htmlResponse('Errore di Configurazione', 'La chiave API di Torbox non è stata configurata.', true));
            }

            if (!encodedMagnet) {
                return res.status(400).send(htmlResponse('Errore', 'Link magnet non valido.', true));
            }

            try {
                const magnetLink = decodeURIComponent(encodedMagnet);
                const infoHash = extractInfoHash(magnetLink);
                if (!infoHash) throw new Error('Magnet link non valido o senza info hash.');

                const torbox = new Torbox(userConfig.torbox_key);

                const userTorrents = await torbox.getTorrents();
                let torrent = userTorrents.find(t => t.hash?.toLowerCase() === infoHash.toLowerCase());

                let torrentId;
                if (!torrent) {
                    console.log(`📦 Adding new torrent to Torbox: ${infoHash}`);
                    const addResponse = await torbox.addTorrent(magnetLink);
                    torrentId = addResponse.torrent_id || addResponse.id;
                    if (!torrentId) throw new Error('Impossibile ottenere l\'ID del torrent da Torbox.');
                } else {
                    torrentId = torrent.id;
                    console.log(`📦 Using existing Torbox torrent. ID: ${torrentId}`);
                }

                for (let i = 0; i < 20; i++) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    const torrentInfo = await torbox.getTorrentInfo(torrentId);
                    console.log(`📦 [${i + 1}/20] Torbox ${torrentId}: ${torrentInfo.download_finished ? 'completed' : 'downloading'}`);

                    if (torrentInfo.download_finished === true) {
                        const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                        const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];
                        
                        const videoFiles = (torrentInfo.files || []).filter(file => {
                            const lowerName = file.name?.toLowerCase() || '';
                            return videoExtensions.some(ext => lowerName.endsWith(ext)) &&
                                   !junkKeywords.some(junk => lowerName.includes(junk));
                        });
                        
                        const bestFile = videoFiles.length > 0
                            ? videoFiles.reduce((max, file) => (file.size > max.size ? file : max), videoFiles[0])
                            : (torrentInfo.files || [])[0];

                        if (!bestFile) throw new Error('Nessun file valido trovato nel torrent.');
                        
                        const downloadData = await torbox.createDownload(torrentId, bestFile.id);
                        console.log(`📦 🚀 Redirecting to Torbox stream`);
                        return res.redirect(302, downloadData);
                    }
                }

                return res.status(200).send(htmlResponse(
                    'Download in Corso',
                    'Il torrent è stato aggiunto a Torbox ed è in download. Torna tra qualche minuto.',
                    false
                ));

            } catch (error) {
                console.error('📦 ❌ Torbox add error:', error);
                return res.status(500).send(htmlResponse('Errore Torbox', error.message, true));
            }
        }

        if (url.pathname.startsWith('/torbox-stream/')) {
            const pathParts = url.pathname.split('/');
            const encodedConfigStr = pathParts[2];
            const encodedHash = pathParts[3];
            
            let userConfig = {};
            res.setHeader('Content-Type', 'text/html');
            try {
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(`<h1>Errore Config</h1><p>${e.message}</p>`);
            }

            if (!userConfig.torbox_key) {
                return res.status(400).send('<h1>Errore</h1><p>Torbox API key non configurata.</p>');
            }

            try {
                const infoHash = decodeURIComponent(encodedHash);
                const torbox = new Torbox(userConfig.torbox_key);

                const userTorrents = await torbox.getTorrents();
                let torrent = userTorrents.find(t => t.hash?.toLowerCase() === infoHash.toLowerCase());

                if (torrent && torrent.download_finished === true) {
                    const torrentInfo = await torbox.getTorrentInfo(torrent.id);
                    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                    const videoFiles = (torrentInfo.files || []).filter(f => 
                        videoExtensions.some(ext => f.name?.toLowerCase().endsWith(ext))
                    );
                    const bestFile = videoFiles.length > 0
                        ? videoFiles.reduce((max, f) => (f.size > max.size ? f : max), videoFiles[0])
                        : (torrentInfo.files || [])[0];
                    
                    if (!bestFile) throw new Error('No valid file found');
                    
                    const downloadData = await torbox.createDownload(torrent.id, bestFile.id);
                    return res.redirect(302, downloadData);
                }

                const fakeMagnet = `magnet:?xt=urn:btih:${infoHash}`;
                return res.redirect(302, `/torbox-add/${encodedConfigStr}/${encodeURIComponent(fakeMagnet)}`);

            } catch (error) {
                console.error('📦 ❌ Torbox stream error:', error);
                return res.status(500).send(`<h1>Errore</h1><p>${error.message}</p>`);
            }
        }

        if (url.pathname.startsWith('/torbox-stream-personal/')) {
            const pathParts = url.pathname.split('/');
            const encodedConfigStr = pathParts[2];
            const torrentId = pathParts[3];
            
            let userConfig = {};
            res.setHeader('Content-Type', 'text/html');
            try {
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(`<h1>Errore Config</h1><p>${e.message}</p>`);
            }

            if (!userConfig.torbox_key) {
                return res.status(400).send('<h1>Errore</h1><p>Torbox API key non configurata.</p>');
            }

            try {
                const torbox = new Torbox(userConfig.torbox_key);
                const torrentInfo = await torbox.getTorrentInfo(torrentId);

                if (!torrentInfo.download_finished) {
                    throw new Error('Il torrent non è ancora completato.');
                }

                const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];
                
                const videoFiles = (torrentInfo.files || []).filter(file => {
                    const lowerName = file.name?.toLowerCase() || '';
                    return videoExtensions.some(ext => lowerName.endsWith(ext)) &&
                           !junkKeywords.some(junk => lowerName.includes(junk));
                });
                
                const bestFile = videoFiles.length > 0
                    ? videoFiles.reduce((max, file) => (file.size > max.size ? file : max), videoFiles[0])
                    : (torrentInfo.files || [])[0];

                if (!bestFile) throw new Error('Nessun file valido trovato.');
                
                const downloadData = await torbox.createDownload(torrentId, bestFile.id);
                console.log(`📦 🚀 Redirecting to personal Torbox stream`);
                return res.redirect(302, downloadData);

            } catch (error) {
                console.error('📦 ❌ Torbox personal stream error:', error);
                return res.status(500).send(`<h1>Errore</h1><p>${error.message}</p>`);
            }
        }

        // Health check
        if (url.pathname === '/health') {
            const health = {
                status: 'OK',
                addon: 'Stremizio (Vercel)',
                version: '2.0.0',
                uptime: Date.now(),
                cache: {
                    entries: cache.size,
                    maxEntries: MAX_CACHE_ENTRIES,
                    ttl: `${CACHE_TTL / 60000} minutes`
                }
            };

            res.setHeader('Content-Type', 'application/json');
            return res.status(200).send(JSON.stringify(health, null, 2));
        }

        // Enhanced search endpoint for testing
        if (url.pathname === '/search') {
            const query = url.searchParams.get('q');
            const type = url.searchParams.get('type') || 'movie';

            if (!query) {
                res.setHeader('Content-Type', 'application/json');
                return res.status(400).send(JSON.stringify({ error: 'Missing query parameter (q)' }));
            }

            const searchConfig = {
                tmdb_key: env.TMDB_KEY,
                rd_key: env.RD_KEY,
                jackett_url: env.JACKETT_URL,
                jackett_api_key: env.JACKETT_API_KEY,
                jackett_password: env.JACKETT_PASSWORD
            };

            const result = await handleSearch({ query, type }, searchConfig);
            const responseTime = Date.now() - startTime;
            
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('X-Response-Time', `${responseTime}ms`);
            return res.status(200).send(JSON.stringify({ ...result, responseTimeMs: responseTime }, null, 2));
        }

        // 404 for unknown paths
        res.setHeader('Content-Type', 'application/json');
        return res.status(404).send(JSON.stringify({ error: 'Not Found' }));

    } catch (error) {
        const responseTime = Date.now() - startTime;
        console.error(`❌ Worker error after ${responseTime}ms:`, error);
        
        res.setHeader('Content-Type', 'application/json');
        return res.status(500).send(JSON.stringify({ 
            error: 'Internal Server Error',
            message: error.message,
            path: url.pathname,
            responseTimeMs: responseTime
        }));
    }
}
