const express = require('express');
const csv = require('csv-parser');
const fetch = require('node-fetch');
const { Readable } = require('stream');

const app = express();

startAutoUpdate()
.then(() => {
    console.log(`Sto aggiornando ${PORT}`);            
})
.catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});

// Cache per i dati con timestamp
let cache = {
  stationsData: null,
  pricesData: null,
  lastUpdate: null
};

// Funzione per calcolare la distanza tra due punti usando la formula di Haversine
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raggio della Terra in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180; // Corretto qui: era (lon1 - lon1)
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

async function downloadAndParseCSV(url) {
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'text/csv,application/csv'
            }
        });

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
                .on('end', () => resolve(results))
                .on('error', (error) => reject(error));
        });
    } catch (error) {
        console.error('Download error:', error.message);
        throw error;
    }
}

async function updateDataIfNeeded() {
    // Aggiorna i dati solo se sono passate più di 2 ore dall'ultimo aggiornamento
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    
    if (!cache.lastUpdate || (Date.now() - cache.lastUpdate) > TWO_HOURS) {
        try {
            console.log('Aggiornamento dati...');
            const [stations, prices] = await Promise.all([
                downloadAndParseCSV('https://www.mise.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv'),
                downloadAndParseCSV('https://www.mise.gov.it/images/exportCSV/prezzo_alle_8.csv')
            ]);

            if (stations?.length && prices?.length) {
                cache.stationsData = stations.slice(1);
                cache.pricesData = prices.slice(1);
                cache.lastUpdate = Date.now();
                console.log('Dati aggiornati con successo');
            }
        } catch (error) {
            console.error('Errore aggiornamento:', error.message);
            if (!cache.stationsData) cache.stationsData = [];
            if (!cache.pricesData) cache.pricesData = [];
        }
    }
}

// Modifica i route handler per usare la cache
app.get('/gas-stations', async (req, res) => {

    console.log(`Request received on port ${PORT}`);
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

    // Filtra le stazioni per distanza e aggiungi i prezzi
    let nearbyStations = cache.stationsData
        .filter(station => {
            // Usa i nomi corretti dei campi per le coordinate
            const stationLat = parseFloat(station['_8']);
            const stationLng = parseFloat(station['_9']);
            
            if (isNaN(stationLat) || isNaN(stationLng)) {
                return false;
            }

            const dist = calculateDistance(userLat, userLng, stationLat, stationLng);
            station._distance = dist; // Salviamo la distanza per l'ordinamento
            return dist <= maxDistance;
        })
        .map(station => {
            const stationId = station['_0'];
            const stationPrices = cache.pricesData.filter(p => p['_0'] === stationId);

            return {
                id_stazione: stationId,
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
        })
        .sort((a, b) => a.distanza - b.distanza)
        .slice(0, 30); // Limita a 10 risultati
//test
    res.json({
        status: 'success',
        timestamp: new Date().toISOString(),
        totale_stazioni: cache.stationsData.length,
        stazioni_trovate: nearbyStations.length,
        stations: nearbyStations
    });
});

app.get('/top-stations', async (req, res) => {
    if (!cache.stationsData || !cache.pricesData) {
        return res.status(503).json({ status: 'error', message: 'Dati non disponibili' });
    }

    console.log('Prima stazione:', cache.stationsData[0]);
    console.log('Primo prezzo:', cache.pricesData[0]);

    const topStations = cache.stationsData
        .slice(0, 10)
        .map(station => {
            // Usa il campo ID corretto
            const stationId = station['_0'] || station['_0'];
            // Trova i prezzi usando l'ID corretto
            const stationPrices = cache.pricesData.filter(p => p['_0'] === stationId);
            return {
                id_stazione: stationId,
                bandiera: station['_2'],
                dettagli_stazione: {
                    gestore: station['_1'],
                    tipo: station['_3'],
                    nome: station['_4']
                },
                indirizzo: {
                    via: station['_5'],
                    comune: station['_6'],
                    provincia: station['_7'],
                    regione: 'null',
                },
                maps:{
                    lat: parseFloat(station['_8']),
                    lon: parseFloat(station['_9'])
                },
                prezzi_carburanti: stationPrices.map(price => ({
                    tipo: price['_1'],
                    prezzo: parseFloat(price['_2']?.replace(',', '.')) || null,
                    prezzo: parseFloat(price['_2']?.replace(',', '.')) || null,
                    self_service: price['_3'] === '1',
                    ultimo_aggiornamento: price['_4']
                }))
            };
        });

    res.json({
        status: 'success',
        timestamp: new Date().toISOString(),
        totale_stazioni: cache.stationsData.length,
        stazioni_mostrate: topStations.length,
        stations: topStations,
       // debug: {
       //     esempio_stazione: cache.stationsData[0],
       //     esempio_prezzo: cache.pricesData[0]
       // }
    });
});
// Configurazione dell'aggiornamento automatico
const TWO_HOURS = 2 * 60 * 60 * 1000;

// Modifica la funzione startAutoUpdate per restituire una Promise
async function startAutoUpdate() {
    try {
        // Caricamento iniziale dei dati
        await updateDataIfNeeded();
        console.log('Dati iniziali caricati con successo');

        // Imposta l'intervallo per gli aggiornamenti successivi
        setInterval(async () => {
            try {
                await updateDataIfNeeded();
                console.log('Aggiornamento automatico completato');
            } catch (error) {
                console.error('Errore nell\'aggiornamento automatico:', error);
            }
        }, TWO_HOURS);

    } catch (error) {
        console.error('Errore nel caricamento iniziale:', error);
        throw error; // Rilanciamo l'errore per gestirlo nell'avvio del server
    }
}
// Configurazione della porta
const PORT = process.env.PORT || 3000;

// Avvio del server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server in ascolto sulla porta ${PORT}`);
        startAutoUpdate().catch(error => {
            console.error('Errore durante l\'avvio del server:', error);
            process.exit(1);
        });
    });
   
}

module.exports = app;