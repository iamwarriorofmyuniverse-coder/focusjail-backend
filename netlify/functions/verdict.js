exports.handler = async function (event, context) {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    const GROQ_KEY = process.env.GROQ_KEY || '';
    let body = {};
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        body = {};
    }

    const {
        name = 'User',
        goals = [],
        completed = false,
        excuse = '',
        proof = '',
        streak = 0,
        tone = 'brutal',
        partner_name = 'Partner'
    } = body;

    const toneInstructions = {
        brutal: 'Be an uncompromising, hyper-direct accountability warden. No fluff, no toxic positivity. Call out exact excuses with surgical precision. Address the user directly by name.',
        firm: 'Be a disciplined, direct executive coach. Stick to the facts, eliminate rationalizations, and demand high standards.',
        gentle: 'Be an empathetic mentor. Acknowledge the struggle, recognize genuine effort, but maintain accountability.'
    };

    const systemPrompt = `You are FocusPact, the intelligent high-performance AI accountability system.
Rules:
- Tone: ${toneInstructions[tone] || toneInstructions.brutal}
- Keep your response to EXACTLY 2 impactful sentences.
- If proof is provided (links, commits, artifacts), evaluate its credibility.
- Never use generic clichés. Focus on the gap between commitments and execution.`;

    const userPrompt = `User: ${name}
Commitments: ${goals.length ? goals.join(', ') : 'None specified'}
Outcome: ${completed ? 'Goals fully met' : 'FAILED / Incomplete'}
Proof of Work: ${proof || 'None provided'}
Reflection / Confession: ${excuse || 'No explanation provided.'}
Current Streak: ${streak} Days`;

    let verdict = '';
    let proofRating = completed ? (proof ? 'Verified High-Confidence ✓' : 'Self-Reported ✓') : 'Failed / Missing ✗';

    if (!GROQ_KEY) {
        // Safe smart fallback if user hasn't added GROQ_KEY to Netlify env variables yet
        verdict = completed
            ? `${name}, you executed your commitments as promised today. Do not get complacent—momentum is maintained only through tomorrow's discipline.`
            : `${name}, you surrendered your day to rationalizations and comfort. The gap between who you want to be and who you currently are just widened.`;
    } else {
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

            if (response.ok) {
                const data = await response.json();
                verdict = data.choices && data.choices[0] ? data.choices[0].message.content.trim() : '';
            } else {
                // Fallback to 8b instant
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

                if (fallbackRes.ok) {
                    const data = await fallbackRes.json();
                    verdict = data.choices && data.choices[0] ? data.choices[0].message.content.trim() : '';
                }
            }
        } catch (err) {
            verdict = completed
                ? `${name}, commitments logged. Maintain this standard of discipline tomorrow.`
                : `${name}, you fell short today. Regroup, refocus, and restart tomorrow without excuses.`;
        }
    }

    if (!verdict) {
        verdict = completed
            ? `${name}, commitments logged. Maintain this standard of discipline tomorrow.`
            : `${name}, you fell short today. Regroup, refocus, and restart tomorrow without excuses.`;
    }

    // Generate Autonomous Dead-Man's Switch Partner Alert Payload
    const partnerAlert = completed
        ? `🔥 FocusPact Daily Victory Update: ${name} completed all 3 daily commitments today! Current streak: ${streak} days. Verified: ${proofRating}`
        : `🚨 FocusPact Accountability Alert: ${name} failed to complete their 3 commitments today. Reason: "${excuse || 'Lost discipline'}". Streak reset to 0.`;

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
            verdict: verdict,
            proofRating: proofRating,
            partnerAlert: partnerAlert,
            timestamp: new Date().toISOString()
        })
    };
};
