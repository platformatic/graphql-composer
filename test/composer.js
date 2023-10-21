'use strict'
const assert = require('node:assert')
const { test } = require('node:test')

const { compose } = require('../lib')
const { startGraphqlService } = require('./helper')

test('should get sdl from composer', async (t) => {
  const services = [
    {
      schema: `
      type Query {
        add(x: Int, y: Int): Int
      }`,
      resolvers: { Query: { add: (_, { x, y }) => x + y } }
    },
    {
      schema: `
      type Query {
        mul(a: Int, b: Int): Int
      }`,
      resolvers: { Query: { mul: (_, { a, b }) => a * b } }
    },
    {
      schema: `
      type Query {
        sub(x: Int, y: Int): Int
      }`,
      resolvers: { Query: { sub: (_, { x, y }) => x - y } }
    }]
  const expectedSdl = 'type Query {\n' +
  '  add(x: Int, y: Int): Int\n' +
  '  mul(a: Int, b: Int): Int\n' +
  '  sub(x: Int, y: Int): Int\n' +
  '}'

  for (const service of services) {
    const instance = await startGraphqlService(t, {
      schema: service.schema,
      resolvers: service.resolvers
    })
    service.host = await instance.listen()
  }

  const composer = await compose({
    subgraphs: services.map(service => (
      {
        server: {
          host: service.host,
          composeEndpoint: '/graphql-composition',
          graphqlEndpoint: '/graphql'
        }
      }
    ))
  })

  await startGraphqlService(t, {
    schema: composer.toSdl(),
    resolvers: composer.resolvers
  })

  assert.strictEqual(expectedSdl, composer.toSdl())
})
