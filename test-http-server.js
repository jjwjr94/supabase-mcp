#!/usr/bin/env node

/**
 * Test script for Supabase MCP HTTP Server
 * This script tests the HTTP endpoints to ensure they work correctly
 */

const http = require('http');
const https = require('https');

const SERVER_URL = process.env.TEST_SERVER_URL || 'http://localhost:3000';
const SUPABASE_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;

if (!SUPABASE_TOKEN || !PROJECT_REF) {
  console.error('❌ Missing required environment variables:');
  console.error('   SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  'x-supabase-token': SUPABASE_TOKEN,
  'x-project-ref': PROJECT_REF
};

function makeRequest(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SERVER_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: method,
      headers: headers
    };

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const jsonBody = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: jsonBody });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: body });
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function testHealthCheck() {
  console.log('🔍 Testing health check...');
  try {
    const response = await makeRequest('/health');
    if (response.status === 200) {
      console.log('✅ Health check passed');
      console.log('   Status:', response.body.status);
      console.log('   Version:', response.body.version);
    } else {
      console.log('❌ Health check failed:', response.status);
    }
  } catch (error) {
    console.log('❌ Health check error:', error.message);
  }
}

async function testToolsList() {
  console.log('\n🔍 Testing tools list...');
  try {
    const response = await makeRequest('/tools');
    if (response.status === 200) {
      console.log('✅ Tools list retrieved');
      console.log('   Number of tools:', response.body.result?.tools?.length || 0);
      if (response.body.result?.tools?.length > 0) {
        console.log('   First tool:', response.body.result.tools[0].name);
      }
    } else {
      console.log('❌ Tools list failed:', response.status, response.body);
    }
  } catch (error) {
    console.log('❌ Tools list error:', error.message);
  }
}

async function testMCPToolsList() {
  console.log('\n🔍 Testing MCP tools/list...');
  try {
    const response = await makeRequest('/mcp', 'POST', {
      method: 'tools/list',
      params: {}
    });
    if (response.status === 200) {
      console.log('✅ MCP tools/list successful');
    } else {
      console.log('❌ MCP tools/list failed:', response.status);
    }
  } catch (error) {
    console.log('❌ MCP tools/list error:', error.message);
  }
}

async function testMCPPromptsList() {
  console.log('\n🔍 Testing MCP prompts/list...');
  try {
    const response = await makeRequest('/mcp', 'POST', {
      method: 'prompts/list',
      params: {}
    });
    if (response.status === 200) {
      console.log('✅ MCP prompts/list successful');
    } else {
      console.log('❌ MCP prompts/list failed:', response.status);
    }
  } catch (error) {
    console.log('❌ MCP prompts/list error:', error.message);
  }
}

async function testMCPResourcesList() {
  console.log('\n🔍 Testing MCP resources/list...');
  try {
    const response = await makeRequest('/mcp', 'POST', {
      method: 'resources/list',
      params: {}
    });
    if (response.status === 200) {
      console.log('✅ MCP resources/list successful');
    } else {
      console.log('❌ MCP resources/list failed:', response.status);
    }
  } catch (error) {
    console.log('❌ MCP resources/list error:', error.message);
  }
}

async function runTests() {
  console.log('🚀 Starting Supabase MCP HTTP Server Tests');
  console.log('   Server URL:', SERVER_URL);
  console.log('   Project Ref:', PROJECT_REF);
  console.log('   Token:', SUPABASE_TOKEN.substring(0, 10) + '...');
  
  await testHealthCheck();
  await testToolsList();
  await testMCPToolsList();
  await testMCPPromptsList();
  await testMCPResourcesList();
  
  console.log('\n✨ Tests completed!');
}

runTests().catch(console.error);
