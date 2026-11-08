// FocusPact Serverless Proof Verification Engine
// Origin-locked, rate-limited, zero-fabrication proof inspector

const ipTracker = new Map();
let globalDaily = { count: 0, date: new Date().toISOString().slice(0, 10) };

function checkLimit(ip, maxPerHour) {
    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);

    if (globalDaily.date !== today) {
        globalDaily = { count: 0, date: today };
    }
    if (globalDaily.count >= 500) {
        return { allowed: false, error: 'Daily verification capacity reached. Please try again tomorrow.' };
    }

    let entry = ipTracker.get(ip);
    if (!entry || now > entry.resetTime) {
        entry = { count: 0, resetTime: now + 3600000 };
        ipTracker.set(ip, entry);
    }

    if (entry.count >= maxPerHour) {
        return { allowed: false, error: 'Rate limit exceeded: maximum 10 verification requests per hour.' };
    }

    entry.count++;
    globalDaily.count++;
    return { allowed: true };
}

exports.handler = async function (event) {
    const origin = event.headers.origin || event.headers.Origin || '';
    const isAllowed = origin === 'https://iamwarriorofmyuniverse-coder.github.io' || 
                      (origin && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')));
    const corsOrigin = isAllowed ? origin : 'https://iamwarriorofmyuniverse-coder.github.io';

    const headers = {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    // 1. Enforce payload size limit (~2.5MB base64 string corresponds to ~1.8MB binary)
    const rawBody = event.body || '';
    if (rawBody.length > 2.5 * 1024 * 1024) {
        return {
            statusCode: 413,
            headers,
            body: JSON.stringify({ error: 'Payload Too Large: proof image must be under 2MB.' })
        };
    }

    // 2. Rate limit check
    const clientIP = event.headers['x-forwarded-for'] ? event.headers['x-forwarded-for'].split(',')[0].trim() : (event.headers['client-ip'] || 'unknown');
    const limitCheck = checkLimit(clientIP, 10);
    if (!limitCheck.allowed) {
        return { statusCode: 429, headers, body: JSON.stringify({ error: limitCheck.error }) };
    }

    let body = {};
    try {
        body = JSON.parse(rawBody);
    } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON payload' }) };
    }

    const {
        goalText = 'Daily Commitment',
        imageBase64 = '',
        userName = 'User',
        goalIndex = 0
    } = body;

    // 3. Reject non-image MIME types or invalid base64
    const mimeMatch = imageBase64.match(/^data:(image\/(jpeg|jpg|png|webp|gif));base64,/i);
    if (!mimeMatch || imageBase64.length < 200) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Invalid image format. Supported formats: JPEG, PNG, WEBP, GIF.' })
        };
    }
    const mimeType = mimeMatch[1];
    const rawBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const GROQ_KEY = process.env.GROQ_KEY || '';
    const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

    if (!GROQ_KEY && !GEMINI_KEY) {
        console.error('Verify-proof error: neither GROQ_KEY nor GEMINI_API_KEY configured');
        return {
            statusCode: 503,
            headers,
            body: JSON.stringify({ verified: false, isUnavailable: true, findings: 'AI verification service temporarily unavailable.' })
        };
    }

    let result = null;

    // Attempt 1: Gemini Flash Vision
    if (GEMINI_KEY) {
        try {
            const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: `You are FocusPact Work Proof Auditor. The user committed to: "${goalText}". Examine this image artifact. Does it show legitimate evidence of working on or completing this commitment? Respond strictly with a JSON object: { "verified": boolean, "findings": "1-2 sentence evidence appraisal" }` },
                            { inline_data: { mime_type: mimeType, data: rawBase64 } }
                        ]
                    }],
                    generationConfig: {
                        response_mime_type: 'application/json',
                        temperature: 0.2
                    }
                })
            });

            if (geminiRes.ok) {
                const geminiData = await geminiRes.json();
                const text = geminiData.candidates && geminiData.candidates[0] && geminiData.candidates[0].content && geminiData.candidates[0].content.parts[0] ? geminiData.candidates[0].content.parts[0].text : '';
                const parsed = JSON.parse(text);
                result = {
                    verified: Boolean(parsed.verified),
                    findings: parsed.findings || (parsed.verified ? 'Visual proof verified against commitment.' : 'Visual proof does not match stated commitment.')
                };
            } else {
                console.error('Gemini vision API error HTTP ' + geminiRes.status);
            }
        } catch (err) {
            console.error('Gemini vision error:', err.message);
        }
    }

    // Attempt 2: Groq Vision fallback
    if (!result && GROQ_KEY) {
        try {
            const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${GROQ_KEY}`
                },
                body: JSON.stringify({
                    model: 'llama-3.2-11b-vision-preview',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are FocusPact Work Proof Auditor. Evaluate whether the image provides genuine evidence for the stated commitment. Respond strictly with JSON: { "verified": boolean, "findings": string }.'
                        },
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: `Commitment: "${goalText}". Determine if this image artifact provides legitimate evidence of execution.` },
                                { type: 'image_url', image_url: { url: imageBase64 } }
                            ]
                        }
                    ],
                    response_format: { type: 'json_object' },
                    max_tokens: 150,
                    temperature: 0.2
                })
            });

            if (groqRes.ok) {
                const groqData = await groqRes.json();
                const contentStr = groqData.choices && groqData.choices[0] ? groqData.choices[0].message.content : '';
                const parsed = JSON.parse(contentStr);
                result = {
                    verified: Boolean(parsed.verified),
                    findings: parsed.findings || (parsed.verified ? 'Visual proof verified.' : 'Proof did not match commitment.')
                };
            } else {
                console.error('Groq vision API error HTTP ' + groqRes.status);
            }
        } catch (err) {
            console.error('Groq vision error:', err.message);
        }
    }

    // If both AI models failed or were unavailable:
    // DO NOT FABRICATE PASSES, SCORES, OR SEALS!
    if (!result) {
        return {
            statusCode: 503,
            headers,
            body: JSON.stringify({
                verified: false,
                isUnavailable: true,
                findings: 'Not verified: AI unavailable'
            })
        };
    }

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
            verified: result.verified,
            findings: result.findings,
            timestamp: new Date().toISOString()
        })
    };
};
