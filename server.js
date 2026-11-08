const express = require('express');

const app = express();

const ALLOWED_ORIGIN = 'https://iamwarriorofmyuniverse-coder.github.io';

app.use((req, res, next) => {
    const origin = req.headers.origin || '';
    const isAllowed = origin === ALLOWED_ORIGIN || 
                      (origin && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')));
    res.setHeader('Access-Control-Allow-Origin', isAllowed ? origin : ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

app.use(express.json({ limit: '2.5mb' }));

// In-memory rate limiting
const ipTracker = new Map();
let globalDaily = { count: 0, date: new Date().toISOString().slice(0, 10) };

function rateLimiter(maxPerHour) {
    return (req, res, next) => {
        const now = Date.now();
        const today = new Date().toISOString().slice(0, 10);

        if (globalDaily.date !== today) {
            globalDaily = { count: 0, date: today };
        }
        if (globalDaily.count >= 500) {
            return res.status(429).json({ error: 'Daily service capacity reached. Please try again tomorrow.' });
        }

        const ip = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : req.socket.remoteAddress;
        let entry = ipTracker.get(ip);
        if (!entry || now > entry.resetTime) {
            entry = { count: 0, resetTime: now + 3600000 };
            ipTracker.set(ip, entry);
        }

        if (entry.count >= maxPerHour) {
            return res.status(429).json({ error: `Rate limit exceeded: maximum ${maxPerHour} requests per hour.` });
        }

        entry.count++;
        globalDaily.count++;
        next();
    };
}

const GROQ_KEY = process.env.GROQ_KEY || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        hasGroqKey: Boolean(GROQ_KEY && GROQ_KEY.length > 5),
        hasGeminiKey: Boolean(GEMINI_KEY && GEMINI_KEY.length > 5),
        timestamp: new Date().toISOString()
    });
});

app.post('/api/verdict', rateLimiter(20), async function (req, res) {
    const {
        name = 'User',
        goals = [],
        completed = false,
        excuse = '',
        proof = '',
        streak = 0,
        tone = 'firm'
    } = req.body;

    if (!GROQ_KEY) {
        console.error('Verdict error: GROQ_KEY not configured on server');
        return res.status(503).json({ error: 'AI verdict service unavailable', isUnavailable: true });
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
                console.error('Groq fallback error HTTP ' + fallbackRes.status);
                return res.status(503).json({ error: 'AI verdict service unavailable', isUnavailable: true });
            }

            const fallbackData = await fallbackRes.json();
            const verdict = fallbackData.choices && fallbackData.choices[0] ? fallbackData.choices[0].message.content.trim() : '';
            return res.json({ verdict });
        }

        const data = await response.json();
        const verdict = data.choices && data.choices[0] ? data.choices[0].message.content.trim() : '';
        return res.json({ verdict });
    } catch (err) {
        console.error('Verdict error:', err.message);
        return res.status(503).json({ error: 'AI verdict service unavailable', isUnavailable: true });
    }
});

app.post('/api/verify-proof', rateLimiter(10), async function (req, res) {
    const {
        goalText = 'Daily Commitment',
        imageBase64 = ''
    } = req.body;

    const mimeMatch = imageBase64.match(/^data:(image\/(jpeg|jpg|png|webp|gif));base64,/i);
    if (!mimeMatch || imageBase64.length < 200) {
        return res.status(400).json({ error: 'Invalid image format. Supported formats: JPEG, PNG, WEBP, GIF.' });
    }

    const mimeType = mimeMatch[1];
    const rawBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    if (!GROQ_KEY && !GEMINI_KEY) {
        console.error('Verify-proof error: no vision keys configured');
        return res.status(503).json({ verified: false, isUnavailable: true, findings: 'AI verification service temporarily unavailable.' });
    }

    let result = null;

    if (GEMINI_KEY) {
        try {
            const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: `You are FocusPact Work Proof Auditor. The user committed to: "${goalText}". Does this image show legitimate evidence of execution? Respond strictly with JSON: { "verified": boolean, "findings": string }` },
                            { inline_data: { mime_type: mimeType, data: rawBase64 } }
                        ]
                    }],
                    generationConfig: { response_mime_type: 'application/json', temperature: 0.2 }
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
            }
        } catch (err) {
            console.error('Gemini vision error:', err.message);
        }
    }

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
                        { role: 'system', content: 'You are FocusPact Work Proof Auditor. Evaluate whether the image provides genuine evidence. Return JSON: { "verified": boolean, "findings": string }.' },
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: `Commitment: "${goalText}".` },
                                { type: 'image_url', image_url: { url: imageBase64 } }
                            ]
                        }
                    ],
                    response_format: { type: 'json_object' },
                    max_tokens: 150
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
            }
        } catch (err) {
            console.error('Groq vision error:', err.message);
        }
    }

    if (!result) {
        return res.status(503).json({
            verified: false,
            isUnavailable: true,
            findings: 'Not verified: AI unavailable'
        });
    }

    return res.json({
        verified: result.verified,
        findings: result.findings,
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`FocusPact Backend operational on port ${PORT}`);
});
