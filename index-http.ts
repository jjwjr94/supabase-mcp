#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createSupabaseMcpServer, type SupabaseMcpServerOptions } from './packages/mcp-server-supabase/src/server.js';
import { createApiPlatform } from './packages/mcp-server-supabase/src/platform/api-platform.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

interface StreamResponse {
  id: string;
  type: 'data' | 'error' | 'complete';
  data?: any;
  error?: string;
}

class SupabaseHttpServer {
  private app: express.Application;
  private port: number;

  constructor(port: number = 3000) {
    this.port = port;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    // Security middleware - configure for Render deployment
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" }
    }));
    
    // CORS for n8n integration - allow Render domains
    this.app.use(cors({
      origin: [
        'https://*.render.com',
        'https://*.n8n.cloud',
        'https://*.n8n.io',
        'http://localhost:3000',
        'http://localhost:5678' // n8n local development
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-supabase-token', 'x-project-ref']
    }));
    
    // JSON parsing
    this.app.use(express.json({ limit: '10mb' }));
    
    // Logging middleware
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - ${req.ip}`);
      next();
    });
  }

  private setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        version: '0.5.3',
        timestamp: new Date().toISOString()
      });
    });

    // MCP HTTP Streaming endpoint - handles all MCP operations
    this.app.post('/mcp', async (req, res) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Set headers for streaming
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });

      try {
        // Get Supabase credentials from request headers or environment
        const supabaseToken = req.headers['x-supabase-token'] as string || process.env.SUPABASE_ACCESS_TOKEN;
        const projectRef = req.headers['x-project-ref'] as string || process.env.SUPABASE_PROJECT_REF;
        
        if (!supabaseToken) {
          this.sendStreamResponse(res, requestId, 'error', null, 'Supabase access token required');
          res.end();
          return;
        }

        if (!projectRef) {
          this.sendStreamResponse(res, requestId, 'error', null, 'Supabase project reference required');
          res.end();
          return;
        }

        // Create Supabase platform instance
        const platform = createApiPlatform({
          accessToken: supabaseToken,
          projectRef: projectRef,
        });

        // Create MCP server with options
        const mcpServerOptions: SupabaseMcpServerOptions = {
          platform,
          projectId: projectRef,
          readOnly: process.env.SUPABASE_READ_ONLY === 'true',
          features: process.env.SUPABASE_FEATURES?.split(',') || undefined,
        };

        const mcpServer = createSupabaseMcpServer(mcpServerOptions);

        const { method, params } = req.body;

        if (!method) {
          this.sendStreamResponse(res, requestId, 'error', null, 'MCP method is required');
          res.end();
          return;
        }

        // Send initial response
        this.sendStreamResponse(res, requestId, 'data', { 
          message: `Starting MCP operation: ${method}`,
          method: method,
          params: params
        });

        let result;
        
        // Handle different MCP methods
        switch (method) {
          case 'tools/list':
            // Get tools from the MCP server
            const toolsRequest = {
              jsonrpc: "2.0",
              id: requestId,
              method: "tools/list",
              params: {}
            };
            result = await mcpServer.handleRequest(toolsRequest);
            break;
            
          case 'tools/call':
            if (!params || !params.name) {
              this.sendStreamResponse(res, requestId, 'error', null, 'Tool name is required for tools/call');
              res.end();
              return;
            }
            
            const toolRequest = {
              jsonrpc: "2.0",
              id: requestId,
              method: "tools/call",
              params: {
                name: params.name,
                arguments: params.arguments || {}
              }
            };
            result = await mcpServer.handleRequest(toolRequest);
            break;
            
          case 'prompts/list':
            const promptsListRequest = {
              jsonrpc: "2.0",
              id: requestId,
              method: "prompts/list",
              params: {}
            };
            result = await mcpServer.handleRequest(promptsListRequest);
            break;
            
          case 'prompts/get':
            if (!params || !params.name) {
              this.sendStreamResponse(res, requestId, 'error', null, 'Prompt name is required for prompts/get');
              res.end();
              return;
            }
            
            const promptRequest = {
              jsonrpc: "2.0",
              id: requestId,
              method: "prompts/get",
              params: { name: params.name }
            };
            result = await mcpServer.handleRequest(promptRequest);
            break;
            
          case 'resources/list':
            const resourcesListRequest = {
              jsonrpc: "2.0",
              id: requestId,
              method: "resources/list",
              params: {}
            };
            result = await mcpServer.handleRequest(resourcesListRequest);
            break;
            
          case 'resources/read':
            if (!params || !params.uri) {
              this.sendStreamResponse(res, requestId, 'error', null, 'Resource URI is required for resources/read');
              res.end();
              return;
            }
            
            const resourceRequest = {
              jsonrpc: "2.0",
              id: requestId,
              method: "resources/read",
              params: { uri: params.uri }
            };
            result = await mcpServer.handleRequest(resourceRequest);
            break;
            
          default:
            this.sendStreamResponse(res, requestId, 'error', null, `Unsupported MCP method: ${method}`);
            res.end();
            return;
        }

        // Send the result
        this.sendStreamResponse(res, requestId, 'data', result);

        // Send completion
        this.sendStreamResponse(res, requestId, 'complete', { message: 'MCP operation completed' });

      } catch (error) {
        console.error('Error executing MCP operation:', error);
        this.sendStreamResponse(res, requestId, 'error', null, error instanceof Error ? error.message : 'Unknown error');
      }

      res.end();
    });

    // Legacy endpoints for backward compatibility
    this.app.get('/tools', async (req, res) => {
      try {
        const supabaseToken = req.headers['x-supabase-token'] as string || process.env.SUPABASE_ACCESS_TOKEN;
        const projectRef = req.headers['x-project-ref'] as string || process.env.SUPABASE_PROJECT_REF;
        
        if (!supabaseToken || !projectRef) {
          return res.status(401).json({ error: 'Supabase credentials required' });
        }

        const platform = createApiPlatform({
          accessToken: supabaseToken,
          projectRef: projectRef,
        });

        const mcpServer = createSupabaseMcpServer({
          platform,
          projectId: projectRef,
          readOnly: process.env.SUPABASE_READ_ONLY === 'true',
          features: process.env.SUPABASE_FEATURES?.split(',') || undefined,
        });

        const toolsRequest = {
          jsonrpc: "2.0",
          id: "tools_list",
          method: "tools/list",
          params: {}
        };

        const result = await mcpServer.handleRequest(toolsRequest);
        res.json(result);
      } catch (error) {
        console.error('Error listing tools:', error);
        res.status(500).json({ 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    });

    // Execute a tool with streaming response (legacy)
    this.app.post('/tools/execute', async (req, res) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Set headers for streaming
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });

      try {
        const supabaseToken = req.headers['x-supabase-token'] as string || process.env.SUPABASE_ACCESS_TOKEN;
        const projectRef = req.headers['x-project-ref'] as string || process.env.SUPABASE_PROJECT_REF;
        
        if (!supabaseToken || !projectRef) {
          this.sendStreamResponse(res, requestId, 'error', null, 'Supabase credentials required');
          res.end();
          return;
        }

        const platform = createApiPlatform({
          accessToken: supabaseToken,
          projectRef: projectRef,
        });

        const mcpServer = createSupabaseMcpServer({
          platform,
          projectId: projectRef,
          readOnly: process.env.SUPABASE_READ_ONLY === 'true',
          features: process.env.SUPABASE_FEATURES?.split(',') || undefined,
        });

        const { toolName, arguments: toolArgs } = req.body;

        if (!toolName) {
          this.sendStreamResponse(res, requestId, 'error', null, 'Tool name is required');
          res.end();
          return;
        }

        // Send initial response
        this.sendStreamResponse(res, requestId, 'data', { 
          message: `Starting execution of tool: ${toolName}`,
          tool: toolName,
          arguments: toolArgs
        });

        // Execute the tool
        const toolRequest = {
          jsonrpc: "2.0",
          id: requestId,
          method: "tools/call",
          params: {
            name: toolName,
            arguments: toolArgs || {}
          }
        };

        const result = await mcpServer.handleRequest(toolRequest);

        // Send the result
        this.sendStreamResponse(res, requestId, 'data', result);

        // Send completion
        this.sendStreamResponse(res, requestId, 'complete', { message: 'Tool execution completed' });

      } catch (error) {
        console.error('Error executing tool:', error);
        this.sendStreamResponse(res, requestId, 'error', null, error instanceof Error ? error.message : 'Unknown error');
      }

      res.end();
    });

    // Execute a tool without streaming (for compatibility)
    this.app.post('/tools/:toolName', async (req, res) => {
      try {
        const { toolName } = req.params;
        const toolArgs = req.body;

        const supabaseToken = req.headers['x-supabase-token'] as string || process.env.SUPABASE_ACCESS_TOKEN;
        const projectRef = req.headers['x-project-ref'] as string || process.env.SUPABASE_PROJECT_REF;
        
        if (!supabaseToken || !projectRef) {
          return res.status(401).json({ error: 'Supabase credentials required' });
        }

        const platform = createApiPlatform({
          accessToken: supabaseToken,
          projectRef: projectRef,
        });

        const mcpServer = createSupabaseMcpServer({
          platform,
          projectId: projectRef,
          readOnly: process.env.SUPABASE_READ_ONLY === 'true',
          features: process.env.SUPABASE_FEATURES?.split(',') || undefined,
        });

        const toolRequest = {
          jsonrpc: "2.0",
          id: `req_${Date.now()}`,
          method: "tools/call",
          params: {
            name: toolName,
            arguments: toolArgs || {}
          }
        };

        const result = await mcpServer.handleRequest(toolRequest);
        res.json(result);
      } catch (error) {
        console.error('Error executing tool:', error);
        res.status(500).json({ 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    });

    // Error handling middleware
    this.app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('Unhandled error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  private sendStreamResponse(res: express.Response, id: string, type: 'data' | 'error' | 'complete', data?: any, error?: string) {
    const response: StreamResponse = {
      id,
      type,
      data,
      error
    };
    
    res.write(`data: ${JSON.stringify(response)}\n\n`);
  }

  public start() {
    this.app.listen(this.port, () => {
      console.log(`Supabase MCP HTTP Server running on port ${this.port}`);
      console.log(`Health check: http://localhost:${this.port}/health`);
      console.log(`Tools list: http://localhost:${this.port}/tools`);
      console.log(`Execute tool: POST http://localhost:${this.port}/tools/execute`);
    });
  }
}

// Main execution
async function main() {
  const port = parseInt(process.env.PORT || '3000', 10);
  const server = new SupabaseHttpServer(port);
  server.start();
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
