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
    server.register(Mercurius, { schema, resolvers, subscription: true })
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
  const subscriptionRecorder = []
  const routerConfig = {
    subgraphs: subgraphConfigs,
    subscriptions: {
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
  }
  const composer = await compose(routerConfig)
  const router = Fastify()

  router.register(Mercurius, {
    schema: buildClientSchema(composer.toSchema()),
    resolvers: composer.resolvers,
    subscription: true
  })

  await router.ready()
  router.graphql.addHook('onSubscriptionEnd', composer.onSubscriptionEnd)
  router._subscriptionRecorder = subscriptionRecorder
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
