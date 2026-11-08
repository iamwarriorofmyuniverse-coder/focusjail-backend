// FocusPact Serverless AI Verdict Engine
// Rate-limited, origin-locked, zero-leak backend proxy

const ipTracker = new Map();
let globalDaily = { count: 0, date: new Date().toISOString().slice(0, 10) };

function checkLimit(ip, maxPerHour) {
    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);

    if (globalDaily.date !== today) {
        globalDaily = { count: 0, date: today };
    }
    if (globalDaily.count >= 500) {
        return { allowed: false, error: 'Daily service capacity reached. Please try again tomorrow.' };
    }

    let entry = ipTracker.get(ip);
    if (!entry || now > entry.resetTime) {
        entry = { count: 0, resetTime: now + 3600000 };
        ipTracker.set(ip, entry);
    }

    if (entry.count >= maxPerHour) {
        return { allowed: false, error: 'Rate limit exceeded: maximum 20 requests per hour.' };
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

    const clientIP = event.headers['x-forwarded-for'] ? event.headers['x-forwarded-for'].split(',')[0].trim() : (event.headers['client-ip'] || 'unknown');
    const limitCheck = checkLimit(clientIP, 20);
    if (!limitCheck.allowed) {
        return { statusCode: 429, headers, body: JSON.stringify({ error: limitCheck.error }) };
    }

    let body = {};
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON payload' }) };
    }

    const {
        name = 'User',
        goals = [],
        completed = false,
        excuse = '',
        proof = '',
        streak = 0,
        tone = 'firm'
    } = body;

    const GROQ_KEY = process.env.GROQ_KEY || '';
    if (!GROQ_KEY) {
        console.error('Verdict service error: GROQ_KEY is not configured on host');
        return {
            statusCode: 503,
            headers,
            body: JSON.stringify({ error: 'AI verdict service temporarily unavailable', isUnavailable: true })
        };
    }

    const toneInstructions = {
        brutal: 'Be an uncompromising, hyper-direct accountability warden. No fluff, no toxic positivity. Call out exact excuses with surgical precision. Address the user directly by name.',
        firm: 'Be a disciplined, direct executive coach. Stick to the facts, eliminate rationalizations, and demand high standards.',
        gentle: 'Be an empathetic mentor. Acknowledge the struggle, recognize genuine effort, but maintain accountability.'
    };

    const systemPrompt = `You are FocusPact, an AI accountability mentor.
Rules:
- Tone: ${toneInstructions[tone] || toneInstructions.firm}
- Keep your response to EXACTLY 2 impactful sentences.
- Never use generic clichés. Focus directly on the stated commitments.`;

    const userPrompt = `User: ${name}
Commitments: ${goals.length ? goals.join(', ') : 'None specified'}
Outcome: ${completed ? 'Goals fully met' : 'FAILED / Incomplete'}
Proof: ${proof ? 'Provided' : 'None'}
Reflection: ${excuse || 'None'}
Streak: ${streak} Days`;

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_KEY}`
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                max_tokens: 180,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            // Secondary fallback to 8B instant
            const fallbackRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${GROQ_KEY}`
                },
                body: JSON.stringify({
                    model: 'llama-3.1-8b-instant',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    max_tokens: 180,
                    temperature: 0.7
                })
            });

            if (!fallbackRes.ok) {
                console.error('Groq API error HTTP ' + fallbackRes.status);
                return {
                    statusCode: 503,
                    headers,
                    body: JSON.stringify({ error: 'AI verdict service unavailable', isUnavailable: true })
                };
            }

            const fallbackData = await fallbackRes.json();
            const verdict = fallbackData.choices && fallbackData.choices[0] ? fallbackData.choices[0].message.content.trim() : '';
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ verdict })
            };
        }

        const data = await response.json();
        const verdict = data.choices && data.choices[0] ? data.choices[0].message.content.trim() : '';
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ verdict })
        };
    } catch (err) {
        console.error('Verdict error:', err.message);
        return {
            statusCode: 503,
            headers,
            body: JSON.stringify({ error: 'AI verdict service unavailable', isUnavailable: true })
        };
    }
};
