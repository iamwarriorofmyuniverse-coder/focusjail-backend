const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const GROQ_KEY = process.env.GROQ_KEY || '';

// Health check endpoint for Railway / Render monitoring
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        hasGroqKey: Boolean(GROQ_KEY && GROQ_KEY.length > 5)
    });
});

app.post('/verdict', async function (req, res) {
    console.log('Incoming /verdict request at:', new Date().toISOString());

    // Support both new structured format and legacy { prompt } format
    let messages = [];

    if (req.body.prompt) {
        // Legacy fallback
        messages = [
            {
                role: 'system',
                content: 'You are FocusJail, an unapologetic, direct AI accountability coach. Deliver exactly 2 punchy, impactful sentences without fluff or clichés.'
            },
            { role: 'user', content: req.body.prompt }
        ];
    } else {
        const {
            name = 'Inmate',
            goals = [],
            completed = false,
            excuse = '',
            tone = 'brutal'
        } = req.body;

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

        messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];
    }

    if (!GROQ_KEY) {
        console.warn('Warning: GROQ_KEY environment variable is not configured.');
        return res.json({
            verdict: 'Warden notice: API key is not configured on the backend server. Set GROQ_KEY in your hosting dashboard.',
            isFallback: true
        });
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
                messages: messages,
                max_tokens: 180,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            console.log('Primary 70b model status:', response.status, 'Retrying with 8b instant...');
            const fallbackRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${GROQ_KEY}`
                },
                body: JSON.stringify({
                    model: 'llama-3.1-8b-instant',
                    messages: messages,
                    max_tokens: 180,
                    temperature: 0.7
                })
            });

            if (!fallbackRes.ok) {
                const errText = await fallbackRes.text();
                throw new Error(`Groq API returned ${fallbackRes.status}: ${errText}`);
            }

            const fallbackData = await fallbackRes.json();
            return res.json({ verdict: fallbackData.choices[0].message.content.trim() });
        }

        const data = await response.json();
        const verdict = data.choices[0].message.content.trim();
        res.json({ verdict });

    } catch (error) {
        console.error('FocusJail Execution Error:', error.message);
        res.status(500).json({
            error: error.message,
            verdict: 'The warden encountered an unexpected error evaluating your day. Stay disciplined regardless.'
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
    console.log(`FocusJail Backend operational on port ${PORT}`);
});
