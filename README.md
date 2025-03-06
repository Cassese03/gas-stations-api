# Gas Stations API

API per la ricerca delle stazioni di servizio in Italia con prezzi dei carburanti aggiornati.

## Installazione

```bash
npm install
```

## Avvio in sviluppo

```bash
npm run dev
```

## Endpoint disponibili

### GET /gas-stations
Trova le stazioni di servizio in un'area specifica.

Parametri:
- `lat`: Latitudine (es: 41.9028)
- `lng`: Longitudine (es: 12.4964)
- `distance`: Raggio di ricerca in km (es: 5)

### GET /top-stations
Mostra le prime 10 stazioni di servizio.

## Deploy
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/git/external?repository-url=https://github.com/TUOUSERNAME/gas-stations-api)