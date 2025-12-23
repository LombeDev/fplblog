const fetch = require('node-fetch');

exports.handler = async (event) => {
    // 1. Get the path from the URL (e.g., bootstrap-static)
    const path = event.queryStringParameters.path;
    
    if (!path) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "Missing 'path' parameter" })
        };
    }

    // 2. Construct the FPL API URL
    const url = `https://fantasy.premierleague.com/api/${path}/`;

    console.log("Proxying request to:", url);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                // FPL requires a User-Agent to identify the request as coming from a browser
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            return {
                statusCode: response.status,
                body: JSON.stringify({ error: `FPL API error: ${response.statusText}` })
            };
        }

        const data = await response.json();

        // 3. Return the data to your website
        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json",
                // These headers allow your website to read the data
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "GET, OPTION"
            },
            body: JSON.stringify(data)
        };
    } catch (error) {
        console.error("Function Error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Internal Server Error", details: error.message })
        };
    }
};
