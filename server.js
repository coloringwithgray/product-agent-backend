require('dotenv').config();  // Load variables from .env
const express = require('express');
const cors = require('cors');
const { Configuration, OpenAIApi } = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

// Configure OpenAI with your API key
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Endpoint to handle questions
app.post('/ask', async (req, res) => {
  const question = req.body.question;
  if (!question) {
    return res.status(400).json({ error: 'No question provided.' });
  }

  try {
    const messages = [
      {
        role: 'system',
        content: `
          You are a helpful assistant knowledgeable about the Reflection product.
          Answer questions concisely and accurately, using a friendly tone.
        `,
      },
      {
        role: 'user',
        content: question,
      },
    ];

    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo', 
      messages: messages,
      max_tokens: 300,
      temperature: 0.7,
    });

    const answer = response.data.choices[0].message.content;
    res.json({ reply: answer });
  } catch (error) {
    console.error('Error fetching from OpenAI:', error);
    res.status(500).json({ error: 'Error processing your request.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});

