// Netlify serverless health check endpoint
exports.handler = async function (event) {
    const origin = event.headers.origin || event.headers.Origin || '';
    const isAllowed = origin === 'https://iamwarriorofmyuniverse-coder.github.io' || 
                      (origin && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')));
    
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: {
                'Access-Control-Allow-Origin': isAllowed ? origin : 'https://iamwarriorofmyuniverse-coder.github.io',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Allow-Methods': 'GET, OPTIONS'
            },
            body: ''
        };
    }

    return {
        statusCode: 200,
        headers: {
            'Access-Control-Allow-Origin': isAllowed ? origin : 'https://iamwarriorofmyuniverse-coder.github.io',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        })
    };
};
