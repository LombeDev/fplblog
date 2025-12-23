const https = require('https');

exports.handler = async (event) => {
    // 1. Define Valid CORS Headers
    const headers = {
        "Access-Control-Allow-Origin": "*", // Allows any domain to access
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Content-Type": "application/json"
    };

    // 2. Handle Browser Preflight (OPTIONS request)
    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 204, // No Content
            headers,
            body: ""
        };
    }

    const path = event.queryStringParameters.path;
    const url = `https://fantasy.premierleague.com/api/${path}/`;

    // 3. Perform the Actual Request
    return new Promise((resolve) => {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/115.0.0.0 Safari/537.36'
            }
        };

        https.get(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: 200,
                    headers, // Attach valid CORS headers here
                    body: data
                });
            });
        }).on('error', (e) => {
            resolve({ 
                statusCode: 500, 
                headers, 
                body: JSON.stringify({ error: e.message }) 
            });
        });
    });
};
