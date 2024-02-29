'use strict'

const assert = require('node:assert')
const { getIntrospectionQuery } = require('graphql')
const Fastify = require('fastify')
const Mercurius = require('mercurius')

const introspectionQuery = getIntrospectionQuery()

async function createComposerService (t, { compose, options }) {
  const composer = await compose(options)
  const service = Fastify()
  t.after(async () => { try { await service.close() } catch { } })

  service.register(Mercurius, {
    schema: composer.toSdl(),
    resolvers: composer.getResolvers(),
    graphiql: true
  })

  return { composer, service }
}

async function graphqlRequest (service, query, variables) {
  const response = await service.inject({
    path: '/graphql',
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  })

  const { data, errors } = response.json()

  if (errors) {
    throw errors
  }

  assert.strictEqual(response.statusCode, 200)

  return data
}

async function createGraphqlServiceFromFile (t, { file, fastify, exposeIntrospection = {} }) {
  delete require.cache[require.resolve(file)]
  const config = require(file)

  const service = Fastify(fastify ?? { logger: false })
  service.register(Mercurius, { schema: config.schema, resolvers: config.resolvers })

  if (exposeIntrospection) {
    service.get(exposeIntrospection.path || '/.well-known/graphql-composition', async function (req, reply) {
      return reply.graphql(introspectionQuery)
    })
  }

  t.after(async () => {
    try { await service.close() } catch { }
  })

  return { service, config }
}

async function createGraphqlServiceFromConfig (t, { fastify, mercurius, exposeIntrospection = {} }) {
  const service = Fastify(fastify ?? { logger: false })

  service.register(Mercurius, mercurius)

  if (exposeIntrospection) {
    service.get(exposeIntrospection.path || '/.well-known/graphql-composition', async function (req, reply) {
      return reply.graphql(introspectionQuery)
    })
  }

  t.after(async () => {
    try { await service.close() } catch { }
  })

  return service
}

async function createGraphqlServices (t, servicesConfig) {
  const services = []
  for (const config of servicesConfig) {
    let service
    if (config.file) {
      const s = await createGraphqlServiceFromFile(t, config)
      service = s.service
      config.reset = s.config.reset
      config.data = s.config.data
      config.entities = s.config.entities
    } else if (config.mercurius) {
      service = await createGraphqlServiceFromConfig(t, config)
    }
    const s = { name: config.name, config, service }
    if (config.listen) {
      s.host = await service.listen()
    }
    services.push(s)
  }

  return services
}

function assertObject (actual, expected) {
  for (const k of Object.keys(expected)) {
    if (typeof expected[k] === 'function' && typeof actual[k] === 'function') { continue }
    if (typeof expected === 'object') {
      assertObject(actual[k], expected[k])
      continue
    }
    assert.deepStrictEqual(actual[k], expected[k])
  }
}

module.exports = { graphqlRequest, createComposerService, createGraphqlServices, assertObject }
