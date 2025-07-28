const express = require('express');
const csv = require('csv-parser');
const fetch = require('node-fetch');
const { Readable } = require('stream');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

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

// Cache per i dati con timestamp
let cache = {
    stationsData: null,
    pricesData: null,
    chargeStationsData: null,
    lastUpdate: null
};

// Funzione per calcolare la distanza tra due punti usando una formula più semplice e robusta
function calculateDistance(lat1, lon1, lat2, lon2) {
    try {
        // Converti stringhe in numeri e rimuovi spazi
        lat1 = parseFloat(String(lat1).replace(',', '.').trim());
        lon1 = parseFloat(String(lon1).replace(',', '.').trim());
        lat2 = parseFloat(String(lat2).replace(',', '.').trim());
        lon2 = parseFloat(String(lon2).replace(',', '.').trim());

        // Verifica validità coordinate
        if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) {
            console.log('[DEBUG] Coordinate non valide:', { lat1, lon1, lat2, lon2 });
            return Infinity;
        }

        // Usa una formula più semplice per il calcolo approssimativo
        // 1 grado di latitudine = circa 111km
        // 1 grado di longitudine = circa 111km * cos(latitudine)
        const latDistance = Math.abs(lat1 - lat2) * 111;
        const lonDistance = Math.abs(lon1 - lon2) * 111 * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
        
        const distance = Math.sqrt(latDistance * latDistance + lonDistance * lonDistance);

        console.log('[DEBUG] Calcolo distanza:', {
            da: {lat: lat1, lon: lon1},
            a: {lat: lat2, lon: lon2},
            distanza: distance,
            componenti: {
                latDistance,
                lonDistance
            }
        });

        return distance;
    } catch (error) {
        console.error('[DEBUG] Errore nel calcolo della distanza:', error);
        return Infinity;
    }
}

// Rilevamento dell'ambiente Vercel
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;

// Percorsi dei file CSV locali - semplificati per lavorare meglio con GitHub Actions
const LOCAL_DATA_DIR = path.join(__dirname, 'public', 'data');
const STATIONS_CSV_FILE = path.join(LOCAL_DATA_DIR, 'anagrafica_impianti_attivi.csv');
const PRICES_CSV_FILE = path.join(LOCAL_DATA_DIR, 'prezzo_alle_8.csv');

// Modifica la funzione readLocalCSV per migliorare il debug degli ID
async function readLocalCSV(filePath) {
    console.log(`Lettura file locale: ${filePath}`);
    
    return new Promise((resolve, reject) => {
        const results = [];
        let isFirstRow = true;
        let rowCount = 0;
        let headerRow = null;
        
        // Set per tracciare gli ID univoci e il loro formato originale
        const uniqueIds = new Map(); // Mappa ID normalizzato -> ID originale
        
        if (!fs.existsSync(filePath)) {
            console.error(`File non trovato: ${filePath}`);
        }
        
        fs.createReadStream(filePath)
            .pipe(csv({
                separator: ';',
                mapHeaders: ({ header, index }) => {
                    if (index === 0) return 'idImpianto';
                    return `_${index}`;
                },
                mapValues: ({ header, value }) => {
                    if (header === 'idImpianto') {
                        // Non modificare il valore dell'ID in questa fase
                        return value;
                    }
                    // Per altri valori, sostituisci le virgole con punti per i numeri decimali
                    if (value && !isNaN(value.replace(',', '.'))) {
                        return value.replace(',', '.');
                    }
                    return value;
                }
            }))
            .on('data', (data) => {
                if (!isFirstRow) {
                    // Salva l'ID originale prima della normalizzazione
                    const originalId = data.idImpianto;
                    const normalizedId = String(originalId || '').trim().replace(/^0+/, '');
                    
                    uniqueIds.set(normalizedId, originalId);
                    
                    // Log dettagliato per ogni ID
                    if (normalizedId === '45672') {
                        console.log('[DEBUG] Trovato ID target nel CSV:', {
                            filePath,
                            originalId,
                            normalizedId,
                            record: data
                        });
                    }
                    
                    results.push(data);
                } else {
                    headerRow = data;
                    isFirstRow = false;
                }
                rowCount++;
            })
            .on('end', () => {
                console.log(`Lettura completata: ${results.length} record letti da ${filePath}`);
                console.log(`Statistiche importazione:`, {
                    totaleRighe: rowCount,
                    recordValidi: results.length,
                    idUnivoci: uniqueIds.size,
                    headerRow,
                    esempiIds: Array.from(uniqueIds.entries()).slice(0, 5).map(([norm, orig]) => ({
                        originale: orig,
                        normalizzato: norm
                    })),
                    targetIdInfo: uniqueIds.has('45672') ? {
                        presente: true,
                        originale: uniqueIds.get('45672')
                    } : {
                        presente: false,
                        possibiliMatch: Array.from(uniqueIds.keys())
                            .filter(id => id.includes('45672'))
                    }
                });
                resolve(results);
            })
            .on('error', (error) => {
                console.error(`Errore nella lettura del file ${filePath}:`, error);
                reject(error);
            });
    });
}

// Funzione semplificata - ora legge solo i file locali
async function loadCSVData(type) {
    try {
        const filePath = type === 'stations' ? STATIONS_CSV_FILE : PRICES_CSV_FILE;
        console.log(`Caricamento dati da ${filePath}`);
        return await readLocalCSV(filePath);
    } catch (error) {
        console.error(`Errore nel caricamento dei dati ${type}:`, error);
        return [];
    }
}

// Nuova funzione per scaricare dati JSON dalle stazioni di ricarica elettrica
async function downloadChargeStationsData(url) {
    try {
        console.log('Scaricamento dati stazioni di ricarica...');
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Errore API: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log(`Scaricate ${data.length} stazioni di ricarica`);
        return data;
    } catch (error) {
        console.error('Errore scaricamento stazioni di ricarica:', error.message);
        throw error;
    }
}

async function updateDataIfNeeded() {
    // Aggiorna i dati solo se sono passate più di 23 ore dall'ultimo aggiornamento
    //const HOURS_23 = 23 * 60 * 60 * 1000;
    const HOURS_23 = 1;

    if (!cache.lastUpdate || (Date.now() - cache.lastUpdate) > HOURS_23) {
        try {
            console.log('Aggiornamento dati da file locali...');

            // Carica i dati dai file locali - semplificato rispetto alla versione precedente
            const stations = await loadCSVData('stations');
            const prices = await loadCSVData('prices');
            
            // Prova a scaricare le stazioni di ricarica da API esterna
            let chargeStations = [];
            try {
                chargeStations = await downloadChargeStationsData('https://api.openchargemap.io/v3/poi/?output=json&countrycode=IT&key=65923063-f5a4-43cd-8ef9-3c1d64195d93&maxresults=1000');
            } catch (chargeError) {
                console.error('Errore nel download delle stazioni di ricarica:', chargeError);
            }

            if (stations?.length && prices?.length) {
                cache.stationsData = stations;
                cache.pricesData = prices;

                // Trasforma i dati delle stazioni di ricarica con ID prefissati
                if (chargeStations?.length) {
                    cache.chargeStationsData = chargeStations.map(station => {
                        // Aggiungiamo il prefisso "999" all'ID
                        station.ID = '999' + station.ID.toString();
                        return station;
                    });
                    console.log(`Salvate ${cache.chargeStationsData.length} stazioni di ricarica nella cache`);
                } else {
                    cache.chargeStationsData = [];
                }

                cache.lastUpdate = Date.now();
                console.log('Dati aggiornati con successo');
            } else {
                console.error('Dati non disponibili dai file locali');
                if (!cache.stationsData) cache.stationsData = [];
                if (!cache.pricesData) cache.pricesData = [];
                if (!cache.chargeStationsData) cache.chargeStationsData = [];
            }
        } catch (error) {
            console.error('Errore aggiornamento:', error.message);
            if (!cache.stationsData) cache.stationsData = [];
            if (!cache.pricesData) cache.pricesData = [];
            if (!cache.chargeStationsData) cache.chargeStationsData = [];
        }
    }
}

// Modifica i route handler per usare la cache
app.get('/gas-stations', async (req, res) => {
    await updateDataIfNeeded();

    const { lat, lng, distance } = req.query;

    if (!lat || !lng || !distance) {
        return res.status(400).json({
            status: 'error',
            message: 'Parametri lat, lng e distance sono richiesti'
        });
    }

    if (!cache.stationsData || !cache.pricesData) {
        return res.status(503).json({
            status: 'error',
            message: 'Dati non ancora disponibili'
        });
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const maxDistance = parseFloat(distance);

    // 1. Ottieni le stazioni di benzina
    let gasolineStations = cache.stationsData
        .filter(station => {
            const stationLat = parseFloat(station['_8']);
            const stationLng = parseFloat(station['_9']);

            if (isNaN(stationLat) || isNaN(stationLng)) {
                return false;
            }

            const dist = calculateDistance(userLat, userLng, stationLat, stationLng);
            station._distance = dist;
            return dist <= maxDistance;
        })
        .map(station => {
            const stationId = station['_0'];
            const stationPrices = cache.pricesData.filter(p => p['_0'] === stationId);

            return {
                id_stazione: stationId,
                tipo_stazione: 'Benzina', // Aggiungiamo un campo per distinguere
                bandiera: station['_2'],
                dettagli_stazione: {
                    gestore: station['_1'],
                    tipo: station['_3'],
                    nome: station['_4']
                },
                indirizzo: {
                    via: station['_5'],
                    comune: station['_6'],
                    provincia: station['_7']
                },
                maps: {
                    lat: parseFloat(station['_8']),
                    lon: parseFloat(station['_9'])
                },
                distanza: Number(station._distance.toFixed(2)),
                prezzi_carburanti: stationPrices.map(price => ({
                    tipo: price['_1'],
                    prezzo: parseFloat(price['_2']?.replace(',', '.')) || null,
                    self_service: price['_3'] === '1',
                    ultimo_aggiornamento: price['_4']
                }))
            };
        });

    // 2. Ottieni le stazioni elettriche
    let electricStations = [];
    let googleStations = [];
    try {
        const googleApiKey = 'AIzaSyCoiskCn8rH89TSLvX9rB6yTQO9c0dCcvM'; // Sostituisci con la tua chiave API
        const googleApiUrl = 'https://places.googleapis.com/v1/places:searchText?languageCode=it';
        response = await fetch(googleApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': googleApiKey,
                'X-Goog-FieldMask': 'places.id,places.name,places.displayName,places.evChargeOptions,places.location,places.formattedAddress,places.addressComponents',
            },
            body: JSON.stringify({

                textQuery: "Stazioni di ricarica",
                pageSize: distance*2 || 10,
                evOptions: {
                    minimumChargingRateKw: 1
                },
                locationBias: {
                    circle: {
                        center: {
                            latitude: parseFloat(lat),
                            longitude: parseFloat(lng)
                        },
                        radius: parseFloat(distance) * 10 // Convert distance to meters
                    }

                }
            }),
        });

        if (response.status === 200) {
            const googleData = await response.json();
            if (googleData.places.length > 0) {
                googleStations = googleData.places.map(async station => {
                    const avgPower = response.evChargeOptions?.connectorAggregation.maxChargeRateKw || 50; // Usa la potenza media se disponibile, altrimenti 50 kW
                    let stimaPrezzo = null;

                    if (avgPower > 0) {
                        // Stima basata su tariffe medie in Italia
                        if (avgPower < 11) stimaPrezzo = 0.40; // AC lenta
                        else if (avgPower < 50) stimaPrezzo = 0.50; // AC veloce
                        else if (avgPower < 100) stimaPrezzo = 0.60; // DC veloce
                        else stimaPrezzo = 0.70; // DC ultra veloce
                    }
                    const locality = station.addressComponents.find(component => component.types[0] === "administrative_area_level_3")?.shortText || "N/D";
                    const provincia = station.addressComponents.find(component => component.types[0] === "administrative_area_level_2")?.shortText || "N/D";

                    return {
                        id_stazione: station.id,
                        tipo_stazione: 'Elettrica',
                        bandiera: station.displayName.text + station.evChargeOptions.connectorCount.text || "N/D",
                        dettagli_stazione: {
                            gestore: station.displayName.text + station.evChargeOptions.connectorCount.text || "N/D",
                            tipo: "Elettrica",
                            nome: station.displayName.text + station.evChargeOptions.connectorCount.text || "Stazione di ricarica"
                        },
                        indirizzo: {
                            via: station.formattedAddress || "N/D",
                            comune: locality || "N/D",
                            provincia: provincia || "N/D"
                        },
                        maps: {
                            lat: station.location.latitude,
                            lon: station.location.longitude
                        },
                        distanza: calculateDistance(userLat, userLng, parseFloat(station.location.latitude), parseFloat(station.location.longitude)),
                        prezzi_carburanti: [{
                            tipo: response.evChargeOptions?.connectorAggregation.type || "Generico",
                            potenza_kw: avgPower,
                            prezzo: stimaPrezzo, // €/kWh stimato
                            unita_misura: "€/kWh (stimato)",
                            self_service: true,
                            ultimo_aggiornamento: new Date().toISOString().split('T')[0]
                        }]
                    };
                });
            }
        } else {
            console.error('Errore Google Places API:', response.statusText);
        }
    } catch (error) {
        console.error('Errore durante il recupero delle stazioni da Google Places API:', error.message);
    }
    googleStations = await Promise.all(googleStations);

    // Unisci le stazioni di Google con le altre
    const allStations = [...gasolineStations, ...googleStations]
        .sort((a, b) => a.distanza - b.distanza)
        .slice(0, parseInt(distance * 4));

    res.json({
        status: 'success',
        timestamp: new Date().toISOString(),
        totale_stazioni: (cache.stationsData.length) + (cache.chargeStationsData?.length || 0),
        stazioni_trovate: allStations.length,
        stations: allStations
    });
});

app.get('/api/cron', async (req, res) => {
    try {
        await updateDataIfNeeded();
    } catch (error) {
        console.error('Error in cron job:', error);

        res.json({ status: 'failed', timestamp: new Date().toISOString() });
    }
    res.json({ status: 'success', timestamp: new Date().toISOString() });

});

// Endpoint di health check con aggiornamento dati
app.get('/health', async (req, res) => {
    console.log('Health check iniziato:', new Date().toISOString());

    try {
        // Esegui l'aggiornamento dei dati
        await updateDataIfNeeded();

        const healthStatus = {
            status: 'online',
            timestamp: new Date().toISOString(),
            cache: {
                lastUpdate: cache.lastUpdate,
                stationsCount: cache.stationsData?.length || 0,
                pricesCount: cache.pricesData?.length || 0,
                chargeStationsCount: cache.chargeStationsData?.length || 0, // Aggiunta questa riga
                hasData: !!cache.stationsData && !!cache.pricesData && !!cache.chargeStationsData,
                lastUpdateFormatted: cache.lastUpdate ? new Date(cache.lastUpdate).toISOString() : null
            },
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            environment: process.env.NODE_ENV || 'development',
            dataUpdateStatus: 'success'
        };

        res.json(healthStatus);
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: error.message,
            cache: {
                lastUpdate: cache.lastUpdate,
                hasData: !!cache.stationsData && !!cache.pricesData && !!cache.chargeStationsData
            }
        });
    }
});

// Endpoint per le stazioni di ricarica elettrica
app.get('/charge-stations', async (req, res) => {
    const { lat, lng, distance } = req.query;

    if (!lat || !lng || !distance) {
        return res.status(400).json({
            status: 'error',
            message: 'Parametri lat, lng e distance sono richiesti'
        });
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const maxDistance = parseFloat(distance);
    let googleStations = [];
    try {
        const googleApiKey = 'AIzaSyCoiskCn8rH89TSLvX9rB6yTQO9c0dCcvM'; // Sostituisci con la tua chiave API
        const googleApiUrl = 'https://places.googleapis.com/v1/places:searchText?languageCode=it';
        response = await fetch(googleApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': googleApiKey,
                'X-Goog-FieldMask': 'places.id,places.name,places.displayName,places.evChargeOptions,places.location,places.formattedAddress,places.addressComponents',
            },
            body: JSON.stringify({

                textQuery: "Stazioni di ricarica",
                pageSize: distance*2 || 10,
                evOptions: {
                    minimumChargingRateKw: 1
                },
                locationBias: {
                    circle: {
                        center: {
                            latitude: parseFloat(lat),
                            longitude: parseFloat(lng)
                        },
                        radius: parseFloat(distance) * 10 // Convert distance to meters
                    }

                }
            }),
        });

        if (response.status === 200) {
            const googleData = await response.json();
            if (googleData.places.length > 0) {
                googleStations = googleData.places.map(async station => {
                    const avgPower = response.evChargeOptions?.connectorAggregation.maxChargeRateKw || 50; // Usa la potenza media se disponibile, altrimenti 50 kW
                    let stimaPrezzo = null;

                    if (avgPower > 0) {
                        // Stima basata su tariffe medie in Italia
                        if (avgPower < 11) stimaPrezzo = 0.40; // AC lenta
                        else if (avgPower < 50) stimaPrezzo = 0.50; // AC veloce
                        else if (avgPower < 100) stimaPrezzo = 0.60; // DC veloce
                        else stimaPrezzo = 0.70; // DC ultra veloce
                    }
                    const locality = station.addressComponents.find(component => component.types[0] === "administrative_area_level_3")?.shortText || "N/D";
                    const provincia = station.addressComponents.find(component => component.types[0] === "administrative_area_level_2")?.shortText || "N/D";

                    return {
                        id_stazione: station.id,
                        tipo_stazione: 'Elettrica',
                        bandiera: station.displayName.text + station.evChargeOptions.connectorCount.text || "N/D",
                        dettagli_stazione: {
                            gestore: station.displayName.text + station.evChargeOptions.connectorCount.text || "N/D",
                            tipo: "Elettrica",
                            nome: station.displayName.text + station.evChargeOptions.connectorCount.text || "Stazione di ricarica"
                        },
                        indirizzo: {
                            via: station.formattedAddress || "N/D",
                            comune: locality || "N/D",
                            provincia: provincia || "N/D"
                        },
                        maps: {
                            lat: station.location.latitude,
                            lon: station.location.longitude
                        },
                        distanza: calculateDistance(userLat, userLng, parseFloat(station.location.latitude), parseFloat(station.location.longitude)),
                        prezzi_carburanti: [{
                            tipo: response.evChargeOptions?.connectorAggregation.type || "Generico",
                            potenza_kw: avgPower,
                            prezzo: stimaPrezzo, // €/kWh stimato
                            unita_misura: "€/kWh (stimato)",
                            self_service: true,
                            ultimo_aggiornamento: new Date().toISOString().split('T')[0]
                        }]
                    };
                });
            }
        } else {
            console.error('Errore Google Places API:', response.statusText);
        }
    } catch (error) {
        console.error('Errore durante il recupero delle stazioni da Google Places API:', error.message);
    }
    googleStations = await Promise.all(googleStations
        .sort((a, b) => a.distanza - b.distanza)
        .slice(0, parseInt(distance * 4)));

    res.json({
        status: 'success',
        timestamp: new Date().toISOString(),
        totale_stazioni: googleStations.length,
        stazioni_trovate: googleStations.length,
        stations: googleStations
    });
});

// Aggiungi un endpoint per visualizzare informazioni sui file locali
app.get('/file-info', (req, res) => {
    try {
        const stationsExists = fs.existsSync(STATIONS_CSV_FILE);
        const pricesExists = fs.existsSync(PRICES_CSV_FILE);
        
        let stationsStats = null;
        let pricesStats = null;
        
        if (stationsExists) {
            stationsStats = fs.statSync(STATIONS_CSV_FILE);
        }
        
        if (pricesExists) {
            pricesStats = fs.statSync(PRICES_CSV_FILE);
        }
        
        res.json({
            status: 'success',
            files: {
                stations: {
                    exists: stationsExists,
                    path: STATIONS_CSV_FILE,
                    size: stationsStats ? `${(stationsStats.size / (1024 * 1024)).toFixed(2)} MB` : null,
                    lastModified: stationsStats ? new Date(stationsStats.mtime).toISOString() : null
                },
                prices: {
                    exists: pricesExists,
                    path: PRICES_CSV_FILE,
                    size: pricesStats ? `${(pricesStats.size / (1024 * 1024)).toFixed(2)} MB` : null,
                    lastModified: pricesStats ? new Date(pricesStats.mtime).toISOString() : null
                }
            },
            cache: {
                lastUpdate: cache.lastUpdate ? new Date(cache.lastUpdate).toISOString() : null,
                stationsCount: cache.stationsData?.length || 0,
                pricesCount: cache.pricesData?.length || 0
            }
        });
    } catch (error) {
        console.error('Errore durante la lettura delle informazioni sui file:', error);
        res.status(500).json({
            status: 'error',
            message: 'Errore durante la lettura delle informazioni sui file',
            error: error.message
        });
    }
});

// Aggiungi un nuovo endpoint /gas-stations-by-fuel che accetta i parametri lat, lng, distance e TipoFuel, e restituisce solo le stazioni di benzina che hanno almeno un prezzo per quel tipo di carburante (TipoFuel). Il filtro viene applicato sui prezzi_carburanti.
app.get('/gas-stations-by-fuel', async (req, res) => {
    await updateDataIfNeeded();
    console.log('\n[DEBUG] Inizio elaborazione gas-stations-by-fuel');

    // Funzione migliorata per la normalizzazione degli ID
    const normalizeId = (id) => {
        if (id === null || id === undefined) return '';
        // Mantieni gli zeri iniziali ma rimuovi spazi e caratteri non numerici
        return String(id).trim().replace(/[^\d]/g, '');
    };

    const targetId = '45672';

    // Debug dettagliato dei dati in cache
    const debugStations = cache.stationsData
        ?.filter(s => normalizeId(s['_0']) === targetId)
        .map(s => ({
            rawId: s['_0'],
            normalizedId: normalizeId(s['_0']),
            matches: normalizeId(s['_0']) === targetId,
            fullRecord: s
        }));

    console.log('[DEBUG] Ricerca ID target:', {
        targetId,
        normalizedTargetId: normalizeId(targetId),
        trovatiRecord: debugStations?.length || 0,
        dettagliRecord: debugStations,
        primiDieciId: cache.stationsData?.slice(0, 10).map(s => ({
            raw: s['_0'],
            normalized: normalizeId(s['_0'])
        }))
    });

    const tracking = {
        allIds: [], // tutti gli ID iniziali
        withValidCoords: [], // ID con coordinate valide
        inRange: [], // ID nel raggio richiesto
        withMatchingFuel: [], // ID con il tipo carburante richiesto
        finalIds: [], // ID nelle stazioni finali
    };

    const targetTracking = {
        initialCheck: false,
        validCoords: false,
        inRange: false,
        hasFuel: false,
        inFinal: false,
        failureReason: null,
        lastFoundPhase: null
    };

    const { lat, lng, distance, TipoFuel } = req.query;

    // Se il tipo fuel è "Elettrico", inoltra la richiesta all'endpoint /charge-stations
    if (TipoFuel.trim().toUpperCase() === 'ELETTRICA') {
        req.query.TipoFuel = undefined;
        req.url = `/charge-stations?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&distance=${encodeURIComponent(distance)}`;
        return app._router.handle(req, res, () => {});
    }

    if (!cache.stationsData || !cache.pricesData) {
        return res.status(503).json({
            status: 'error',
            message: 'Dati non ancora disponibili'
        });
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const maxDistance = parseFloat(distance);

    tracking.allIds = cache.stationsData.map(s => normalizeId(s['_0']));
    targetTracking.initialCheck = tracking.allIds.includes(targetId);
    if (targetTracking.initialCheck) {
        targetTracking.lastFoundPhase = 'initialCheck';
    } else {
        targetTracking.failureReason = 'ID non presente nel dataset iniziale';
    }

    const pricesMap = new Map();
    let targetPrices = [];
    cache.pricesData.forEach(price => {
        const id = normalizeId(price['_0']);
        if (id === targetId) {
            targetPrices.push(price);
        }
        if (!pricesMap.has(id)) {
            pricesMap.set(id, []);
        }
        pricesMap.get(id).push(price);
    });

    let gasolineStations = cache.stationsData
        .map(station => {
            const stationId = normalizeId(station['_0']);
            const isTarget = stationId === targetId;
            
            const stationLat = parseFloat(String(station['_8']).replace(',', '.'));
            const stationLng = parseFloat(String(station['_9']).replace(',', '.'));
            
            if (!isNaN(stationLat) && !isNaN(stationLng)) {
                tracking.withValidCoords.push(stationId);
                if (isTarget) {
                    targetTracking.validCoords = true;
                    targetTracking.lastFoundPhase = 'validCoords';
                }
                
                const dist = calculateDistance(userLat, userLng, stationLat, stationLng);
                
                if (dist <= maxDistance) {
                    tracking.inRange.push(stationId);
                    if (isTarget) {
                        targetTracking.inRange = true;
                        targetTracking.lastFoundPhase = 'inRange';
                    }

                    const stationPrices = pricesMap.get(stationId) || [];
                    const filteredPrices = stationPrices.filter(p => 
                        p['_1']?.trim().toUpperCase() === TipoFuel.trim().toUpperCase()
                    );

                    if (filteredPrices.length > 0) {
                        tracking.withMatchingFuel.push(stationId);
                        tracking.finalIds.push(stationId);
                        
                        if (isTarget) {
                            targetTracking.hasFuel = true;
                            targetTracking.inFinal = true;
                            targetTracking.lastFoundPhase = 'final';
                        }

                        return {
                            id_stazione: stationId,
                            tipo_stazione: 'Benzina',
                            bandiera: station['_2'],
                            dettagli_stazione: {
                                gestore: station['_1'],
                                tipo: station['_3'],
                                nome: station['_4']
                            },
                            indirizzo: {
                                via: station['_5'],
                                comune: station['_6'],
                                provincia: station['_7']
                            },
                            maps: {
                                lat: stationLat,
                                lon: stationLng
                            },
                            distanza: Number(dist.toFixed(2)),
                            prezzi_carburanti: filteredPrices.map(price => ({
                                tipo: price['_1'],
                                prezzo: parseFloat(price['_2']?.replace(',', '.')) || null,
                                self_service: price['_3'] === '1',
                                ultimo_aggiornamento: price['_4']
                            }))
                        };
                    } else if (isTarget) {
                        targetTracking.failureReason = `Non ha prezzi per il tipo carburante ${TipoFuel}`;
                    }
                } else if (isTarget) {
                    targetTracking.failureReason = `Fuori dal raggio di ${maxDistance}km (distanza: ${dist.toFixed(2)}km)`;
                }
            } else if (isTarget) {
                targetTracking.failureReason = 'Coordinate non valide';
            }
            
            return null;
        })
        .filter(station => station !== null)
        .sort((a, b) => a.distanza - b.distanza);

    console.log('[DEBUG] Tracciamento target ID:', {
        targetId,
        tracking: {
            trovatoInDatasetIniziale: targetTracking.initialCheck,
            haCoordinateValide: targetTracking.validCoords,
            nelRaggio: targetTracking.inRange,
            haCarburanteRichiesto: targetTracking.hasFuel,
            nelRisultatoFinale: targetTracking.inFinal,
            ultimaFaseDoveTrovato: targetTracking.lastFoundPhase,
            motivoEsclusione: targetTracking.failureReason
        },
        dettagliPrezzi: targetPrices.length > 0 ? {
            numeroPrezzi: targetPrices.length,
            tipiCarburante: [...new Set(targetPrices.map(p => p['_1']))]
        } : 'Nessun prezzo trovato'
    });

    res.json({
        status: 'success',
        timestamp: new Date().toISOString(),
        debug: {
            tracking,
            targetTracking,
            searchParams: { lat, lng, distance, TipoFuel }
        },
        totale_stazioni: cache.stationsData.length,
        stazioni_trovate: gasolineStations.length,
        stations: gasolineStations
    });
});

// Configurazione della porta
const PORT = process.env.PORT || 3000;

// Avvio del server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

module.exports = app;