/**
 * Swagger/OpenAPI Documentation Setup
 * 
 * Mounts interactive Swagger UI at /docs
 */

import swaggerUi from 'swagger-ui-express'
import swaggerJsdoc from 'swagger-jsdoc'
import { Express } from 'express'
import * as path from 'path'
import * as fs from 'fs'
import * as yaml from 'js-yaml'

const OPENAPI_SPEC_PATH = path.join(__dirname, 'openapi.yaml')

/**
 * Load OpenAPI spec from YAML file
 */
function loadOpenApiSpec(): any {
  try {
    const fileContents = fs.readFileSync(OPENAPI_SPEC_PATH, 'utf8')
    return yaml.load(fileContents)
  } catch (error) {
    console.error('Failed to load OpenAPI spec:', error)
    throw error
  }
}

/**
 * Setup Swagger UI middleware
 * Mounts at /docs (publicly accessible, no auth required)
 */
export function setupSwagger(app: Express): void {
  const swaggerSpec = loadOpenApiSpec()

  // Swagger UI options
  const swaggerUiOptions: swaggerUi.SwaggerUiOptions = {
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info .title { font-size: 2.5em; }
      .swagger-ui .scheme-container { background: #fafafa; padding: 1em; }
    `,
    customSiteTitle: 'AgentPay API Documentation',
    customfavIcon: '/favicon.ico',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      syntaxHighlight: {
        activate: true,
        theme: 'monokai',
      },
      tryItOutEnabled: true,
    },
  }

  // Mount Swagger UI at /docs
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, swaggerUiOptions)
  )

  // Also serve raw spec at /docs/openapi.json and /docs/openapi.yaml
  app.get('/docs/openapi.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify(swaggerSpec, null, 2))
  })

  app.get('/docs/openapi.yaml', (_req, res) => {
    res.setHeader('Content-Type', 'text/yaml')
    res.sendFile(OPENAPI_SPEC_PATH)
  })

  console.log('📚 Swagger UI available at /docs')
  console.log('📄 OpenAPI spec: /docs/openapi.json | /docs/openapi.yaml')
}
