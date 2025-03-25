const fetch = require('node-fetch');

module.exports = async function handler(req, res) {
    try {
        // Verifica che la richiesta provenga da Vercel Cron
        if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Chiama l'endpoint health
        const healthResponse = await fetch(`${process.env.VERCEL_URL}/health`);
        const healthData = await healthResponse.json();

        console.log('Cron job eseguito:', new Date().toISOString());
        
        res.status(200).json({
            status: 'success',
            timestamp: new Date().toISOString(),
            healthCheck: healthData
        });
    } catch (error) {
        console.error('Cron job error:', error);
        res.status(500).json({
            status: 'error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};
