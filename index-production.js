const express = require('express');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    message: 'Supabase MCP HTTP Server is running'
  });
});

// MCP endpoint
app.post('/mcp', (req, res) => {
  const { method, params } = req.body;
  
  if (!method) {
    return res.status(400).json({ error: 'MCP method is required' });
  }

  // Simple response for any MCP method
  res.json({
    id: req.body.id || 'test',
    result: {
      content: [{
        type: 'text',
        text: `MCP method '${method}' executed successfully. This is a minimal test version.`
      }]
    }
  });
});

// Start server
app.listen(port, () => {
  console.log(`Supabase MCP HTTP Server running on port ${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
  console.log(`MCP endpoint: POST http://localhost:${port}/mcp`);
});
