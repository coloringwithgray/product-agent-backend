// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Configuration, OpenAIApi } = require('openai');
const morgan = require('morgan');
const redis = require('redis');

// Import static brand information
const config = require('./config.json');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// Environment Variable Validation
const requiredEnvVars = ['OPENAI_API_KEY', 'ADMIN_API_KEY', 'REDIS_HOST', 'REDIS_PORT'];
const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

// OpenAI Configuration
const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));

// Redis Setup
const redisClient = redis.createClient({
  socket: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT },
  password: process.env.REDIS_PASSWORD || undefined,
});
redisClient.on('error', (err) => console.error('Redis Client Error:', err));

// Load Chat History
const chatHistoryPath = path.join(__dirname, 'chatHistory.json');
function loadChatHistory() {
  try {
    if (fs.existsSync(chatHistoryPath)) {
      return JSON.parse(fs.readFileSync(chatHistoryPath, 'utf-8'));
    }
    return [];
  } catch (error) {
    console.error('Error loading chat history:', error.message);
    return [];
  }
}

// Save Chat History
function saveChatHistory(history) {
  try {
    fs.writeFileSync(chatHistoryPath, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error('Error saving chat history:', error.message);
  }
}

// Dynamic System Prompt
const productContext = `
You are a representative of Coloring with Gray and a master perfumer. Speak knowledgeably about the brand, its ethos, its flagship product 'Reflections of You,' and the visuals used to represent the brand, including the background scene. Provide thoughtful, concise responses that reflect professionalism.

Brand Philosophy:
${config.brandInfo.philosophy}

Product Details:
- **Name:** ${config.productInfo.name}
- **Description:** ${config.productInfo.description}
- **Key Features:** ${config.productInfo.keyFeatures.join(', ')}
- **Public Ingredients:** ${config.productInfo.ingredients.public.join(', ')}
- **Proprietary Formula (for internal use only):** 
  - Ambroxan: ${config.productInfo.ingredients.proprietary.Ambroxan}
  - Iso E Super: ${config.productInfo.ingredients.proprietary["Iso E Super"]}
  - Hedione HC: ${config.productInfo.ingredients.proprietary["Hedione HC"]}
  - Exaltone (Musk): ${config.productInfo.ingredients.proprietary["Exaltone (Musk)"]}
  - Ethyl Maltol: ${config.productInfo.ingredients.proprietary["Ethyl Maltol"]}
  - Apple Note: ${config.productInfo.ingredients.proprietary["Apple Note"]}
  - Veramoss: ${config.productInfo.ingredients.proprietary.Veramoss}
- **Ethos:** ${config.productInfo.ethos}

Brand Visuals:
- **Background Source:** ${config.brandVisuals.background.source}
- **Correlation to Brand:** ${config.brandVisuals.background.correlation}

Contact Information:
- **Instagram:** ${config.contactInfo.instagram}
`;

// Handle /ask Requests
app.post('/ask', async (req, res) => {
  try {
    const userQuestion = req.body.question?.trim();
    if (!userQuestion) return res.status(400).json({ error: 'Question is required' });

    // Check Redis Cache
    const cachedResponse = await redisClient.get(userQuestion);
    if (cachedResponse) return res.json({ reply: cachedResponse });

    // Query OpenAI
    const response = await openai.createChatCompletion({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: productContext },
        { role: 'user', content: userQuestion },
      ],
      max_tokens: 300,
    });

    const reply = response.data.choices[0].message.content.trim();
    res.json({ reply });

    // Save to Redis
    await redisClient.set(userQuestion, reply, { EX: 3600 });
  } catch (error) {
    console.error('Error processing /ask:', error.message);
    res.status(500).json({ error: 'An error occurred' });
  }
});

// Admin Endpoints
app.get('/history', (req, res) => res.json(loadChatHistory()));
app.post('/clear-history', (req, res) => {
  saveChatHistory([]);
  res.json({ message: 'Chat history cleared' });
});

// Start Server
(async () => {
  try {
    await redisClient.connect();
    console.log('Redis connected');
    app.listen(3000, () => console.log('Server running on port 3000'));
  } catch (error) {
    console.error('Failed to connect to Redis:', error.message);
    process.exit(1);
  }
})();

