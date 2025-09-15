#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

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
    // Security middleware
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
    
    // CORS
    this.app.use(cors({
      origin: [
        'https://*.render.com',
        'https://*.n8n.cloud',
        'https://*.n8n.io',
        'http://localhost:3000',
        'http://localhost:5678'
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-project-ref']
    }));
    
    this.app.use(express.json({ limit: '10mb' }));
    
    // Logging
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - ${req.ip}`);
      next();
    });
  }

  private setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        version: '0.5.3',
        timestamp: new Date().toISOString(),
        message: 'Supabase MCP HTTP Server is running'
      });
    });

    // MCP endpoint
    this.app.post('/mcp', async (req, res) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });

      try {
        // Authentication is handled externally - no auth checks in server code
        const projectRef = req.headers['x-project-ref'] as string || process.env.SUPABASE_PROJECT_REF || 'default-project';

        const { method, params } = req.body;

        if (!method) {
          this.sendStreamResponse(res, requestId, 'error', null, 'MCP method is required');
          res.end();
          return;
        }

        this.sendStreamResponse(res, requestId, 'data', { 
          message: `Starting MCP operation: ${method}`,
          method: method,
          params: params,
          projectRef: projectRef,
          note: "Authentication handled externally"
        });

        let result;
        
        switch (method) {
          case 'tools/list':
            result = {
              jsonrpc: "2.0",
              id: requestId,
              result: {
                tools: [
                  {
                    name: "list_tables",
                    description: "List all tables in the database",
                    inputSchema: {
                      type: "object",
                      properties: {
                        project_id: { type: "string", description: "Supabase project ID" },
                        schemas: { type: "array", items: { type: "string" }, description: "Database schemas to include" }
                      }
                    }
                  },
                  {
                    name: "execute_sql",
                    description: "Execute raw SQL queries (SELECT and INSERT only)",
                    inputSchema: {
                      type: "object",
                      properties: {
                        query: { type: "string", description: "SQL query to execute" },
                        project_id: { type: "string", description: "Supabase project ID" }
                      },
                      required: ["query", "project_id"]
                    }
                  },
                  {
                    name: "get_project_url",
                    description: "Get the API URL for a project",
                    inputSchema: {
                      type: "object",
                      properties: {
                        project_id: { type: "string", description: "Supabase project ID" }
                      },
                      required: ["project_id"]
                    }
                  },
                  {
                    name: "get_anon_key",
                    description: "Get the anonymous API key for a project",
                    inputSchema: {
                      type: "object",
                      properties: {
                        project_id: { type: "string", description: "Supabase project ID" }
                      },
                      required: ["project_id"]
                    }
                  }
                ]
              }
            };
            break;
            
          case 'tools/call':
            if (!params || !params.name) {
              this.sendStreamResponse(res, requestId, 'error', null, 'Tool name is required for tools/call');
              res.end();
              return;
            }
            
            result = {
              jsonrpc: "2.0",
              id: requestId,
              result: {
                content: [
                  {
                    type: "text",
                    text: `Tool '${params.name}' executed successfully with parameters: ${JSON.stringify(params.arguments || {})}\n\nNote: This is a demo implementation. Authentication is handled externally, and in production this would connect to your actual Supabase project.`
                  }
                ]
              }
            };
            break;
            
          default:
            this.sendStreamResponse(res, requestId, 'error', null, `Unsupported MCP method: ${method}`);
            res.end();
            return;
        }

        this.sendStreamResponse(res, requestId, 'data', result);
        this.sendStreamResponse(res, requestId, 'complete', { message: 'MCP operation completed' });

      } catch (error) {
        console.error('Error executing MCP operation:', error);
        this.sendStreamResponse(res, requestId, 'error', null, error instanceof Error ? error.message : 'Unknown error');
      }

      res.end();
    });

    // Legacy endpoints
    this.app.get('/tools', async (req, res) => {
      try {
        const result = {
          jsonrpc: "2.0",
          id: "tools_list",
          result: {
            tools: [
              { name: "list_tables", description: "List all tables in the database" },
              { name: "execute_sql", description: "Execute raw SQL queries" },
              { name: "get_project_url", description: "Get the API URL for a project" },
              { name: "get_anon_key", description: "Get the anonymous API key for a project" }
            ]
          }
        };
        res.json(result);
      } catch (error) {
        console.error('Error listing tools:', error);
        res.status(500).json({ 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    });

    // Error handling
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
      console.log(`MCP endpoint: POST http://localhost:${this.port}/mcp`);
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
