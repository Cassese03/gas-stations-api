const express = require('express');
const csv = require('csv-parser');
const fetch = require('node-fetch');
const fs = require('fs');
const { Readable } = require('stream');

const app = express();
const port = process.env.PORT || 3000;  // Modifica qui per usare la porta di Vercel se disponibile

// Funzione per calcolare la distanza tra due punti usando la formula di Haversine
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raggio della Terra in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Funzione per scaricare e parsare i CSV
async function downloadAndParseCSV(url) {
    const response = await fetch(url);
    const buffer = await response.buffer();
    const results = [];
    
    return new Promise((resolve, reject) => {
        Readable.from(buffer)
            .pipe(csv({ separator: ';' }))
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
    });
}

// Cache per i dati
let stationsData = null;
let pricesData = null;

// Funzione per aggiornare i dati
async function updateData() {
    try {
        console.log('Iniziando aggiornamento dati...');
        const stations = await downloadAndParseCSV('https://www.mise.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv');
        const prices = await downloadAndParseCSV('https://www.mise.gov.it/images/exportCSV/prezzo_alle_8.csv');
        
        if (stations.length > 0 && prices.length > 0) {
            stationsData = stations.slice(1);
            pricesData = prices.slice(1);
            console.log('Dati aggiornati con successo');
        } else {
            throw new Error('Dati vuoti ricevuti');
        }
    } catch (error) {
        console.error('Errore durante l\'aggiornamento dei dati:', error);
        // Non sovrascrivere i dati esistenti in caso di errore
        if (!stationsData || !pricesData) {
            stationsData = [];
            pricesData = [];
        }
    }
}

// Aggiorna i dati ogni ora
updateData();
setInterval(updateData, 3600000);

app.get('/gas-stations', (req, res) => {
    const { lat, lng, distance } = req.query;
    
    if (!lat || !lng || !distance) {
        return res.status(400).json({
            status: 'error',
            message: 'Parametri lat, lng e distance sono richiesti'
        });
    }

    if (!stationsData || !pricesData) {
        return res.status(503).json({
            status: 'error',
            message: 'Dati non ancora disponibili'
        });
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const maxDistance = parseFloat(distance);

    // Filtra le stazioni per distanza e aggiungi i prezzi
    let nearbyStations = stationsData
        .filter(station => {
            // Usa i nomi corretti dei campi per le coordinate
            const stationLat = parseFloat(station['_8']);
            const stationLng = parseFloat(station['_9']);
            
            if (isNaN(stationLat) || isNaN(stationLng)) {
                return false;
            }

            const dist = calculateDistance(userLat, userLng, stationLat, stationLng);
            return dist <= maxDistance;
        })
        .map(station => {
            const stationId = station['Estrazione del 2025-03-05'];
            const stationPrices = pricesData.filter(p => p['Estrazione del 2025-03-05'] === stationId);

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
                prezzi_carburanti: stationPrices.map(price => ({
                    tipo: price['_1'],
                    prezzo: parseFloat(price['_2']?.replace(',', '.')) || null,
                    self_service: price['_3'] === '1',
                    ultimo_aggiornamento: price['_4']
                }))
            };
        });

    res.json({
        status: 'success',
        timestamp: new Date().toISOString(),
        totale_stazioni: stationsData.length,
        stazioni_trovate: nearbyStations.length,
        stations: nearbyStations
    });
});

app.get('/top-stations', (req, res) => {
    if (!stationsData || !pricesData) {
        return res.status(503).json({ status: 'error', message: 'Dati non disponibili' });
    }

    console.log('Prima stazione:', stationsData[0]);
    console.log('Primo prezzo:', pricesData[0]);

    const topStations = stationsData
        .slice(0, 10)
        .map(station => {
            // Usa il campo ID corretto
            const stationId = station['Estrazione del 2025-03-05'] || station['Estrazione del 2025-03-05'];
            // Trova i prezzi usando l'ID corretto
            const stationPrices = pricesData.filter(p => p['Estrazione del 2025-03-05'] === stationId);
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
                    self_service: price['_3'] === '1',
                    ultimo_aggiornamento: price['_4']
                }))
            };
        });
//aggiusta qui todo
    res.json({
        status: 'success',
        timestamp: new Date().toISOString(),
        totale_stazioni: stationsData.length,
        stazioni_mostrate: topStations.length,
        stations: topStations,
       // debug: {
       //     esempio_stazione: stationsData[0],
       //     esempio_prezzo: pricesData[0]
       // }
    });
});

if (require.main === module) {
    const server = app.listen(process.env.PORT || port, () => {
        console.log(`Server in esecuzione sulla porta ${process.env.PORT || port}`);
        updateData().catch(console.error);
    });
}

module.exports = app;