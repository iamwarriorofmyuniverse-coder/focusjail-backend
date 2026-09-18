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
        name = 'Inmate',
        goals = [],
        completed = false,
        excuse = '',
        tone = 'brutal'
    } = body;

    const toneInstructions = {
        brutal: 'Be an uncompromising, hyper-direct accountability warden. No fluff, no toxic positivity. Call out exact excuses with surgical precision. Address the user directly by name.',
        firm: 'Be a disciplined, direct executive coach. Stick to the facts, eliminate rationalizations, and demand high standards.',
        gentle: 'Be an empathetic mentor. Acknowledge the struggle, recognize genuine effort, but maintain accountability.'
    };

    const systemPrompt = `You are FocusJail, the ultimate anti-procrastination AI accountability system.
Rules:
- Tone: ${toneInstructions[tone] || toneInstructions.brutal}
- Keep your response to EXACTLY 2 impactful sentences.
- Never use generic clichés. Focus on the gap between commitments and execution.`;

    const userPrompt = `Inmate: ${name}
Commitments: ${goals.length ? goals.join(', ') : 'None specified'}
Outcome: ${completed ? 'Goals fully met' : 'FAILED goals'}
Reflection / Excuse: ${excuse || 'No explanation provided.'}`;

    if (!GROQ_KEY) {
        // Safe smart fallback if user hasn't added GROQ_KEY to Netlify env variables yet
        const fallback = completed
            ? `${name}, you executed your commitments as promised today. Do not get complacent—momentum is maintained only through tomorrow's discipline.`
            : `${name}, you surrendered your day to rationalizations and comfort. The gap between who you want to be and who you currently are just widened.`;

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ verdict: fallback, isFallback: true })
        };
    }

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

            if (!fallbackRes.ok) {
                throw new Error(`Groq API returned ${fallbackRes.status}`);
            }

            const fallbackData = await fallbackRes.json();
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ verdict: fallbackData.choices[0].message.content.trim() })
            };
        }

        const data = await response.json();
        const verdict = data.choices[0].message.content.trim();

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ verdict: verdict })
        };

    } catch (error) {
        console.error('Verdict Function Error:', error);
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                verdict: `${name}, the warden recorded your day. Regardless of system noise, hold yourself to your highest standard tomorrow.`
            })
        };
    }
};
