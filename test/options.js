'use strict'
const assert = require('node:assert')
const { test } = require('node:test')

const { compose } = require('../lib')
const { startGraphqlService, graphqlRequest } = require('./helper')

test('should build a service using composer without subscriptions', async (t) => {
  let calls = 0

  const service = await startGraphqlService(t, {
    mercurius: {
      schema: `
    type Query {
      add(x: Int, y: Int): Int
    }`,
      resolvers: {
        Query: {
          async add (_, { x, y }) {
            calls++
            return x + y
          }
        }
      }
    }
  })
  const host = await service.listen()

  const composer = await compose({
    subgraphs: [{ server: { host } }]
  })

  const router = await startGraphqlService(t, {
    mercurius: {
      schema: composer.toSdl(),
      resolvers: composer.resolvers
    }
  })

  await router.listen({ port: 0 })

  const query = '{ add(x: 2, y: 2) }'
  const data = await graphqlRequest(router, query)
  assert.deepStrictEqual(data, { add: 4 })

  assert.strictEqual(calls, 1)
})

test('should get error when onSubgraphError is not a function', async (t) => {
  await assert.rejects(compose({
    subgraphs: [{ server: { host: 'http://graph1.local' } }],
    onSubgraphError: 1
  }), {
    name: 'TypeError',
    message: 'onSubgraphError must be a function'
  })
})
