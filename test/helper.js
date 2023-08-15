'use strict'
const { strictEqual } = require('node:assert')
const { join } = require('node:path')
const Fastify = require('fastify')
const { buildClientSchema, getIntrospectionQuery } = require('graphql')
const Mercurius = require('mercurius')
const { compose } = require('../lib')
const fixturesDir = join(__dirname, '..', 'fixtures')

async function startRouter (t, subgraphs) {
  const promises = subgraphs.map(async (subgraph) => {
    const {
      entities,
      reset,
      resolvers,
      schema
    } = require(join(fixturesDir, subgraph))
    const server = Fastify()

    t.after(() => {
      try {
        server.close()
      } catch {} // Ignore errors.
    })

    reset()
    server.register(Mercurius, { schema, resolvers })
    server.get('/.well-known/gql-composition', async function (req, reply) {
      const introspectionQuery = getIntrospectionQuery()

      return reply.graphql(introspectionQuery)
    })

    const host = await server.listen()

    return {
      entities,
      server: {
        host,
        composeEndpoint: '/.well-known/gql-composition',
        gqlEndpoint: '/graphql'
      }
    }
  })
  const subgraphConfigs = await Promise.all(promises)
  const routerConfig = {
    subgraphs: subgraphConfigs
  }
  const composer = await compose(routerConfig)
  const router = Fastify()

  router.register(Mercurius, {
    schema: buildClientSchema(composer.toSchema()),
    resolvers: composer.resolvers
  })

  return router
}

async function gqlRequest (router, query, variables) {
  const response = await router.inject({
    path: '/graphql',
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  })

  strictEqual(response.statusCode, 200)
  const { data, errors } = response.json()

  if (errors) {
    throw errors
  }

  return data
}

module.exports = { gqlRequest, startRouter }
