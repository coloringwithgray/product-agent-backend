// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Configuration, OpenAIApi } = require('openai');
const Fuse = require('fuse.js');

// Initialize Express
const app = express();
app.use(cors());
app.use(express.json());

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

// Path to your JSON file
const chatHistoryPath = path.join(__dirname, 'chatHistory.json');

// Function to load chat history from JSON
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

// Function to save chat history to JSON
function saveChat(question, answer) {
  const chats = loadChatHistory();
  const newChat = { question, answer, timestamp: new Date().toISOString() };

  console.log('Saving new chat:', newChat);

  chats.push(newChat);
  try {
    fs.writeFileSync(chatHistoryPath, JSON.stringify(chats, null, 2), 'utf-8');
    console.log('Chat saved successfully!');
  } catch (error) {
    console.error('Error saving chat:', error.message);
  }
}

// Initialize Fuse.js with chat history
let fuse;
function initializeFuse(chatHistory) {
  const options = {
    includeScore: true,
    threshold: 0.4, // Adjust based on testing
    keys: ['question'],
  };
  fuse = new Fuse(chatHistory, options);
  console.log('Fuse.js initialized.');
}

// Load chat history and initialize Fuse.js at startup
let chatHistory = loadChatHistory();
initializeFuse(chatHistory);

// Handle questions
app.post('/ask', async (req, res) => {
  try {
    const userQuestion = req.body.question;
    if (!userQuestion) {
      return res.status(400).json({ error: 'Question is required' });
    }

    console.log('Received question:', userQuestion);

    // Search for a matching chat using Fuse.js
    const fuseResults = fuse.search(userQuestion);

    if (fuseResults.length > 0 && fuseResults[0].score <= 0.4) { // Adjust threshold as needed
      const matchedChat = fuseResults[0].item;
      console.log('Found matching chat:', matchedChat.question);
      return res.json({ reply: matchedChat.answer });
    } else {
      console.log('No suitable match found in chat history. Querying OpenAI...');

      // Define product-specific context
      const productContext = `
        Product Name: Reflections of You.
        Description: "Reflections of You" is the inaugural fragrance from Coloring with Gray. It’s a second-skin scent designed to amplify the wearer’s natural essence. The fragrance adapts to the individual’s chemistry, creating a unique and personalized aroma that embodies the brand’s philosophy of collaboration and individuality.
        Key Features:
        - Long-lasting scent.
        - Gender-neutral.
        - Elegant and modern packaging inspired by reflective puddles.

        You are a product specialist for "Reflections of You". Respond thoroughly and helpfully to all questions related to this fragrance. If the question is unrelated, politely indicate that you can only answer questions about this product.
      `;

      // Query OpenAI
      const response = await openai.createChatCompletion({
        model: 'gpt-3.5-turbo', // or 'gpt-4' for better performance
        messages: [
          { role: 'system', content: productContext },
          { role: 'user', content: userQuestion },
        ],
        max_tokens: 200,
      });

      const answer = response.data.choices[0].message.content.trim();
      console.log('Generated answer:', answer);

      // Save the new Q&A to chatHistory.json
      saveChat(userQuestion, answer);

      // Update Fuse.js with the new chat
      chatHistory.push({ question: userQuestion, answer: answer, timestamp: new Date().toISOString() });
      initializeFuse(chatHistory);

      res.json({ reply: answer });
    }
  } catch (error) {
    console.error('Error processing request:', error.response?.data || error.message);
    res.status(500).json({ error: 'Error processing your request.' });
  }
});

// Endpoint to get chat history
app.get('/history', (req, res) => {
  const chatHistory = loadChatHistory();
  res.json(chatHistory);
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

