const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const GROQ_KEY = process.env.GROQ_KEY;

app.post('/verdict', async function (req, res) {
    console.log('Request received');
    console.log('Key length:', GROQ_KEY.length);

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + GROQ_KEY
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: [{ role: 'user', content: req.body.prompt }],
                max_tokens: 150
            })
        });

        console.log('Groq status:', response.status);
        const text = await response.text();
        console.log('Groq response:', text);
        const data = JSON.parse(text);
        res.json({ verdict: data.choices[0].message.content });

    } catch (error) {
        console.error('CRASH:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.listen(3000, function () {
    console.log('Server running on port 3000');
});