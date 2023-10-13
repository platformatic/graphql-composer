'use strict'
const assert = require('node:assert')
const { test } = require('node:test')

const { compose } = require('../lib')
const { startGraphqlService, graphqlRequest } = require('./helper')
const { buildClientSchema } = require('graphql')

test('should build a service using composer without subscriptions', async (t) => {
  let calls = 0

  const service = await startGraphqlService(t, {
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
  })
  await service.listen({ port: 0 })

  const composer = await compose({
    subgraphs: [
      {
        server: {
          host: 'http://localhost:' + service.server.address().port,
          composeEndpoint: '/graphql-composition',
          graphqlEndpoint: '/graphql'
        }
      }
    ]
  })

  const router = await startGraphqlService(t, {
    schema: buildClientSchema(composer.toSchema()),
    resolvers: composer.resolvers
  })

  await router.listen({ port: 0 })

  const query = '{ add(x: 2, y: 2) }'
  const data = await graphqlRequest(router, query)
  assert.deepStrictEqual(data, { add: 4 })

  assert.equal(calls, 1)
})
