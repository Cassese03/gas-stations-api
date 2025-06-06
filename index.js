const express = require('express');
const csv = require('csv-parser');
const fetch = require('node-fetch');
const { Readable } = require('stream');
const cors = require('cors');

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

// Funzione per calcolare la distanza tra due punti usando la formula di Haversine
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raggio della Terra in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180; // Corretto qui: era (lon1 - lon1)
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function downloadAndParseCSV(url) {
    // Aggiungi un timeout esplicito per le richieste
    const timeout = 15000; // 15 secondi di timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        console.log(`Tentativo download da ${url}`);
        
        // Controllo se l'URL è quello problematico del MISE e provo URL alternativi
        let urlToUse = url;
        if (url.includes('mise.gov.it')) {
            // Prova URL alternativi dal ministero (MIMIT è il nuovo nome del MISE)
            if (url.includes('anagrafica_impianti_attivi.csv')) {
                console.log('Utilizzo URL alternativo per anagrafica');
                urlToUse = 'https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv';
            } else if (url.includes('prezzo_alle_8.csv')) {
                console.log('Utilizzo URL alternativo per prezzi');
                urlToUse = 'https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv';
            }
        }
        
        const response = await fetch(urlToUse, {
            method: 'GET',
            headers: {
                'Accept': 'text/csv,application/csv',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`Risposta HTTP non valida: ${response.status} ${response.statusText}`);
        }

        return new Promise((resolve, reject) => {
            const results = [];
            let isFirstRow = true;

            Readable.from(response.body)
                .pipe(csv({
                    separator: ';',
                    mapHeaders: ({ header, index }) => `_${index}` // Questo trasforma gli header in _0, _1, _2, ecc.
                }))
                .on('data', (data) => {
                    if (!isFirstRow) {
                        results.push(data);
                    } else {
                        isFirstRow = false;
                    }
                })
                .on('end', () => {
                    console.log(`Download completato con successo: ${results.length} righe`);
                    resolve(results);
                })
                .on('error', (error) => {
                    console.error(`Errore parsing CSV: ${error.message}`);
                    reject(error);
                });
        });
    } catch (error) {
        clearTimeout(timeoutId);
        console.error('Download error:', error.message);
        
        // In caso di errore, ritorna un array vuoto invece di lanciare un'eccezione
        // per evitare che tutto il processo fallisca
        console.log('Ritorno array vuoto a causa di errore download');
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
    const HOURS_23 = 23 * 60 * 60 * 1000;

    if (!cache.lastUpdate || (Date.now() - cache.lastUpdate) > HOURS_23) {
        try {
            console.log('Aggiornamento dati...');

            // Aggiungi gestione degli errori migliorata
            let stations = [], prices = [], chargeStations = [];
            
            try {
                // Primo tentativo con URL mimit.gov.it
                [stations, prices, chargeStations] = await Promise.all([
                    downloadAndParseCSV('https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv'),
                    downloadAndParseCSV('https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv'),
                    downloadChargeStationsData('https://api.openchargemap.io/v3/poi/?output=json&countrycode=IT&key=65923063-f5a4-43cd-8ef9-3c1d64195d93&maxresults=1000')
                ]);
                
                // Se non abbiamo ottenuto dati, proviamo con gli URL originali mise.gov.it
                if (!stations.length || !prices.length) {
                    console.log('Primo tentativo fallito, provo URLs alternativi...');
                    [stations, prices] = await Promise.all([
                        downloadAndParseCSV('https://www.mise.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv'),
                        downloadAndParseCSV('https://www.mise.gov.it/images/exportCSV/prezzo_alle_8.csv')
                    ]);
                }
            } catch (downloadError) {
                console.error('Errore durante il download parallelo:', downloadError.message);
                
                // Proviamo a scaricare i file uno alla volta per isolare il problema
                console.log('Tentativo download sequenziale...');
                try {
                    stations = await downloadAndParseCSV('https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv');
                } catch (e) {
                    console.error('Errore download stazioni:', e.message);
                }
                
                try {
                    prices = await downloadAndParseCSV('https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv');
                } catch (e) {
                    console.error('Errore download prezzi:', e.message);
                }
                
                try {
                    chargeStations = await downloadChargeStationsData('https://api.openchargemap.io/v3/poi/?output=json&countrycode=IT&key=65923063-f5a4-43cd-8ef9-3c1d64195d93&maxresults=1000');
                } catch (e) {
                    console.error('Errore download stazioni ricarica:', e.message);
                }
            }

            // Verifica se abbiamo ottenuto dati validi
            if (stations?.length && prices?.length) {
                console.log(`Download completato: ${stations.length} stazioni, ${prices.length} prezzi`);
                cache.stationsData = stations.slice(1);
                cache.pricesData = prices.slice(1);

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
                console.error('Non è stato possibile ottenere dati completi: stazioni='+stations.length+', prezzi='+prices.length);
                
                // Mantieni i dati precedenti se disponibili
                if (!cache.stationsData) cache.stationsData = [];
                if (!cache.pricesData) cache.pricesData = [];
                if (!cache.chargeStationsData) cache.chargeStationsData = [];
            }
        } catch (error) {
            console.error('Errore generale aggiornamento:', error.message);
            // Assicurati che la cache abbia almeno array vuoti per evitare errori
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
    // if (cache.chargeStationsData) {
    //     electricStations = cache.chargeStationsData
    //         .filter(station => {
    //             if (!station.AddressInfo || !station.AddressInfo.Latitude || !station.AddressInfo.Longitude) {
    //                 return false;
    //             }

    //             const stationLat = station.AddressInfo.Latitude;
    //             const stationLng = station.AddressInfo.Longitude;
    //             const dist = calculateDistance(userLat, userLng, stationLat, stationLng);
    //             station._distance = dist;
    //             return dist <= maxDistance;
    //         })
    //         .map(station => {
    //             const avgPower = station.Connections.reduce((sum, conn) => sum + (conn.PowerKW || 0), 0) /
    //                 (station.Connections.length || 1);

    //             // Aggiungi il numero di colonnine disponibili
    //             const numBays = station.NumberOfPoints || station.Connections.length || 1;

    //             return {
    //                 id_stazione: station.ID.toString(),
    //                 tipo_stazione: `Elettrica`,
    //                 bandiera: station.OperatorInfo?.Title || "N/D",
    //                 dettagli_stazione: {
    //                     gestore: station.OperatorInfo?.Title || "N/D",
    //                     tipo: "Elettrica",
    //                     nome: (station.AddressInfo.Title || "Stazione di ricarica") + ` (${numBays} colonnine)`
    //                 },
    //                 indirizzo: {
    //                     via: station.AddressInfo.AddressLine1 || "N/D",
    //                     comune: station.AddressInfo.Town || "N/D",
    //                     provincia: station.AddressInfo.StateOrProvince || "N/D"
    //                 },
    //                 maps: {
    //                     lat: station.AddressInfo.Latitude,
    //                     lon: station.AddressInfo.Longitude
    //                 },
    //                 distanza: parseFloat(station._distance.toFixed(2)),
    //                 prezzi_carburanti: station.Connections.map(conn => {
    //                     const potenzaKW = conn.PowerKW || avgPower || 0;
    //                     let stimaPrezzo = null;

    //                     if (potenzaKW > 0) {
    //                         // Stima basata su tariffe medie in Italia
    //                         if (potenzaKW < 11) stimaPrezzo = 0.40; // AC lenta
    //                         else if (potenzaKW < 50) stimaPrezzo = 0.50; // AC veloce
    //                         else if (potenzaKW < 100) stimaPrezzo = 0.60; // DC veloce
    //                         else stimaPrezzo = 0.70; // DC ultra veloce
    //                     }

    //                     return {
    //                         tipo: conn.ConnectionType?.Title || "Generico",
    //                         potenza_kw: parseFloat(potenzaKW.toFixed(2)),
    //                         prezzo: stimaPrezzo, // €/kWh stimato
    //                         unita_misura: "€/kWh (stimato)",
    //                         self_service: true,
    //                         ultimo_aggiornamento: station.DateLastStatusUpdate ?
    //                             new Date(station.DateLastStatusUpdate).toISOString().split('T')[0] :
    //                             new Date().toISOString().split('T')[0]
    //                     };
    //                 })
    //             };
    //         });
    // }
    // 3. Ottieni le stazioni di ricarica da Google Places API
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
        });// Termina l'esecuzione del programma come farebbe dd() in PHP

        if (response.status === 200) {
            const googleData = await response.json();
            if (googleData.places.length > 0) {
                googleStations = googleData.places.map(async station => {
                    //console.log('station:', station);

                    //process.exit(0); Termina l'esecuzione del programma come farebbe dd() in PHP

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
    const allStations = [...gasolineStations/*, ...electricStations,*/, ...googleStations]
        .sort((a, b) => a.distanza - b.distanza)
        .slice(0, parseInt(distance * 4));
    // // 3. Unisci le stazioni e ordina per distanza
    // const allStations = [...gasolineStations, ...electricStations]
    //     .sort((a, b) => a.distanza - b.distanza)
    //     .slice(0, parseInt(distance * 4));

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
    //await updateDataIfNeeded();

    const { lat, lng, distance } = req.query;

    if (!lat || !lng || !distance) {
        return res.status(400).json({
            status: 'error',
            message: 'Parametri lat, lng e distance sono richiesti'
        });
    }

    // if (!cache.chargeStationsData) {
    //     return res.status(503).json({
    //         status: 'error',
    //         message: 'Dati non ancora disponibili'
    //     });
    // }

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
        });// Termina l'esecuzione del programma come farebbe dd() in PHP

        if (response.status === 200) {
            const googleData = await response.json();
            if (googleData.places.length > 0) {
                googleStations = googleData.places.map(async station => {
                    //console.log('station:', station);

                    //process.exit(0); Termina l'esecuzione del programma come farebbe dd() in PHP
                    // Recupera informazioni dettagliate per ogni stazione da Google Places API
                    //         const placeDetailsUrl = `https://places.googleapis.com/v1/places/${station.place_id}?fields=id,displayName,evChargeOptions,addressDescriptor&key=${googleApiKey}`;
                    //         const placeDetailsResponse = await fetch(placeDetailsUrl);

                    //         let placeDetails = {};
                    //         if (placeDetailsResponse.ok) {
                    //             placeDetails = await placeDetailsResponse.json();
                    //         } else {
                    //             console.error(`Errore nel recupero dei dettagli per la stazione ${station.place_id}:`, placeDetailsResponse.statusText);
                    //         }



                    //                     const potenzaKW = conn.PowerKW || avgPower || 0;
                    //                     let stimaPrezzo = null;

                    //                     if (potenzaKW > 0) {
                    //                         // Stima basata su tariffe medie in Italia
                    //                         if (potenzaKW < 11) stimaPrezzo = 0.40; // AC lenta
                    //                         else if (potenzaKW < 50) stimaPrezzo = 0.50; // AC veloce
                    //                         else if (potenzaKW < 100) stimaPrezzo = 0.60; // DC veloce
                    //                         else stimaPrezzo = 0.70; // DC ultra veloce
                    //                     }

                    //                     return {
                    //                         tipo: conn.ConnectionType?.Title || "Generico",
                    //                         potenza_kw: parseFloat(potenzaKW.toFixed(2)),
                    //                         prezzo: stimaPrezzo, // €/kWh stimato
                    //                         unita_misura: "€/kWh (stimato)",
                    //                         self_service: true,
                    //                         ultimo_aggiornamento: station.DateLastStatusUpdate ?
                    //                             new Date(station.DateLastStatusUpdate).toISOString().split('T')[0] :
                    //                             new Date().toISOString().split('T')[0]
                    //                     };
                    //                 

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
    // Ottieni solo le stazioni elettriche
    /*let electricStations = cache.chargeStationsData
        .filter(station => {
            if (!station.AddressInfo || !station.AddressInfo.Latitude || !station.AddressInfo.Longitude) {
                return false;
            }

            const stationLat = station.AddressInfo.Latitude;
            const stationLng = station.AddressInfo.Longitude;
            const dist = calculateDistance(userLat, userLng, stationLat, stationLng);
            station._distance = dist;
            return dist <= maxDistance;
        })
        .map(station => {
            const avgPower = station.Connections.reduce((sum, conn) => sum + (conn.PowerKW || 0), 0) /
                (station.Connections.length || 1);

            const numBays = station.NumberOfPoints || station.Connections.length || 1;

            return {
                id_stazione: station.ID.toString(),
                tipo_stazione: 'Elettrica',
                bandiera: station.OperatorInfo?.Title || "N/D",
                dettagli_stazione: {
                    gestore: station.OperatorInfo?.Title || "N/D",
                    tipo: "Elettrica",
                    nome: (station.AddressInfo.Title || "Stazione di ricarica") + ` (${numBays} colonnine)`
                },
                indirizzo: {
                    via: station.AddressInfo.AddressLine1 || "N/D",
                    comune: station.AddressInfo.Town || "N/D",
                    provincia: station.AddressInfo.StateOrProvince || "N/D"
                },
                maps: {
                    lat: station.AddressInfo.Latitude,
                    lon: station.AddressInfo.Longitude
                },
                distanza: parseFloat(station._distance.toFixed(2)),
                prezzi_carburanti: station.Connections.map(conn => {
                    const potenzaKW = conn.PowerKW || avgPower || 0;
                    let stimaPrezzo = null;

                    if (potenzaKW > 0) {
                        if (potenzaKW < 11) stimaPrezzo = 0.40;
                        else if (potenzaKW < 50) stimaPrezzo = 0.50;
                        else if (potenzaKW < 100) stimaPrezzo = 0.60;
                        else stimaPrezzo = 0.70;
                    }

                    return {
                        tipo: conn.ConnectionType?.Title || "Generico",
                        prezzo: stimaPrezzo,
                        self_service: true,
                        ultimo_aggiornamento: station.DateLastStatusUpdate ?
                            new Date(station.DateLastStatusUpdate).toISOString().split('T')[0] :
                            new Date().toISOString().split('T')[0]
                    };
                })
            };
        })
        .sort((a, b) => a.distanza - b.distanza)
        .slice(0, parseInt(distance * 4));
        */

    res.json({
        status: 'success',
        timestamp: new Date().toISOString(),
        totale_stazioni: googleStations.length,
        stazioni_trovate: googleStations.length,
        stations: googleStations
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