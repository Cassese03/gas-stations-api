const fs = require('fs');
const path = require('path');

/**
 * Dati locali delle stazioni di benzina e prezzi
 * Questi dati vengono utilizzati in ambiente Vercel come alternativa
 * al download diretto dai server del ministero che causa errori ETIMEDOUT
 */

// Percorsi file per i dati salvati
const SAVED_DATA_DIR = path.join(__dirname, 'saved_data');
const STATIONS_FILE = path.join(SAVED_DATA_DIR, 'stations_data.json');
const PRICES_FILE = path.join(SAVED_DATA_DIR, 'prices_data.json');
const METADATA_FILE = path.join(SAVED_DATA_DIR, 'metadata.json');

// Assicurati che la directory esista
try {
  if (!fs.existsSync(SAVED_DATA_DIR)) {
    fs.mkdirSync(SAVED_DATA_DIR, { recursive: true });
    console.log(`Directory creata: ${SAVED_DATA_DIR}`);
  }
} catch (error) {
  console.error('Errore nella creazione della directory per i dati salvati:', error);
}

// Dati di fallback minimi nel caso in cui non ci sia nulla di salvato
const fallbackStationsData = [
  // Aggiungi qui almeno 50-100 stazioni dalle principali città italiane
  {
    "_0": "1000001",
    "_1": "TAMOIL ITALIA SPA",
    "_2": "TAMOIL",
    "_3": "Stradale",
    "_4": "STAZIONE DI RIFORNIMENTO",
    "_5": "VIA CRISTOFORO COLOMBO 1897",
    "_6": "ROMA",
    "_7": "RM",
    "_8": "41.8183",
    "_9": "12.4593"
  },
  {
    "_0": "1000002",
    "_1": "ENI SPA",
    "_2": "ENI",
    "_3": "Stradale",
    "_4": "STAZIONE DI SERVIZIO",
    "_5": "VIA TUSCOLANA 1581",
    "_6": "ROMA",
    "_7": "RM",
    "_8": "41.8544",
    "_9": "12.5779"
  },
  {
    "_0": "1000003",
    "_1": "Q8 PETROLEUM ITALIA SPA",
    "_2": "Q8",
    "_3": "Stradale",
    "_4": "STAZIONE DI SERVIZIO",
    "_5": "VIALE EUROPA 95",
    "_6": "ROMA",
    "_7": "RM",
    "_8": "41.8317",
    "_9": "12.4686"
  },
  {
    "_0": "1000004",
    "_1": "ESSO ITALIANA SRL",
    "_2": "ESSO",
    "_3": "Stradale",
    "_4": "STAZIONE DI SERVIZIO",
    "_5": "CORSO FRANCIA 252",
    "_6": "ROMA",
    "_7": "RM",
    "_8": "41.9378",
    "_9": "12.4689"
  },
  {
    "_0": "1000005",
    "_1": "ENI SPA",
    "_2": "ENI",
    "_3": "Stradale",
    "_4": "STAZIONE DI SERVIZIO",
    "_5": "CORSO SEMPIONE 94",
    "_6": "MILANO",
    "_7": "MI",
    "_8": "45.4862",
    "_9": "9.1663"
  },
  {
    "_0": "1000006",
    "_1": "TAMOIL ITALIA SPA",
    "_2": "TAMOIL",
    "_3": "Stradale",
    "_4": "STAZIONE DI RIFORNIMENTO",
    "_5": "VIALE FULVIO TESTI 303",
    "_6": "MILANO",
    "_7": "MI",
    "_8": "45.5124",
    "_9": "9.2136"
  },
  {
    "_0": "1000007",
    "_1": "Q8 PETROLEUM ITALIA SPA",
    "_2": "Q8",
    "_3": "Stradale",
    "_4": "STAZIONE DI SERVIZIO",
    "_5": "VIALE CERTOSA 215",
    "_6": "MILANO",
    "_7": "MI",
    "_8": "45.4993",
    "_9": "9.1224"
  },
  {
    "_0": "1000008",
    "_1": "AGIP SPA",
    "_2": "AGIP",
    "_3": "Stradale",
    "_4": "STAZIONE DI SERVIZIO",
    "_5": "CORSO GARIBALDI 35",
    "_6": "NAPOLI",
    "_7": "NA",
    "_8": "40.8483",
    "_9": "14.2494"
  },
  {
    "_0": "1000009",
    "_1": "ESSO ITALIANA SRL",
    "_2": "ESSO",
    "_3": "Stradale",
    "_4": "STAZIONE DI SERVIZIO",
    "_5": "VIA TOLEDO 256",
    "_6": "NAPOLI",
    "_7": "NA",
    "_8": "40.8422",
    "_9": "14.2485"
  },
  {
    "_0": "1000010",
    "_1": "ENI SPA",
    "_2": "ENI",
    "_3": "Stradale",
    "_4": "STAZIONE DI SERVIZIO",
    "_5": "VIA CARACCIOLO 13",
    "_6": "NAPOLI",
    "_7": "NA",
    "_8": "40.8302",
    "_9": "14.2211"
  }
  // ... Aggiungi altre stazioni se necessario
];

const fallbackPricesData = [
  // Prezzi per stazione ID 1000001
  {
    "_0": "1000001",
    "_1": "Benzina",
    "_2": "1,899",
    "_3": "1",
    "_4": "2023-06-06"
  },
  {
    "_0": "1000001",
    "_1": "Gasolio",
    "_2": "1,799",
    "_3": "1",
    "_4": "2023-06-06"
  },
  {
    "_0": "1000001",
    "_1": "GPL",
    "_2": "0,799",
    "_3": "1",
    "_4": "2023-06-06"
  },
  // Prezzi per stazione ID 1000002
  {
    "_0": "1000002",
    "_1": "Benzina",
    "_2": "1,889",
    "_3": "1",
    "_4": "2023-06-06"
  },
  {
    "_0": "1000002",
    "_1": "Gasolio",
    "_2": "1,789",
    "_3": "1",
    "_4": "2023-06-06"
  },
  {
    "_0": "1000002",
    "_1": "Metano",
    "_2": "1,979",
    "_3": "1",
    "_4": "2023-06-06"
  },
  // Prezzi per stazione ID 1000003
  {
    "_0": "1000003",
    "_1": "Benzina",
    "_2": "1,879",
    "_3": "1",
    "_4": "2023-06-06"
  },
  {
    "_0": "1000003",
    "_1": "Gasolio",
    "_2": "1,779",
    "_3": "1",
    "_4": "2023-06-06"
  },
  // Prezzi per stazione ID 1000004
  {
    "_0": "1000004",
    "_1": "Benzina",
    "_2": "1,909",
    "_3": "1",
    "_4": "2023-06-06"
  },
  {
    "_0": "1000004",
    "_1": "Gasolio",
    "_2": "1,809",
    "_3": "1",
    "_4": "2023-06-06"
  },
  // Prezzi per stazione ID 1000005
  {
    "_0": "1000005",
    "_1": "Benzina",
    "_2": "1,929",
    "_3": "1",
    "_4": "2023-06-06"
  },
  {
    "_0": "1000005",
    "_1": "Gasolio",
    "_2": "1,829",
    "_3": "1",
    "_4": "2023-06-06"
  },
  // Prezzi per stazione ID 1000006
  {
    "_0": "1000006",
    "_1": "Benzina",
    "_2": "1,919",
    "_3": "1",
    "_4": "2023-06-06"
  },
  {
    "_0": "1000006",
    "_1": "Gasolio",
    "_2": "1,819",
    "_3": "1",
    "_4": "2023-06-06"
  },
  {
    "_0": "1000006",
    "_1": "GPL",
    "_2": "0,789",
    "_3": "1",
    "_4": "2023-06-06"
  },
  // Prezzi per stazione ID 1000007
  {
    "_0": "1000007",
    "_1": "Benzina",
    "_2": "1,939",
    "_3": "1",
    "_4": "2023-06-06"
  },
  {
    "_0": "1000007",
    "_1": "Gasolio",
    "_2": "1,839",
    "_3": "1",
    "_4": "2023-06-06"
  },
  // Prezzi per stazione ID 1000008
  {
    "_0": "1000008",
    "_1": "Benzina",
    "_2": "1,869",
    "_3": "1",
    "_4": "2023-06-06"
  },
  {
    "_0": "1000008",
    "_1": "Gasolio",
    "_2": "1,769",
    "_3": "1",
    "_4": "2023-06-06"
  },
  // Prezzi per stazione ID 1000009
  {
    "_0": "1000009",
    "_1": "Benzina",
    "_2": "1,859",
    "_3": "1",
    "_4": "2023-06-06"
  },
  {
    "_0": "1000009",
    "_1": "Gasolio",
    "_2": "1,759",
    "_3": "1",
    "_4": "2023-06-06"
  },
  // Prezzi per stazione ID 1000010
  {
    "_0": "1000010",
    "_1": "Benzina",
    "_2": "1,849",
    "_3": "1",
    "_4": "2023-06-06"
  },
  {
    "_0": "1000010",
    "_1": "Gasolio",
    "_2": "1,749",
    "_3": "1",
    "_4": "2023-06-06"
  },
  {
    "_0": "1000010",
    "_1": "GPL",
    "_2": "0,779",
    "_3": "1",
    "_4": "2023-06-06"
  }
  // ... Aggiungi altri prezzi se necessario
];

/**
 * Carica i dati locali salvati o ritorna i dati di fallback
 */
function loadLocalData() {
  let stationsData = fallbackStationsData;
  let pricesData = fallbackPricesData;
  let metadata = { lastSaved: null };
  
  try {
    // Controlla se i file esistono e in tal caso li carica
    if (fs.existsSync(STATIONS_FILE) && fs.existsSync(PRICES_FILE)) {
      const stationsJson = fs.readFileSync(STATIONS_FILE, 'utf8');
      const pricesJson = fs.readFileSync(PRICES_FILE, 'utf8');
      
      const loadedStations = JSON.parse(stationsJson);
      const loadedPrices = JSON.parse(pricesJson);
      
      // Verifica che i dati caricati siano array validi e non vuoti
      if (Array.isArray(loadedStations) && loadedStations.length > 0) {
        stationsData = loadedStations;
        console.log(`Caricati ${stationsData.length} record di stazioni dai dati salvati`);
      }
      
      if (Array.isArray(loadedPrices) && loadedPrices.length > 0) {
        pricesData = loadedPrices;
        console.log(`Caricati ${pricesData.length} record di prezzi dai dati salvati`);
      }
      
      // Carica i metadati se esistono
      if (fs.existsSync(METADATA_FILE)) {
        const metadataJson = fs.readFileSync(METADATA_FILE, 'utf8');
        metadata = JSON.parse(metadataJson);
        console.log(`Dati salvati il: ${new Date(metadata.lastSaved).toLocaleString()}`);
      }
    } else {
      console.log('Nessun dato salvato trovato, utilizzo dati di fallback');
    }
  } catch (error) {
    console.error('Errore nel caricamento dei dati salvati:', error);
    console.log('Utilizzo dati di fallback a causa di errori');
  }
  
  return {
    localStationsData: stationsData,
    localPricesData: pricesData,
    metadata
  };
}

/**
 * Salva i dati su file per usi futuri
 * @param {Array} stationsData - Array di stazioni di benzina
 * @param {Array} pricesData - Array di prezzi
 * @returns {boolean} - True se il salvataggio è riuscito, False altrimenti
 */
function saveLocalData(stationsData, pricesData) {
  if (!Array.isArray(stationsData) || !Array.isArray(pricesData)) {
    console.error('Impossibile salvare dati non validi');
    return false;
  }
  
  if (stationsData.length === 0 || pricesData.length === 0) {
    console.error('Impossibile salvare array vuoti');
    return false;
  }
  
  try {
    // Salva i dati in formato JSON
    fs.writeFileSync(STATIONS_FILE, JSON.stringify(stationsData, null, 2));
    fs.writeFileSync(PRICES_FILE, JSON.stringify(pricesData, null, 2));
    
    // Salva i metadati con la data di salvataggio
    const metadata = {
      lastSaved: new Date().toISOString(),
      stationsCount: stationsData.length,
      pricesCount: pricesData.length
    };
    fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));
    
    console.log(`Dati salvati con successo: ${stationsData.length} stazioni, ${pricesData.length} prezzi`);
    return true;
  } catch (error) {
    console.error('Errore durante il salvataggio dei dati:', error);
    return false;
  }
}

// Carica i dati all'avvio
const { localStationsData, localPricesData, metadata } = loadLocalData();

module.exports = {
  localStationsData,
  localPricesData,
  metadata,
  saveLocalData, // Esporta la funzione di salvataggio
  loadLocalData  // Esporta la funzione di caricamento
};
