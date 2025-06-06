const express = require('express');
const csv = require('csv-parser');
const fetch = require('node-fetch');
const { Readable } = require('stream');
const cors = require('cors');

// Modifica l'import per utilizzare anche le funzioni
const { localStationsData, localPricesData, metadata, saveLocalData, loadLocalData } = require('./localData');

const app = express();

// Rimuovi la configurazione CORS esistente e sostituiscila con questa
app.use(cors());

// Aggiungi middleware per headers CORS su tutte le risposte
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Credentials', true);

    // Gestisci le richieste OPTIONS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    next();
});

// Rilevamento dell'ambiente Vercel
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;

// Cache per i dati con timestamp
let cache = {
    stationsData: null,
    pricesData: null,
    chargeStationsData: null,
    lastUpdate: null,
    
    // Dati di fallback minimi
    fallbackStationsData: [
        {
            "_0": "1000001",
            "_1": "GESTORE ESEMPIO",
            "_2": "ESSO",
            "_3": "Stradale",
            "_4": "STAZIONE ESEMPIO 1",
            "_5": "Via Roma 123",
            "_6": "ROMA",
            "_7": "RM",
            "_8": "41.9028",
            "_9": "12.4964"
        },
        {
            "_0": "1000002",
            "_1": "GESTORE ESEMPIO 2",
            "_2": "Q8",
            "_3": "Stradale",
            "_4": "STAZIONE ESEMPIO 2",
            "_5": "Via Milano 456",
            "_6": "MILANO",
            "_7": "MI",
            "_8": "45.4642",
            "_9": "9.1900"
        }
    ],
    fallbackPricesData: [
        {
            "_0": "1000001",
            "_1": "Benzina",
            "_2": "1,899",
            "_3": "1",
            "_4": "2023-05-01"
        },
        {
            "_0": "1000001",
            "_1": "Gasolio",
            "_2": "1,799",
            "_3": "1",
            "_4": "2023-05-01"
        },
        {
            "_0": "1000002",
            "_1": "Benzina",
            "_2": "1,889",
            "_3": "1",
            "_4": "2023-05-01"
        },
        {
            "_0": "1000002",
            "_1": "Gasolio",
            "_2": "1,789",
            "_3": "1",
            "_4": "2023-05-01"
        }
    ]
};

// Funzione di logging migliorata per Vercel
function logError(message, error) {
    const errorDetails = {
        message,
        errorName: error?.name,
        errorMessage: error?.message,
        errorStack: error?.stack,
        timestamp: new Date().toISOString(),
        environment: isVercel ? 'Vercel' : 'Local'
    };
    
    // In Vercel, console.error è il modo migliore per loggare errori
    console.error(JSON.stringify(errorDetails, null, 2));
    
    // Invia anche a un servizio di logging esterno o salva in un file se necessario
    // Se stai usando Vercel, considera di configurare un servizio come Sentry
    return errorDetails;
}

// Funzione per calcolare la distanza tra due punti usando la formula di Haversine
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raggio della Terra in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function downloadAndParseCSV(url) {
    // Su Vercel, usa sempre i dati locali per evitare errori ETIMEDOUT
    if (isVercel) {
        console.log(`[VERCEL-LOG] Utilizzo dati locali invece di scaricare da ${url}`);
        
        // Controlla quale file dati utilizzare
        if (url.includes('anagrafica_impianti_attivi.csv')) {
            return localStationsData;
        } else if (url.includes('prezzo_alle_8.csv')) {
            return localPricesData;
        }
        
        return [];
    }
    
    const timeout = 30000; // 30 secondi di timeout sia per Vercel che per ambiente locale
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
        console.log(`[VERCEL-LOG] Timeout raggiunto dopo ${timeout}ms per URL: ${url}`);
    }, timeout);
    
    try {
        console.log(`[VERCEL-LOG] Tentativo download da ${url} con timeout di ${timeout}ms - Ambiente: ${isVercel ? 'Vercel' : 'Local'}`);
        
        let urlToUse = url;
        if (url.includes('mise.gov.it')) {
            if (url.includes('anagrafica_impianti_attivi.csv')) {
                console.log('[VERCEL-LOG] Utilizzo URL alternativo per anagrafica');
                urlToUse = 'https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv';
            } else if (url.includes('prezzo_alle_8.csv')) {
                console.log('[VERCEL-LOG] Utilizzo URL alternativo per prezzi');
                urlToUse = 'https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv';
            }
        }
        
        console.log(`[VERCEL-LOG] Inizio download da ${urlToUse} con timeout di ${timeout}ms`);
        
        const response = await fetch(urlToUse, {
            method: 'GET',
            headers: {
                'Accept': 'text/csv,application/csv',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            signal: controller.signal,
            ...(typeof fetch.defaults === 'object' ? { timeout } : {})
        });
        
        clearTimeout(timeoutId);
        console.log(`[VERCEL-LOG] Risposta ricevuta da ${urlToUse} - Status: ${response.status}`);
        
        if (!response.ok) {
            throw new Error(`Risposta HTTP non valida: ${response.status} ${response.statusText} per URL ${urlToUse}`);
        }

        return new Promise((resolve, reject) => {
            const results = [];
            let isFirstRow = true;
            let bytesProcessed = 0;
            let rowsProcessed = 0;
            const startTime = Date.now();

            console.log(`[VERCEL-LOG] Inizio parsing CSV da ${urlToUse}`);
            
            const progressInterval = setInterval(() => {
                console.log(`[VERCEL-LOG] Progresso parsing CSV da ${urlToUse}: ${rowsProcessed} righe, ${bytesProcessed} bytes processati in ${(Date.now() - startTime)/1000}s`);
            }, 5000);

            Readable.from(response.body)
                .pipe(csv({
                    separator: ';',
                    mapHeaders: ({ header, index }) => `_${index}`
                }))
                .on('data', (data) => {
                    if (!isFirstRow) {
                        results.push(data);
                    } else {
                        isFirstRow = false;
                    }
                    rowsProcessed++;
                    bytesProcessed += JSON.stringify(data).length;
                })
                .on('end', () => {
                    clearInterval(progressInterval);
                    const elapsedTime = (Date.now() - startTime)/1000;
                    console.log(`[VERCEL-LOG] Download completato con successo: ${results.length} righe da ${urlToUse} in ${elapsedTime}s`);
                    resolve(results);
                })
                .on('error', (error) => {
                    clearInterval(progressInterval);
                    const loggedError = logError(`Errore parsing CSV da ${urlToUse}`, error);
                    reject(error);
                });
        });
    } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
            const errorDetails = logError(`[DETTAGLIO ERRORE] La richiesta a ${url} è stata interrotta per timeout dopo ${timeout}ms`, error);
            console.log(`[VERCEL-LOG] ERRORE TIMEOUT: ${url} - Dettaglio completo: ${JSON.stringify(errorDetails)}`);
        } else {
            const errorDetails = logError(`[DETTAGLIO ERRORE] Download fallito per ${url}`, error);
            console.log(`[VERCEL-LOG] ERRORE DOWNLOAD: ${url} - Dettaglio completo: ${JSON.stringify(errorDetails)}`);
        }

        if (isVercel) {
            console.log('[VERCEL-LOG] Ambiente Vercel rilevato, utilizzo dati di fallback immediati');
            return url.includes('anagrafica_impianti_attivi.csv') 
                ? cache.fallbackStationsData 
                : cache.fallbackPricesData;
        }
        
        return [];
    }
}

async function updateDataIfNeeded() {
    const updateInterval = isVercel ? 7 * 24 * 60 * 60 * 1000 : 23 * 60 * 60 * 1000;
    
    if (!cache.lastUpdate || (Date.now() - cache.lastUpdate) > updateInterval) {
        try {
            console.log(`[VERCEL-LOG] Aggiornamento dati... (ambiente: ${isVercel ? 'Vercel' : 'Local'})`);

            if (isVercel) {
                console.log('[VERCEL-LOG] Ambiente Vercel: caricamento dati locali');
                cache.stationsData = localStationsData;
                cache.pricesData = localPricesData;
                cache.lastUpdate = Date.now();
                console.log(`[VERCEL-LOG] Dati locali caricati: ${localStationsData.length} stazioni, ${localPricesData.length} prezzi`);
                return;
            }
            
            let stations = [], prices = [], chargeStations = [];
            
            try {
                console.log('[VERCEL-LOG] Tentativo download dati con timeout di 30s');
                
                stations = await downloadAndParseCSV('https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv');
                
                if (stations.length > 0) {
                    console.log('[VERCEL-LOG] Download stazioni completato, tentativo download prezzi...');
                    prices = await downloadAndParseCSV('https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv');
                }
                
                if (!stations.length) {
                    console.log('[VERCEL-LOG] Tentativo con URL alternativo per stazioni...');
                    stations = await downloadAndParseCSV('https://www.mise.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv');
                }
                
                if (!prices.length) {
                    console.log('[VERCEL-LOG] Tentativo con URL alternativo per prezzi...');
                    prices = await downloadAndParseCSV('https://www.mise.gov.it/images/exportCSV/prezzo_alle_8.csv');
                }
                
                if (stations.length && prices.length && !isVercel) {
                    console.log('[VERCEL-LOG] Download dati principali completato, tentativo download stazioni ricarica...');
                    chargeStations = await downloadChargeStationsData('https://api.openchargemap.io/v3/poi/?output=json&countrycode=IT&key=65923063-f5a4-43cd-8ef9-3c1d64195d93&maxresults=1000');
                    
                    if (stations.length > 0 && prices.length > 0) {
                        console.log('[VERCEL-LOG] Salvataggio dati scaricati con successo...');
                        const savedSuccessfully = saveLocalData(stations, prices);
                        if (savedSuccessfully) {
                            console.log('[VERCEL-LOG] Dati salvati correttamente per uso futuro');
                        }
                    }
                }
            } catch (e) {
                console.error('[VERCEL-LOG] Errore download sequenziale:', e.message);
                
                console.log('[VERCEL-LOG] Tentativo di caricare i dati salvati in precedenza...');
                const savedData = loadLocalData();
                
                if (!stations.length && savedData.localStationsData.length > 0) {
                    stations = savedData.localStationsData;
                    console.log(`[VERCEL-LOG] Utilizzati ${stations.length} stazioni dai dati salvati in precedenza`);
                } else {
                    stations = cache.fallbackStationsData;
                    console.log('[VERCEL-LOG] Utilizzo dati di fallback per stazioni');
                }
                
                if (!prices.length && savedData.localPricesData.length > 0) {
                    prices = savedData.localPricesData;
                    console.log(`[VERCEL-LOG] Utilizzati ${prices.length} prezzi dai dati salvati in precedenza`);
                } else {
                    prices = cache.fallbackPricesData;
                    console.log('[VERCEL-LOG] Utilizzo dati di fallback per prezzi');
                }
            }

            if (stations?.length && prices?.length) {
                console.log(`[VERCEL-LOG] Download completato: ${stations.length} stazioni, ${prices.length} prezzi`);
                
                if (stations !== cache.fallbackStationsData) {
                    cache.stationsData = stations.slice(1);
                } else {
                    cache.stationsData = stations;
                }
                
                if (prices !== cache.fallbackPricesData) {
                    cache.pricesData = prices.slice(1);
                } else {
                    cache.pricesData = prices;
                }

                if (chargeStations?.length) {
                    cache.chargeStationsData = chargeStations.map(station => {
                        station.ID = '999' + station.ID.toString();
                        return station;
                    });
                    console.log(`[VERCEL-LOG] Salvate ${cache.chargeStationsData.length} stazioni di ricarica nella cache`);
                } else {
                    cache.chargeStationsData = [];
                }

                cache.lastUpdate = Date.now();
                console.log('[VERCEL-LOG] Dati aggiornati con successo');
            } else {
                console.error('[VERCEL-LOG] Non è stato possibile ottenere dati completi: stazioni=' + 
                    (stations?.length || 0) + ', prezzi=' + (prices?.length || 0));
                
                if (!cache.stationsData || cache.stationsData.length === 0) {
                    cache.stationsData = cache.fallbackStationsData;
                    console.log('[VERCEL-LOG] Utilizzati dati stazioni di fallback');
                }
                if (!cache.pricesData || cache.pricesData.length === 0) {
                    cache.pricesData = cache.fallbackPricesData;
                    console.log('[VERCEL-LOG] Utilizzati dati prezzi di fallback');
                }
                if (!cache.chargeStationsData) cache.chargeStationsData = [];
            }
        } catch (error) {
            console.error('[VERCEL-LOG] Errore generale aggiornamento:', error.message);
            if (!cache.stationsData) cache.stationsData = cache.fallbackStationsData;
            if (!cache.pricesData) cache.pricesData = cache.fallbackPricesData;
            if (!cache.chargeStationsData) cache.chargeStationsData = [];
        }
    }
}

app.get('/save-local-data', async (req, res) => {
    try {
        if (!cache.stationsData || !cache.pricesData || 
            cache.stationsData.length === 0 || cache.pricesData.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Nessun dato disponibile da salvare'
            });
        }
        
        const savedSuccessfully = saveLocalData(cache.stationsData, cache.pricesData);
        
        if (savedSuccessfully) {
            return res.json({
                status: 'success',
                message: 'Dati salvati con successo',
                count: {
                    stations: cache.stationsData.length,
                    prices: cache.pricesData.length
                },
                timestamp: new Date().toISOString()
            });
        } else {
            return res.status(500).json({
                status: 'error',
                message: 'Errore durante il salvataggio dei dati'
            });
        }
    } catch (error) {
        console.error('Errore nel salvataggio manuale dei dati:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Errore interno del server',
            error: error.message
        });
    }
});

app.get('/local-data-info', (req, res) => {
    const freshData = loadLocalData();
    
    res.json({
        status: 'success',
        timestamp: new Date().toISOString(),
        currentLocalData: {
            stationsCount: localStationsData.length,
            pricesCount: localPricesData.length,
            sampleStations: localStationsData.slice(0, 3),
            samplePrices: localPricesData.slice(0, 3)
        },
        savedData: {
            lastSaved: freshData.metadata.lastSaved,
            stationsCount: freshData.localStationsData.length,
            pricesCount: freshData.localPricesData.length
        },
        cacheData: {
            stationsCount: cache.stationsData?.length || 0,
            pricesCount: cache.pricesData?.length || 0,
            lastUpdate: cache.lastUpdate ? new Date(cache.lastUpdate).toISOString() : null
        },
        environment: isVercel ? 'Vercel' : 'Local',
        usingLocalData: isVercel ? true : false
    });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

module.exports = app;