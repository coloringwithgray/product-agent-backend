// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Configuration, OpenAIApi } = require('openai');
const morgan = require('morgan'); // For HTTP request logging
const rateLimit = require('express-rate-limit');
const redis = require('redis');

// Initialize Express app
const app = express();

// Middleware Setup
app.use(cors());
app.use(express.json());
app.use(morgan('combined')); // Logs HTTP requests

// Rate Limiting to prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again after 15 minutes.',
});
app.use(limiter);

// Verify that the OpenAI API key is loaded
if (!process.env.OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY is not set in the environment variables.');
  process.exit(1); // Exit the application if API key is missing
}

// Configure OpenAI API
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Redis Client Setup
const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
  },
  password: process.env.REDIS_PASSWORD || undefined,
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error', err);
});

(async () => {
  await redisClient.connect();
  console.log('Connected to Redis');
})();

// Path to your JSON file
const chatHistoryPath = path.join(__dirname, 'chatHistory.json');

// Load chat history from JSON
function loadChatHistory() {
  try {
    if (fs.existsSync(chatHistoryPath)) {
      const data = fs.readFileSync(chatHistoryPath, 'utf-8');
      console.log('Loaded chat history.');
      return JSON.parse(data);
    } else {
      console.log('chatHistory.json does not exist. Creating a new one.');
      fs.writeFileSync(chatHistoryPath, '[]', 'utf-8');
      return [];
    }
  } catch (error) {
    console.error('Error reading chat history:', error.message);
    return [];
  }
}

// Save chat history to JSON
function saveChatHistory(chatHistory) {
  try {
    fs.writeFileSync(chatHistoryPath, JSON.stringify(chatHistory, null, 2), 'utf-8');
    console.log('Chat history saved successfully.');
  } catch (error) {
    console.error('Error saving chat history:', error.message);
  }
}

// Generate embedding for a given text using OpenAI's API
async function getEmbedding(text) {
  try {
    const response = await openai.createEmbedding({
      model: 'text-embedding-ada-002', // Efficient model for embeddings
      input: text,
    });
    return response.data.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error.response?.data || error.message);
    return null;
  }
}

// Compute cosine similarity between two vectors
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] ** 2;
    normB += vecB[i] ** 2;
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Initialize chat history
let chatHistory = loadChatHistory();

// Function to ensure all chat entries have embeddings
async function initializeEmbeddings() {
  let updated = false;
  for (let chat of chatHistory) {
    if (!chat.embedding) {
      console.log(`Generating embedding for question: "${chat.question}"`);
      const embedding = await getEmbedding(chat.question);
      if (embedding) {
        chat.embedding = embedding;
        updated = true;
      } else {
        console.warn(`Failed to generate embedding for question: "${chat.question}"`);
      }
    }
  }
  if (updated) {
    saveChatHistory(chatHistory);
    console.log('Updated chat history with new embeddings.');
  } else {
    console.log('All chat entries already have embeddings.');
  }
}

// Call initializeEmbeddings at startup
initializeEmbeddings();

// Secure Endpoints with API Key
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'your-default-admin-api-key'; // Change to a secure key

// Middleware for API key authentication
function authenticate(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey === ADMIN_API_KEY) {
    next();
  } else {
    res.status(403).json({ error: 'Forbidden: Invalid API Key' });
  }
}

// Endpoint to ask questions
app.post('/ask', async (req, res) => {
  try {
    const userQuestion = req.body.question;
    if (!userQuestion) {
      return res.status(400).json({ error: 'Question is required.' });
    }

    console.log(`Received question: "${userQuestion}"`);

    // Check Redis cache first
    const cachedAnswer = await redisClient.get(userQuestion);
    if (cachedAnswer) {
      console.log('Retrieved answer from cache.');
      return res.json({ reply: cachedAnswer });
    }

    // Generate embedding for the user question
    const userEmbedding = await getEmbedding(userQuestion);
    if (!userEmbedding) {
      return res.status(500).json({ error: 'Failed to generate embedding for the question.' });
    }

    // Find the most similar question in chatHistory
    let maxSimilarity = 0;
    let bestMatch = null;

    for (let chat of chatHistory) {
      if (chat.embedding) {
        const similarity = cosineSimilarity(userEmbedding, chat.embedding);
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          bestMatch = chat;
        }
      }
    }

    const similarityThreshold = 0.8; // Adjust based on testing

    if (bestMatch && maxSimilarity >= similarityThreshold) {
      console.log(`Found a similar question with similarity ${maxSimilarity.toFixed(2)}: "${bestMatch.question}"`);
      // Cache the answer in Redis
      await redisClient.set(userQuestion, bestMatch.answer, {
        EX: 60 * 60, // Expires in 1 hour
      });
      console.log('Answer cached in Redis.');
      return res.json({ reply: bestMatch.answer });
    } else {
      console.log('No similar question found. Querying OpenAI...');

      // Define enhanced product-specific context for OpenAI
      const productContext = `
        You are a highly knowledgeable perfume specialist with expertise in the science of fragrances, including their chemical compositions, scent profiles, and comparisons to other renowned perfumes. You are also a consummate professional, adept at engaging with clients courteously and effectively, understanding their preferences, and providing personalized recommendations.

        Product Details:
        - **Name:** Reflections of You
        - **Brand:** Coloring with Gray
        - **Description:** "Reflections of You" is the inaugural fragrance from Coloring with Gray. It’s a second-skin scent designed to amplify the wearer’s natural essence. The fragrance adapts to the individual’s chemistry, creating a unique and personalized aroma that embodies the brand’s philosophy of collaboration and individuality.
        - **Key Features:**
          - Long-lasting scent.
          - Gender-neutral.
          - Elegant and modern packaging inspired by reflective puddles.
        - **Ingredients:** Apple, Ambroxan, Exaltone. (Full formula is proprietary.)

        Responsibilities:
        - Provide detailed information about the perfume's science, including scent notes, top/middle/base notes, and olfactory families.
        - Compare "Reflections of You" to other well-known fragrances, highlighting similarities and unique aspects.
        - Engage with clients professionally, offering personalized advice based on their scent preferences and occasions.
        - Address client inquiries with clarity, accuracy, and a friendly demeanor.
      `;

      // Query OpenAI's Chat Completion API
      const response = await openai.createChatCompletion({
        model: 'gpt-4', // Use 'gpt-4' for enhanced performance if available
        messages: [
          { role: 'system', content: productContext },
          { role: 'user', content: userQuestion },
        ],
        max_tokens: 300, // Increased token limit for more detailed responses
        temperature: 0.7, // Balance between creativity and accuracy
      });

      const answer = response.data.choices[0].message.content.trim();
      console.log(`Generated answer: "${answer}"`);

      // Save the new Q&A to chatHistory.json with embedding
      const newChat = {
        question: userQuestion,
        answer: answer,
        timestamp: new Date().toISOString(),
        embedding: userEmbedding,
      };
      chatHistory.push(newChat);
      saveChatHistory(chatHistory);
      console.log('New chat saved with embedding.');

      // Cache the answer in Redis
      await redisClient.set(userQuestion, answer, {
        EX: 60 * 60, // Expires in 1 hour
      });
      console.log('Answer cached in Redis.');

      return res.json({ reply: answer });
    }
  } catch (error) {
    console.error('Error processing /ask request:', error.response?.data || error.message);
    res.status(500).json({ error: 'An error occurred while processing your request.' });
  }
});

// Endpoint to get chat history (secured)
app.get('/history', authenticate, (req, res) => {
  res.json(chatHistory);
});

// Endpoint to clear chat history (secured)
app.post('/clear-history', authenticate, (req, res) => {
  try {
    chatHistory = [];
    saveChatHistory(chatHistory);
    console.log('Chat history cleared.');
    res.json({ message: 'Chat history has been cleared.' });
  } catch (error) {
    console.error('Error clearing chat history:', error.message);
    res.status(500).json({ error: 'Failed to clear chat history.' });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

