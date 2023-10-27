'use strict'
const { strictEqual } = require('node:assert')
const { join } = require('node:path')
const Fastify = require('fastify')
const { getIntrospectionQuery } = require('graphql')
const Mercurius = require('mercurius')
const { compose } = require('../lib')
const fixturesDir = join(__dirname, '..', 'fixtures')

async function startRouter (t, subgraphs, overrides = {}, extend) {
  const promises = subgraphs.map(async (subgraph) => {
    let {
      name,
      entities = {},
      reset,
      resolvers,
      schema,
      data
    } = require(join(fixturesDir, subgraph))
    const server = Fastify()

    t.after(async () => {
      try {
        // await server.close()
      } catch {} // Ignore errors.
    })

    reset()

    const subgraphOverrides = overrides?.subgraphs?.[subgraph]

    if (subgraphOverrides) {
      entities = structuredClone(entities)
      if (subgraphOverrides.entities) {
        for (const [k, v] of Object.entries(subgraphOverrides.entities)) {
          entities[k] = { ...entities[k], ...v }
        }
      }
    }

    server.register(Mercurius, { schema, resolvers, graphiql: true, subscription: true })
    server.get('/.well-known/graphql-composition', async function (req, reply) {
      const introspectionQuery = getIntrospectionQuery()

      return reply.graphql(introspectionQuery)
    })

    const extendServer = extend?.[subgraph]
    if (extendServer) {
      await server.ready()
      const { schema, resolvers } = extendServer(data)
      schema && server.graphql.extendSchema(schema)
      resolvers && server.graphql.defineResolvers(resolvers)
    }

    const host = await server.listen()

    console.log(subgraph, host)

    return {
      name,
      entities,
      server: {
        host,
        composeEndpoint: '/.well-known/graphql-composition',
        graphqlEndpoint: '/graphql'
      }
    }
  })
  const subgraphConfigs = await Promise.all(promises)
  const subscriptionRecorder = []
  const defaultSubscriptionHandler = {
    onError (ctx, topic, error) {
      subscriptionRecorder.push({ action: 'error', topic, error })
    },
    publish (ctx, topic, payload) {
      subscriptionRecorder.push({ action: 'publish', topic, payload })
      ctx.pubsub.publish({
        topic,
        payload
      })
    },
    subscribe (ctx, topic) {
      subscriptionRecorder.push({ action: 'subscribe', topic })
      return ctx.pubsub.subscribe(topic)
    },
    unsubscribe (ctx, topic) {
      subscriptionRecorder.push({ action: 'unsubscribe', topic })
      ctx.pubsub.close()
    }
  }
  const routerConfig = {
    subgraphs: subgraphConfigs,
    subscriptions: { ...defaultSubscriptionHandler, ...overrides.subscriptions }
  }
  const composer = await compose(routerConfig)
  const router = Fastify()

  router.register(Mercurius, {
    schema: composer.toSdl(),
    resolvers: composer.resolvers,
    graphiql: true,
    subscription: true
  })

  await router.ready()
  router.graphql.addHook('onSubscriptionEnd', composer.onSubscriptionEnd)
  router._subscriptionRecorder = subscriptionRecorder
  return router
}

async function graphqlRequest (router, query, variables) {
  const response = await router.inject({
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

  strictEqual(response.statusCode, 200)

  return data
}

async function startGraphqlService (t, { fastify, mercurius, exposeIntrospection = {} }) {
  const service = Fastify(fastify ?? { logger: false })

  service.register(Mercurius, mercurius)

  if (exposeIntrospection) {
    service.get(exposeIntrospection.path || '/.well-known/graphql-composition', async function (req, reply) {
      return reply.graphql(getIntrospectionQuery())
    })
  }

  t.after(async () => {
    try {
      await service.close()
    } catch { } // Ignore errors.
  })

  return service
}

module.exports = { graphqlRequest, startRouter, startGraphqlService }
