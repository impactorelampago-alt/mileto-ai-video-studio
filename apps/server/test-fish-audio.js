const fetch = require('node-fetch');

async function test() {
    // The API key is taken from the logs implicitly if we knew it, or we try to test the endpoint structure.
    // Wait, let's just make a generic call to see the exact error layout.

    // Actually, I can read the API keys from localStorage if I run this in the client context,
    // but here I'm on the server. I will test with a dummy key just to see if the structure
    // `reference_id` vs `model_id` triggers a different error code.

    const dummyKey = 'sk-xxxxxxxxxxxxxxxxxxxxxxxx';
    const voiceId = 'cfcf01844b2f4fbbba44deecfb8da47f';

    console.log('Testing voice:', voiceId);
    try {
        const response = await fetch('https://api.fish.audio/v1/tts', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${dummyKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: 'Testando API',
                reference_id: voiceId,
                format: 'mp3',
                mp3_bitrate: 128,
            }),
        });

        const data = await response.text();
        console.log('Status:', response.status);
        console.log('Response:', data);
    } catch (e) {
        console.error('Error:', e.message);
    }
}

test();
